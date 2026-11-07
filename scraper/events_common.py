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
CLUB_ACTIVITY_FILE = HERE / "club_activity.json"  # latest event date per club; on GitHub, only moves forward
CLUB_FIELDS_FILE = HERE / "club_fields.json"      # AI-sorted major fields per club; on GitHub
CLUB_ALIASES_FILE = HERE / "club_aliases.txt"     # Instagram handle -> HuskyLink club name, by hand
HUSKYLINK_FILE = HERE / "huskylink.json"  # huskylink_scraper.py output; on GitHub so every scraper sees it
CLUB_INSTAGRAM_FILE = HERE / "club_instagram.json"  # find_instagram_handles.py output: club name -> handle
# Instagram's picture links expire after a few days, so the site serves its own copies (on GitHub).
IG_POST_IMAGES = HERE.parent / "public" / "ig" / "posts"  # <post code>.jpg, only posts with upcoming events
IG_CLUB_IMAGES = HERE.parent / "public" / "ig" / "clubs"  # <handle>.jpg, each club's profile picture


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
                   "Outdoors", "Sports", "Gaming", "Service", "Social", "Greek Life", "Faith & Spirituality"]
# Categories that say what a club is rather than what it does: the one a club picked on HuskyLink
# wins over the AI's guess from its Instagram.
IDENTITY_CATEGORIES = {"Greek Life", "Faith & Spirituality"}
# A fraternity or sorority only on Instagram ("UW Alpha Omicron Pi"): two Greek letters in a row,
# and not a professional, honor or service fraternity (those keep their own category).
GREEK_LETTERS = ("alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|"
                 "pi|rho|sigma|tau|upsilon|phi|chi|psi|omega")
GREEK_NAME = re.compile(rf"\b(?:{GREEK_LETTERS})[\s-]+(?:{GREEK_LETTERS})\b", re.I)
NOT_SOCIAL_GREEK = re.compile(r"business|pre-?law|pre-?med|pharma|medic|engineer|honou?r|service|chemi|"
                              r"professional|accounting|journalism|music|technology|leadership|scholar|research", re.I)
# Must match the major groups (MAJOR_GROUPS) in the website's Major filter.
MAJOR_FIELDS = ["Engineering", "Computing & Math", "Sciences", "Health", "Social Sciences",
                "Arts & Humanities", "Business"]
ACTIVE_DAYS = 365  # clubs with an event in this long are "active"
# True: the site lists every club, active ones first. False: only active clubs are listed.
# After changing it: python events_common.py, then push public/clubs.json.
SHOW_INACTIVE_CLUBS = False

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


INSTAGRAM_EPOCH_MS = 1314220021721  # the moment Instagram's media IDs count from (Aug 24, 2011)


def instagram_post_date(media_id):
    """An Instagram post's ID -> the Seattle date it was posted. The ID's top bits are the
    milliseconds since INSTAGRAM_EPOCH_MS, so no extra request is needed."""
    try:
        ms = (int(str(media_id).split("_")[0]) >> 23) + INSTAGRAM_EPOCH_MS
    except (TypeError, ValueError):
        return None
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromtimestamp(ms / 1000, ZoneInfo("America/Los_Angeles")).date()
    except Exception:
        return datetime.fromtimestamp(ms / 1000).date()


def picture_text(alt):
    """Instagram's description of a post's picture, minus its 'Photo by X on <date>.' opener
    (that's when it was posted, not the event date). Often keeps a flyer's text:
    "May be an image of text that says 'GENERAL MEETING THURS 7PM HUB 145'"."""
    text = re.sub(r"^(Photo|Video|Reel)( shared)? by .*? on \w+ \d{1,2}, \d{4}( tagging [^.]*)?\.?\s*", "",
                  (alt or "").strip())
    # Only worth keeping when it quotes the picture's text; "May be a graphic of poster and text" isn't.
    return text if "says" in text else None


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
    # A flyer's text (from Instagram's picture description) often has the date and place.
    caption = "\n".join(filter(None, [post["caption"], post.get("image_text")]))
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
        + (f"\nText in the picture: {p['image_text'][:500]}" if p.get("image_text") else "")
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
- "Text in the picture" is the text on the post's flyer (from Instagram's picture description);
  use it together with the caption, since the date, time or room is often only on the flyer.
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
                "likes": post.get("likes"),
                "comments": post.get("comments"),
                # From Instagram, when the scraper saw them: the picture's (expiring) link and the
                # flyer's text (from Instagram's description of the picture).
                **{k: post[k] for k in ("image_src", "image_text") if post.get(k)},
            }
        if found and i + AI_BATCH < len(posts) and mode == "ai":
            time.sleep(3)  # stay under Groq's free per-minute limit


