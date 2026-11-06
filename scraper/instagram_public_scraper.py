"""
DubHub's no-login Instagram scraper. It reads each club's public Instagram page the way a
logged-out visitor sees it, so there's no account for Instagram to block. One request per club
gets the club's name, bio, link and profile picture, and its 12 newest posts: the picture, the
caption, the post's link, when it was posted, and the flyer's text from Instagram's description
of the picture. Then it finds the events in the posts (with AI if GROQ_API_KEY is set, keywords
otherwise, like the other scrapers) and keeps copies of the pictures for the site.

Sources (both MIT licensed). This scraper is modeled on them:
  - Instaloader, https://github.com/instaloader/instaloader (version 4.16 or newer).
    Its logged-out mode loads a profile's public page, which has the profile and its first
    posts embedded as JSON (InstaloaderContext.get_page_data). We use that, but read the posts
    straight from the page instead of looking each one up again, so a club costs 1 request
    instead of 1 + 1 per post.
  - instagram-media-scraper by ahmedrangel, https://github.com/ahmedrangel/instagram-media-scraper.
    Its "GraphQL, no cookie" method looks up a single post by its code without logging in.
    Instaloader 4.16 does the same in Post.from_shortcode, which we use (a few times per run)
    for the like counts of posts that announce events, and to fill in posts the Google scraper
    only found as cut-off snippets.
SOURCES.md lists the other scrapers we compared and why these two fit DubHub best.

Setup (one time):
    pip install --pre -U instaloader requests

Every run (from this folder):
    python instagram_public_scraper.py            # 40 clubs, the ones checked longest ago first
    python instagram_public_scraper.py --limit 10 # fewer clubs
Then push the website: public/events.json, public/clubs.json and the pictures in public/ig/.

To stay polite (and not get this computer's internet address blocked): one page per club, a
10-20 second pause between clubs, and it stops the moment Instagram asks it to slow down or
to log in. The clubs it didn't get to go first next run.
"""

import json
import random
import re
import sys
import time
from datetime import datetime, timedelta

import instaloader
import requests
from instaloader.exceptions import (
    BadResponseException,
    ConnectionException,
    LoginRequiredException,
    QueryReturnedNotFoundException,
)

from events_common import (
    IG_CLUB_IMAGES,
    LOOKBACK_DAYS,
    STATE_DIR,
    TODAY,
    found_instagram_handles,
    instagram_post_date,
    load_store,
    picture_text,
    process_posts,
    read_club_handles,
    redo_keyword_posts,
    save_club_profile,
    save_store,
    write_site_clubs,
    write_site_events,
)
from uw_event_scraper import format_club

CHECKED_FILE = STATE_DIR / "instagram_public_checked.json"  # handle -> when it was last checked
CLUBS_PER_RUN = 40
MIN_WAIT, MAX_WAIT = 10, 20     # seconds between clubs
DETAILS_PER_RUN = 15            # single-post lookups per run (likes, filling in Google snippets)
PICTURE_MAX_AGE_DAYS = 14       # re-download a club's profile picture this often
PICTURE_WIDTH = 640             # preferred width of saved post pictures


class SlowDown(Exception):
    """Instagram asked us to slow down or to log in: stop this run."""


class StopOnTooManyRequests(instaloader.RateController):
    """Instaloader's default is to sleep (sometimes for many minutes) and retry; stop instead."""

    def handle_429(self, query_type):
        raise SlowDown("Instagram answered 429 Too Many Requests")


def read_clubs():
    """Handles from clubs.txt plus the ones find_instagram_handles.py found."""
    handles = read_club_handles() + list(found_instagram_handles().values())
    return list(dict.fromkeys(h.lower() for h in handles))


