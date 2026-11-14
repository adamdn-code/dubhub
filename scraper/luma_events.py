"""
Reads UW clubs' events from Luma (luma.com, formerly lu.ma), the RSVP site many clubs use, and
puts the ones in Seattle on the site.

How it reads Luma. Luma's website gets its data from a public API (api.luma.com) that needs no
login. This combines what the open-source Luma scrapers we compared do best (see SOURCES.md):
  - /discover/get-paginated-events with a latitude and longitude, page by page with a cursor:
    every public event near UW, with its calendar and how many are going
    (dsec-hub/event_api_scraper, a student club's scraper; KShivendu/event-radar's city feed),
  - /calendar/get-items: one calendar's upcoming events (event-radar's organizer calendars),
  - /url: what a lu.ma link points to, and /event/get: one event's description,
  - a pause between requests and a stop when Luma says to slow down (mayckolco/luma-event-scraper).
It never reads guest lists (several scrapers out there do; DubHub has no reason to).

Which events count: only UW clubs' (on HuskyLink or not), in Seattle.
  1. Events on a UW club's own Luma calendar. Calendars are found two ways: from the Luma links
     clubs post (captions, bios, websites, HuskyLink), and from events near campus whose calendar
     says UW or that happen on campus. A calendar counts when its Instagram or name matches a
     club DubHub already knows, or else the AI (Groq) reads its name, description and events and
     says it's run by UW Seattle students: not a department, company or person. Results go to
     club_luma.json (on GitHub); set a calendar's "status" to "club" or "not" with
     "from": "manual" to decide one by hand.
  2. Events a UW club links to (often on an officer's personal calendar, or a partner group's
     for a collab): the club that linked it is its host, unless it's on a UW club's calendar.
Online events are left out; an event whose address Luma only shows to guests is kept as a club's.
Results: luma.json (on GitHub), merged into the site's events (public/events.json) here and
whenever another scraper writes them (events_common.merge_luma_events). An Instagram post of the
same event folds into the Luma copy, which has the exact time and place; an event that's also on
HuskyLink keeps its HuskyLink copy.

Every run (from this folder):
    python luma_events.py
    python luma_events.py --dry-run     # show what it finds, save nothing
"""

import json
import re
import sys
import time
from datetime import date, datetime
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests

from events_common import (
    CLUB_INSTAGRAM_FILE,
    CLUB_PROFILES_FILE,
    GROQ_KEY,
    HUSKYLINK_FILE,
    LUMA_CALENDARS_FILE,
    LUMA_EVENTS_FILE,
    POSTS_FILE,
    SEATTLE_BOUNDS,
    SITE_CLUBS_FILE,
    SITE_EVENTS_FILE,
    TODAY,
    TYPE_KEYWORDS,
    UNLISTED_CLUBS_FILE,
    _load,
    club_key,
    handle_rate_limit,
    merge_luma_events,
    pick_model,
    record_activity,
)
from find_unlisted_clubs import similar_huskylink
from guess_instagram_handles import OTHER_SCHOOL, STRONG_UW_SIGN, UW_USERNAME

API = "https://api.luma.com"
HEADERS = {"User-Agent": "Mozilla/5.0 (DubHub UW events; github.com/adamxlegend/dubhub)", "Accept": "application/json"}
PAUSE = 1.0  # seconds between requests
SEATTLE = ZoneInfo("America/Los_Angeles")
UW = ("47.6553", "-122.3035")
UW_CAMPUS = (47.6475, -122.3195, 47.662, -122.295)  # south, west, north, east
DISCOVER_PAGES = 10  # 50 events each; near UW there are about 200
DETAILS_PER_RUN = 60  # event descriptions looked up per run
RECHECK_DAYS = 30  # a calendar the AI wasn't sure about is looked at again after this long
LUMA_LINK = re.compile(r"(?:lu\.ma|luma\.com)/([A-Za-z0-9_-]{3,60})", re.I)
NOT_SLUGS = {"discover", "signin", "login", "create", "home", "calendar", "calendars", "user", "event", "events",
             "settings", "pricing", "explore", "help", "terms", "privacy", "seattle", "sf", "nyc", "la"}


class SlowDown(Exception):
    """Luma asked us to slow down: stop asking for this run."""


