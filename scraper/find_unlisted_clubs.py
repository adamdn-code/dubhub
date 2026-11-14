"""
Finds UW Seattle clubs that aren't registered student organizations on HuskyLink (many
fraternities and sororities, club sports teams, dance and music groups, new and informal clubs)
through the Instagram accounts that UW clubs and UW's own pages point to, and adds the active
ones to the list instagram_public_scraper.py reads.

Where the accounts to check come from (none of this asks Instagram for anything):
  1. @mentions in the bios and posts of the UW clubs DubHub already reads (a co-hosted event,
     a sister club, "follow @..."): instagram_public_scraper.py notes them from every club page it
     reads (all 12 posts), plus the posts it saved, HuskyLink club missions and event descriptions.
  2. Instagram links on UW pages that list student groups (LISTING_PAGES below: Rec Clubs, the
     fraternity and sorority councils, ...), read again every LISTING_DAYS days.
  3. Clubs named in posts without an @ ("co-hosted with the Korean Student Association"): the AI
     reads the posts the scrapers saved and HuskyLink event descriptions for other student groups
     they name. For a name that isn't a club DubHub knows, it tries the usernames UW clubs usually
     pick (guess_instagram_handles.py) and keeps an account only if its profile says UW and names
     the club. Names and what came of them: unlisted_names.json (on GitHub).
  4. Accounts given by hand: python find_unlisted_clubs.py --add handle1,handle2

Each account is then checked once on its public Instagram page (one page, no login) and kept
only when all of these hold:
  - it isn't a club DubHub already reads. If it's the account of a HuskyLink club whose
    Instagram wasn't known yet, it's saved to club_instagram.json for that club instead.
  - its name or bio says UW (and no other school), the same test guess_instagram_handles.py uses,
  - it's public and has posted in the past year,
  - the AI (Groq) reads its name, bio and latest posts and says it's a group run by UW Seattle
    students, not a department or office, business, person, national organization or city-wide
    group. Without the AI it waits as "maybe" until the AI can look.
Most mentions are people and brands, so only the likeliest are checked: ones from UW pages,
ones whose username sounds like UW, and ones several clubs mention.

Results go to unlisted_clubs.json (on GitHub): handle -> {"status": ...}
  club       a UW student group not on HuskyLink: read by instagram_public_scraper.py from now on,
             and on the Clubs page once it has an event (the one-year rule applies, as for all clubs)
  huskylink  turned out to be a HuskyLink club's account: saved to club_instagram.json
  not        isn't a UW student group (why says so); never checked again
  maybe      the AI wasn't sure or wasn't available; checked again later
  private / inactive / missing   checked again after RECHECK_DAYS
  new        found, not checked yet
To decide one by hand, set its "status" to "club" or "not" and add "from": "manual".

Every run (from this folder; scheduled_scrape.py runs it before each Instagram run):
    python find_unlisted_clubs.py               # gather accounts, check up to 10
    python find_unlisted_clubs.py --limit 5
    python find_unlisted_clubs.py --add uwsundodgers,uwelement
    python find_unlisted_clubs.py --pages       # read the UW listing pages again now
    python find_unlisted_clubs.py --dry-run     # show what it would do, save nothing
To stay polite: 6-12 seconds between Instagram pages, and it stops the moment Instagram objects.
"""

import json
import random
import re
import sys
import time
from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import urljoin, urlparse

import instaloader
import requests
from instaloader.exceptions import BadResponseException, ConnectionException, QueryReturnedNotFoundException

from events_common import (
    ACTIVE_DAYS,
    CLUB_INSTAGRAM_FILE,
    CLUB_PROFILES_FILE,
    GROQ_KEY,
    HUSKYLINK_FILE,
    MENTION,
    MENTIONS_FILE,
    POSTS_FILE,
    SITE_CLUBS_FILE,
    STATE_DIR,
    UNLISTED_CLUBS_FILE,
    _load,
    club_key,
    handle_rate_limit,
    instagram_post_date,
    parse_host,
    pick_model,
    read_club_handles,
)
from find_instagram_handles import NOT_ACCOUNTS, name_match
from guess_instagram_handles import OTHER_SCHOOL, STRONG_UW_SIGN, UW_SIGN, UW_USERNAME, guesses, is_the_club
from instagram_public_scraper import SlowDown, StopOnTooManyRequests, caption_of, club_page