def redo_keyword_posts(store):
    """When AI is available, re-read posts that were only keyword-matched before."""
    if not GROQ_KEY:
        return
    redo = [
        {"key": k, "club": v["club"], "caption": v["caption"], "url": v["url"], "source": v["source"],
         "posted": date.fromisoformat(v["posted"]) if v["posted"] else None,
         **{f: v[f] for f in ("image_src", "image_text", "likes", "comments") if v.get(f) is not None}}
        for k, v in store.items()
        if v.get("found_with") == "keywords" and (v.get("posted") or "9999") >= (TODAY - timedelta(days=LOOKBACK_DAYS)).isoformat()
    ]
    if redo:
        print(f"Re-reading {len(redo)} earlier post(s) with AI...")
        process_posts(redo, store)


def not_uw_clubs(store):
    """A Google-found account with any post mentioning a semester, another campus, etc. isn't UW Seattle."""
    return {p["club"] for p in store.values() if p["source"] != "instagram" and NOT_UW_SIGNS.search(p["caption"])}


GENERIC_TITLE = "Club Event"  # what keyword matching calls an event it can't name (see TITLE_KEYWORDS)


def drop_duplicate_events(events):
    """Clubs often post the same event twice (a schedule, then a reminder). Keep one per
    club, date and title: the copy with the most details (place, map pin, times). A keyword-found
    "Club Event" on a day the same club has exactly one properly named event is that event too.
    The kept copy gets every copy's likes and comments, `posts` (how many posts promoted it), and
    a picture if it has none. Counts are added up per post (`post_counts`), so a post is never
    counted twice, even when copies come back from earlier runs on other computers."""
    club_day = lambda e: (parse_host(e["host"])[1] or (e["host"] or "").lower(), e["date"])
    tidy = lambda title: re.sub(r"[^a-z0-9]", "", title.lower())
    generic = lambda e: e.get("generic") or e["title"] == GENERIC_TITLE
    groups = {}
    for e in events:
        groups.setdefault((*club_day(e), tidy(GENERIC_TITLE if generic(e) else e["title"])), []).append(e)
    named = {}
    for key in groups:
        if key[2] != tidy(GENERIC_TITLE):
            named.setdefault(key[:2], []).append(key)
    for key in [k for k in groups if k[2] == tidy(GENERIC_TITLE) and k[:2] in named]:
        copies = groups.pop(key)
        if len(named[key[:2]]) == 1:  # with two named events that day, we can't tell which it was
            groups[named[key[:2]][0]] += copies
    keep = set()
    for copies in groups.values():
        best = max(copies, key=lambda e: (not generic(e),
                                          sum(e.get(field) is not None for field in ("where", "pos", "start", "end"))))
        counts = {}
        for e in copies:
            counts.update(post_counts(e))
        best["post_counts"] = counts
        for field, i in (("likes", 0), ("comments", 1)):
            found = [c[i] for c in counts.values() if c[i] is not None]
            best[field] = sum(found) if found else None
        best["posts"] = len(counts)
        best["image"] = best.get("image") or next((e["image"] for e in copies if e.get("image")), None)
        keep.add(id(best))
    return [e for e in events if id(e) in keep]


PICTURE_WIDTH = 640  # preferred width of saved post pictures


def picture_url(node):
    """The post's picture: the page's thumbnail, or the size closest to PICTURE_WIDTH."""
    if node.get("display_uri"):
        return node["display_uri"]
    sizes = [c for c in (node.get("image_versions2") or {}).get("candidates") or [] if c.get("url")]
    if not sizes:
        return node.get("display_url")
    bigger = [c for c in sizes if (c.get("width") or 0) >= PICTURE_WIDTH]
    return (min(bigger, key=lambda c: c["width"]) if bigger else max(sizes, key=lambda c: c.get("width") or 0))["url"]


