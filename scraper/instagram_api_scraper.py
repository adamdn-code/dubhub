"""
Reads club Instagram posts through Instagram's official API (Business
Discovery) instead of logging in like a person, so the account can't get
blocked. Finds events in the posts the same way uw_instagram_scraper.py does.

Limits: it can only read clubs whose Instagram is a professional account
(Business or Creator). Clubs with personal accounts are skipped; the
Instaloader scraper (uw_instagram_scraper.py) still works for those.

Setup (one time, see the steps in the DubHub README or ask in the team chat):
  1. Make the DubHub Instagram a professional account, connected to a Facebook Page.
  2. Make a Meta developer app (developers.facebook.com > My Apps > Create App).
  3. In Graph API Explorer, pick the app, add the permissions instagram_basic,
     instagram_manage_insights, pages_show_list and pages_read_engagement,
     click "Generate Access Token" and copy it.
  4. Run (from this folder):  python instagram_api_scraper.py --setup
     and paste the app ID, app secret and that token when asked (hidden).
     It saves a token that doesn't expire to scraper/.env (never on GitHub).

Every run (from this folder):
  python instagram_api_scraper.py

Then push the website so the new public/events.json and public/clubs.json go live.
"""

import getpass
import json
import os
import re
import sys
from datetime import datetime, timedelta

import requests

import uw_event_scraper
from events_common import (
    HERE,
    LOOKBACK_DAYS,
    STATE_DIR,
    TODAY,
    found_instagram_handles,
    load_store,
    process_posts,
    read_club_handles,
    redo_keyword_posts,
    save_club_profile,
    save_store,
    write_site_clubs,
    write_site_events,
)

GRAPH = "https://graph.facebook.com/v26.0"
ENV_FILE = HERE / ".env"
CHECKED_FILE = STATE_DIR / "instagram_api_checked.json"  # handle -> when it was last checked
CLUBS_PER_RUN = 150   # Meta allows about 200 requests an hour per account
POSTS_PER_CLUB = 6
DUBHUB_ACCOUNT = "dubhub.uw"
RATE_LIMIT_CODES = {4, 17, 32, 613, 80002}
NOT_FOUND_CODES = {100, 110}  # not a professional account, renamed, or doesn't exist


class GraphError(Exception):
    def __init__(self, error):
        self.code = error.get("code")
        super().__init__(error.get("message", "unknown error"))


def graph(path, **params):
    r = requests.get(f"{GRAPH}/{path}", params=params, timeout=30)
    data = r.json()
    if "error" in data:
        raise GraphError(data["error"])
    return data


# ------------------------------------------------------------------- setup ---
def save_env(values):
    """Set NAME=value lines in scraper/.env, keeping everything else in it."""
    try:
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        lines = []
    lines = [line for line in lines if line.split("=", 1)[0].strip() not in values]
    lines += [f"{k}={v}" for k, v in values.items()]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def setup():
    app_id = input("Meta app ID: ").strip()
    secret = getpass.getpass("Meta app secret (hidden): ").strip()
    short = getpass.getpass("Access token from Graph API Explorer (hidden): ").strip()
    try:
        long_user = graph("oauth/access_token", grant_type="fb_exchange_token", client_id=app_id,
                          client_secret=secret, fb_exchange_token=short)["access_token"]
        pages = graph("me/accounts", fields="name,access_token,instagram_business_account{username}",
                      access_token=long_user)["data"]
    except GraphError as e:
        sys.exit(f"Meta said: {e}\nCheck the app ID and secret, and make a fresh token in Graph API Explorer.")

    linked = [p for p in pages if p.get("instagram_business_account")]
    if not linked:
        sys.exit("None of your Facebook Pages has an Instagram professional account connected. Connect "
                 f"@{DUBHUB_ACCOUNT} to a Page (Instagram app > Settings > Accounts Center), then try again.")
    page = next((p for p in linked if p["instagram_business_account"].get("username", "").lower()
                 == DUBHUB_ACCOUNT), linked[0])
    ig_id = page["instagram_business_account"]["id"]
    username = page["instagram_business_account"].get("username")

    # A Page token made from a long-lived user token never expires; fall back to the 60-day user token.
    for token, note in ((page["access_token"], "doesn't expire"), (long_user, "lasts about 60 days")):
        try:
            graph(ig_id, fields=f"business_discovery.username({username}){{username}}", access_token=token)
        except GraphError:
            continue
        save_env({"META_IG_USER_ID": ig_id, "META_IG_TOKEN": token})
        print(f"Connected as @{username} through the Page \"{page['name']}\". Saved a token that {note} "
              f"to {ENV_FILE}.\nNow run: python instagram_api_scraper.py")
        return
    sys.exit("Got a token, but Business Discovery didn't work with it. In Graph API Explorer, make sure the "
             "token has instagram_basic, instagram_manage_insights, pages_show_list and pages_read_engagement.")


