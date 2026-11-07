"""
Reads events from the Discord servers of UW clubs that added the DubHub bot:
  1. the server's scheduled Events (Discord's Events tab): name, time, place, description, cover
     picture and how many people are interested. These need no AI.
  2. posts in the server's announcement channels (#announcements, #events, #news...), which go
     through the same AI event finder as Instagram captions (and the applications check).

The bot only reads servers whose admins added it, which is how Discord allows reading servers.
Tools that log in with a person's account instead ("self-bots") break Discord's terms and get
accounts banned; DubHub doesn't do that. find_discord_servers.py says which server is which club's.

Set-up, once:
  1. https://discord.com/developers/applications -> New Application ("DubHub") -> Bot ->
     Reset Token. Put the token in scraper/.env as DISCORD_BOT_TOKEN=...  (never share it or
     commit it; .env stays off GitHub).
  2. On the same Bot page, turn on "Message Content Intent" so it can read announcement posts.
  3. python discord_events.py --invite-link   prints the link club officers open to add the bot.
     It only asks to view channels and read message history.

Every run (from this folder):  python discord_events.py
Results: discord.json (the scheduled events; on GitHub) and the announcement posts in the
scraper's saved posts. Both show on the site from this run on.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

from events_common import (CLUB_DISCORD_FILE, DISCORD_EVENTS_FILE, LOOKBACK_DAYS, TODAY, _load, find_applications,
                           load_store, locate, process_posts, save_store, write_site_applications, write_site_events)

API = "https://discord.com/api/v10"
TOKEN = os.environ.get("DISCORD_BOT_TOKEN")  # events_common loads scraper/.env
SEATTLE = ZoneInfo("America/Los_Angeles")
PERMISSIONS = 1024 | 65536  # View Channels + Read Message History
ANNOUNCEMENT_CHANNELS = re.compile(r"announce|event|news|update|calendar", re.I)
MESSAGES_PER_CHANNEL = 50


def api(path, **params):
    """GET from Discord's API as the bot. None when the bot can't see that (no permission)."""
    for _ in range(5):
        r = requests.get(f"{API}{path}", params=params, timeout=30,
                         headers={"Authorization": f"Bot {TOKEN}",
                                  "User-Agent": "DubHub (https://github.com/adamxlegend/dubhub, 1.0)"})
        if r.status_code == 429:
            time.sleep(float(r.json().get("retry_after", 2)) + 0.5)
            continue
        if r.status_code == 401:
            sys.exit("Discord rejected DISCORD_BOT_TOKEN. Reset it on the developer page and update scraper/.env.")
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        return r.json()
    return None


def seattle(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(SEATTLE)


def club_of_server():
    """Discord server id -> the club's name as the site shows hosts ("@handle" for clubs only on
    Instagram), from find_discord_servers.py."""
    return {v["guild_id"]: k for k, v in _load(CLUB_DISCORD_FILE, {}).items() if v.get("guild_id")}


def scheduled_events(guild, host):
    """The server's upcoming events from its Events tab, as site events."""
    out = []
    for e in api(f"/guilds/{guild['id']}/scheduled-events", with_user_count="true") or []:
        if e.get("status") not in (1, 2):  # scheduled or happening now
            continue
        start = seattle(e["scheduled_start_time"])
        if start.date() < TODAY:
            continue
        end = seattle(e["scheduled_end_time"]) if e.get("scheduled_end_time") else None
        # External events have a place; stage and voice-channel events happen on Discord itself.
        where = (e.get("entity_metadata") or {}).get("location") or ("Online" if e.get("entity_type") in (1, 2) else None)
        out.append({
            "id": f"dc-{e['id']}",
            "title": e["name"].strip()[:80],
            "type": "Club",
            "host": host,
            "where": where,
            "pos": locate(where) if where and where != "Online" else None,
            "date": start.date().isoformat(),
            "start": start.strftime("%H:%M"),
            "end": end.strftime("%H:%M") if end and end.date() == start.date() else None,
            "url": f"https://discord.com/events/{guild['id']}/{e['id']}",
            "source": "discord",
            "description": (e.get("description") or "").strip() or None,
            "image": f"https://cdn.discordapp.com/guild-events/{e['id']}/{e['image']}.png?size=512" if e.get("image") else None,
            "rsvps": e.get("user_count"),
        })
    return out


def announcement_posts(guild, host, store):
    """New posts from the server's announcement channels, shaped like Instagram posts for the AI."""
    since = TODAY - timedelta(days=LOOKBACK_DAYS)
    posts = []
    for ch in api(f"/guilds/{guild['id']}/channels") or []:
        if ch.get("type") not in (0, 5) or not ANNOUNCEMENT_CHANNELS.search(ch.get("name") or ""):
            continue  # 0 = text channel, 5 = announcement channel
        for m in api(f"/channels/{ch['id']}/messages", limit=MESSAGES_PER_CHANNEL) or []:
            key = f"dcm{m['id']}"
            posted = seattle(m["timestamp"]).date()
            # Bots often post events as embeds; their title and text count as the post's words.
            text = " ".join(filter(None, [m.get("content")] + [
                f"{em.get('title') or ''} {em.get('description') or ''}".strip() for em in m.get("embeds") or []])).strip()
            if key in store or posted < since or len(text) < 20:
                continue
            posts.append({"key": key, "club": host, "caption": text[:2000], "source": "discord", "posted": posted,
                          "url": f"https://discord.com/channels/{guild['id']}/{ch['id']}/{m['id']}"})
    return posts


def main():
    if not TOKEN:
        print("No DISCORD_BOT_TOKEN in scraper/.env yet, so no Discord servers were read. "
              "The top of discord_events.py says how to set up the DubHub bot.")
        return
    if "--invite-link" in sys.argv:
        me = api("/users/@me")
        print(f"Club officers add the DubHub bot with:\n"
              f"https://discord.com/oauth2/authorize?client_id={me['id']}&scope=bot&permissions={PERMISSIONS}")
        return

    clubs = club_of_server()
    guilds = api("/users/@me/guilds") or []
    print(f"The DubHub bot is in {len(guilds)} server(s).", flush=True)
    store = load_store()
    events, posts = [], []
    for g in guilds:
        host = clubs.get(g["id"], g["name"])
        found, new = scheduled_events(g, host), announcement_posts(g, host, store)
        print(f"  {g['name']}: {len(found)} scheduled event(s), {len(new)} new announcement(s)", flush=True)
        events += found
        posts += new
    DISCORD_EVENTS_FILE.write_text(
        json.dumps({"updated": datetime.now().isoformat(timespec="minutes"), "events": events}, indent=1, ensure_ascii=False),
        encoding="utf-8")
    print(f"Saved {len(events)} scheduled event(s) to {DISCORD_EVENTS_FILE.name}")
    if posts:
        process_posts(posts, store)
        find_applications(store)
        save_store(store)
    write_site_events(store)
    write_site_applications(store)


if __name__ == "__main__":
    main()