def load_checked():
    try:
        return json.loads(CHECKED_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def club_page(L, handle):
    """One request: the club's public page. Returns (profile, post nodes), or (None, []) if the
    page had no profile in it."""
    try:
        page = L.context.get_page_data(f"{handle}/")
    except LoginRequiredException as e:
        raise SlowDown(f"Instagram wants a login ({e})") from e
    except ConnectionException as e:
        if "429" in str(e):
            raise SlowDown(str(e)) from e
        raise
    user = {}
    for data in page:
        user.update(data.get("xig_user_by_username") or {})
    if not user.get("pk"):
        return None, []
    timeline = user.pop("polaris_ordered_timeline_connection", None) or {}
    return user, [e.get("node") or {} for e in timeline.get("edges") or []]


def picture_url(node):
    """The post's picture: the page's thumbnail, or the size closest to PICTURE_WIDTH."""
    if node.get("display_uri"):
        return node["display_uri"]
    sizes = [c for c in (node.get("image_versions2") or {}).get("candidates") or [] if c.get("url")]
    if not sizes:
        return node.get("display_url")
    bigger = [c for c in sizes if (c.get("width") or 0) >= PICTURE_WIDTH]
    return (min(bigger, key=lambda c: c["width"]) if bigger else max(sizes, key=lambda c: c.get("width") or 0))["url"]


def caption_of(node):
    caption = node.get("caption")
    return (caption.get("text") if isinstance(caption, dict) else caption) or ""


def post_from_node(node, club):
    """A page or GraphQL post node -> a post in the shared format (see events_common.py)."""
    code = node["code"]
    return {
        "key": code,  # same key the other Instagram scrapers and the Google scraper use
        "club": club,
        "caption": caption_of(node),
        "posted": instagram_post_date(node.get("pk") or node.get("id")),
        "url": f"https://www.instagram.com/p/{code}/",
        "source": "instagram",
        "image_src": picture_url(node),
        "image_text": picture_text(node.get("accessibility_caption")),
        "likes": node.get("like_count"),
    }


def save_club_picture(handle, url):
    """Keep a copy of the club's profile picture for the site (Instagram's links expire)."""
    path = IG_CLUB_IMAGES / f"{handle}.jpg"
    fresh = path.exists() and time.time() - path.stat().st_mtime < PICTURE_MAX_AGE_DAYS * 86400
    if fresh or not url:
        return
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    except requests.RequestException:
        return
    if r.ok and r.headers.get("content-type", "").startswith("image/"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)


def scrape_clubs(L, store, limit):
    """Read this run's clubs. Returns (new posts, stopped early?)."""
    every = read_clubs()
    checked = load_checked()
    handles = sorted(every, key=lambda h: checked.get(h, ""))[:limit]
    print(f"Checking {len(handles)} of {len(every)} clubs this run, without logging in; "
          "the rest get their turn on later runs.", flush=True)

    cutoff = TODAY - timedelta(days=LOOKBACK_DAYS)
    posts, empty_pages, stopped = [], 0, False
    for i, handle in enumerate(handles, 1):
        if i > 1:
            time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
        try:
            user, nodes = club_page(L, handle)
        except SlowDown as e:
            print(f"\nStopping: {e}. The clubs left go first next run.", flush=True)
            stopped = True
            break
        except QueryReturnedNotFoundException:
            print(f"[{i}/{len(handles)}] {handle}: account not found, skipping", flush=True)
            user, nodes = None, []
        except (ConnectionException, BadResponseException) as e:
            print(f"[{i}/{len(handles)}] {handle}: couldn't load ({str(e)[:100]}), skipping", flush=True)
            continue  # try again next run

        if user is None:
            # A page without the profile in it, several times in a row, means Instagram is
            # showing a login wall instead of profiles.
            empty_pages += 1
            if empty_pages >= 3:
                print("\nStopping: Instagram stopped showing profiles to logged-out visitors.", flush=True)
                stopped = True
                break
        else:
            empty_pages = 0
            links = user.get("bio_links") or []
            save_club_profile(handle, user.get("full_name"), user.get("biography"),
                              (links[0].get("url") if links else None) or user.get("external_url"))
            save_club_picture(handle, user.get("profile_pic_url"))
            if user.get("is_private"):
                print(f"[{i}/{len(handles)}] {handle}: private account, skipping", flush=True)
            else:
                club = format_club(user.get("full_name") or None, handle)
                new = [post_from_node(n, club) for n in nodes if n.get("code") and n["code"] not in store]
                # Pinned posts come first and can be old, so check every post's date rather than
                # stopping at the first old one.
                new = [p for p in new if p["posted"] and p["posted"] >= cutoff]
                posts += new
                print(f"[{i}/{len(handles)}] {handle}: {len(new)} new post(s)", flush=True)
        checked[handle] = datetime.now().isoformat(timespec="minutes")

    STATE_DIR.mkdir(exist_ok=True)
    CHECKED_FILE.write_text(json.dumps(checked, indent=1), encoding="utf-8")
    return posts, stopped


def look_up_post(L, code):
    """One request: a single post by its code (the GraphQL method from instagram-media-scraper,
    via Instaloader). Returns its full node, or None."""
    try:
        post = instaloader.Post.from_shortcode(L.context, code)
    except LoginRequiredException as e:
        raise SlowDown(f"Instagram wants a login ({e})") from e
    except (QueryReturnedNotFoundException, BadResponseException):
        return None
    except ConnectionException as e:
        if "429" in str(e):
            raise SlowDown(str(e)) from e
        return None
    return {**post._node, **(post._full_metadata_dict or {})}


def add_details(L, store, new_posts):
    """A few single-post lookups: like counts for this run's posts that announce upcoming events
    (Trending on the site uses them), and the full caption and picture for posts the Google
    scraper only found as snippets (their events are found again from the full text)."""
    today = TODAY.isoformat()
    upcoming = lambda key: any(e["date"] >= today for e in store.get(key, {}).get("events") or [])
    want_likes = [p["key"] for p in new_posts if upcoming(p["key"])]
    snippets = [k for k, v in store.items() if v.get("source") == "google" and not v.get("image_src")
                and upcoming(k) and re.fullmatch(r"[\w-]{6,20}", k)]
    todo = (want_likes + snippets)[:DETAILS_PER_RUN]
    if not todo:
        return
    print(f"Looking up {len(todo)} post(s) for likes and full captions...", flush=True)
    refetched = []
    for i, code in enumerate(todo):
        if i:
            time.sleep(random.uniform(4, 8))
        try:
            node = look_up_post(L, code)
        except SlowDown as e:
            print(f"Stopping the lookups: {e}.", flush=True)
            break
        if not node:
            continue
        if store[code].get("source") == "google":
            owner = node.get("user") or node.get("owner") or {}
            club = format_club(owner.get("full_name") or None, owner.get("username")) if owner.get("username") \
                else store[code]["club"]
            post = post_from_node({**node, "code": code}, club)
            refetched.append({**post, "source": "google", "url": store[code]["url"]})
        elif node.get("like_count") is not None:
            store[code]["likes"] = node["like_count"]
    if refetched:
        print(f"Finding events again in {len(refetched)} post(s) with their full captions...", flush=True)
        process_posts(refetched, store)


def main():
    limit = CLUBS_PER_RUN
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    L = instaloader.Instaloader(
        quiet=True, max_connection_attempts=1, request_timeout=30,
        download_pictures=False, download_videos=False, download_video_thumbnails=False,
        download_geotags=False, download_comments=False, save_metadata=False,
        rate_controller=lambda context: StopOnTooManyRequests(context),
    )
    store = load_store()
    posts, stopped = scrape_clubs(L, store, limit)
    print(f"Instagram: {len(posts)} new post(s).", flush=True)
    process_posts(posts, store)
    redo_keyword_posts(store)
    if not stopped:
        add_details(L, store, posts)
    save_store(store)
    write_site_events(store)
    write_site_clubs(store)


if __name__ == "__main__":
    main()
