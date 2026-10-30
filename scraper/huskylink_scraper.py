"""
DubHub's HuskyLink scraper: reads UW Seattle's official club directory (every
RSO, Greek chapter and student government group on huskylink.washington.edu)
and the events those groups post there. No login or API key needed.

Setup (one time):
  pip install requests

Every run (from this folder):
  python huskylink_scraper.py

It saves what it found to huskylink.json (kept on GitHub, so the other
scrapers include it too) and updates public/clubs.json and public/events.json.
Then push the website so the new clubs and events go live.

It downloads the full directory (about 6 MB, takes around 30 seconds), HuskyLink's
public event feed, and its public past-events list (20 per request, one request a
second), which records when each club last held an event in club_activity.json.
"""

import html
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

import requests

from events_common import (
    HUSKYLINK_FILE,
    SITE_CLUBS_FILE,
    SITE_EVENTS_FILE,
    ACTIVE_DAYS,
    TODAY,
    finish_clubs,
    load_store,
    locate,
    merge_huskylink_clubs,
    merge_huskylink_events,
    record_activity,
    write_site_clubs,
    write_site_events,
)
from uw_buildings import find_building

BASE = "https://huskylink.washington.edu"
HEADERS = {"User-Agent": "DubHub club scraper (github.com/adamxlegend/dubhub)"}
DAYS_AHEAD = 30  # events further out than this are skipped

# HuskyLink's categories -> the categories the website uses.
CATEGORY_MAP = {
    "Academic": "Academic",
    "Business": "Business",
    "Cultural/International": "Cultural",
    "Engineering": "Engineering",
    "Environmental": "Service",
    "Gaming/Esports": "Gaming",
    "Graduate/Professional": "Academic",
    "Health Sciences": "Academic",
    "Honorary Society": "Academic",
    "IFC/Panhellenic Association Greeks": "Social",
    "Independent Fraternity or Sorority": "Social",
    "Law": "Academic",
    "Medical/Dental/Nursing/Pharmacy": "Academic",
    "Multicultural Greek Council": "Social",
    "National Pan-Hellenic Council": "Social",
    "Performing Arts": "Arts",
    "Political/Social Action": "Service",
    "Religious/Spiritual": "Cultural",
    "Sciences": "Academic",
    "Special Interest": "Social",
    "Sports/Recreation": "Sports",
    "Student Government": "Service",
    "Veteran": "Social",
}
# Used when a group has no category, by its group type.
GROUP_TYPE_MAP = {
    "Fraternity & Sorority Life": "Social",
    "Student Government": "Service",
    "Rec Clubs": "Sports",
}

# HuskyLink's event types -> the event types (and map colors) the website uses.
EVENT_TYPE_MAP = {
    "Meeting": "Club",
    "Workshop": "Study",
    "Office Hours": "Study",
    "Academic": "Study",
    "Educational/Awareness": "Study",
    "Social/Fun": "Hangout",
    "Movie": "Hangout",
    "Athletic/Sports": "Hangout",
    "Competition/Tournament": "Game night",
}
GAME_WORDS = re.compile(r"\b(game night|board games?|video games?|esports|tournament|commander|mtg)\b", re.I)
HIDDEN_LOCATIONS = re.compile(r"private location|sign in to display|^tbd$|^tba$", re.I)


def clean(text):
    """Unescape HTML, drop tags and squeeze whitespace (keeping line breaks)."""
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    text = re.sub(r"\\r\\n|\\n|\\r", "\n", text)  # some groups typed a literal "\r\n" into HuskyLink
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\s*\n\s*", "\n", text).strip()


def first_sentence(text, limit=120):
    line = text.split("\n")[0]
    m = re.match(r"(.+?[.!?])(\s|$)", line)
    s = (m.group(1) if m else line).strip()
    return s if len(s) <= limit else s[: limit - 1].rsplit(" ", 1)[0] + "…"


# ------------------------------------------------------------------- clubs ---
def scrape_clubs():
    print("Downloading the HuskyLink club directory (about 30 seconds)...", flush=True)
    r = requests.get(f"{BASE}/club_signup", params={"view": "all"}, headers=HEADERS, timeout=180)
    r.raise_for_status()
    clubs = []
    for item in r.text.split('<li class="list-group-item"')[1:]:
        name = re.search(r'<legend><span class="sr-only">(.*?)</span>', item, re.S)
        if not name or not re.search(r'id="cb_club_\d+"', item):
            continue  # the table header row, not a group
        url = re.search(r'<h2 class="media-heading[^"]*">\s*<a[^>]*href="\s*(\S+?)\s*"', item, re.S)
        kind = re.search(r'<p class="h5 media-heading grey-element">(.*?)</p>', item, re.S)
        mission = re.search(r'id="club_\d+"[^>]*>\s*<strong>Mission</strong><br>(.*?)</p>', item, re.S)

        group_type, _, category = re.sub(r"\s+", " ", clean(kind.group(1) if kind else "")).partition(" - ")
        mission = clean(mission.group(1)) if mission else ""
        clubs.append({
            "name": clean(name.group(1)),
            "website": url.group(1) if url else None,
            "category": CATEGORY_MAP.get(category.strip()) or GROUP_TYPE_MAP.get(group_type.strip()) or "Other",
            "about": first_sentence(mission) if mission else None,
            "description": mission[:1000] or None,
        })
    print(f"Found {len(clubs)} groups")
    return clubs


# ------------------------------------------------------------------ events ---
def event_type(item, title, description):
    if GAME_WORDS.search(f"{title} {description}"):
        return "Game night"
    if item.findtext("foodProvided") == "1" and item.findtext("eventType") == "Social/Fun":
        return "Food"
    return EVENT_TYPE_MAP.get(item.findtext("eventType") or "", "Club")