def save_post_image(key, post):
    """Keep the site's own copy of a post's picture (Instagram's links expire within days).
    Returns its path on the site, or None."""
    path = IG_POST_IMAGES / f"{key}.jpg"
    if not path.exists() and post.get("image_src") and re.fullmatch(r"[\w-]+", key):
        try:
            r = requests.get(post["image_src"], headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            if r.ok and r.headers.get("content-type", "").startswith("image/"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(r.content)
        except requests.RequestException:
            pass  # the event just shows without a picture
    return f"/ig/{path.parent.name}/{path.name}" if path.exists() else None


def drop_unused_post_images(events):
    """Delete saved post pictures whose events have all passed."""
    used = {e["image"].rsplit("/", 1)[-1] for e in events if (e.get("image") or "").startswith("/ig/posts/")}
    for f in IG_POST_IMAGES.glob("*.jpg"):
        if f.name not in used:
            f.unlink()


def site_events():
    """The upcoming Instagram/Google events on the site now, from anyone's runs."""
    try:
        site = json.loads(SITE_EVENTS_FILE.read_text(encoding="utf-8")).get("events", [])
    except (FileNotFoundError, ValueError):
        return []
    return [e for e in site if e.get("source") in ("instagram", "google") and e.get("date", "") >= TODAY.isoformat()]


def others_events(site, store, mine):
    """The site's events to keep alongside this run's: those from posts whose events this run
    doesn't write itself (`mine`), usually someone else's run. They get this computer's newer
    like count and saved picture for their posts when it has them."""
    kept = []
    for e in site:
        counts = {k: v for k, v in post_counts(e).items() if k not in mine}
        if not counts:
            continue
        for k in counts:
            local = store.get(k) or {}
            if local.get("likes") is not None:  # read here more recently; split like write_site_events does
                n = max(len(local.get("events") or []), 1)
                counts[k] = [round(local["likes"] / n), None if local.get("comments") is None else round(local["comments"] / n)]
        image = e.get("image") or next(filter(None, (save_post_image(k, store[k]) for k in counts if k in store)), None)
        kept.append({**e, "post_counts": counts, "image": image})
    return kept


def post_counts(event):
    """{post key: [likes, comments]} of the posts behind an event. Events written before
    post_counts existed count as one post: the one in their id ("<post key>-<n>")."""
    return event.get("post_counts") or {event["id"].rsplit("-", 1)[0]: [event.get("likes"), event.get("comments")]}


def write_site_events(store):
    """Write every upcoming event to public/events.json for the website."""
    not_uw = not_uw_clubs(store)
    site = site_events()
    on_site = {k for e in site for k in post_counts(e)}
    # This run writes the events of the posts it has, except that a post someone else's run
    # already put on the site keeps that version when this computer only guessed with keywords
    # (keywords can't name events, and sometimes miss the date; their runs may have used AI).
    mine = {k for k, v in store.items() if not (v.get("found_with") == "keywords" and k in on_site)}
    events = []
    for key, post in store.items():
        if key not in mine or post["club"] in not_uw:
            continue
        found = post.get("events") or []
        # A post listing several events (a quarter's schedule) shares its likes among them.
        share = lambda count: None if count is None else round(count / len(found))
        for n, e in enumerate(found):
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
                "image": save_post_image(key, post),
                # Popularity signals for the site's Trending row. post_counts keeps each post's
                # share apart, so merging copies of an event never counts a post twice.
                "likes": share(post.get("likes")),
                "comments": share(post.get("comments")),
                "post_counts": {key: [share(post.get("likes")), share(post.get("comments"))]},
            })
    events = merge_huskylink_events(drop_duplicate_events(events + others_events(site, store, mine)))
    for e in events:  # an event keywords couldn't name is shown as its club's ("ALPFA UW event")
        if e["title"] == GENERIC_TITLE:
            name, handle = parse_host(e["host"])
            e["title"] = f"{(name or '@' + (handle or 'club')).split(' | ')[0]} event"
            e["generic"] = True
    drop_unused_post_images(events)
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

    # What the site already says about each club. Someone else's run may have added clubs (and
    # summarized them) that this computer's scraper has never seen; keep those instead of
    # dropping or renaming them. Joined clubs are remembered by name, so names must stay put.
    try:
        site = {c.get("handle"): c for c in json.loads(SITE_CLUBS_FILE.read_text(encoding="utf-8"))["clubs"]}
    except (FileNotFoundError, ValueError, KeyError):
        site = {}
    on_site = sorted(h for h, c in site.items() if h and c.get("source") != "huskylink")

    found = {parse_host(p["club"])[1] for p in store.values() if p.get("events") and p["club"] not in not_uw}
    handles = list(dict.fromkeys(read_club_handles() + sorted(h for h in found if h) + on_site))

    clubs = []
    for h in handles:
        prof, old = profiles.get(h, {}), site.get(h, {})
        name = prof.get("name") or names.get(h) or (old.get("name") if h in on_site else None) or f"@{h}"
        clubs.append({"handle": h, "name": name, "bio": prof.get("bio"),
                      "website": prof.get("website") or old.get("website"), "posts": posts.get(h, [])[:3]})

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
        i = info.get(c["handle"]) or {k: v for k, v in site.get(c["handle"], {}).items()
                                      if k in ("category", "about", "description") and v}
        out.append({
            "name": c["name"],
            "handle": c["handle"],
            "instagram": f"https://www.instagram.com/{c['handle']}/",
            "website": c["website"],
            "category": i.get("category") or "Other",
            "about": i.get("about") or (c["bio"] or "").split("\n")[0][:120] or None,
            # A summary (only ever written from a real bio or posts, never just a name), else the bio.
            "description": i.get("description") or c["bio"] or None,
            "logo": club_picture(c["handle"]),
        })
    record_activity((p["club"], e["date"]) for p in store.values() if p["club"] not in not_uw
                    for e in p.get("events") or [])
    out = finish_clubs(merge_huskylink_clubs(out))
    # A club keeps the name the site already shows it under. Joined clubs are remembered by name,
    # so a rename (an Instagram display name changing, or the club being matched to its HuskyLink
    # listing) would quietly drop everyone who joined it. New clubs get HuskyLink's official name.
    for c in out:
        shown = site.get(c["handle"], {}).get("name") if c.get("handle") else None
        if shown and not shown.startswith("@"):
            c["name"] = shown
    out.sort(key=lambda c: c["name"].lstrip("@").lower())
    SITE_CLUBS_FILE.write_text(json.dumps({"clubs": out}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(out)} clubs to {SITE_CLUBS_FILE}")
    return out


# --------------------------------------------------------------- huskylink ---
def load_huskylink():
    return _load(HUSKYLINK_FILE, {"clubs": [], "events": []})


def merge_huskylink_events(events):
    """Swap in the latest HuskyLink events (dropping any old ones), sorted by date. A club's
    Instagram post of an event that's also on HuskyLink (same day, and same title or start time)
    is folded into the HuskyLink copy, which keeps its RSVP link and gets the post's likes,
    comments and picture (and its place, when HuskyLink doesn't say), so it isn't listed twice."""
    today = TODAY.isoformat()
    before = {e["id"]: e for e in events if e.get("source") == "huskylink"}
    events = [e for e in events if e.get("source") != "huskylink" and e["date"] >= today]
    handles = {name: handle for handle, name in read_club_aliases().items()}
    handles.update(found_instagram_handles())  # HuskyLink club name -> Instagram handle
    tidy = lambda title: re.sub(r"[^a-z0-9]", "", (title or "").lower())
    folded, huskylink = set(), []
    for h in load_huskylink()["events"]:
        if h["date"] < today:
            continue
        old = before.get(h["id"]) or {}
        # Posts folded in by an earlier run (maybe on another computer) still count.
        counts = {k: v for k, v in (old.get("post_counts") or {}).items() if k != "hl"}
        image = old.get("image")
        place = (old["where"], old["pos"]) if old.get("pos") else None
        handle = handles.get(h["host"])
        for e in events:
            if (handle and parse_host(e["host"])[1] == handle and e["date"] == h["date"]
                    and (tidy(e["title"]) == tidy(h["title"]) or (e["start"] and e["start"] == h["start"]))):
                counts.update(post_counts(e))
                image = e.get("image") or image
                place = (e["where"], e["pos"]) if e.get("pos") else place
                folded.add(id(e))
        h = dict(h)
        if not h.get("pos") and place:
            h["where"], h["pos"] = place
        if counts:
            h["post_counts"] = counts
            for field, i in (("likes", 0), ("comments", 1)):
                found = [c[i] for c in counts.values() if c[i] is not None]
                h[field] = sum(found) if found else None
            h["posts"] = len(counts)
        h["image"] = h.get("image") or image
        huskylink.append(h)
    events = [e for e in events if id(e) not in folded] + huskylink
    events.sort(key=lambda e: (e["date"], e["start"] or "99"))
    return events


def club_key(name):
    """'Product Space @ UW', 'Product Space' and '@product_space_uw' all -> 'productspace'."""
    n = re.sub(r"[._]", " ", name.casefold()).replace("&", "and")
    n = re.sub(r"\b(at|@)\s*(the\s+)?(uw|university of washington)(\s+seattle)?\b"
               r"|\buw\b|\buniversity of washington\b|\bchapter\b|\bthe\b", " ", n)
    return re.sub(r"[^a-z0-9]+", "", n)


def read_club_aliases():
    """club_aliases.txt: 'instagram_handle = HuskyLink club name' -> {handle: name}."""
    try:
        lines = CLUB_ALIASES_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return {}
    aliases = {}
    for line in lines:
        handle, sep, name = line.split("#")[0].partition("=")
        if sep and handle.strip() and name.strip():
            aliases[handle.strip().lstrip("@").lower()] = name.strip()
    return aliases


def club_picture(handle):
    """The site path of a club's saved Instagram profile picture, or None."""
    path = IG_CLUB_IMAGES / f"{handle}.jpg"
    return f"/ig/clubs/{path.name}" if handle and path.exists() else None


def found_instagram_handles():
    """HuskyLink club name -> Instagram handle, for clubs find_instagram_handles.py found one for."""
    return {name: v["handle"] for name, v in _load(CLUB_INSTAGRAM_FILE, {}).items() if v.get("handle")}


def merge_huskylink_clubs(clubs):
    """Add every HuskyLink group. A club already listed under the same Instagram, a matching name,
    or matched to it in club_aliases.txt gets the gaps filled in."""
    clubs = [c for c in clubs if c.get("source") != "huskylink"]
    by_name = {club_key(c["name"]): c for c in clubs}
    by_handle = {c["handle"]: c for c in clubs if c.get("handle")}
    aliases = read_club_aliases()
    for c in clubs:
        if c.get("handle") in aliases:
            by_name[club_key(aliases[c["handle"]])] = c
    handles = found_instagram_handles()
    for h in load_huskylink()["clubs"]:
        handle = handles.get(h["name"])
        if handle:
            h = {**h, "handle": handle, "instagram": f"https://www.instagram.com/{handle}/",
                 "logo": h.get("logo") or club_picture(handle)}
        c = by_handle.get(handle) or by_name.get(club_key(h["name"]))
        if c is None:
            clubs.append({**h, "source": "huskylink"})
            by_name[club_key(h["name"])] = clubs[-1]
            continue
        c["name"] = h["name"]  # HuskyLink's official name (write_site_clubs keeps any name already shown)
        for field in ("website", "about", "description", "handle", "instagram", "logo"):
            c[field] = c.get(field) or h.get(field)
        if c.get("category") in (None, "Other") or h["category"] in IDENTITY_CATEGORIES:
            c["category"] = h["category"]
    on_huskylink = {h["name"] for h in load_huskylink()["clubs"]}
    for c in clubs:
        if c["name"] not in on_huskylink and GREEK_NAME.search(c["name"]) and not NOT_SOCIAL_GREEK.search(c["name"]):
            c["category"] = "Greek Life"
    for c in clubs:  # some HuskyLink missions have a typed-in "\r\n"; older merges kept it
        for field in ("about", "description"):
            if c.get(field):
                c[field] = re.sub(r"\\r\\n|\\n|\\r", "\n", c[field])
    clubs.sort(key=lambda c: c["name"].lstrip("@").lower())
    return clubs


# ------------------------------------------------- activity + major fields ---
def activity_keys(host):
    """Keys a host is remembered under: its tidied name and, for Instagram hosts, '@handle'."""
    name, handle = parse_host(host)
    return [k for k in (club_key(name) if name else None, f"@{handle}" if handle else None) if k]


def record_activity(entries):
    """Remember the latest event date per club. entries: (host name or 'Name (@handle)', 'YYYY-MM-DD')."""
    activity = _load(CLUB_ACTIVITY_FILE, {})
    for host, day in entries:
        for k in activity_keys(host):
            if day and day > activity.get(k, ""):
                activity[k] = day
    CLUB_ACTIVITY_FILE.write_text(json.dumps(dict(sorted(activity.items())), indent=0, ensure_ascii=False),
                                  encoding="utf-8")


def last_event(club, activity):
    keys = [club_key(club["name"])] + ([f"@{club['handle']}"] if club.get("handle") else [])
    return max((activity[k] for k in keys if k in activity), default=None)


def ai_club_fields(clubs):
    """Ask Groq which major fields each club relates to. Returns a list of field lists, or None."""
    if not GROQ_KEY or not pick_model():
        return None
    listing = "\n".join(f"{i + 1}. {c['name']}: {(c.get('about') or c.get('description') or '')[:160]}"
                        for i, c in enumerate(clubs))
    prompt = f"""Sort these University of Washington student clubs into academic/career fields.
Fields: {MAJOR_FIELDS}.
A club can have several fields, or none. Give a field only when the club is clearly about that
area of study or career (a pre-med club -> Health; a robotics club -> Engineering and
Computing & Math; a consulting club -> Business; a dance team, faith group or most cultural
and social clubs -> no fields).

Reply with ONLY JSON: {{"clubs": [{{"club": 1, "fields": ["..."]}}]}}

{listing}"""
    for attempt in range(12):
        try:
            r = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}"},
                json={"model": pick_model(), "temperature": 0, "response_format": {"type": "json_object"},
                      "messages": [{"role": "user", "content": prompt}],
                      # gpt-oss models "think" first; keep it short to stay under the free token limits.
                      **({"reasoning_effort": "low"} if "gpt-oss" in pick_model() else {})},
                timeout=120,
            )
        except Exception as e:
            print(f"  Groq request failed ({e}).", flush=True)
            return None
        if r.status_code == 429:
            m = re.search(r"try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", r.text)
            wait = (int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + float(m.group(3))) if m else 30
            if wait > 600:
                print(f"  Groq's daily free limit is used up (resets in {wait / 3600:.1f} h). Run again later; "
                      "finished clubs are saved.", flush=True)
                return None
            print(f"  Groq's free limit reached; waiting {wait:.0f}s...", flush=True)
            time.sleep(wait + 2)
            continue
        if r.status_code == 400 and "json_validate_failed" in r.text:
            continue  # the model's JSON came out malformed; just ask again
        if r.status_code != 200:
            print(f"  Groq error {r.status_code}: {r.text[:300]}", flush=True)
            return None
        try:
            replies = json.loads(r.json()["choices"][0]["message"]["content"])["clubs"]
        except (KeyError, TypeError, ValueError) as e:
            print(f"  Groq's reply wasn't usable ({e}); asking again.", flush=True)
            continue
        # Each reply names its club by number, but sometimes by name; fall back to the order given.
        numbers = {club_key(c["name"]): i for i, c in enumerate(clubs)}
        got = {}
        for n, reply in enumerate(replies):
            ref = str(reply.get("club", "")).strip().rstrip(".")
            i = int(ref) - 1 if ref.isdigit() else numbers.get(club_key(ref), n)
            got[i] = reply.get("fields") or []
        return [[f for f in got.get(i, []) if f in MAJOR_FIELDS] for i in range(len(clubs))]
    return None