CHECKS_PER_RUN = 10  # Instagram pages each scheduled run: about 40 a day
NAME_PAGES_PER_RUN = 4  # of those, at most this many go to trying usernames for named clubs
NAMES_FILE = UNLISTED_CLUBS_FILE.with_name("unlisted_names.json")  # club names found in posts
NAMES_READ_FILE = STATE_DIR / "unlisted_names_read.txt"  # posts already read for club names
POSTS_PER_RUN = 60  # posts the AI reads for club names each run (20 per request)
MIN_WAIT, MAX_WAIT = 6, 12
RECHECK_DAYS = 60
LISTING_DAYS = 30
LISTING_STAMP = STATE_DIR / "unlisted_listing_pages.txt"  # when the UW listing pages were last read
HEADERS = {"User-Agent": "Mozilla/5.0 (DubHub club finder; github.com/adamxlegend/dubhub)"}

# UW pages that list student groups, and which links on each lead to a group's own page (followed
# two levels: the list, then each group's page; at most PAGES_PER_LISTING pages each). Many of these
# groups aren't on HuskyLink.
LISTING_PAGES = {
    "https://www.washington.edu/ima/rec-clubs/club-offerings/": r"^/ima/rec-clubs/",
    "https://ofsl.uw.edu/councils/panhellenic-council/": r"^/councils/",
    "https://ofsl.uw.edu/councils/united-greek-council/": r"^/councils/",
    "https://uwpanhellenic.com/": r"^/[a-z-]+/?$",
    "https://uwifc.squarespace.com/": r"^/[a-z-]+/?$",
    "https://uwnphc.wordpress.com/": r"^/[a-z0-9-]+/?$",
    "https://sustainability.uw.edu/action/students/groups": r"^/action/students/groups",
    "https://health.asuw.org/": r"^/[a-z0-9-]+/?$",
    "https://dance.washington.edu/organizations": r"^/organizations",
    "https://foster.uw.edu/academics/degree-programs/undergraduate-programs/student-organizations/":
        r"^/academics/degree-programs/undergraduate-programs/student-organizations",
    "https://ischool.uw.edu/current/student-groups": r"^/(current/student-groups|diversity/resources/student-groups)",
    "https://www.cs.washington.edu/academics/undergraduate/undergrad-student-life/student-organizations":
        r"^/academics/undergraduate/undergrad-student-life/student-organizations",
    "https://www.me.washington.edu/students/clubs-competitions": r"^/students/(clubs|engineering)",
    "https://qsc.asuw.org/": r"^/",
}
PAGES_PER_LISTING = 60
# What each of those sites is, for the AI (the site an account was linked from says a lot).
LISTING_SITES = {
    "washington.edu/ima/rec-clubs": "UW Recreation's list of Rec Clubs (club sports teams run by students, not varsity)",
    "ofsl.uw.edu": "UW's Office of Fraternity & Sorority Life",
    "uwpanhellenic.com": "UW Panhellenic (sororities)",
    "uwifc.squarespace.com": "UW Interfraternity Council (fraternities)",
    "uwnphc.wordpress.com": "UW National Pan-Hellenic Council (historically Black fraternities and sororities)",
    "sustainability.uw.edu": "UW Sustainability's list of student sustainability groups",
    "health.asuw.org": "ASUW's list of student health organizations",
    "dance.washington.edu": "UW Dance's list of student dance groups",
    "foster.uw.edu": "the Foster School of Business's list of student organizations",
    "ischool.uw.edu": "the iSchool's list of student groups",
    "cs.washington.edu": "the Allen School's list of student organizations",
    "me.washington.edu": "Mechanical Engineering's list of student clubs and teams",
    "qsc.asuw.org": "ASUW Queer Student Commission",
}

