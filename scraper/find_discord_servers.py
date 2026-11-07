"""
Finds UW clubs' Discord servers, so the site can link each club's server and discord_events.py
knows which server belongs to which club. No Discord login: it only reads what any visitor sees.

Where it looks, for every HuskyLink club and every Instagram-only club in clubs.txt:
  1. the club's HuskyLink details (its website link and mission text),
  2. the club's Instagram bio and bio link, including link pages like Linktree,
  3. the club's own website.
Each invite is checked with Discord's public invite lookup (what Discord's own invite previews
use), which gives the server's name, icon and member count, or says the invite has expired. An
invite several clubs link (a department's or a UW-wide server) isn't any one club's, so it's only
kept for a club whose name matches the server's.

Results go to club_discord.json (kept on GitHub): club name (or "@handle" for clubs only on
Instagram) -> {invite, guild_id, server, members, icon, from, checked}. To fix one by hand, set
its "from" to "manual" and it won't be changed.

Every run (from this folder):
    python find_discord_servers.py             # clubs not checked in the last week
    python find_discord_servers.py --refresh   # check every club again
"""

import json
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import requests

from events_common import CLUB_DISCORD_FILE, CLUB_INSTAGRAM_FILE, HUSKYLINK_FILE, STATE_DIR, club_key, read_club_handles
from find_instagram_handles import HEADERS, name_match

CLUB_PROFILES_FILE = STATE_DIR / "club_profiles.json"
INVITE = re.compile(r"(?:discord\.gg|discord(?:app)?\.com/invite)/([A-Za-z0-9-]{2,32})", re.I)
RECHECK_DAYS = 7
LOOKUP_WAIT = 1.2  # seconds between Discord invite lookups (it rate-limits bursts)
# Pages not worth fetching for a club's own links.
SKIP_HOSTS = ("huskylink.washington.edu", "instagram.com", "facebook.com", "discord.gg", "discord.com",
              "tiktok.com", "youtube.com", "twitter.com", "x.com")


def page_invites(url):
    """Discord invite codes on a web page (a club website or a Linktree-style link page)."""
    host = urllib.parse.urlparse(url or "").netloc.lower().removeprefix("www.")
    if not (url or "").startswith("http") or any(host.endswith(s) for s in SKIP_HOSTS):
        return []
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
    except requests.RequestException:
        return []
    return INVITE.findall(r.text) if r.ok else []


def candidates(club, profile):
    """(invite code, where it was found) pairs for one club, most trustworthy source first."""
    found = []
    for text in (club.get("website") or "", club.get("description") or ""):
        found += [(code, "huskylink") for code in INVITE.findall(text)]
    if profile:
        found += [(code, "instagram") for code in INVITE.findall(f"{profile.get('bio') or ''} {profile.get('website') or ''}")]
        found += [(code, "instagram-link") for code in page_invites(profile.get("website"))]
    found += [(code, "website") for code in page_invites(club.get("website"))]
    return list(dict.fromkeys(found))


def look_up(code):
    """Discord's public preview of an invite: the server it leads to, or None if it expired."""
    for _ in range(4):
        r = requests.get(f"https://discord.com/api/v10/invites/{code}", params={"with_counts": "true"},
                         headers={"User-Agent": HEADERS["User-Agent"]}, timeout=20)
        if r.status_code == 429:
            time.sleep(float(r.json().get("retry_after", 5)) + 1)
            continue
        if r.status_code != 200:
            return None
        d = r.json()
        guild = d.get("guild") or {}
        if not guild.get("id"):
            return None  # a group-DM invite, not a server
        icon = guild.get("icon")
        return {
            "guild_id": guild["id"],
            "server": guild.get("name"),
            "members": d.get("approximate_member_count"),
            "icon": f"https://cdn.discordapp.com/icons/{guild['id']}/{icon}.png?size=128" if icon else None,
        }
    return None


def main():
    refresh = "--refresh" in sys.argv
    clubs = json.loads(HUSKYLINK_FILE.read_text(encoding="utf-8"))["clubs"]
    handles = {name: v["handle"] for name, v in json.loads(CLUB_INSTAGRAM_FILE.read_text(encoding="utf-8")).items()
               if v.get("handle")}
    try:
        profiles = json.loads(CLUB_PROFILES_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        profiles = {}
    try:
        saved = json.loads(CLUB_DISCORD_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        saved = {}

    # Every club to look at: HuskyLink clubs, plus Instagram-only clubs (keyed "@handle").
    todo = [(c["name"], c, profiles.get(handles.get(c["name"], ""))) for c in clubs]
    on_huskylink = set(handles.values())
    todo += [(f"@{h}", {"name": h}, profiles.get(h)) for h in read_club_handles() if h not in on_huskylink]
    since = (date.today() - timedelta(days=RECHECK_DAYS)).isoformat()
    todo = [t for t in todo if (saved.get(t[0]) or {}).get("from") != "manual"
            and (refresh or (saved.get(t[0]) or {}).get("checked", "") < since)]
    print(f"Looking for the Discord server of {len(todo)} clubs (their pages take a few minutes)...", flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        found = dict(zip([t[0] for t in todo], pool.map(lambda t: candidates(t[1], t[2]), todo)))
    codes = list(dict.fromkeys(code for pairs in found.values() for code, _ in pairs))
    print(f"Checking {len(codes)} invite link(s) with Discord...", flush=True)
    servers = {}
    for i, code in enumerate(codes):
        if i:
            time.sleep(LOOKUP_WAIT)
        servers[code] = look_up(code)

    today = date.today().isoformat()
    picked = {}
    for key, pairs in found.items():
        live = [(code, source) for code, source in pairs if servers.get(code)]
        if live:
            code, source = live[0]
            picked[key] = {"invite": f"https://discord.gg/{code}", **servers[code], "from": source, "checked": today}
        else:
            picked[key] = {"invite": None, "from": "expired" if pairs else None, "checked": today}

    # A server several clubs link isn't one club's; keep it only for a club whose name matches it.
    by_guild = {}
    for key, v in picked.items():
        if v.get("guild_id"):
            by_guild.setdefault(v["guild_id"], []).append(key)
    for guild_id, keys in by_guild.items():
        if len(keys) < 2:
            continue
        server = picked[keys[0]]["server"] or ""
        matching = [k for k in keys if name_match(club_key(server), k.lstrip("@")) or club_key(k) == club_key(server)]
        for k in keys:
            if len(matching) != 1 or k != matching[0]:
                picked[k] = {"invite": None, "from": "shared", "server": server, "checked": today}

    saved.update(picked)
    saved = dict(sorted(saved.items(), key=lambda kv: kv[0].lstrip("@").lower()))
    CLUB_DISCORD_FILE.write_text(json.dumps(saved, indent=1, ensure_ascii=False), encoding="utf-8")
    have = sum(1 for v in saved.values() if v.get("invite"))
    print(f"{have} clubs have a Discord server. Saved to {CLUB_DISCORD_FILE.name}")


if __name__ == "__main__":
    main()