def finish_clubs(clubs):
    """Put clubs with an event in the past year (or coming up) first, leave the rest out unless
    SHOW_INACTIVE_CLUBS is on, and add each club's latest event date and major fields.
    Both scrapers call this last."""
    activity = _load(CLUB_ACTIVITY_FILE, {})
    cutoff = (TODAY - timedelta(days=ACTIVE_DAYS)).isoformat()
    for c in clubs:
        c["last_event"] = last_event(c, activity)
    total = len(clubs)
    active = [c for c in clubs if (c["last_event"] or "") >= cutoff]
    clubs = active + [c for c in clubs if (c["last_event"] or "") < cutoff] if SHOW_INACTIVE_CLUBS else active
    print(f"Keeping {len(clubs)} of {total} clubs ({len(active)} with an event in the past {ACTIVE_DAYS} days or coming up)")

    saved = _load(CLUB_FIELDS_FILE, {})
    fingerprint = lambda c: f"{c['name']}|{(c.get('about') or c.get('description') or '')[:160]}"
    todo = [c for c in clubs if saved.get(club_key(c["name"]), {}).get("from") != fingerprint(c)]
    if todo and GROQ_KEY:
        print(f"Sorting {len(todo)} club(s) into major fields with AI...", flush=True)
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        result = ai_club_fields(batch)
        if result is None:
            break
        for c, fields in zip(batch, result):
            saved[club_key(c["name"])] = {"fields": fields, "from": fingerprint(c)}
        CLUB_FIELDS_FILE.write_text(json.dumps(saved, indent=0, ensure_ascii=False), encoding="utf-8")
        print(f"  {min(i + 20, len(todo))}/{len(todo)} sorted", flush=True)

    for c in clubs:
        c["fields"] = saved.get(club_key(c["name"]), {}).get("fields", [])
    return clubs