IG_LINK = re.compile(r"instagram\.com/(?!p/|reels?/|explore/|accounts/|stories/|tv/)([A-Za-z0-9_.]{2,30})", re.I)
# UW Bothell's and UW Tacoma's groups ("uwb_...", "uwt.whatever").
OTHER_CAMPUS = re.compile(r"^uw[bt][._]|uwbothell|uwtacoma", re.I)
# Usernames that are the university's own accounts (departments, schools, offices), not clubs.
UNIVERSITY_ACCOUNT = re.compile(
    r"^(uofwa|uw|uwnews|uwdaily|uwathletics|uwhuskies|uwalumni|uwadmissions|uwgreeklife)$|"
    r"school|college|librar|admission|alumni|athletics|^uw(med|medicine)|hospital|uwnews|department|dept\b", re.I)


def clean(handle):
    h = handle.strip(".").lower()
    return None if h in NOT_ACCOUNTS or re.search(r"\.(edu|com|org|net)$", h) else h


def known_handles():
    """Instagram accounts DubHub already reads or lists."""
    known = set(read_club_handles())
    known |= {v["handle"] for v in _load(CLUB_INSTAGRAM_FILE, {}).values() if v.get("handle")}
    known |= set(_load(CLUB_PROFILES_FILE, {}))
    try:
        known |= {c["handle"] for c in json.loads(SITE_CLUBS_FILE.read_text(encoding="utf-8"))["clubs"] if c.get("handle")}
    except (FileNotFoundError, ValueError, KeyError):
        pass
    return known


def mentions():
    """handle -> the accounts and places that mention it: the club pages instagram_public_scraper.py
    read, the posts it saved, and HuskyLink missions and event descriptions."""
    found = defaultdict(set)
    for handle, v in _load(MENTIONS_FILE, {}).items():
        h = clean(handle)
        if h:
            found[h].update(v.get("by", []))

    def note(text, where, own=None):
        for m in MENTION.findall(text or ""):
            h = clean(m)
            if h and h != own:
                found[h].add(where)

    for post in _load(POSTS_FILE, {}).values():
        if post.get("source") in ("instagram", "discord"):
            handle = parse_host(post.get("club"))[1]
            note(post.get("caption"), f"post by @{handle}" if handle else "a club's post", handle)
    for handle, prof in _load(CLUB_PROFILES_FILE, {}).items():
        note(prof.get("bio"), f"bio of @{handle}", handle)
    huskylink = _load(HUSKYLINK_FILE, {"clubs": [], "events": []})
    for c in huskylink["clubs"]:
        note(c.get("description"), f"HuskyLink: {c['name']}")
    for e in huskylink["events"]:
        note(e.get("description"), f"HuskyLink event by {e.get('host')}")
    return found


def listing_page_links():
    """handle -> the UW pages that link to it."""
    found = defaultdict(set)
    for start, follow in LISTING_PAGES.items():
        host = urlparse(start).netloc
        queue, seen = [(start, 0)], set()
        while queue and len(seen) < PAGES_PER_LISTING:
            url, depth = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            try:
                r = requests.get(url, headers=HEADERS, timeout=20)
            except requests.RequestException:
                continue
            time.sleep(0.5)
            if not r.ok or "html" not in r.headers.get("content-type", ""):
                continue
            for m in IG_LINK.findall(r.text):
                h = clean(m)
                if h:
                    found[h].add(url)
            if depth >= 2:
                continue
            for href in re.findall(r'href="([^"#]+)', r.text):
                link = urljoin(url, href).split("?")[0]
                p = urlparse(link)
                if (p.netloc == host and re.search(follow, p.path) and link not in seen
                        and not re.search(r"\.(pdf|jpe?g|png|docx?)$", p.path, re.I)):
                    queue.append((link, depth + 1))
        print(f"  {start}: {len(seen)} page(s)", flush=True)
    return found


def worth_checking(handle, entry):
    """Ones likely to be UW groups: linked from a UW page, sounding like UW, or mentioned by two or
    more clubs. (Most mentions are people and brands.)"""
    found = entry.get("found", [])
    if "added by hand" in found or any(f.startswith("named ") for f in found):
        return True
    if UNIVERSITY_ACCOUNT.search(handle) or OTHER_SCHOOL.search(handle) or OTHER_CAMPUS.search(handle):
        return False
    mentioned_by = {f.split("@")[-1] for f in found if f.startswith(("post by", "bio of", "HuskyLink"))}
    return on_uw_page(entry) or bool(UW_USERNAME.search(handle)) or len(mentioned_by) >= 2