def api(path, **params):
    """GET from Luma's public API. None when there's nothing there."""
    for attempt in range(3):
        time.sleep(PAUSE)
        try:
            r = requests.get(API + path, params=params, headers=HEADERS, timeout=30)
        except requests.RequestException as e:
            print(f"  Luma request failed ({str(e)[:80]})", flush=True)
            return None
        if r.status_code == 429:
            if attempt == 2:
                raise SlowDown("Luma asked us to slow down")
            time.sleep(10 * (attempt + 1))
            continue
        return r.json() if r.ok else None
    return None


# ------------------------------------------------------------------------------- the clubs ---
def club_index():
    """The clubs DubHub knows, by Instagram handle and by tidied name -> the host name events use."""
    by_handle, by_key = {}, {}
    try:
        site = json.loads(SITE_CLUBS_FILE.read_text(encoding="utf-8"))["clubs"]
    except (FileNotFoundError, ValueError, KeyError):
        site = []
    for c in site:
        host = f"{c['name']} (@{c['handle']})" if c.get("handle") else c["name"]
        if c.get("handle"):
            by_handle[c["handle"].lower()] = host
        by_key.setdefault(club_key(c["name"]), host)
    for name, v in _load(CLUB_INSTAGRAM_FILE, {}).items():
        if v.get("handle"):
            by_handle.setdefault(v["handle"].lower(), f"{name} (@{v['handle']})")
    for c in _load(HUSKYLINK_FILE, {"clubs": []})["clubs"]:
        by_key.setdefault(club_key(c["name"]), c["name"])
    for h, v in _load(UNLISTED_CLUBS_FILE, {}).items():
        if v.get("status") == "club":
            by_handle.setdefault(h, f"{v.get('name') or '@' + h} (@{h})")
    return by_handle, {k: v for k, v in by_key.items() if len(k) >= 4}


def known_club(cal, by_handle, by_key):
    """The host name of the club DubHub knows this calendar belongs to, or None."""
    ig = (cal.get("instagram_handle") or "").strip().lstrip("@").lower()
    ig = re.sub(r"^(?:https?://)?(?:www\.)?instagram\.com/", "", ig).strip("/")
    if ig and ig in by_handle:
        return by_handle[ig]
    return by_key.get(club_key(cal.get("name") or ""))


def says_uw(cal):
    text = " ".join(filter(None, [cal.get("name"), cal.get("description_short")]))
    handles = " ".join(filter(None, [cal.get("slug"), cal.get("instagram_handle")]))
    if OTHER_SCHOOL.search(text + " " + handles):
        return False
    return bool(STRONG_UW_SIGN.search(text) or UW_USERNAME.search(handles))


def on_campus(ev):
    c = ev.get("coordinate") or {}
    s, w, n, e = UW_CAMPUS
    return bool(c) and s <= c.get("latitude", 0) <= n and w <= c.get("longitude", 0) <= e


def links():
    """lu.ma links UW clubs posted -> the host names of the clubs that posted them."""
    found = {}

    def note(text, host):
        for slug in LUMA_LINK.findall(text or ""):
            if slug.lower() not in NOT_SLUGS and host:
                found.setdefault(slug, set()).add(host)

    by_handle, _ = club_index()
    for post in _load(POSTS_FILE, {}).values():
        if post.get("source") in ("instagram", "discord"):
            note(post.get("caption"), post.get("club"))
    for handle, prof in _load(CLUB_PROFILES_FILE, {}).items():
        note(" ".join(filter(None, [prof.get("bio"), prof.get("website")])), by_handle.get(handle) or f"@{handle}")
    huskylink = _load(HUSKYLINK_FILE, {"clubs": [], "events": []})
    for c in huskylink["clubs"]:
        note(" ".join(filter(None, [c.get("website"), c.get("description")])), c["name"])
    for e in huskylink["events"]:
        note(e.get("description"), e.get("host"))
    return found