# ------------------------------------------------------------- applications ---
# Clubs post when applications open ("Applications for our 2026-27 team are OPEN, link in bio!").
# The site lists the open ones on its Clubs page.
SITE_APPLICATIONS_FILE = HERE.parent / "public" / "applications.json"
APPLICATION_LOOKBACK_DAYS = 45  # posts older than this aren't checked for applications
APPLICATION_SHOW_DAYS = 30      # an application with no deadline is shown this long after its post
APPLICATION_BATCH = 8           # posts per Groq request
# Only posts mentioning one of these are worth asking the AI about.
APPLY_WORDS = re.compile(
    r"\b(appl(y|ying|ications?)|recruit\w*|rush|interest forms?|sign[- ]?up forms?|forms?\b.{0,20}\b(open|due)|"
    r"hiring|positions?|officers?|board members?|auditions?|try-?outs?|join our (team|board|cast)|deadline)\b", re.I)
# What an application is for, so the site can filter them. KIND_WORDS is the fallback when the AI
# didn't say: the first group whose words appear in the "for" text wins.
APPLICATION_KINDS = ["Membership", "Officer & board", "Team & staff", "Auditions & tryouts", "Programs", "Other"]
KIND_WORDS = [
    ("Auditions & tryouts", r"audition|try-?outs?|cast|perform"),
    ("Officer & board", r"officer|board|lead|chair|president|director|committee|exec"),
    ("Programs", r"mentor|program|fellow|cohort|intern|scholar"),
    ("Membership", r"member|join|interest|recruit|sorority|fraternity|rush|\bfam\b"),
    ("Team & staff", r"team|staff|writer|\bdj|volunteer|submission|crew|position|editor|photographer"),
]


