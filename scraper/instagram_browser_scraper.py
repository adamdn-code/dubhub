"""
Reads club Instagram posts by opening each club's page in a real Chrome window (Playwright)
and keeping the post data Instagram's own page downloads. Unlike Instaloader, it doesn't
imitate Instagram's private requests, so it keeps working when Instagram changes them.

Setup (one time):
  1. pip install playwright requests      (it uses your installed Chrome; no browser download)
  2. Log in as the DubHub account in the window this opens (2FA and checks work as usual):
         python instagram_browser_scraper.py --login
     The login stays in scraper/state/browser_profile/ (kept off GitHub). Nobody types a
     password anywhere else. Run --login again whenever it says the login expired.

Every run (from this folder):
     python instagram_browser_scraper.py
Options: --force (ignore the 20 hour limit), --headless (no window; easier to spot as a bot)

Then push the website so the new public/events.json and public/clubs.json go live.

It shares its club list, rotation and 20 hour limit with uw_instagram_scraper.py, so run one
or the other, not both. To look like a person reading and avoid getting the account
flagged, it scrolls and pauses at varying speeds, and waits 30-60 seconds between clubs.
It stops as soon as Instagram asks it to log in or check the account.
"""

import ctypes
import json
import random
import sys
import time
from datetime import datetime, timedelta

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

import uw_event_scraper
from events_common import (
    LOOKBACK_DAYS,
    STATE_DIR,
    TODAY,
    load_store,
    picture_text,
    picture_url,
    process_posts,
    redo_keyword_posts,
    save_club_profile,
    save_store,
    write_site_clubs,
    write_site_events,
)
from uw_instagram_scraper import (
    CHECKED_FILE,
    CLUBS_PER_RUN,
    LAST_RUN_FILE,
    MAX_WAIT,
    MIN_WAIT,
    POSTS_PER_CLUB,
    load_checked,
    ran_recently,
    read_clubs,
    this_runs_clubs,
)

PROFILE_DIR = STATE_DIR / "browser_profile"
# Where Instagram sends a browser it wants to sign in or check.
STOP_PATHS = ("/accounts/login", "/challenge", "/accounts/suspended", "/auth_platform")


class Stop(Exception):
    """Instagram wants a login or an account check: end the run."""


def open_browser(p, headless=False):
    return p.chromium.launch_persistent_context(
        str(PROFILE_DIR),
        channel="chrome",
        headless=headless,
        viewport={"width": random.randint(1240, 1420), "height": random.randint(760, 880)},
        locale="en-US",
        timezone_id="America/Los_Angeles",
        ignore_default_args=["--enable-automation"],  # no "controlled by automated software" bar
    )


def login():
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = open_browser(p)
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto("https://www.instagram.com/accounts/login/")
        print("Log in as the DubHub account in the Chrome window. Close the window when you see your feed.")
        try:
            page.wait_for_event("close", timeout=0)
        except PlaywrightError:
            pass
        logged_in = any(c["name"] == "sessionid" for c in browser.cookies("https://www.instagram.com"))
        browser.close()
    print("Saved the login." if logged_in else "No login found. Run --login again and finish logging in.")


# ------------------------------------------------------------- reading posts ---
def walk(obj):
    """Every dict inside a JSON response."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v)


def count(d, *paths):
    for path in paths:
        v = d
        for key in path:
            v = v.get(key) if isinstance(v, dict) else None
        if isinstance(v, int):
            return v
    return None


def as_post(d, handle):
    """A post of this club, from whichever shape Instagram's JSON is in this week, or None."""
    code = d.get("code") or d.get("shortcode")
    taken = d.get("taken_at") or d.get("taken_at_timestamp")
    if not isinstance(code, str) or not isinstance(taken, int):
        return None
    owner = (d.get("user") or d.get("owner") or {}).get("username")
    if owner and owner.lower() != handle:
        return None  # a suggested account's post, not this club's
    caption = d.get("caption")
    if isinstance(caption, dict):
        caption = caption.get("text")
    if not isinstance(caption, str):
        edges = (d.get("edge_media_to_caption") or {}).get("edges") or [{}]
        caption = (edges[0].get("node") or {}).get("text") or ""
    return {
        "key": code,
        "caption": caption,
        "posted": datetime.fromtimestamp(taken).date(),
        "url": f"https://www.instagram.com/p/{code}/",
        "source": "instagram",
        "pinned": bool(d.get("is_pinned") or d.get("timeline_pinned_user_ids")),
        "likes": count(d, ("like_count",), ("edge_liked_by", "count"), ("edge_media_preview_like", "count")),
        "comments": count(d, ("comment_count",), ("edge_media_to_comment", "count")),
        # Kept for the site: the picture (saved to public/ig/ for events) and the flyer's text.
        "image_src": picture_url(d),
        "image_text": picture_text(d.get("accessibility_caption")),
    }


def as_profile(d, handle):
    if (d.get("username") or "").lower() == handle and ("full_name" in d or "biography" in d):
        return d
    return None


# ------------------------------------------------------------ acting human ---
def pause(lo, hi):
    time.sleep(random.uniform(lo, hi))


