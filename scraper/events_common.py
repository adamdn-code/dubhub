"""
Shared code for the DubHub scrapers: turns club posts into events and writes
them to ../public/events.json, which the website loads.

Each scraper collects posts as dicts:
    {"key": unique id, "club": "Club Name (@handle)", "caption": "...",
     "posted": date or None, "url": "...", "source": "instagram" | "google"}
and calls process_posts(posts) and then write_site_events().

Everything the scrapers learn is remembered in state/posts.json, so each run
only has to read new posts, and events from earlier runs stay on the site
until their date passes.
"""

import json
import os
import re
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

from uw_buildings import find_building

HERE = Path(__file__).resolve().parent
STATE_DIR = HERE / "state"
POSTS_FILE = STATE_DIR / "posts.json"
GEOCODE_FILE = STATE_DIR / "geocode.json"
SITE_EVENTS_FILE = HERE.parent / "public" / "events.json"
SITE_CLUBS_FILE = HERE.parent / "public" / "clubs.json"
CLUBS_FILE = HERE / "clubs.txt"
CLUB_PROFILES_FILE = STATE_DIR / "club_profiles.json"  # name + bio + website per handle
CLUB_INFO_FILE = STATE_DIR / "club_info.json"          # AI category/summary per handle
HUSKYLINK_FILE = HERE / "huskylink.json"  # huskylink_scraper.py output; on GitHub so every scraper sees it
CLUB_INSTAGRAM_FILE = HERE / "club_instagram.json"  # find_instagram_handles.py output: club name -> handle


def _load_env_file():
    """Read NAME=value lines from scraper/.env (kept off GitHub) without overriding the terminal."""
    try:
        lines = (HERE / ".env").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


_load_env_file()  # before anything below reads os.environ

TODAY = date.today()
LOOKBACK_DAYS = 21      # posts older than this are skipped
FORGET_AFTER_DAYS = 120  # drop remembered posts older than this

# Must match the event types (and colors) the website knows about.
EVENT_TYPES = ["Study", "Club", "Food", "Hangout", "Game night"]
CLUB_CATEGORIES = ["Academic", "Tech", "Engineering", "Business", "Cultural", "Arts",
                   "Outdoors", "Sports", "Gaming", "Service", "Social"]

# Seattle, same box the website's map is limited to.
SEATTLE_BOUNDS = (47.48, -122.46, 47.74, -122.22)

GROQ_KEY = os.environ.get("GROQ_API_KEY")
PREFERRED_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
]
AI_BATCH = 6  # posts per Groq request

# ------------------------------------------------------------ text parsing ---
EVENT_WORDS = re.compile(
    r"\b(event|meeting|join us|workshop|social|info session|gbm|mixer|"
    r"tabling|rsvp|come out|performance|show|tryouts?|game night|panel)\b",
    re.I,
)

