"""
Finds the Instagram account of clubs that find_instagram_handles.py couldn't (no website, or
no Instagram link on it): it tries the usernames UW clubs usually pick ("uwasu", "asu.uw",
"uw_asu", ...) on Instagram's public profile pages, without logging in, and keeps one only when
the account clearly is that UW club:
  - its name or bio says UW Seattle (UW, University of Washington, Husky, Seattle...) and
    doesn't name another school (Wisconsin, Waterloo, UW Tacoma, UW Bothell, Seattle U...), and
  - its name or bio has the club's own words ("Afghanistan", "Armenian"...), so the Arab
    Student Association's @uwasa isn't taken for the Armenian Student Association.

It goes through the clubs that had events most recently first, so active clubs come first.

Every run (from this folder), after huskylink_scraper.py:
    python guess_instagram_handles.py               # up to 60 clubs
    python guess_instagram_handles.py --limit 20
    python guess_instagram_handles.py --dry-run     # show what it would keep, save nothing
Results go into club_instagram.json ("from": "guess"); a club tried with no match is marked
"guess-none" and tried again after GUESS_AGAIN_DAYS. To fix a wrong one by hand, set its
"from" to "manual", as with the website finder.

To stay polite: one page per guess, at most GUESSES_PER_CLUB guesses per club, 6-12 seconds
between pages, and it stops the moment Instagram objects.
"""

import json
import random
import re
import sys
import time
from datetime import date, timedelta

import instaloader
from instaloader.exceptions import QueryReturnedNotFoundException

from events_common import CLUB_ACTIVITY_FILE, CLUB_INSTAGRAM_FILE, HUSKYLINK_FILE, club_key
from find_instagram_handles import GENERIC_WORDS, name_match
from instagram_public_scraper import SlowDown, StopOnTooManyRequests, club_page

CLUBS_PER_RUN = 60
GUESSES_PER_CLUB = 7
GUESS_AGAIN_DAYS = 60
MIN_WAIT, MAX_WAIT = 6, 12
KNOWN_ACCOUNT = "uwproductspace"  # re-checked when many guesses in a row come back empty

# Words that say nothing about which club it is ("Club" or "of"), left out of acronyms and names.
SMALL_WORDS = {"the", "of", "at", "and", "for", "in", "a", "an", "to", "on", "&", "uw"}
# Too common to tell clubs apart by on their own.
WEAK_WORDS = GENERIC_WORDS | {"american", "international", "national", "global", "community", "united",
                              "world", "northwest", "pacific", "seattle", "group", "team", "organization"}
UW_SIGN = re.compile(r"\buw\b|university of washington|\bhusk(y|ies)\b|\bseattle\b|uofwa|\budub\b|\bdawgs?\b", re.I)
OTHER_SCHOOL = re.compile(
    r"wisconsin|madison|milwaukee|eau claire|la ?crosse|oshkosh|whitewater|stevens point|green bay|"
    r"platteville|river falls|parkside|waterloo|tacoma|bothell|seattle ?u\b|seattle university|"
    r"seattle pacific|\bspu\b|seattle central|western washington|\bwwu\b|washington state|\bwsu\b", re.I)