def read_like_a_person(page):
    """Look at the page for a while: drift the mouse, scroll down in uneven steps, sometimes back up."""
    pause(2, 5)
    w, h = page.viewport_size["width"], page.viewport_size["height"]
    for _ in range(random.randint(3, 6)):
        page.mouse.move(random.randint(80, w - 80), random.randint(120, h - 80), steps=random.randint(8, 25))
        page.mouse.wheel(0, random.randint(250, 700))
        pause(0.8, 2.6)
        if random.random() < 0.2:
            page.mouse.wheel(0, -random.randint(100, 300))
            pause(0.5, 1.5)


def check_page(page):
    if any(p in page.url for p in STOP_PATHS):
        raise Stop(f"Instagram sent the browser to {page.url}")


def read_club(page, handle, store, cutoff):
    """New posts from one club's page, and refreshed like counts for posts already saved."""
    responses = []
    listener = lambda r: responses.append(r) if r.request.resource_type in ("xhr", "fetch") else None
    page.on("response", listener)
    try:
        page.goto(f"https://www.instagram.com/{handle}/", wait_until="domcontentloaded", timeout=60000)
        check_page(page)
        read_like_a_person(page)
        check_page(page)
    finally:
        page.remove_listener("response", listener)

    found, profile = {}, None
    for r in responses:
        if "instagram.com" not in r.url:
            continue
        try:
            data = r.json()
        except (PlaywrightError, ValueError):
            continue
        for d in walk(data):
            profile = profile or as_profile(d, handle)
            post = as_post(d, handle)
            if post:
                found.setdefault(post["key"], post)

    if not found and not profile:
        unavailable = page.locator("text=Sorry, this page isn't available").count()
        return None if unavailable else []
    if profile:
        save_club_profile(handle, profile.get("full_name"), profile.get("biography"), profile.get("external_url"))
    club = uw_event_scraper.format_club((profile or {}).get("full_name") or None, handle)

    new = []
    for post in sorted(found.values(), key=lambda p: p["posted"], reverse=True)[:POSTS_PER_CLUB]:
        if post["key"] in store:
            if post["likes"] is not None:
                store[post["key"]].update(likes=post["likes"], comments=post["comments"])
            continue
        if post["posted"] < cutoff:
            continue
        post.pop("pinned")
        new.append({**post, "club": club})
    return new


def keep_awake(on):
    """Ask Windows not to sleep during the run (a sleeping laptop drops the connection)."""
    if sys.platform == "win32":
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000003 if on else 0x80000000)


def scrape(store, headless):
    cutoff = TODAY - timedelta(days=LOOKBACK_DAYS)
    every = read_clubs()
    checked = load_checked()
    handles = this_runs_clubs(every, checked)
    print(f"Checking {len(handles)} of {len(every)} clubs this run; the rest get their turn on later runs.")
    LAST_RUN_FILE.parent.mkdir(exist_ok=True)
    LAST_RUN_FILE.write_text(datetime.now().isoformat())

    posts = []
    with sync_playwright() as p:
        browser = open_browser(p, headless)
        page = browser.pages[0] if browser.pages else browser.new_page()
        try:
            page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
            check_page(page)
            if not any(c["name"] == "sessionid" for c in browser.cookies("https://www.instagram.com")):
                raise Stop("not logged in")
            read_like_a_person(page)
            for i, handle in enumerate(handles):
                if i:
                    wait = random.uniform(MIN_WAIT, MAX_WAIT)
                    print(f"    waiting {wait:.0f}s before the next club...", flush=True)
                    time.sleep(wait)
                print(f"[{i + 1}/{len(handles)}] checking {handle}...", flush=True)
                new = read_club(page, handle, store, cutoff)
                if new is None:
                    print(f"[{i + 1}/{len(handles)}] {handle}: account not found, skipping")
                else:
                    print(f"[{i + 1}/{len(handles)}] {handle}: {len(new)} new post(s)")
                    posts += new
                checked[handle] = datetime.now().isoformat(timespec="minutes")
                CHECKED_FILE.write_text(json.dumps(checked, indent=1), encoding="utf-8")
        except Stop as e:
            print(f"\nStopping: {e}. Run: python instagram_browser_scraper.py --login")
        except PlaywrightError as e:
            print(f"\nThe browser hit a problem ({str(e).splitlines()[0][:150]}). Keeping what was read.")
        finally:
            browser.close()
    return posts


def main():
    if "--login" in sys.argv:
        return login()
    if not PROFILE_DIR.exists():
        sys.exit("Log in first: python instagram_browser_scraper.py --login")
    last = ran_recently()
    if last and "--force" not in sys.argv:
        sys.exit(f"Already ran at {last:%b %d %I:%M %p}. Running more than once a day gets "
                 "accounts flagged. Use --force if you really need to.")

    store = load_store()
    keep_awake(True)
    try:
        posts = scrape(store, "--headless" in sys.argv)
    finally:
        keep_awake(False)
    print(f"Instagram: {len(posts)} new post(s).")
    process_posts(posts, store)
    redo_keyword_posts(store)
    save_store(store)
    write_site_events(store)
    write_site_clubs(store)


if __name__ == "__main__":
    main()
