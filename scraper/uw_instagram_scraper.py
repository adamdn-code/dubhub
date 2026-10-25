"""
DubHub's main scraper: reads club Instagram accounts (via Instaloader) and
puts their upcoming events on the website (public/events.json).

Setup (one time):
  1. pip install instaloader requests
  2. List club handles in clubs.txt, one per line (# lines are ignored).
  3. Log in once with the THROWAWAY account (not your main one):
         python -m instaloader --login=dubhub.uw
  4. Optional but recommended, for much better event details: a free Groq key
     from https://console.groq.com > API Keys.

Every run (PowerShell, from this folder):
     $env:IG_USERNAME = "dubhub.uw"
     $env:GROQ_API_KEY = "gsk_..."      # optional
     $env:SERPAPI_KEY = "..."           # optional, used if Instagram blocks you
     python uw_instagram_scraper.py

Then push the website so the new public/events.json and public/clubs.json go live.
(To rebuild those two files from saved data without scraping: python events_common.py)

To avoid getting blocked, it:
  - runs at most once every 20 hours (use --force to override),
  - waits 30-60 seconds between clubs,
  - only reads posts from the past 3 weeks and stops at posts it already read,
  - stops immediately if Instagram pushes back, and then tries Google instead.
Options: --force (ignore the 20 hour limit), --google (skip Instagram, only use Google)
"""

import os
import random
import sys
import time
from datetime import datetime, timedelta
from itertools import islice

import instaloader

import uw_event_scraper
from events_common import (
    LOOKBACK_DAYS,
    STATE_DIR,
    TODAY,
    load_store,
    process_posts,
    redo_keyword_posts,
    save_club_profile,
    save_store,
    write_site_clubs,
    write_site_events,
)

IG_USERNAME = os.environ.get("IG_USERNAME")
CLUBS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "clubs.txt")
LAST_RUN_FILE = STATE_DIR / "last_instagram_run.txt"
POSTS_PER_CLUB = 6           # newest posts to check per club, at most
MIN_WAIT, MAX_WAIT = 30, 60  # seconds between clubs; slower = less chance of being blocked
MIN_HOURS_BETWEEN_RUNS = 20


def read_clubs():
    if not os.path.exists(CLUBS_FILE):
        sys.exit("Make a clubs.txt file with one Instagram handle per line.")
    with open(CLUBS_FILE, encoding="utf-8") as f:
        return [h for h in (line.split("#")[0].strip().lstrip("@") for line in f) if h]


def ran_recently():
    try:
        last = datetime.fromisoformat(LAST_RUN_FILE.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None
    return last if datetime.now() - last < timedelta(hours=MIN_HOURS_BETWEEN_RUNS) else None


def scrape_instagram(store):
    """Read new posts from every club. Returns (posts, blocked)."""
    L = instaloader.Instaloader(
        download_pictures=False, download_videos=False, download_video_thumbnails=False,
        download_geotags=False, download_comments=False, save_metadata=False,
        quiet=False,  # show Instaloader's "Too many queries, waiting N seconds" messages
    )
    try:
        L.load_session_from_file(IG_USERNAME)
    except FileNotFoundError:
        sys.exit(f"No saved login for {IG_USERNAME}. Run: python -m instaloader --login={IG_USERNAME}")

    LAST_RUN_FILE.parent.mkdir(exist_ok=True)
    LAST_RUN_FILE.write_text(datetime.now().isoformat())

    cutoff = TODAY - timedelta(days=LOOKBACK_DAYS)
    handles = read_clubs()
    posts = []
    for i, handle in enumerate(handles):
        if i:
            wait = random.uniform(MIN_WAIT, MAX_WAIT)
            print(f"    waiting {wait:.0f}s before the next club...", flush=True)
            time.sleep(wait)
        print(f"[{i + 1}/{len(handles)}] checking {handle}...", flush=True)
        try:
            profile = instaloader.Profile.from_username(L.context, handle)
            club = uw_event_scraper.format_club(profile.full_name or None, handle)
            save_club_profile(handle, profile.full_name, profile.biography, profile.external_url)  # no extra request
            new = 0
            for post in islice(profile.get_posts(), POSTS_PER_CLUB):
                pinned = getattr(post, "is_pinned", False)
                # Posts come newest first (after pinned ones), so the first old
                # or already-read post means everything after it is too.
                if post.date_utc.date() < cutoff or post.shortcode in store:
                    if pinned:
                        continue
                    break
                posts.append({
                    "key": post.shortcode,
                    "club": club,
                    "caption": post.caption or "",
                    "posted": post.date_utc.date(),
                    "url": f"https://www.instagram.com/p/{post.shortcode}/",
                    "source": "instagram",
                })
                new += 1
            print(f"[{i + 1}/{len(handles)}] {handle}: {new} new post(s)")
        except instaloader.ProfileNotExistsException:
            print(f"[{i + 1}/{len(handles)}] {handle}: account not found, skipping")
        except instaloader.PrivateProfileNotFollowedException:
            print(f"[{i + 1}/{len(handles)}] {handle}: private account, skipping")
        except instaloader.LoginRequiredException:
            print("Instagram logged you out. Run: python -m instaloader --login=" + IG_USERNAME)
            return posts, True
        except (
            instaloader.AbortDownloadException,  # "feedback_required" / checkpoint challenges
            instaloader.QueryReturnedBadRequestException,
            instaloader.ConnectionException,  # "Please wait a few minutes", 429s
        ) as e:
            print(f"\nInstagram is blocking this account ({str(e)[:120]}).")
            print("Stopping now so it doesn't get worse. Open Instagram as "
                  f"{IG_USERNAME}, clear any warning, and wait 24-48 hours before trying again.")
            return posts, True
    return posts, False


def main():
    google_only = "--google" in sys.argv
    store = load_store()
    posts, blocked = [], google_only

    if not google_only:
        if not IG_USERNAME:
            sys.exit('Set IG_USERNAME first, e.g.  $env:IG_USERNAME = "dubhub.uw"')
        last = ran_recently()
        if last and "--force" not in sys.argv:
            sys.exit(f"Already ran at {last:%b %d %I:%M %p}. Running more than once a day gets "
                     "accounts blocked. Use --force if you really need to.")
        posts, blocked = scrape_instagram(store)
        print(f"Instagram: {len(posts)} new post(s).")

    if blocked:
        if uw_event_scraper.SERPAPI_KEY:
            print("Trying Google search instead...")
            google_posts = uw_event_scraper.collect(set(store) | {p["key"] for p in posts})
            print(f"Google: {len(google_posts)} new post(s).")
            posts += google_posts
        else:
            print("(Set SERPAPI_KEY to automatically use Google search when this happens.)")

    process_posts(posts, store)
    redo_keyword_posts(store)
    save_store(store)
    write_site_events(store)
    write_site_clubs(store)


if __name__ == "__main__":
    main()