# ------------------------------------------------------------------------------- the AI ---
def ai_verdicts(cals):
    """Ask Groq whether each Luma calendar is run by UW Seattle students, and whether it's one of
    the HuskyLink clubs with a similar name. A list of {"verdict", "why", "huskylink"}, or None."""
    if not GROQ_KEY or not pick_model():
        return None
    listing = "\n\n".join(
        f"CALENDAR {i + 1}\nName: {c['name']}\nLuma page: luma.com/{c.get('slug') or c['api_id']}\n"
        f"About: {c.get('description_short') or '(none)'}\nWebsite: {c.get('website') or '(none)'}\n"
        f"Instagram: {c.get('instagram_handle') or '(none)'}\n"
        f"Events: {'; '.join(c['events'][:5]) or '(none listed)'}"
        + ("\nSimilar names on HuskyLink: " + "; ".join(f"H{k + 1}. {n}" for k, n in enumerate(c["similar"]))
           if c["similar"] else "")
        for i, c in enumerate(cals)
    )
    prompt = f"""Below are calendars on Luma (an event RSVP site) with events near the University of Washington in
Seattle. For each, decide whether it belongs to a club, team or organization run by UW Seattle
students. Being registered with the university doesn't matter: fraternities and sororities,
club sports, cultural, faith, tech, business and project clubs, hackathons and student-run
chapters of national groups all count.

It does NOT count if it is:
- a university department, school, office, program, center or lab (staff-run),
- a company, startup, venue, investor or recruiter, or a national organization's own calendar,
- one person's calendar or a city-wide community or meetup group not run by UW students,
- a group at another school (including UW Tacoma, UW Bothell, Seattle University).

Answer "club" only when it's clear, "not" when it clearly isn't, and "unsure" otherwise. "why": a
few words. Some calendars list "Similar names on HuskyLink" (UW's list of registered student
organizations): if the calendar is clearly one of those same groups, give its number in
"huskylink" ("H2" -> 2); otherwise 0.

Reply with ONLY JSON: {{"calendars": [{{"calendar": 1, "verdict": "club", "why": "...", "huskylink": 0}}]}}

{listing}"""
    for _ in range(6):
        try:
            r = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}"},
                json={"model": pick_model(), "temperature": 0, "response_format": {"type": "json_object"},
                      "messages": [{"role": "user", "content": prompt}],
                      **({"reasoning_effort": "low"} if "gpt-oss" in pick_model() else {})},
                timeout=120,
            )
        except Exception as e:
            print(f"  Groq request failed ({e}).", flush=True)
            return None
        if r.status_code == 429:
            if not handle_rate_limit(r):
                return None
            continue
        if r.status_code == 400 and "json_validate_failed" in r.text:
            continue
        if r.status_code != 200:
            print(f"  Groq error {r.status_code}: {r.text[:200]}", flush=True)
            return None
        try:
            got = {int(x["calendar"]): x for x in json.loads(r.json()["choices"][0]["message"]["content"])["calendars"]}
        except (KeyError, TypeError, ValueError):
            continue
        out = []
        for i, c in enumerate(cals):
            reply = got.get(i + 1) or {}
            try:
                n = int(str(reply.get("huskylink") or 0).lstrip("Hh"))
            except ValueError:
                n = 0
            out.append({"verdict": reply.get("verdict", "unsure"), "why": (reply.get("why") or "").strip()[:120],
                        "huskylink": c["similar"][n - 1] if 1 <= n <= len(c["similar"]) else None})
        return out
    return None


# ------------------------------------------------------------------------------- events ---
def plain_text(node):
    """Luma's rich-text description -> plain text."""
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text") or ""
    if node.get("type") == "hard_break":
        return "\n"
    inner = "".join(plain_text(n) for n in node.get("content") or [])
    return inner + ("\n" if node.get("type") in ("paragraph", "heading", "list_item") else "")


def event_type(text):
    for words, kind in TYPE_KEYWORDS:
        if re.search(words, text, re.I):
            return kind
    return "Club"