def base_name(name):
    """'Afghanistan Student Union at the University of Washington' -> 'Afghanistan Student Union'."""
    name = re.sub(r"\(\s*[^)]*\)", " ", name)
    name = re.sub(r"\s+(?:at|@)\s+(?:the\s+)?(?:university of washington|uw)\b.*$", "", name, flags=re.I)
    name = re.sub(r"\s+(?:uw|university of washington)(?:\s+seattle)?\s*$", "", name, flags=re.I)
    name = re.sub(r"^\s*(?:uw|asuw)\s+", "", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip(" -,|")


def guesses(name):
    """Likely usernames for a club, the most common patterns first."""
    words = [w for w in re.findall(r"[A-Za-z0-9]+", base_name(name)) if w.lower() not in SMALL_WORDS]
    if not words:
        return []
    acronyms = []
    given = re.search(r"\(\s*([A-Za-z]{2,8})\s*\)", name)  # "Undergraduate Women in Business ( UWiB )"
    if given:
        acronyms.append(given.group(1).lower())
    full = "".join(w[0] for w in words).lower()
    if len(words) > 3 and words[-1].lower() in ("club", "association", "society"):
        acronyms.append(full[:-1])  # "American Sign Language Club" usually goes by ASL
    acronyms.append(full)
    acronyms = [a for a in dict.fromkeys(acronyms) if len(a) >= 2]
    compact = "".join(w.lower() for w in words)

    out = []
    for a in acronyms[:2]:
        out += [a] if a.startswith("uw") else [f"uw{a}", f"{a}.uw", f"{a}uw"]
    if len(compact) <= 26:
        out += [f"uw{compact}", compact, f"{compact}uw"]
    for a in acronyms[:2]:
        out += [f"uw_{a}", f"{a}_uw", f"uw.{a}"]
    return list(dict.fromkeys(out))


def is_the_club(user, name):
    """Whether this public profile is clearly the UW club `name`. Returns (yes?, why)."""
    text = " ".join(filter(None, [user.get("username"), user.get("full_name"), user.get("biography")]))
    if OTHER_SCHOOL.search(text):
        return False, "names another school"
    if not UW_SIGN.search(text):
        return False, "doesn't say UW"
    own = [w for w in re.findall(r"[a-z0-9]+", base_name(name).lower()) if len(w) >= 4 and w not in WEAK_WORDS]
    about = " ".join(filter(None, [user.get("full_name"), user.get("biography")])).lower()
    if own:
        hits = [w for w in own if w in about or w[:-1] in about]  # "Mathematics" ~ "Mathematic"
        return (True, f"mentions {', '.join(hits)}") if hits else (False, "none of the club's own words")
    # A name with only common words ("Student Association"): the account's name must match it.
    same = club_key(user.get("full_name") or "") == club_key(name) or name_match(user["username"], name) >= 4
    return (True, "same name") if same else (False, "name doesn't match")


def clubs_to_try(saved):
    """HuskyLink clubs with no Instagram yet that weren't ruled out, most recently active first."""
    clubs = json.loads(HUSKYLINK_FILE.read_text(encoding="utf-8"))["clubs"]
    try:
        activity = json.loads(CLUB_ACTIVITY_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        activity = {}
    again = (date.today() - timedelta(days=GUESS_AGAIN_DAYS)).isoformat()
    todo = []
    for c in clubs:
        v = saved.get(c["name"]) or {}
        if v.get("handle") or v.get("from") in ("manual", "not-uw", "shared"):
            continue
        if v.get("from") == "guess-none" and v.get("checked", "") > again:
            continue
        todo.append(c)
    return sorted(todo, key=lambda c: activity.get(club_key(c["name"]), ""), reverse=True)


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else CLUBS_PER_RUN
    dry = "--dry-run" in sys.argv
    saved = json.loads(CLUB_INSTAGRAM_FILE.read_text(encoding="utf-8"))
    taken = {v["handle"] for v in saved.values() if v.get("handle")}
    todo = clubs_to_try(saved)[:limit]
    print(f"Guessing the Instagram of {len(todo)} clubs{' (dry run: nothing saved)' if dry else ''}...", flush=True)

    L = instaloader.Instaloader(quiet=True, max_connection_attempts=1, request_timeout=30,
                                rate_controller=lambda context: StopOnTooManyRequests(context))
    pages, empty_in_a_row, found = 0, 0, 0
    try:
        for i, club in enumerate(todo, 1):
            match = None
            for handle in [h for h in guesses(club["name"]) if h not in taken][:GUESSES_PER_CLUB]:
                if pages:
                    time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
                pages += 1
                try:
                    user, _ = club_page(L, handle)
                except QueryReturnedNotFoundException:
                    user = None
                if user is None:
                    empty_in_a_row += 1
                    if empty_in_a_row >= 20:  # lots of "no such account": make sure Instagram isn't hiding profiles
                        time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
                        if club_page(L, KNOWN_ACCOUNT)[0] is None:
                            raise SlowDown("Instagram stopped showing profiles to logged-out visitors")
                        empty_in_a_row = 0
                    continue
                empty_in_a_row = 0
                ok, why = is_the_club(user, club["name"])
                print(f"    @{handle}: {user.get('full_name')!r} -> {'yes' if ok else 'no'} ({why})", flush=True)
                if ok:
                    match = handle
                    break
            print(f"[{i}/{len(todo)}] {club['name']}: {'@' + match if match else 'nothing found'}", flush=True)
            if match:
                found += 1
                taken.add(match)
            saved[club["name"]] = {"handle": match, "from": "guess" if match else "guess-none",
                                   "checked": date.today().isoformat()}
    except SlowDown as e:
        print(f"\nStopping: {e}. The clubs left go first next run.", flush=True)
    except instaloader.exceptions.ConnectionException as e:
        print(f"\nStopping: couldn't reach Instagram ({str(e)[:100]}).", flush=True)

    print(f"Found {found} account(s) with {pages} page(s).", flush=True)
    if not dry:
        saved = dict(sorted(saved.items(), key=lambda kv: kv[0].lower()))
        CLUB_INSTAGRAM_FILE.write_text(json.dumps(saved, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"Saved to {CLUB_INSTAGRAM_FILE}. Run instagram_public_scraper.py to read their posts.")


if __name__ == "__main__":
    main()