# ----------------------------------------------------------------- scraping ---
def load_checked():
    try:
        return json.loads(CHECKED_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def read_club(ig_id, token, handle):
    fields = (f"business_discovery.username({handle}){{username,name,biography,website,"
              f"media.limit({POSTS_PER_CLUB}){{caption,timestamp,permalink}}}}")
    return graph(ig_id, fields=fields, access_token=token)["business_discovery"]


def scrape(store):
    """Read new posts from this run's clubs. Returns the posts."""
    ig_id, token = os.environ.get("META_IG_USER_ID"), os.environ.get("META_IG_TOKEN")
    if not ig_id or not token:
        sys.exit("Not set up yet. Run: python instagram_api_scraper.py --setup")

    every = list(dict.fromkeys(h.lower() for h in read_club_handles() + list(found_instagram_handles().values())))
    checked = load_checked()
    handles = sorted(every, key=lambda h: checked.get(h, ""))[:CLUBS_PER_RUN]
    print(f"Checking {len(handles)} of {len(every)} clubs this run; the rest get their turn on later runs.")

    cutoff = TODAY - timedelta(days=LOOKBACK_DAYS)
    posts, skipped = [], 0
    for i, handle in enumerate(handles, 1):
        try:
            club = read_club(ig_id, token, handle)
        except GraphError as e:
            if e.code == 190:
                sys.exit(f"The saved token stopped working ({e}). Run: python instagram_api_scraper.py --setup")
            if e.code in RATE_LIMIT_CODES:
                print(f"Hit Meta's hourly limit after {i - 1} clubs; the rest wait for the next run.")
                break
            if e.code not in NOT_FOUND_CODES:
                print(f"[{i}/{len(handles)}] {handle}: {e}")
            skipped += 1  # usually a personal (not professional) account
        else:
            save_club_profile(handle, club.get("name"), club.get("biography"), club.get("website"))
            name = uw_event_scraper.format_club(club.get("name") or None, handle)
            new = 0
            for m in club.get("media", {}).get("data", []):
                shortcode = re.search(r"/(?:p|reel|tv)/([^/?#]+)", m.get("permalink", ""))
                posted = datetime.fromisoformat(m["timestamp"].replace("+0000", "+00:00")).date()
                if not shortcode or posted < cutoff or shortcode.group(1) in store:
                    continue
                posts.append({
                    "key": shortcode.group(1),  # same key the Instaloader scraper uses, so no duplicates
                    "club": name,
                    "caption": m.get("caption") or "",
                    "posted": posted,
                    "url": m["permalink"],
                    "source": "instagram",
                })
                new += 1
            print(f"[{i}/{len(handles)}] {handle}: {new} new post(s)")
        checked[handle] = datetime.now().isoformat(timespec="minutes")
    STATE_DIR.mkdir(exist_ok=True)
    CHECKED_FILE.write_text(json.dumps(checked, indent=1), encoding="utf-8")
    print(f"{skipped} club(s) skipped (personal accounts can't be read through the API).")
    return posts


def main():
    if "--setup" in sys.argv:
        setup()
        return
    store = load_store()
    posts = scrape(store)
    print(f"Instagram API: {len(posts)} new post(s).")
    process_posts(posts, store)
    redo_keyword_posts(store)
    save_store(store)
    write_site_events(store)
    write_site_clubs(store)


if __name__ == "__main__":
    main()