MONTHS = (
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)"
)
WEEKDAYS = (
    r"(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|"
    r"Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)"
)
MONTH_NUM = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
WEEKDAY_NUM = {d: i for i, d in enumerate(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}

DAY_PATTERNS = [
    re.compile(rf"\b{WEEKDAYS}\.?,?\s+{MONTHS}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?\b", re.I),
    re.compile(rf"\b{MONTHS}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?\b", re.I),
    re.compile(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b"),
    re.compile(rf"\b(?:this|next)\s+{WEEKDAYS}\b", re.I),
    re.compile(rf"\b{WEEKDAYS}\b", re.I),
]
TIME_PATTERN = re.compile(r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)", re.I)
DEADLINE_WORDS = re.compile(r"\b(deadline|due|apply by|applications? (?:close|due)|closes?)\b", re.I)
ONLINE_WORDS = re.compile(r"\b(zoom|online|virtual|discord call|google meet|teams meeting)\b", re.I)


def extract_days(text):
    found = []
    for pat in DAY_PATTERNS:
        for m in pat.finditer(text):
            val = m.group(0).strip()
            if not any(val.lower() in f.lower() for f in found):
                found.append(val)
        if found and pat is DAY_PATTERNS[2]:
            break  # have concrete dates, skip loose weekday matches
    return found


def to_dates(day_strings, default_year):
    """Turn 'Oct 18' / '10/18' style strings into real dates (weekday-only strings are skipped)."""
    out = []
    for s in day_strings:
        y = default_year
        m = re.search(rf"({MONTHS})\.?\s+(\d{{1,2}})", s, re.I)
        if m:
            month, day = MONTH_NUM[m.group(1)[:3].lower()], int(m.group(2))
        else:
            m = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?", s)
            if not m:
                continue
            month, day = int(m.group(1)), int(m.group(2))
            if m.group(3):
                y = int(m.group(3))
                y += 2000 if y < 100 else 0
        try:
            out.append(date(y, month, day))
        except ValueError:
            pass
    return out


def parse_posted(text):
    """'October 12, 2026' -> date, or None."""
    try:
        return datetime.strptime(text, "%B %d, %Y").date()
    except (TypeError, ValueError):
        return None


def next_weekday(day_string, after):
    """'Friday' / 'this Fri' -> the first such day on or after `after`."""
    m = re.search(WEEKDAYS, day_string, re.I)
    if not m:
        return None
    target = WEEKDAY_NUM[m.group(0)[:3].lower()]
    return after + timedelta(days=(target - after.weekday()) % 7)


def to_24h(t):
    """'7pm' / '7:30 p.m.' -> '19:00' / '19:30'."""
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s?([ap])", t or "", re.I)
    if not m:
        return None
    h, mins = int(m.group(1)) % 12, int(m.group(2) or 0)
    if m.group(3).lower() == "p":
        h += 12
    return f"{h:02d}:{mins:02d}"


# ------------------------------------------------- keyword fallback (no AI) ---
TYPE_KEYWORDS = [
    (r"study|tutor|homework|exam prep|office hours", "Study"),
    (r"game night|board games?|esports|smash|mario kart|chess", "Game night"),
    (r"food|dinner|lunch|breakfast|boba|pizza|potluck|snacks|bbq|tasting", "Food"),
    (r"social|mixer|hang ?out|bonfire|picnic|party|movie night|karaoke", "Hangout"),
]
TITLE_KEYWORDS = [
    (r"tryouts?|auditions?", "Tryouts"),
    (r"info session", "Info Session"),
    (r"hackathon", "Hackathon"),
    (r"workshop", "Workshop"),
    (r"panel", "Panel"),
    (r"speaker", "Guest Speaker"),
    (r"tabling", "Tabling"),
    (r"volunteer|service", "Volunteering"),
    (r"practice|rehearsal", "Practice"),
    (r"performance|showcase|\bshow\b|concert", "Performance"),
    (r"game night", "Game Night"),
    (r"social|mixer|hang ?out|picnic|bonfire|potluck|party", "Social"),
    (r"gbm|general (?:body )?meeting|kickoff|meeting", "General Meeting"),
]


UW_SIGNS = re.compile(r"\b(UW|University of Washington|Husk(?:y|ies)|Seattle|Dawgs?)\b|\buw|uw\b", re.I)
NOT_UW_SIGNS = re.compile(r"\b(semesters?|Tacoma|Bothell|UWT|UWB|Wisconsin|Waterloo)\b", re.I)


def looks_like_uw_seattle(post):
    """For Google results, which mix in other schools: need a UW sign and no other-school sign."""
    text = f"{post['club']} {post['caption']}"
    return bool(UW_SIGNS.search(text) or find_building(post["caption"])) and not NOT_UW_SIGNS.search(text)


def keyword_extract(post):
    """Best-effort event from a caption without AI: one event, needs a date."""
    caption = post["caption"]
    if post["source"] != "instagram" and not looks_like_uw_seattle(post):
        return []
    if not EVENT_WORDS.search(caption) and not extract_days(caption):
        return []
    posted = post["posted"] or TODAY
    days = extract_days(caption)
    dates = [d for d in to_dates(days, posted.year) if d >= TODAY]
    if not dates:
        weekday = next((next_weekday(d, posted) for d in days if re.search(WEEKDAYS, d, re.I)), None)
        if weekday and weekday >= TODAY:
            dates = [weekday]
    if not dates:
        return []

    times = [to_24h(t) for t in TIME_PATTERN.findall(caption)]
    times = [t for t in times if t and t != "23:59"]  # 11:59 PM is almost always a deadline
    building = find_building(caption)
    online = ONLINE_WORDS.search(caption)
    title = next((t for p, t in TITLE_KEYWORDS if re.search(p, caption, re.I)), "Club Event")
    kind = next((t for p, t in TYPE_KEYWORDS if re.search(p, caption, re.I)), "Club")
    return [{
        "title": title,
        "date": min(dates).isoformat(),
        "start": times[0] if times else None,
        "end": times[1] if len(times) > 1 else None,
        "location": building[0] if building else ("Online" if online else None),
        "type": kind,
    }]


# --------------------------------------------------------------- AI (Groq) ---
_model = {}
ai_used = False


def pick_model():
    if "name" in _model:
        return _model["name"]
    name = PREFERRED_MODELS[0]
    try:
        r = requests.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            timeout=30,
        )
        if r.status_code == 200:
            ids = [m["id"] for m in r.json().get("data", [])]
            name = next((m for m in PREFERRED_MODELS if m in ids), name)
        elif r.status_code == 401:
            print("Your GROQ_API_KEY was rejected (expired or deleted?). Using keyword mode.", file=sys.stderr)
            name = None
        else:
            print(f"Could not list Groq models ({r.status_code}): {r.text[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"Could not reach Groq ({e})", file=sys.stderr)
    _model["name"] = name
    if name:
        print(f"Using Groq model: {name}")
    return name


def ai_prompt(batch):
    posts = "\n\n".join(
        f"POST {i + 1}\nClub: {p['club']}\n"
        f"Known UW club: {'yes' if p['source'] == 'instagram' else 'no, check'}\n"
        f"Posted: {p['posted'].strftime('%A, %B %d, %Y') if p['posted'] else 'unknown'}\n"
        f"Caption: {p['caption'][:1500]}"
        for i, p in enumerate(batch)
    )
    return f"""Today is {TODAY:%A, %B %d, %Y}. Below are Instagram posts from University of Washington clubs.

For each post, list the events it announces that happen on or after today.
Rules:
- Only events by University of Washington SEATTLE campus clubs or groups. If the post is from
  another school (other "UW"s like Wisconsin or Waterloo, other universities) or from UW Tacoma
  or UW Bothell, return no events for it. For posts marked "Known UW club: no, check", only
  include events when there's clear evidence of UW Seattle (UW / University of Washington /
  Husky in the club name or handle, a UW building, or Seattle). UW Seattle uses quarters, so a
  post about a "semester" is from another school.
- Some captions are cut-off Google search snippets; only use what's actually written.
- Only real events people attend (meetings, socials, workshops, games, performances...).
- Skip application/form deadlines, recruiting forms, giveaways, and recaps of past events.
- Work out relative dates ("this Friday", "tomorrow") from the post's Posted date.
- If one post lists several sessions, make one event per session.
- "title": short name of the event (2-6 words), using the post's own wording when possible.
- "date": YYYY-MM-DD. "start"/"end": 24-hour HH:MM, or null if not given.
- "location": building and room as written (e.g. "HUB 145", "Kane Hall 120"), "Online" if virtual, or null.
- "type": exactly one of {EVENT_TYPES}: "Game night" for games, tournaments and esports;
  "Food" when food is the main draw (dinners, tastings, potlucks); "Study" for study sessions,
  tutoring and office hours; "Hangout" for socials, mixers and outings; "Club" for meetings,
  workshops, talks, competitions and anything else.

Reply with ONLY JSON in this shape:
{{"posts": [{{"post": 1, "events": [{{"title": "...", "date": "...", "start": null, "end": null, "location": null, "type": "Club"}}]}}]}}
Include every post, with "events": [] when it has none.

{posts}"""


def clean_event(e):
    try:
        day = datetime.strptime(str(e.get("date")), "%Y-%m-%d").date()
    except ValueError:
        return None
    if day < TODAY:
        return None
    hhmm = lambda t: t if isinstance(t, str) and re.fullmatch(r"\d{2}:\d{2}", t) else None
    loc = e.get("location")
    return {
        "title": str(e.get("title") or "Club Event").strip()[:80],
        "date": day.isoformat(),
        "start": hhmm(e.get("start")),
        "end": hhmm(e.get("end")),
        "location": str(loc).strip()[:120] if loc else None,
        "type": e.get("type") if e.get("type") in EVENT_TYPES else "Club",
    }


def ai_extract(batch):
    """Ask Groq for events in a batch of posts. Returns a list of event lists, or None on failure."""
    global ai_used
    if not GROQ_KEY or not pick_model():
        return None
    for attempt in range(5):
        try:
            r = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}"},
                json={
                    "model": pick_model(),
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": ai_prompt(batch)}],
                },
                timeout=90,
            )
        except Exception as e:
            print(f"Groq request failed ({e}); using keyword mode for these posts.", file=sys.stderr)
            return None
        if r.status_code == 429 and attempt < 4:
            # The free tier allows ~8000 tokens/minute; Groq says how long to wait.
            m = re.search(r"try again in ([\d.]+)s", r.text)
            wait = float(m.group(1)) if m else float(r.headers.get("retry-after", 20))
            print(f"Groq's free limit reached; waiting {wait:.0f}s...")
            time.sleep(wait + 2)
            continue
        if r.status_code != 200:
            print(f"Groq error {r.status_code}: {r.text[:300]}", file=sys.stderr)
            return None
        try:
            data = json.loads(r.json()["choices"][0]["message"]["content"])
            by_post = {int(p["post"]): p.get("events") or [] for p in data.get("posts", [])}
        except (KeyError, TypeError, ValueError) as e:
            print(f"Groq reply wasn't usable ({e}); using keyword mode for these posts.", file=sys.stderr)
            return None
        ai_used = True
        return [[c for c in map(clean_event, by_post.get(i + 1, [])) if c] for i in range(len(batch))]
    return None