def seattle_time(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(SEATTLE) if iso else None


def site_event(ev, host, guests=None, description=None):
    """A Luma event -> a site event (None when it's online or outside Seattle, or has passed)."""
    if ev.get("location_type") == "online":
        return None
    start, end = seattle_time(ev.get("start_at")), seattle_time(ev.get("end_at"))
    if not start or (end or start).date() < TODAY:
        return None
    geo = ev.get("geo_address_info") or {}
    coord = ev.get("coordinate") or {}
    pos = None
    if coord.get("latitude") is not None:
        s, w, n, e = SEATTLE_BOUNDS
        if not (s <= coord["latitude"] <= n and w <= coord["longitude"] <= e):
            return None  # somewhere else
        pos = [round(coord["latitude"], 5), round(coord["longitude"], 5)]
    elif geo.get("city") and geo["city"].lower() not in ("seattle",):
        return None
    where = geo.get("address") or geo.get("full_address") or (geo.get("city_state") if geo else None)
    title = (ev.get("name") or "").strip()[:80]
    return {
        "id": f"lm-{ev['api_id']}",
        "title": title,
        "type": event_type(title),  # (descriptions mention food at most events)
        "host": host,
        "where": where,
        "pos": pos,
        "date": start.date().isoformat(),
        "start": start.strftime("%H:%M"),
        "end": end.strftime("%H:%M") if end and end.date() == start.date() else None,
        "url": f"https://luma.com/{ev.get('url') or ev['api_id']}",
        "source": "luma",
        "description": (description or "").strip()[:1500] or None,
        "image": ev.get("cover_url"),
        "rsvps": guests or None,
    }


# ------------------------------------------------------------------------------- the run ---
def main():
    sys.stdout.reconfigure(errors="replace")
    dry = "--dry-run" in sys.argv
    today = TODAY.isoformat()
    saved = _load(LUMA_CALENDARS_FILE, {"calendars": {}, "links": {}})
    calendars, link_info = saved.setdefault("calendars", {}), saved.setdefault("links", {})
    by_handle, by_key = club_index()
    hl_clubs = _load(HUSKYLINK_FILE, {"clubs": []})["clubs"]
    seen = {}  # calendar id -> {"cal": calendar, "events": [event names]}
    nearby = {}  # event id -> discover entry
    linked = []  # (event, host) for upcoming events clubs linked to

    def note_calendar(cal, where, event_name=None):
        if not cal or cal.get("is_personal") or cal.get("personal_user_api_id"):
            return
        s = seen.setdefault(cal["api_id"], {"cal": cal, "events": [], "found": set()})
        s["found"].add(where)
        if event_name and event_name not in s["events"]:
            s["events"].append(event_name)

    try:
        # 1. Links clubs posted.
        for slug, hosts in links().items():
            info = link_info.get(slug)
            if info is None or (info.get("kind") == "event" and info.get("start", "") >= today):
                d = api("/url", url=slug)
                data = (d or {}).get("data") or {}
                ev, cal = data.get("event") or {}, data.get("calendar") or {}
                info = {"kind": (d or {}).get("kind"), "event": ev.get("api_id"), "calendar": cal.get("api_id"),
                        "personal": bool(cal.get("is_personal") or cal.get("personal_user_api_id")),
                        "start": (ev.get("start_at") or "")[:10], "by": sorted(hosts)}
                link_info[slug] = info
                if info["kind"] == "event" and info["start"] >= today:
                    linked.append((ev, sorted(hosts)[0]))
                note_calendar(cal, f"linked by {sorted(hosts)[0]}", ev.get("name"))
        print(f"{len(link_info)} Luma links from UW clubs ({len(linked)} to upcoming events).", flush=True)

        # 2. Events near UW.
        cursor, pages = None, 0
        while pages < DISCOVER_PAGES:
            p = api("/discover/get-paginated-events", latitude=UW[0], longitude=UW[1], pagination_limit=50,
                    **({"pagination_cursor": cursor} if cursor else {}))
            if not p:
                break
            pages += 1
            for entry in p.get("entries") or []:
                ev, cal = entry.get("event") or {}, entry.get("calendar") or {}
                nearby[ev.get("api_id")] = entry
                if says_uw(cal) or on_campus(ev):
                    note_calendar(cal, "events near UW", ev.get("name"))
            cursor = p.get("next_cursor") if p.get("has_more") else None
            if not cursor:
                break
        print(f"{len(nearby)} public events near UW on Luma; {len(seen)} calendars worth a look.", flush=True)
    except SlowDown as e:
        print(f"Stopping early: {e}.", flush=True)

    # 3. Which calendars are UW clubs'.
    ask = []
    for cal_id, s in seen.items():
        cal, entry = s["cal"], calendars.get(cal_id) or {}
        entry.update(name=cal.get("name"), slug=cal.get("slug"),
                     found=sorted(set(entry.get("found", [])) | s["found"])[:6])
        calendars[cal_id] = entry
        if entry.get("from") == "manual":
            continue
        club = known_club(cal, by_handle, by_key)
        if club:
            entry.update(status="club", club=club, why="matches a club DubHub knows", checked=today)
        elif entry.get("status") in ("club", "not") or (entry.get("status") == "maybe" and entry.get("checked", "") >
                                                          (date.fromordinal(TODAY.toordinal() - RECHECK_DAYS)).isoformat()):
            continue
        else:
            ask.append({**cal, "events": s["events"],
                        "similar": similar_huskylink({"username": cal.get("slug") or "", "full_name": cal.get("name")}, hl_clubs)})
    for i in range(0, len(ask), 8):
        batch = ask[i:i + 8]
        verdicts = ai_verdicts(batch)
        if verdicts is None:
            print("  No AI right now: those calendars wait.", flush=True)
            break
        for c, v in zip(batch, verdicts):
            entry = calendars[c["api_id"]]
            status = {"club": "club", "not": "not"}.get(v["verdict"], "maybe")
            if v["huskylink"] and status != "not":
                status = "club"
            club = v["huskylink"] or (c["name"] if status == "club" else None)
            entry.update(status=status, club=club, why=v["why"] or None, checked=today)
            print(f"  AI: {c['name']!r} (luma.com/{c.get('slug') or c['api_id']}) -> {status}"
                  f"{' as ' + club if club and status == 'club' else ''}: {v['why']}", flush=True)

    # 4. The events: club calendars', then the other events clubs linked to.
    events, details = {}, 0
    try:
        for cal_id, entry in calendars.items():
            if entry.get("status") != "club":
                continue
            got = api("/calendar/get-items", calendar_api_id=cal_id, period="future", pagination_limit=50) or {}
            for item in got.get("entries") or []:
                ev = item.get("event") or {}
                events[ev.get("api_id")] = (ev, entry["club"], item.get("guest_count"))
        for ev, host in linked:
            if ev.get("api_id") and ev["api_id"] not in events:
                near = nearby.get(ev["api_id"]) or {}
                events[ev["api_id"]] = (ev, host, near.get("guest_count"))
        out = []
        for api_id, (ev, host, guests) in events.items():
            if not ev.get("api_id"):
                continue
            description = None
            if details < DETAILS_PER_RUN and (seattle_time(ev.get("start_at")) or datetime.min.replace(tzinfo=SEATTLE)).date() >= TODAY:
                d = api("/event/get", event_api_id=api_id) or {}
                details += 1
                description = plain_text(d.get("description_mirror") or {}) or None
                guests = d.get("guest_count", guests)
            e = site_event(ev, host, guests, description)
            if e:
                out.append(e)
    except SlowDown as e:
        print(f"Stopping early: {e}. Keeping the events read so far.", flush=True)
        out = [x for x in (site_event(ev, host, guests) for ev, host, guests in events.values() if ev.get("api_id")) if x]
    out.sort(key=lambda e: (e["date"], e["start"] or "99"))

    clubs = sorted({c["club"] for c in calendars.values() if c.get("status") == "club" and c.get("club")})
    print(f"{len(clubs)} UW club calendar(s) on Luma; {len(out)} upcoming event(s) in Seattle:", flush=True)
    for e in out:
        print(f"  {e['date']} {e['start']}  {e['title'][:50]}  ({e['host'][:40]}; {e['where'] or 'place not shown'})", flush=True)
    if dry:
        print("Dry run: nothing saved.")
        return
    saved["calendars"] = dict(sorted(calendars.items(), key=lambda kv: (kv[1].get("name") or "").lower()))
    LUMA_CALENDARS_FILE.write_text(json.dumps(saved, indent=1, ensure_ascii=False), encoding="utf-8")
    LUMA_EVENTS_FILE.write_text(json.dumps({"updated": datetime.now().isoformat(timespec="minutes"), "events": out},
                                           indent=1, ensure_ascii=False), encoding="utf-8")
    record_activity((e["host"], e["date"]) for e in out)  # a club with Luma events counts as active
    print(f"Saved {len(out)} event(s) to {LUMA_EVENTS_FILE.name}.")
    # Into the site's events as they are (the other scrapers merge luma.json in too when they write
    # them): rebuilding them here would leave out what the flyer step added.
    try:
        site = json.loads(SITE_EVENTS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return
    site["events"] = merge_luma_events(site["events"])
    SITE_EVENTS_FILE.write_text(json.dumps(site, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"The site now has {len(site['events'])} upcoming events.")


if __name__ == "__main__":
    main()