def due(entry, today):
    status = entry.get("status", "new")
    if entry.get("from") == "manual" or status in ("club", "huskylink", "not"):
        return False
    if status == "new" or (status == "maybe" and not entry.get("why")):
        return True  # (a "maybe" with no why is one the AI couldn't look at yet)
    return entry.get("checked", "") <= (today - timedelta(days=RECHECK_DAYS)).isoformat()


def on_uw_page(entry):
    return any(f.startswith("http") for f in entry.get("found", []))


def priority(handle, entry):
    found = entry.get("found", [])
    return (any(f.startswith(("http", "added by hand")) for f in found), bool(UW_USERNAME.search(handle)), len(found))


def says_uw(user):
    """(yes?, why) Whether the profile says UW Seattle, as guess_instagram_handles.py checks."""
    text = " ".join(filter(None, [user.get("username"), user.get("full_name"), user.get("biography")]))
    if OTHER_SCHOOL.search(text):
        return False, "names another school"
    if not UW_SIGN.search(text):
        return False, "doesn't say UW"
    if not STRONG_UW_SIGN.search(text) and not UW_USERNAME.search(user.get("username") or ""):
        return False, "only says Seattle"
    return True, ""


# Words that don't tell clubs apart, left out when looking for HuskyLink clubs with a similar name.
PLAIN_WORDS = {"university", "washington", "uw", "club", "clubs", "association", "society", "student", "students",
               "chapter", "the", "and", "at", "of", "for", "in", "fraternity", "sorority", "inc", "incorporated",
               "international", "national", "team", "organization", "org", "group", "rso", "seattle", "slash",
               "official", "a", "an", "to", "on", "s"}


def name_words(text):
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower().replace("&", " and ")) if w not in PLAIN_WORDS}


def similar_huskylink(user, huskylink_clubs, most=5):
    """HuskyLink clubs whose names share distinctive words with the account's name or username,
    the closest first."""
    words = name_words(user.get("full_name"))
    flat = re.sub(r"[^a-z0-9]", "", (user.get("username") or "").lower())
    scored = []
    for c in huskylink_clubs:
        own = name_words(c["name"])
        if not own:
            continue
        shared = {w for w in own if w in words or (len(w) >= 4 and w in flat)}
        if shared and len(shared) / len(own) >= 0.5:
            # How much the two names have in common, out of all the words in either
            scored.append((len(shared) / len(own | words | shared), len(shared), c["name"]))
    return [n for *_, n in sorted(scored, key=lambda t: (-t[0], -t[1], t[2]))[:most]]


def huskylink_match(user, huskylink_clubs):
    """The name of the HuskyLink club this account clearly belongs to, or None. Several equally
    good matches count as none."""
    key = club_key(user.get("full_name") or "")
    scored = []
    for c in huskylink_clubs:
        ck = club_key(c["name"])
        if len(ck) < 4:
            continue
        same_name = len(key) >= 5 and key == ck
        named = name_match(user["username"], c["name"]) >= 4 and is_the_club(user, c["name"])[0]
        if same_name or named:
            scored.append((2 if same_name else 1, c["name"]))
    if not scored:
        return None
    best = max(s for s, _ in scored)
    names = [n for s, n in scored if s == best]
    return names[0] if len(names) == 1 else None


def described(found):
    """Where an account was found, in words: a listing page's site, or the mention as noted."""
    if not found.startswith("http"):
        return found
    site = next((d for k, d in LISTING_SITES.items() if k in found), None)
    return f"linked from {site}" if site else f"linked from {found}"