# ---------------------------------------------------------------- location ---
def _load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def _save(path, data):
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


_geocache = None
_last_geocode = 0.0


def locate(location):
    """'HUB 145' -> ('HUB 145', [lat, lng]). Unknown places are looked up on OpenStreetMap (Seattle only)."""
    global _geocache, _last_geocode
    if not location or ONLINE_WORDS.search(location) or location.lower() in ("online", "tbd", "tba"):
        return None
    building = find_building(location)
    if building:
        return list(building[1])

    if _geocache is None:
        _geocache = _load(GEOCODE_FILE, {})
    key = location.lower()
    if key not in _geocache:
        time.sleep(max(0.0, 1.1 - (time.time() - _last_geocode)))  # OpenStreetMap allows 1 lookup/second
        _last_geocode = time.time()
        s, w, n, e = SEATTLE_BOUNDS
        q = urllib.parse.urlencode({
            "q": f"{location}, Seattle", "format": "json", "limit": 1,
            "viewbox": f"{w},{n},{e},{s}", "bounded": 1,
        })
        try:
            r = requests.get(
                f"https://nominatim.openstreetmap.org/search?{q}",
                headers={"User-Agent": "DubHub event scraper (github.com/adamxlegend/dubhub)"},
                timeout=20,
            )
            hit = r.json()[0] if r.ok and r.json() else None
            _geocache[key] = [round(float(hit["lat"]), 5), round(float(hit["lon"]), 5)] if hit else None
        except Exception:
            return None  # don't cache network errors
        _save(GEOCODE_FILE, _geocache)
    return _geocache[key]