def application_kind(text):
    return next((kind for kind, words in KIND_WORDS if re.search(words, text or "", re.I)), "Other")


URL_IN_TEXT = re.compile(r"(?:https?://)?(?:[\w-]+\.)+(?:com|org|net|edu|io|gle|ly|ee|co|me|gl|app)(?:/[^\s)\]}>\"']*)?", re.I)


def application_prompt(batch):
    posts = "\n\n".join(
        f"POST {i + 1}\nClub: {p['club']}\nPosted: {p['posted'] or 'unknown'}\n"
        f"Caption: {p['caption'][:1500]}"
        + (f"\nText in the picture: {p['image_text'][:500]}" if p.get("image_text") else "")
        for i, p in enumerate(batch)
    )
    return f"""Today is {TODAY:%A, %B %d, %Y}. Below are Instagram posts from University of Washington clubs.

For each post, say whether it invites people to APPLY or SIGN UP for something that is still open:
club membership, an officer or board position, a project or research team, a committee, auditions
or tryouts, a mentorship or other program, or fraternity/sorority recruitment.
Rules:
- Only applications that are open now (or opening soon) and not past their deadline.
- NOT: thank-yous or recaps ("thanks to everyone who applied"), welcoming new members, stories
  about past recruitment, events people simply show up to, RSVPs or registration to attend an
  event, talk, workshop, retreat or trip, reminders for clubs to register with the university,
  giveaways or raffles, surveys or feedback forms, or job ads from companies.
- "for": what people apply for, 2-8 words in the post's words, e.g. "General membership",
  "Officer positions", "2026-27 research team", "Spring recruitment", "Show performers".
- "deadline": YYYY-MM-DD if a deadline is given (work out "this Friday" from the Posted date), else null.
- "link": a web address written in the caption for applying (forms.gle/..., bit.ly/..., linktr.ee/...),
  copied exactly, else null.
- "link_in_bio": true if the post says the form or link is in the bio.
- "kind": exactly one of {APPLICATION_KINDS}: "Membership" for joining the club (interest forms,
  general members, fraternity/sorority recruitment); "Officer & board" for officer, board, chair
  and committee roles; "Team & staff" for project or research teams, staff, writers, DJs and
  volunteers; "Auditions & tryouts" for auditions, tryouts and performer sign-ups; "Programs" for
  mentorship programs, internships and fellowships; "Other" for anything else.

Reply with ONLY JSON in this shape:
{{"posts": [{{"post": 1, "application": null}}, {{"post": 2, "application": {{"for": "...", "kind": "Membership", "deadline": null, "link": null, "link_in_bio": false}}}}]}}
Include every post, with "application": null when it has none.

{posts}"""