def ai_verdicts(accounts):
    """Ask Groq whether each account is a UW Seattle student group, and whether it's one of the
    HuskyLink clubs with a similar name. A list of {"verdict", "why", "huskylink"} (verdict "club",
    "not" or "unsure"; huskylink: that club's name or None), or None when the AI isn't available."""
    if not GROQ_KEY or not pick_model():
        return None
    listing = "\n\n".join(
        f"ACCOUNT {i + 1}\nUsername: @{a['handle']}\nName: {a['name'] or '(none)'}\nBio: {a['bio'] or '(none)'}\n"
        f"Link: {a['link'] or '(none)'}\nFollowers: {a['followers']}\nLatest post: {a['latest']}\n"
        f"Found: {'; '.join(described(f) for f in a['found'][:3])}\n"
        + "\n".join(f"Post: {c[:300]}" for c in a["captions"][:3])
        + ("\nSimilar names on HuskyLink: " + "; ".join(f"H{k + 1}. {n}" for k, n in enumerate(a["similar"]))
           if a["similar"] else "")
        for i, a in enumerate(accounts)
    )
    prompt = f"""Below are public Instagram accounts that University of Washington (Seattle) student clubs or UW
web pages mentioned or linked to. For each, decide whether it's the account of a club, team or
organization run by UW Seattle students. Being registered with the university doesn't matter: a
fraternity or sorority chapter, club sports team, dance, music or theater group, cultural or
faith-based student group, student publication, hackathon or project team all count.

It does NOT count if it is:
- a university department, school, office, program, center, library, or the university itself,
- a business, brand, venue or shop, or a national or regional organization's main account (not the UW chapter's),
- one person's own account,
- a group at another school (including UW Tacoma, UW Bothell, Seattle University, Seattle Pacific),
- a church, community or city-wide group not run by UW students,
- an alumni group, a one-time event, or a class.

Answer "club" only when the name, bio or posts make it clear, "not" when it clearly isn't one, and
"unsure" otherwise. "why": a few words.

Some accounts list "Similar names on HuskyLink", UW's list of registered student organizations. If
the account is clearly one of those same groups (the same club under a longer or shorter name, not
just a similar name: "Alpha Phi" is a different group from "Alpha Phi Alpha"), give its number in
"huskylink" ("H2" -> 2); otherwise 0.

Reply with ONLY JSON: {{"accounts": [{{"account": 1, "verdict": "club", "why": "...", "huskylink": 0}}]}}

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
            replies = json.loads(r.json()["choices"][0]["message"]["content"])["accounts"]
            got = {int(x["account"]): x for x in replies}
        except (KeyError, TypeError, ValueError):
            continue
        out = []
        for i, a in enumerate(accounts):
            reply = got.get(i + 1) or {}
            try:
                n = int(str(reply.get("huskylink") or 0).lstrip("Hh"))
            except ValueError:
                n = 0
            out.append({"verdict": reply.get("verdict", "unsure"), "why": (reply.get("why") or "").strip()[:120],
                        "huskylink": a["similar"][n - 1] if 1 <= n <= len(a["similar"]) else None})
        return out
    return None


def check(L, handle, entry, huskylink_clubs, saved_instagram, today):
    """Look at one account's public page. Returns the entry's new fields, plus (for accounts that
    pass every test but the AI's) the account's details for the AI under "_ask"."""
    try:
        user, nodes = club_page(L, handle)
    except QueryReturnedNotFoundException:
        return {"status": "missing"}
    if user is None:
        return {"status": "missing"}
    name = user.get("full_name") or None
    out = {"name": name}
    if user.get("is_private"):
        return {**out, "status": "private"}
    # (A UW page linking to it already says it's UW's; the AI still checks it's a student group.)
    ok, why = says_uw(user)
    if OTHER_CAMPUS.search(handle):
        ok, why = False, "names another school"
    if not ok and not (on_uw_page(entry) and why != "names another school"):
        return {**out, "status": "not", "why": why}
    dates = sorted(filter(None, (instagram_post_date(n.get("pk") or n.get("id")) for n in nodes)), reverse=True)
    latest = dates[0] if dates else None
    if not latest or latest < today - timedelta(days=ACTIVE_DAYS):
        return {**out, "status": "inactive", "why": f"latest post {latest or 'none'}"}
    match = huskylink_match(user, huskylink_clubs)
    if match:
        known = (saved_instagram.get(match) or {}).get("handle")
        if known and known != handle:
            return {**out, "status": "not", "why": f"a second account of {match} (@{known})"}
        return {**out, "status": "huskylink", "why": match}
    links = user.get("bio_links") or []
    out.update(bio=(user.get("biography") or "")[:300] or None, latest=latest.isoformat())
    return {**out, "status": "maybe", "_ask": {
        "handle": handle, "name": name, "bio": user.get("biography"), "followers": user.get("follower_count"),
        "link": (links[0].get("url") if links else None) or user.get("external_url"),
        "latest": latest.isoformat(), "found": entry.get("found", []),
        "captions": [caption_of(n) for n in nodes if caption_of(n)][:3],
        "similar": similar_huskylink(user, huskylink_clubs),
    }}


def ai_named_clubs(batch):
    """Ask Groq which other student groups each post names. A list of name lists, or None."""
    if not GROQ_KEY or not pick_model():
        return None
    listing = "\n\n".join(f"POST {i + 1}\nPosted by: {who}\n{text[:700]}" for i, (key, who, text) in enumerate(batch))
    prompt = f"""Below are posts by University of Washington student clubs and HuskyLink event listings. For each
post, list the OTHER UW Seattle student organizations it names by name: co-hosts, partners,
sister clubs, groups it thanks or invites. Write each name as the post writes it ("Korean Student
Association", "SASA"), not @usernames. Leave out the club that posted it; teams and clubs from
other schools (opponents, visiting teams, other universities' chapters); companies and brands;
university departments and offices; people; and places. Most posts name none: give an empty list.

Reply with ONLY JSON: {{"posts": [{{"post": 1, "names": []}}]}}

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
            got = {int(x["post"]): x.get("names") or [] for x in json.loads(r.json()["choices"][0]["message"]["content"])["posts"]}
        except (KeyError, TypeError, ValueError):
            continue
        return [[n.strip() for n in got.get(i + 1, []) if isinstance(n, str) and n.strip()] for i in range(len(batch))]
    return None


def initials(name):
    """'Korean Student Association at UW' -> 'ksa' (what clubs usually shorten their name to)."""
    words = [w for w in re.findall(r"[A-Za-z]+", name) if w.lower() not in ("at", "the", "of", "and", "for", "in", "uw",
                                                                            "university", "washington", "seattle")]
    return "".join(w[0] for w in words).lower()


def read_names(names, known_keys, dry, known_initials=frozenset()):
    """Have the AI read posts it hasn't read yet for other clubs' names; note the unknown ones."""
    done = set(NAMES_READ_FILE.read_text(encoding="utf-8").split()) if NAMES_READ_FILE.exists() else set()
    todo = []
    for key, post in sorted(_load(POSTS_FILE, {}).items(), key=lambda kv: kv[1].get("posted") or "", reverse=True):
        if key not in done and post.get("source") in ("instagram", "discord") and len(post.get("caption") or "") > 40:
            todo.append((key, post.get("club") or "a UW club", post["caption"]))
    for e in _load(HUSKYLINK_FILE, {"events": []})["events"]:
        key = f"hl-{e['id']}"
        if key not in done and len(e.get("description") or "") > 40:
            todo.append((key, e.get("host") or "a UW club", f"{e['title']}\n{e['description']}"))
    todo = todo[:POSTS_PER_RUN]
    added = 0
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        found = ai_named_clubs(batch)
        if found is None:
            break
        for (key, who, _), found_names in zip(batch, found):
            done.add(key)
            for name in found_names:
                if name.startswith("@") or (" " not in name and name.islower()):
                    continue  # an @username: the mentions already cover those
                k = club_key(name)
                poster = re.sub(r"[^a-z0-9]", "", who.lower())  # its name and @username
                if len(k) < 3 or k in known_keys or k in poster:
                    continue  # a club DubHub knows, or the poster itself ("TSA" in a post by @tsauw)
                if name.isupper() and k in known_initials:
                    continue  # most likely a known club's initials ("KSA": Korean Student Association)
                entry = names.setdefault(name, {"status": "new", "by": []})
                if who not in entry["by"] and len(entry["by"]) < 8:
                    entry["by"].append(who)
                added += 1
    if todo:
        print(f"Read {len(done & {k for k, _, _ in todo})} post(s) for other clubs' names; {added} mention(s) of clubs DubHub doesn't know.", flush=True)
    if not dry:
        NAMES_READ_FILE.parent.mkdir(exist_ok=True)
        NAMES_READ_FILE.write_text("\n".join(sorted(done)), encoding="utf-8")


def try_names(L, names, saved, known, today, pages):
    """Try the usual usernames for the most-named unknown clubs, using at most `pages` pages.
    A match goes into `saved` as an account to check. Returns how many pages it used."""
    used = 0
    again = (today - timedelta(days=RECHECK_DAYS)).isoformat()
    todo = sorted((n for n, e in names.items() if e.get("status") == "new"
                   or (e.get("status") == "none" and e.get("checked", "") <= again)),
                  key=lambda n: len(names[n].get("by", [])), reverse=True)
    for name in todo:
        tries = [h for h in guesses(name) if h not in known and h not in saved][:NAME_PAGES_PER_RUN]
        if not tries or used + len(tries) > pages:
            if not tries:
                names[name].update(status="none", checked=today.isoformat())
            continue
        match = None
        for handle in tries:
            if used:
                time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
            used += 1
            try:
                user, _ = club_page(L, handle)
            except (QueryReturnedNotFoundException, BadResponseException):
                continue
            if user and is_the_club(user, name)[0]:
                match = handle
                break
        names[name].update(status="found" if match else "none", handle=match, checked=today.isoformat())
        print(f"  named club {name!r}: {'@' + match if match else 'no account found'}", flush=True)
        if match:
            entry = saved.setdefault(match, {"status": "new", "found": []})
            for who in names[name]["by"][:3]:
                note = f"named as {name!r} by {who}"
                if note not in entry["found"]:
                    entry["found"].append(note)
    return used


def main():
    sys.stdout.reconfigure(errors="replace")  # club names with emoji, in a console that can't show them
    dry = "--dry-run" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else CHECKS_PER_RUN
    today = date.today()
    saved = _load(UNLISTED_CLUBS_FILE, {})
    known = known_handles()

    def add(handle, where):
        if handle in known and handle not in saved:
            return
        entry = saved.setdefault(handle, {"status": "new", "found": []})
        if where not in entry["found"] and len(entry["found"]) < 12:
            entry["found"].append(where)

    for handle, places in mentions().items():
        for where in sorted(places):
            add(handle, where)
    stamp = LISTING_STAMP.read_text().strip() if LISTING_STAMP.exists() else ""
    if "--pages" in sys.argv or stamp <= (today - timedelta(days=LISTING_DAYS)).isoformat():
        print("Reading UW pages that list student groups...", flush=True)
        for handle, pages in listing_page_links().items():
            for page in sorted(pages):
                add(handle, page)
        if not dry:
            LISTING_STAMP.parent.mkdir(exist_ok=True)
            LISTING_STAMP.write_text(today.isoformat())
    if "--add" in sys.argv:
        for h in sys.argv[sys.argv.index("--add") + 1].split(","):
            h = clean(h.strip().lstrip("@"))
            if h:
                add(h, "added by hand")

    huskylink_clubs = _load(HUSKYLINK_FILE, {"clubs": []})["clubs"]
    saved_instagram = _load(CLUB_INSTAGRAM_FILE, {})
    names = _load(NAMES_FILE, {})
    known_keys = {club_key(c["name"]) for c in huskylink_clubs} | {club_key(n) for n in names}
    try:
        known_keys |= {club_key(c["name"]) for c in json.loads(SITE_CLUBS_FILE.read_text(encoding="utf-8"))["clubs"]}
    except (FileNotFoundError, ValueError, KeyError):
        pass
    known_keys |= {club_key(e["name"]) for e in saved.values() if e.get("name")}
    known_initials = {initials(c["name"]) for c in huskylink_clubs}
    read_names(names, known_keys, dry, known_initials)

    L = instaloader.Instaloader(quiet=True, max_connection_attempts=1, request_timeout=30,
                                rate_controller=lambda context: StopOnTooManyRequests(context))
    checked, ask = [], []
    try:
        limit -= try_names(L, names, saved, known, today, min(NAME_PAGES_PER_RUN, limit))
    except SlowDown as e:
        print(f"Stopping: {e}.", flush=True)
        limit = 0
    todo = sorted((h for h, e in saved.items() if h not in known and due(e, today) and worth_checking(h, e)),
                  key=lambda h: priority(h, saved[h]), reverse=True)
    print(f"{len(saved)} accounts noted; {len(todo)} worth a look; checking {max(0, min(limit, len(todo)))} now"
          f"{' (dry run: nothing saved)' if dry else ''}.", flush=True)
    try:
        for i, handle in enumerate(todo[:limit]):
            if i:
                time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
            try:
                result = check(L, handle, saved[handle], huskylink_clubs, saved_instagram, today)
            except BadResponseException as e:
                print(f"  @{handle}: couldn't load ({str(e)[:80]}); trying again next run", flush=True)
                continue
            saved[handle].pop("why", None)  # (an earlier check's reason no longer applies)
            saved[handle].update({k: v for k, v in result.items() if not k.startswith("_")},
                                 checked=today.isoformat())
            checked.append(handle)
            if "_ask" in result:
                ask.append(result["_ask"])
            print(f"  @{handle}: {result.get('name')!r} -> {result['status']}"
                  f"{' (' + result['why'] + ')' if result.get('why') else ''}", flush=True)
    except SlowDown as e:
        print(f"Stopping the checks: {e}. The rest are checked next run.", flush=True)
    except ConnectionException as e:
        print(f"Stopping the checks: couldn't reach Instagram ({str(e)[:100]}).", flush=True)

    # The AI reads the accounts that passed every other test, a few at a time.
    for i in range(0, len(ask), 6):
        batch = ask[i:i + 6]
        verdicts = ai_verdicts(batch)
        if verdicts is None:
            print("  No AI right now: these wait as \"maybe\".", flush=True)
            break
        for a, v in zip(batch, verdicts):
            status, why = {"club": "club", "not": "not"}.get(v["verdict"], "maybe"), v["why"] or None
            if v["huskylink"] and status != "not":
                known = (saved_instagram.get(v["huskylink"]) or {}).get("handle")
                status, why = (("not", f"a second account of {v['huskylink']} (@{known})") if known
                               else ("huskylink", v["huskylink"]))
            saved[a["handle"]].update(status=status, why=why)
            print(f"  AI: @{a['handle']} ({a['name']}) -> {status}: {why}", flush=True)

    # Accounts that turned out to be a HuskyLink club's: that club's Instagram, for every scraper.
    new_links = {e["why"]: h for h, e in saved.items()
                 if h in checked and e.get("status") == "huskylink"
                 and not (saved_instagram.get(e["why"]) or {}).get("handle")
                 and (saved_instagram.get(e["why"]) or {}).get("from") != "manual"}
    for club, handle in new_links.items():
        saved_instagram[club] = {"handle": handle, "from": "mentioned", "checked": today.isoformat()}

    added = [h for h in checked if saved[h].get("status") == "club"]
    print(f"Checked {len(checked)}: {len(added)} new club(s) not on HuskyLink"
          f"{' (' + ', '.join('@' + h for h in added) + ')' if added else ''}, "
          f"{len(new_links)} HuskyLink club(s) got their Instagram.", flush=True)
    if dry:
        return
    UNLISTED_CLUBS_FILE.write_text(json.dumps(dict(sorted(saved.items())), indent=1, ensure_ascii=False), encoding="utf-8")
    NAMES_FILE.write_text(json.dumps(dict(sorted(names.items(), key=lambda kv: kv[0].lower())), indent=1, ensure_ascii=False),
                          encoding="utf-8")
    if new_links:
        CLUB_INSTAGRAM_FILE.write_text(json.dumps(dict(sorted(saved_instagram.items(), key=lambda kv: kv[0].lower())),
                                                  indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Saved to {UNLISTED_CLUBS_FILE.name}. instagram_public_scraper.py reads the new clubs from its next run.")


if __name__ == "__main__":
    main()
