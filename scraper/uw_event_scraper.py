"""
Backup DubHub scraper: finds Instagram posts about UW club events through
Google (via SerpApi), so it never touches instagram.com and can't get blocked.
uw_instagram_scraper.py runs this automatically when Instagram blocks it.

Setup:
  1. pip install requests
  2. Make a free account at https://serpapi.com and copy your API key
  3. In PowerShell:  $env:SERPAPI_KEY = "your_key"
  4. (Optional, recommended) $env:GROQ_API_KEY = "your_key"  (see the Instagram scraper)
  5. python uw_event_scraper.py
"""

import os
import re
import sys
import time

import requests

from events_common import (
    load_store,
    parse_posted,
    process_posts,
    redo_keyword_posts,
    save_store,
    write_site_clubs,
    write_site_events,
)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY")
SERP_ENDPOINT = "https://serpapi.com/search.json"

# Add or change queries to cover more clubs. Each query costs 1 SerpApi search.
QUERIES = [
    '"University of Washington" club event',
    'UW RSO event "this week"',
    'UW Seattle club meeting "join us"',
    'Husky club general meeting',
    'UW club social night HUB',
    'UW club workshop info session',
]
TIME_FILTER = "qdr:w"  # Google time filter: qdr:w = past week, qdr:m = past month
DELAY = 0.5            # seconds between API calls

# Snippets usually look like:
#   12 likes, 0 comments - uwclub on October 12, 2026: "caption..."
SNIPPET_RE = re.compile(
    r"(?:[\d.,KkMm]+\s+likes?,\s+)?(?:[\d.,KkMm]+\s+comments?\s+)?-?\s*"
    r"(?P<user>[\w.]+)\s+on\s+(?P<posted>[A-Za-z]+\s+\d{1,2},\s+\d{4}):\s*"
    r"[\"“]?(?P<caption>.*)$",
    re.S,
)
# Newer snippets look like:
#   Photo by Ceramics Club at University of Washington on October 19, 2026. May be ...
#   October 19, 2026: Come to our ...
PHOTO_BY_RE = re.compile(r"Photo by (?P<name>.+?) on (?P<posted>[A-Z][a-z]+ \d{1,2}, \d{4})")
LEADING_DATE_RE = re.compile(r"^\s*(?P<posted>[A-Z][a-z]+ \d{1,2}, \d{4}):")
NON_USER_PATHS ={"p", "reel", "reels", "tv", "explore", "stories", "accounts"}
BAD_NAMES = {"instagram", "photos", "videos", "reels", "reel", "posts", "post", "p"}


def search(query):
    params = {
        "engine": "google",
        "q": f"site:instagram.com {query}",
        "num": 10,
        "tbs": TIME_FILTER,
        "api_key": SERPAPI_KEY,
    }
    r = requests.get(SERP_ENDPOINT, params=params, timeout=30)
    if r.status_code != 200:
        print(f"SerpApi error {r.status_code}: {r.text[:200]}", file=sys.stderr)
        return []
    return r.json().get("organic_results", [])


def handle_from_link(link):
    m = re.search(r"instagram\.com/([^/?#]+)", link or "")
    if m and m.group(1).lower() not in NON_USER_PATHS:
        return m.group(1)
    return None


def name_from_title(title):
    # "Husky Dance Club (@huskydance) • Instagram..." / 'Husky Dance Club on Instagram: "..."'
    for pat in (
        r"^(.*?)\s*\(@[\w.]+\)",
        r"^(.{2,60}?)\s+on Instagram",
        r"^(.{2,60}?)\s*[•|]\s*Instagram",
    ):
        m = re.match(pat, title or "")
        if m and m.group(1).strip() and m.group(1).strip().lower() not in BAD_NAMES:
            return m.group(1).strip()
    return None


def find_club(item, snippet_user):
    """Look for the club handle and name in every text field Google gave us."""
    title = item.get("title") or ""
    fields = " | ".join(str(item.get(k) or "") for k in ("title", "source", "displayed_link", "snippet"))

    user = snippet_user
    if not user:
        m = re.search(r"\(@([\w.]+)\)", fields)
        user = m.group(1) if m else None
    if not user:  # "Instagram · huskydance" style source lines
        m = next((m for m in re.finditer(r"Instagram\s*[·•›»-]\s*@?([A-Za-z0-9_.]{2,30})", fields)
                  if m.group(1).lower() not in BAD_NAMES), None)
        user = m.group(1) if m else None
    if not user:
        user = handle_from_link(item.get("link"))
    return user, name_from_title(title)


def format_club(name, user):
    if name and user and name.lower() != user.lower():
        return f"{name} (@{user})"
    if user:
        return f"@{user}"
    return name or "UW club"


def parse_snippet(snippet):
    """Google snippet -> (handle, posted date, caption, club name); any can be None."""
    m = SNIPPET_RE.search(snippet)
    if m:
        return m["user"], parse_posted(m["posted"]), m["caption"], None
    m = PHOTO_BY_RE.search(snippet)
    if m:
        return None, parse_posted(m["posted"]), snippet, m["name"].strip()
    m = LEADING_DATE_RE.match(snippet)
    return None, parse_posted(m["posted"]) if m else None, snippet, None


def collect(skip_keys=()):
    """Search Google for recent club posts. Returns posts in the shared format."""
    posts, seen = [], set(skip_keys)
    for q in QUERIES:
        for item in search(q):
            link = item.get("link") or ""
            if link in seen or "instagram.com" not in link:
                continue
            seen.add(link)
            snippet = (item.get("snippet") or "").replace("\n", " ").strip()
            user, posted, caption, name = parse_snippet(snippet)
            user, title_name = find_club(item, user)
            name = name or title_name
            code = re.search(r"instagram\.com/(?:p|reel)/([\w-]+)", link)
            key = code.group(1) if code else link  # same key the Instagram scraper uses
            if key in seen:
                continue
            seen.add(key)
            posts.append({
                "key": key,
                "club": format_club(name, user),
                "caption": caption.strip(' "”…'),
                "posted": posted,
                "url": link,
                "source": "google",
            })
        time.sleep(DELAY)
    return posts


def main():
    if not SERPAPI_KEY:
        sys.exit("Set SERPAPI_KEY first (see the top of this file).")
    store = load_store()
    posts = collect(store.keys())
    print(f"Google found {len(posts)} new post(s) from the past week.")
    process_posts(posts, store)
    redo_keyword_posts(store)
    save_store(store)
    write_site_events(store)
    write_site_clubs(store)


if __name__ == "__main__":
    main()