# ------------------------------------------------------------ the pipeline ---
def load_store():
    return _load(POSTS_FILE, {})


def save_store(store):
    cutoff = (TODAY - timedelta(days=FORGET_AFTER_DAYS)).isoformat()
    store = {k: v for k, v in store.items() if (v.get("posted") or "9999") >= cutoff}
    _save(POSTS_FILE, store)


def process_posts(posts, store):
    """Find events in new posts (AI if available, else keywords) and remember them in store."""
    for i in range(0, len(posts), AI_BATCH):
        batch = posts[i:i + AI_BATCH]
        found = ai_extract(batch)
        mode = "ai" if found is not None else "keywords"
        if found is None:
            found = [keyword_extract(p) for p in batch]
        for post, events in zip(batch, found):
            store[post["key"]] = {
                "club": post["club"],
                "url": post["url"],
                "source": post["source"],
                "posted": post["posted"].isoformat() if post["posted"] else None,
                "caption": post["caption"][:2000],
                "events": events,
                "found_with": mode,
            }
        if found and i + AI_BATCH < len(posts) and mode == "ai":
            time.sleep(3)  # stay under Groq's free per-minute limit


def redo_keyword_posts(store):
    """When AI is available, re-read posts that were only keyword-matched before."""
    if not GROQ_KEY:
        return
    redo = [
        {"key": k, "club": v["club"], "caption": v["caption"], "url": v["url"], "source": v["source"],
         "posted": date.fromisoformat(v["posted"]) if v["posted"] else None}
        for k, v in store.items()
        if v.get("found_with") == "keywords" and (v.get("posted") or "9999") >= (TODAY - timedelta(days=LOOKBACK_DAYS)).isoformat()
    ]
    if redo:
        print(f"Re-reading {len(redo)} earlier post(s) with AI...")
        process_posts(redo, store)