def short_location(address):
    """'Savery Hall, Room 138, 4001 East Stevens Way NE, ...' -> 'Savery Hall, Room 138'."""
    parts = []
    for part in address.split(","):
        part = part.strip()
        if re.match(r"\d+ ", part) or re.search(r"\bSeattle\b|\bWA\b|United States", part):
            break
        parts.append(part)
    return ", ".join(parts) or address


def where_and_pos(item, title, description):
    address = clean(item.findtext("eventLocation"))
    if address and not HIDDEN_LOCATIONS.search(address):
        return short_location(address), locate(short_location(address)) or locate(address)
    # HuskyLink hides most locations unless you sign in, so look for a building in the text instead.
    building = find_building(f"{title}\n{description}")
    return (building[0], list(building[1])) if building else (None, None)


def scrape_events():
    print("Downloading HuskyLink's event feed...", flush=True)
    r = requests.get(f"{BASE}/rss_events", headers=HEADERS, timeout=90)
    r.raise_for_status()
    last_day = (TODAY + timedelta(days=DAYS_AHEAD)).isoformat()

    events, seen, activity = [], set(), []
    items = ET.fromstring(r.content).findall(".//item")
    items.sort(key=lambda i: i.findtext("eventStartDateTime") or "")
    for item in items:
        start = datetime.fromisoformat(item.findtext("eventStartDateTime")[:19])
        end = datetime.fromisoformat(item.findtext("eventEndDateTime")[:19])
        host = clean(item.findtext("group"))
        activity.append((host, start.date().isoformat()))  # any scheduled event counts as activity
        if not TODAY.isoformat() <= start.date().isoformat() <= last_day:
            continue
        title = clean(item.findtext("title"))
        # Weekly meetings repeat dozens of times; only list the next one of each.
        if (host, title) in seen:
            continue
        seen.add((host, title))

        description = clean(item.findtext("fullDescription") or item.findtext("description"))
        all_day = item.findtext("allDayEvent") == "1"
        where, pos = where_and_pos(item, title, description)
        events.append({
            "id": f"hl-{item.findtext('eventId')}",
            "title": title,
            "type": event_type(item, title, description),
            "host": host,
            "where": where,
            "pos": pos,
            "date": start.date().isoformat(),
            "start": None if all_day else start.strftime("%H:%M"),
            "end": None if all_day or end.date() != start.date() else end.strftime("%H:%M"),
            "url": item.findtext("eventLink"),
            "source": "huskylink",
            "description": description or None,
        })
    print(f"Found {len(events)} upcoming events in the next {DAYS_AHEAD} days")
    return events, activity


def scrape_past_activity():
    """(club, date) for HuskyLink's public past events: what its own 'Past Events' filter shows."""
    print("Reading HuskyLink's past events...", flush=True)
    oldest = (TODAY - timedelta(days=ACTIVE_DAYS)).isoformat()
    activity, offset = [], 0
    while offset < 5000:
        r = requests.get(f"{BASE}/mobile_ws/v17/mobile_events_list", params={"filter1": "past", "range": offset},
                         headers=HEADERS, timeout=60)
        r.raise_for_status()
        page = [x for x in r.json() if x.get("listingSeparator") != "true" and x.get("p3")]
        if not page:
            break
        for x in page:
            # p4 is HTML like "<p ...>Fri, Oct 23, 2026</p>...", p9 the group's name.
            m = re.search(r"\w{3}, (\w{3} \d{1,2}, \d{4})", clean(x.get("p4")))
            if m:
                activity.append((clean(x.get("p9")), datetime.strptime(m.group(1), "%b %d, %Y").date().isoformat()))
        if activity and activity[-1][1] < oldest:
            break
        offset += 20
        time.sleep(1)
    print(f"Found {len(activity)} past events from {len({a[0] for a in activity})} clubs")
    return activity


def update_site_files():
    """Put the HuskyLink clubs and events on the site, keeping the Instagram ones."""
    store = load_store()
    if store:
        # This computer has the Instagram scraper's memory, so rebuild everything from it.
        write_site_events(store)
        write_site_clubs(store)
        return
    # No Instagram memory here: keep whatever Instagram clubs/events the site has now.
    def current(path, key):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return {key: []}

    site = current(SITE_EVENTS_FILE, "events")
    site["events"] = merge_huskylink_events(site["events"])
    site["updated"] = datetime.now().isoformat(timespec="minutes")
    SITE_EVENTS_FILE.write_text(json.dumps(site, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(site['events'])} upcoming events to {SITE_EVENTS_FILE}")

    clubs = finish_clubs(merge_huskylink_clubs(current(SITE_CLUBS_FILE, "clubs")["clubs"]))
    SITE_CLUBS_FILE.write_text(json.dumps({"clubs": clubs}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(clubs)} clubs to {SITE_CLUBS_FILE}")


def main():
    try:
        clubs = scrape_clubs()
        events, upcoming = scrape_events()
        past = scrape_past_activity()
    except requests.RequestException as e:
        sys.exit(f"Couldn't reach HuskyLink ({e}). Nothing was changed.")
    if not clubs:
        sys.exit("HuskyLink's directory came back empty (the page may have changed). Nothing was changed.")
    record_activity(upcoming + past)
    HUSKYLINK_FILE.write_text(
        json.dumps({"updated": datetime.now().isoformat(timespec="minutes"), "clubs": clubs, "events": events},
                   indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Saved to {HUSKYLINK_FILE}")
    update_site_files()


if __name__ == "__main__":
    main()