def clean_application(a, caption):
    """The AI's answer for one post, checked: a real deadline date, and a link only if the caption has it."""
    if not isinstance(a, dict) or not str(a.get("for") or "").strip():
        return None
    try:
        deadline = datetime.strptime(str(a.get("deadline")), "%Y-%m-%d").date().isoformat()
    except ValueError:
        deadline = None
    link = str(a.get("link") or "").strip().rstrip(".,!)")
    bare = re.sub(r"^https?://", "", link, flags=re.I)
    if not bare or bare.lower() not in caption.lower() or not URL_IN_TEXT.fullmatch(link):
        link = None  # made up, or not a web address
    elif not link.lower().startswith("http"):
        link = f"https://{link}"
    what = str(a["for"]).strip()[:80]
    kind = a.get("kind") if a.get("kind") in APPLICATION_KINDS else application_kind(what)
    return {"for": what, "kind": kind, "deadline": deadline, "link": link, "link_in_bio": bool(a.get("link_in_bio"))}


def ai_applications(batch):
    """Ask Groq which posts in a batch announce open applications. One answer (or None) per post,
    or None if the AI couldn't be reached."""
    if not GROQ_KEY or not pick_model():
        return None
    for attempt in range(5):
        try:
            r = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}"},
                json={"model": pick_model(), "temperature": 0, "response_format": {"type": "json_object"},
                      "messages": [{"role": "user", "content": application_prompt(batch)}]},
                timeout=90,
            )
        except Exception as e:
            print(f"Groq request failed ({e}); checking these posts for applications next run.", file=sys.stderr)
            return None
        if r.status_code == 429 and attempt < 4:
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
            by_post = {int(p["post"]): p.get("application") for p in data.get("posts", [])}
        except (KeyError, TypeError, ValueError) as e:
            print(f"Groq reply wasn't usable ({e}); checking these posts next run.", file=sys.stderr)
            return None
        return [clean_application(by_post.get(i + 1), p["caption"] + " " + (p.get("image_text") or ""))
                for i, p in enumerate(batch)]
    return None


