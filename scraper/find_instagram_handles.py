"""
Finds the Instagram account of each club in huskylink.json (run
huskylink_scraper.py first), so uw_instagram_scraper.py can read their posts.

It looks in three places, in this order:
  1. the club's HuskyLink website, when that is their Instagram,
  2. an @handle in the club's mission statement,
  3. Instagram links on the club's own website (Linktree, Google Sites, ...).

Every run (from this folder):
  python find_instagram_handles.py            # only clubs not checked yet
  python find_instagram_handles.py --refresh  # check every club again

Results go to club_instagram.json (kept on GitHub). Clubs already in that file
are skipped. To fix a wrong handle by hand (or set it to null to stop that club
being scraped), also set its "from" to "manual" so --refresh never changes it.

A handle found on a website only counts if it sounds like UW (has "uw", "husky",
"dub", "dawg", "seattle" or "washington" in it), and a handle several clubs
share is dropped, since that's usually UW's, a department's or a national
organization's account rather than the club's own.
"""

import json
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import requests

from events_common import CLUB_INSTAGRAM_FILE, HUSKYLINK_FILE, club_key

HEADERS = {"User-Agent": "Mozilla/5.0 (DubHub club finder; github.com/adamxlegend/dubhub)"}
SKIP_HOSTS = ("huskylink.washington.edu", "instagram.com", "discord.gg", "discord.com", "facebook.com")
IG_LINK = re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})", re.I)
AT_HANDLE = re.compile(r"(?<![\w.@/])@([A-Za-z0-9_.]{3,30})")
# instagram.com/<these> are Instagram's own pages, not accounts.
NOT_ACCOUNTS = {"p", "reel", "reels", "explore", "accounts", "stories", "tv", "about", "developer",
                "legal", "direct", "share", "sharer", "web", "instagram", "_u", "static", "embed"}


def clean_handle(h):
    h = h.strip(".").lower()
    if h in NOT_ACCOUNTS or re.search(r"\.(edu|com|org|net)$", h):
        return None
    return h


GENERIC_WORDS = {"university", "washington", "club", "association", "society", "student", "students",
                 "chapter", "the", "and"}


def name_match(handle, name):
    """How much the handle looks like this particular club's name (0 = not at all)."""
    flat = re.sub(r"[._]", "", handle)
    key = club_key(name)
    words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) >= 4 and w not in GENERIC_WORDS]
    acronym = "".join(w[0] for w in re.findall(r"[A-Za-z]+", name)
                      if w[0].isupper() and w.lower() not in GENERIC_WORDS).lower()
    return (bool(key) and (flat in key or key in flat)) * 4 + sum(w in flat for w in words) * 2 + \
        (len(acronym) >= 3 and acronym in flat) * 2


UW_HANDLE = re.compile(r"uw|husk|dub|dawg|seattle|washington", re.I)


def score(handle, name):
    return name_match(handle, name) + bool(UW_HANDLE.search(handle))


def best_handle(handles, name):
    """Pick the handle that looks most like the club (a site can also link a national org or department)."""
    handles = list(dict.fromkeys(h for h in map(clean_handle, handles) if h))
    return max(handles, key=lambda h: score(h, name)) if handles else None


def from_website(club):
    url = club["website"] or ""
    host = urllib.parse.urlparse(url).netloc.lower().removeprefix("www.")
    if not url.startswith("http") or any(host.endswith(s) for s in SKIP_HOSTS):
        return None
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
    except requests.RequestException:
        return None
    if not r.ok:
        return None
    # Websites often link a national organization's account too; only a UW-sounding handle is the club's.
    return best_handle([h for h in IG_LINK.findall(r.text) if UW_HANDLE.search(h)], club["name"])


def find(club):
    website = club["website"] or ""
    if "instagram.com/" in website:
        m = IG_LINK.search(website)
        if m and clean_handle(m.group(1)):
            return clean_handle(m.group(1)), "huskylink"
    handle = best_handle(AT_HANDLE.findall(club["description"] or ""), club["name"])
    if handle:
        return handle, "mission"
    handle = from_website(club)
    return (handle, "website") if handle else (None, None)


def drop_shared(found):
    """A handle several clubs got is only kept for the one club whose name clearly matches it."""
    owners = {}
    for name, v in found.items():
        if v["handle"] and v.get("from") != "manual":
            owners.setdefault(v["handle"], []).append(name)
    for handle, names in owners.items():
        if len(names) < 2:
            continue
        matching = [n for n in names if name_match(handle, n)]
        for n in names:
            if len(matching) != 1 or n != matching[0]:
                found[n].update({"handle": None, "from": "shared"})


def main():
    try:
        clubs = json.loads(HUSKYLINK_FILE.read_text(encoding="utf-8"))["clubs"]
    except FileNotFoundError:
        sys.exit("No huskylink.json yet. Run: python huskylink_scraper.py")
    try:
        found = json.loads(CLUB_INSTAGRAM_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        found = {}

    if "--refresh" in sys.argv:
        found = {k: v for k, v in found.items() if v.get("from") == "manual"}
    todo = [c for c in clubs if c["name"] not in found]
    print(f"Looking for the Instagram of {len(todo)} clubs (checking their websites takes a few minutes)...")
    with ThreadPoolExecutor(max_workers=8) as pool:
        for n, (club, (handle, source)) in enumerate(zip(todo, pool.map(find, todo)), 1):
            found[club["name"]] = {"handle": handle, "from": source, "checked": date.today().isoformat()}
            if n % 100 == 0:
                print(f"  {n}/{len(todo)}...", flush=True)
    drop_shared(found)

    found = dict(sorted(found.items(), key=lambda kv: kv[0].lower()))
    CLUB_INSTAGRAM_FILE.write_text(json.dumps(found, indent=1, ensure_ascii=False), encoding="utf-8")
    have = sum(1 for v in found.values() if v["handle"])
    print(f"{have} of {len(found)} clubs have an Instagram. Saved to {CLUB_INSTAGRAM_FILE}")


if __name__ == "__main__":
    main()