def not_uw_clubs(store):
    """A Google-found account with any post mentioning a semester, another campus, etc. isn't UW Seattle."""
    return {p["club"] for p in store.values() if p["source"] != "instagram" and NOT_UW_SIGNS.search(p["caption"])}


def write_site_events(store):
    """Write every upcoming event to public/events.json for the website."""
    not_uw = not_uw_clubs(store)
    events = []
    for key, post in store.items():
        if post["club"] in not_uw:
            continue
        for n, e in enumerate(post.get("events") or []):
            if e["date"] < TODAY.isoformat():
                continue
            events.append({
                "id": f"{key}-{n}",
                "title": e["title"],
                "type": e["type"],
                "host": post["club"],
                "where": e["location"],
                "pos": locate(e["location"]),
                "date": e["date"],
                "start": e["start"],
                "end": e["end"],
                "url": post["url"],
                "source": post["source"],
                # The post's caption, shown when someone opens the event on the site.
                "description": (post.get("caption") or "").strip() or None,
            })
    events = merge_huskylink_events(events)
    SITE_EVENTS_FILE.parent.mkdir(exist_ok=True)
    SITE_EVENTS_FILE.write_text(
        json.dumps({"updated": datetime.now().isoformat(timespec="minutes"), "events": events},
                   indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    on_map = sum(1 for e in events if e["pos"])
    print(f"Wrote {len(events)} upcoming events ({on_map} with a map location) to {SITE_EVENTS_FILE}")
    return events


# ------------------------------------------------------------------- clubs ---
HOST_RE = re.compile(r"^(?:(?P<name>.+) )?\(?@(?P<handle>[\w.]+)\)?$")


def parse_host(host):
    """'Product Space @ UW (@uwproductspace)' -> ('Product Space @ UW', 'uwproductspace'); '@x' -> (None, 'x')."""
    m = HOST_RE.match(host or "")
    return (m["name"], m["handle"].lower()) if m else (host, None)


def read_club_handles():
    try:
        lines = CLUBS_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    return [h.lower() for h in (line.split("#")[0].strip().lstrip("@") for line in lines) if h]


_profiles = None


def save_club_profile(handle, name, bio, website=None):
    """Remember a club's real Instagram name, bio and profile link (the Instagram scraper calls this)."""
    global _profiles
    if _profiles is None:
        _profiles = _load(CLUB_PROFILES_FILE, {})
    _profiles[handle.lower()] = {"name": name or None, "bio": bio or None, "website": website or None}
    _save(CLUB_PROFILES_FILE, _profiles)


def ai_club_info(clubs):
    """Ask Groq for a category, one-line summary and short description per club, or None."""
    if not GROQ_KEY or not pick_model():
        return None
    listing = "\n\n".join(
        f"CLUB {i + 1}\nName: {c['name']}\nInstagram: @{c['handle']}\nBio: {c['bio'] or '(none)'}\n"
        + "\n".join(f"Post: {p[:300]}" for p in c["posts"])
        for i, c in enumerate(clubs)
    )
    prompt = f"""Below are University of Washington student clubs with their Instagram bio and a few recent posts.

For each club write:
- "category": exactly one of {CLUB_CATEGORIES}.
- "about": one line (max 90 characters) saying what the club does.
- "description": 2-3 friendly sentences about the club for students browsing clubs.
Only use facts from the name, bio and posts. Never invent meeting times, places, numbers or claims.
Describe the club in general terms: don't mention specific event dates, which go out of date.
If there's too little information, keep "about" short and general (based on the name) and set
"description" to null. Never mention that information is missing.

Reply with ONLY JSON: {{"clubs": [{{"club": 1, "category": "...", "about": "...", "description": "..."}}]}}

{listing}"""
    for attempt in range(5):
        try:
            r = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}"},
                json={"model": pick_model(), "temperature": 0, "response_format": {"type": "json_object"},
                      "messages": [{"role": "user", "content": prompt}]},
                timeout=90,
            )
        except Exception as e:
            print(f"Groq request failed ({e}); clubs get basic info for now.", file=sys.stderr)
            return None
        if r.status_code == 429 and attempt < 4:
            m = re.search(r"try again in ([\d.]+)s", r.text)
            time.sleep((float(m.group(1)) if m else 20) + 2)
            continue
        if r.status_code != 200:
            print(f"Groq error {r.status_code}: {r.text[:300]}", file=sys.stderr)
            return None
        try:
            got = {int(c["club"]): c for c in json.loads(r.json()["choices"][0]["message"]["content"])["clubs"]}
        except (KeyError, TypeError, ValueError):
            return None
        return [got.get(i + 1) for i in range(len(clubs))]
    return None


