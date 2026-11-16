"""Builds engagement.db (SQLite) from every version of public/events.json in git history.

    python analysis/engagement/build_db.py && sqlite3 analysis/engagement/engagement.db < analysis/engagement/queries.sql

Events drop off events.json once they've happened, so each commit is a snapshot. We keep the
newest snapshot of every event, which has the most settled like count, and score likes per post.
"""
import json
import re
import sqlite3
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
FOOD = re.compile(r"\b(food|pizza|snacks?|boba|dinner|lunch|breakfast|refreshments|cookies|treats|dessert|tacos|donuts|bbq|potluck|catered)\b", re.I)
COLLAB = re.compile(r"\bcollab|\bco-?host|\bpartner(ing|ed)? with\b|\bjoint\b", re.I)
CLUB_HANDLES = {h.lstrip("@").lower() for h in json.load(open(HERE.parent.parent / "scraper" / "club_activity.json"))}


def is_collab(e: dict, text: str) -> bool:
    """Says it's a collab, or tags another UW club's Instagram account."""
    own = set(re.findall(r"@([\w.]+)", e.get("host") or ""))
    tagged = {h.lower().rstrip(".") for h in re.findall(r"@([\w.]+)", e.get("description") or "")} - {h.lower() for h in own}
    return bool(COLLAB.search(text)) or bool(tagged & CLUB_HANDLES)
FREE = re.compile(r"\bfree\b", re.I)

shas = subprocess.check_output(["git", "log", "--format=%h", "--", "public/events.json"], text=True).split()
events = {}
for sha in shas:  # newest first
    try:
        snap = json.loads(subprocess.check_output(["git", "show", f"{sha}:public/events.json"], stderr=subprocess.DEVNULL))
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        continue
    for e in snap["events"] if isinstance(snap, dict) else snap:
        events.setdefault(e["id"], e)

# The scraper splits a multi-day event into one event per day ("<post>-0", "<post>-1", ...) and adds
# up likes when several posts promote one event. Count each set of posts once, and use the average
# likes per post so an event promoted three times doesn't get three posts' worth of likes.
seen = set()
for key in list(events):
    e = events[key]
    posts = frozenset(e.get("post_counts") or {key})
    if posts in seen:
        del events[key]
        continue
    seen.add(posts)
    known = [c[0] for c in (e.get("post_counts") or {}).values() if c and c[0] is not None]
    if known:
        e["likes"] = round(sum(known) / len(known))

db_path = HERE / "engagement.db"
db_path.unlink(missing_ok=True)
db = sqlite3.connect(db_path)
db.execute("""CREATE TABLE events (
  id TEXT PRIMARY KEY, source TEXT, host TEXT, title TEXT, type TEXT, date TEXT, weekday INTEGER,
  start_hour INTEGER, on_map INTEGER, posts INTEGER, caption_len INTEGER,
  mentions_food INTEGER, says_free INTEGER, is_collab INTEGER, likes INTEGER, comments INTEGER, rsvps INTEGER)""")
for e in events.values():
    text = f"{e.get('title') or ''}\n{e.get('description') or ''}"
    db.execute(
        "INSERT INTO events VALUES (?,?,?,?,?,?,strftime('%w',?),?,?,?,?,?,?,?,?,?,?)",
        (e["id"], e.get("source"), e.get("host"), e.get("title"), e.get("type"), e.get("date"), e.get("date"),
         int(e["start"][:2]) if e.get("start") else None, int(bool(e.get("pos"))), e.get("posts") or 1,
         len(e.get("description") or ""), int(bool(FOOD.search(text))), int(bool(FREE.search(text))),
         int(is_collab(e, text)),
         e.get("likes"), e.get("comments"), e.get("rsvps")),
    )
db.commit()
n, liked, rsvp = db.execute("SELECT count(*), count(likes), sum(rsvps > 0) FROM events").fetchone()
print(f"{n} events from {len(shas)} snapshots; {liked} with Instagram likes; {rsvp} with any RSVP")
