"""
Rebuilds club_growth.csv, DubHub's growth over time, from the repo's own history: for every
commit that changed the site's clubs or the club Instagram list, how many clubs were on the
Clubs page, how many HuskyLink clubs had a known Instagram account, how many upcoming events and
open applications the site listed, and how many clubs HuskyLink had.

Run it any time (from this folder) to bring the file up to date:
    python club_growth.py

Notes on the numbers:
  - clubs_on_page is blank for the commits where the Clubs page briefly listed every HuskyLink
    club (over a thousand) instead of only clubs with an event in the past year.
  - instagram_known carries the last value forward through commits that didn't have the file
    (on Oct 24 the list lived on a branch that was merged on Oct 29).
  - events_listed counts upcoming events at that moment, so it drops as events pass.
"""

import csv
import json
import subprocess
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "club_growth.csv"
WATCHED = ["public/clubs.json", "scraper/club_instagram.json"]
ALL_CLUBS_LISTED = 1000  # more clubs than this on the page means it was listing every HuskyLink club


def git(*args):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8").stdout


def load(commit, path):
    """A JSON file as it was in a commit, or None if it wasn't there."""
    text = git("show", f"{commit}:{path}")
    try:
        return json.loads(text) if text else None
    except ValueError:
        return None


def count(data, key):
    if data is None:
        return None
    return len(data.get(key, []) if isinstance(data, dict) else data)


def main():
    rows, known = [], None
    for line in git("log", "--reverse", "--format=%H|%cI|%s", "--", *WATCHED).splitlines():
        commit, when, subject = line.split("|", 2)
        clubs = count(load(commit, "public/clubs.json"), "clubs")
        accounts = load(commit, "scraper/club_instagram.json")
        if accounts is not None:
            known = sum(1 for v in accounts.values() if v.get("handle"))
        rows.append({
            "commit": commit[:7],
            "when": datetime.fromisoformat(when).strftime("%Y-%m-%d %H:%M"),
            "clubs_on_page": clubs if clubs is not None and clubs <= ALL_CLUBS_LISTED else "",
            "instagram_known": known if known is not None else 0,
            "events_listed": count(load(commit, "public/events.json"), "events") or 0,
            "huskylink_clubs": count(load(commit, "scraper/huskylink.json"), "clubs") or 0,
            "applications_open": count(load(commit, "public/applications.json"), "applications") or 0,
            "note": subject,
        })
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    last = rows[-1]
    print(f"Wrote {len(rows)} rows to {OUT.name}. Latest ({last['when']}): {last['clubs_on_page']} clubs on the page, "
          f"{last['instagram_known']} known Instagram accounts, {last['events_listed']} events, "
          f"{last['applications_open']} open applications.")


if __name__ == "__main__":
    main()