def write_site_clubs(store):
    """Write public/clubs.json: clubs.txt accounts plus UW clubs the scrapers found events for."""
    profiles = _load(CLUB_PROFILES_FILE, {})
    info = _load(CLUB_INFO_FILE, {})
    not_uw = not_uw_clubs(store)

    names, posts = {}, {}
    for post in sorted(store.values(), key=lambda p: p.get("posted") or "", reverse=True):
        name, handle = parse_host(post["club"])
        if not handle or post["club"] in not_uw:
            continue
        if name:
            names.setdefault(handle, name)
        if post["caption"]:
            posts.setdefault(handle, []).append(post["caption"])

    found = {parse_host(p["club"])[1] for p in store.values() if p.get("events") and p["club"] not in not_uw}
    handles = list(dict.fromkeys(read_club_handles() + sorted(h for h in found if h)))

    clubs = []
    for h in handles:
        prof = profiles.get(h, {})
        clubs.append({"handle": h, "name": prof.get("name") or names.get(h) or f"@{h}",
                      "bio": prof.get("bio"), "website": prof.get("website"), "posts": posts.get(h, [])[:3]})

    # Only ask the AI about clubs whose name/bio/posts changed since last time, and skip clubs
    # we know nothing about yet (just a handle), so it can't guess from the letters.
    fingerprint = lambda c: json.dumps([c["name"], c["bio"], c["posts"]], ensure_ascii=False)
    knows_something = lambda c: c["bio"] or c["posts"] or not c["name"].startswith("@")
    todo = [c for c in clubs if knows_something(c) and info.get(c["handle"], {}).get("from") != fingerprint(c)]
    for i in range(0, len(todo), 8):
        batch = todo[i:i + 8]
        result = ai_club_info(batch)
        if result is None:
            break
        for c, r in zip(batch, result):
            if r:
                info[c["handle"]] = {
                    "category": r.get("category") if r.get("category") in CLUB_CATEGORIES else "Social",
                    "about": (r.get("about") or "").strip()[:120] or None,
                    "description": (r.get("description") or "").strip() or None,
                    "from": fingerprint(c),
                }
    _save(CLUB_INFO_FILE, info)

    out = []
    for c in clubs:
        i = info.get(c["handle"], {})
        out.append({
            "name": c["name"],
            "handle": c["handle"],
            "instagram": f"https://www.instagram.com/{c['handle']}/",
            "website": c["website"],
            "category": i.get("category") or "Other",
            "about": i.get("about") or (c["bio"] or "").split("\n")[0][:120] or None,
            # A longer description only when there's a real bio or posts behind it, not just a name.
            "description": (i.get("description") or c["bio"]) if (c["bio"] or c["posts"]) else None,
        })
    out = merge_huskylink_clubs(out)
    SITE_CLUBS_FILE.write_text(json.dumps({"clubs": out}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(out)} clubs to {SITE_CLUBS_FILE}")
    return out


# --------------------------------------------------------------- huskylink ---
def load_huskylink():
    return _load(HUSKYLINK_FILE, {"clubs": [], "events": []})


def merge_huskylink_events(events):
    """Swap in the latest HuskyLink events (dropping any old ones), sorted by date."""
    today = TODAY.isoformat()
    events = [e for e in events if e.get("source") != "huskylink"]
    events += [e for e in load_huskylink()["events"] if e["date"] >= today]
    events.sort(key=lambda e: (e["date"], e["start"] or "99"))
    return events


def club_key(name):
    """'Product Space @ UW', 'Product Space' and '@product_space_uw' all -> 'productspace'."""
    n = re.sub(r"[._]", " ", name.casefold()).replace("&", "and")
    n = re.sub(r"\b(at|@)\s*(the\s+)?(uw|university of washington)(\s+seattle)?\b"
               r"|\buw\b|\buniversity of washington\b|\bchapter\b|\bthe\b", " ", n)
    return re.sub(r"[^a-z0-9]+", "", n)


def found_instagram_handles():
    """HuskyLink club name -> Instagram handle, for clubs find_instagram_handles.py found one for."""
    return {name: v["handle"] for name, v in _load(CLUB_INSTAGRAM_FILE, {}).items() if v.get("handle")}


def merge_huskylink_clubs(clubs):
    """Add every HuskyLink group. A club already listed under the same Instagram or a matching
    name gets the gaps filled in."""
    clubs = [c for c in clubs if c.get("source") != "huskylink"]
    by_name = {club_key(c["name"]): c for c in clubs}
    by_handle = {c["handle"]: c for c in clubs if c.get("handle")}
    handles = found_instagram_handles()
    for h in load_huskylink()["clubs"]:
        handle = handles.get(h["name"])
        if handle:
            h = {**h, "handle": handle, "instagram": f"https://www.instagram.com/{handle}/"}
        c = by_handle.get(handle) or by_name.get(club_key(h["name"]))
        if c is None:
            clubs.append({**h, "source": "huskylink"})
            by_name[club_key(h["name"])] = clubs[-1]
            continue
        if c["name"].startswith("@"):
            c["name"] = h["name"]  # an Instagram handle is all we had; use the real name
        for field in ("website", "about", "description", "handle", "instagram"):
            c[field] = c.get(field) or h.get(field)
        if c.get("category") in (None, "Other"):
            c["category"] = h["category"]
    clubs.sort(key=lambda c: c["name"].lstrip("@").lower())
    return clubs


if __name__ == "__main__":
    # Rebuild the site files from what's already saved, without scraping anything new.
    saved = load_store()
    write_site_events(saved)
    write_site_clubs(saved)