def find_applications(store):
    """Check recent posts for open applications (once per post). Posts that don't mention applying,
    forms or recruiting are settled without asking the AI."""
    since = (TODAY - timedelta(days=APPLICATION_LOOKBACK_DAYS)).isoformat()
    todo = []
    for key, p in store.items():
        if "application" in p or (p.get("posted") or "") < since:
            continue
        if APPLY_WORDS.search(p.get("caption") or "") or APPLY_WORDS.search(p.get("image_text") or ""):
            todo.append((key, p))
        else:
            p["application"] = None
    if not todo or not GROQ_KEY:
        return
    print(f"Checking {len(todo)} post(s) for open applications...", flush=True)
    found = 0
    for i in range(0, len(todo), APPLICATION_BATCH):
        batch = todo[i:i + APPLICATION_BATCH]
        answers = ai_applications([p for _, p in batch])
        if answers is None:
            break  # tried again next run
        for (key, p), a in zip(batch, answers):
            p["application"] = a
            found += a is not None
        if i + APPLICATION_BATCH < len(todo):
            time.sleep(3)  # stay under Groq's free per-minute limit
    print(f"Found {found} open application(s).")


def application_is_open(app, posted):
    if app.get("deadline"):
        return app["deadline"] >= TODAY.isoformat()
    return (posted or "") >= (TODAY - timedelta(days=APPLICATION_SHOW_DAYS)).isoformat()


def write_site_applications(store):
    """Write the open applications to public/applications.json for the site's Clubs page. Ones from
    other people's runs (posts this computer doesn't have) are kept while they're open."""
    profiles = _load(CLUB_PROFILES_FILE, {})
    not_uw = not_uw_clubs(store)
    # Each club's category (for the site's Club type filter), also for clubs not on the Clubs page:
    # the one it picked on HuskyLink, else the AI's guess from its Instagram.
    huskylink_category = {h["name"]: h["category"] for h in load_huskylink()["clubs"]}
    category_of = {handle: huskylink_category.get(name) for name, handle in found_instagram_handles().items()}
    club_info = _load(CLUB_INFO_FILE, {})
    apps = []
    for key, p in store.items():
        a = p.get("application")
        if not a or p["club"] in not_uw or not application_is_open(a, p.get("posted")):
            continue
        handle = parse_host(p["club"])[1]
        bio_link = (profiles.get(handle) or {}).get("website") if handle else None
        apps.append({
            "id": key,
            "host": p["club"],
            "for": a["for"],
            "kind": a.get("kind") or application_kind(a["for"]),
            "deadline": a.get("deadline"),
            # Where the Apply button goes: the caption's own link, else the bio link when the post
            # points there; with neither, the site sends people to the post itself.
            "link": a.get("link") or (bio_link if a.get("link_in_bio") else None),
            "post": p["url"],
            "posted": p.get("posted"),
            "logo": club_picture(handle),  # for clubs not on the Clubs page yet
            "category": category_of.get(handle) or (club_info.get(handle) or {}).get("category"),
        })
    try:
        site = json.loads(SITE_APPLICATIONS_FILE.read_text(encoding="utf-8")).get("applications", [])
    except (FileNotFoundError, ValueError):
        site = []
    apps += [a for a in site if a["id"] not in store and application_is_open(a, a.get("posted"))]
    # A club often posts the same application twice (the opening, then a reminder): keep the newest.
    newest = {}
    for a in sorted(apps, key=lambda a: a.get("posted") or ""):
        newest[(parse_host(a["host"])[1] or a["host"], re.sub(r"[^a-z0-9]", "", a["for"].lower()))] = a
    apps = sorted(newest.values(), key=lambda a: (a["deadline"] or "9999", a.get("posted") or ""))
    SITE_APPLICATIONS_FILE.write_text(
        json.dumps({"updated": datetime.now().isoformat(timespec="minutes"), "applications": apps},
                   indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(apps)} open application(s) to {SITE_APPLICATIONS_FILE}")
    return apps


if __name__ == "__main__":
    # Rebuild the site files from what's already saved, without scraping anything new.
    saved = load_store()
    write_site_events(saved)
    write_site_clubs(saved)
    write_site_applications(saved)
