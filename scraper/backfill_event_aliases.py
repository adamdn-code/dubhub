"""
One time (November 2026): give the site's events the ids they had in every earlier version of
public/events.json, so RSVPs saved under an old id find their event again. From then on every
scraper keeps `aliases` up to date itself (events_common.carry_aliases).

It replays the history of public/events.json in order, carrying each version's ids into the next,
then into the events on the site now.

    python backfill_event_aliases.py            # update public/events.json
    python backfill_event_aliases.py --dry-run  # just show what it would add
"""

import json
import subprocess
import sys

from events_common import SITE_EVENTS_FILE, carry_aliases

REPO = SITE_EVENTS_FILE.parent.parent


def history():
    """Each version of public/events.json, oldest first."""
    shas = subprocess.run(["git", "log", "--reverse", "--format=%H", "--", "public/events.json"], cwd=REPO,
                          capture_output=True, text=True, check=True).stdout.split()
    for sha in shas:
        out = subprocess.run(["git", "show", f"{sha}:public/events.json"], cwd=REPO, capture_output=True, text=True,
                             encoding="utf-8")
        try:
            yield json.loads(out.stdout).get("events", [])
        except ValueError:
            continue


def main():
    sys.stdout.reconfigure(errors="replace")
    previous = []
    versions = 0
    for events in history():
        previous = carry_aliases(events, previous)
        versions += 1
    site = json.loads(SITE_EVENTS_FILE.read_text(encoding="utf-8"))
    before = {e["id"]: list(e.get("aliases") or []) for e in site["events"]}
    carry_aliases(site["events"], previous)
    gained = [(e, [a for a in e.get("aliases", []) if a not in before[e["id"]]]) for e in site["events"]]
    gained = [(e, new) for e, new in gained if new]
    print(f"Read {versions} versions of public/events.json; {len(gained)} event(s) get old ids back:")
    for e, new in gained[:40]:
        print(f"  {e['date']}  {e['title'][:50]}  {e['id']}  <- {', '.join(new)}")
    if "--dry-run" not in sys.argv:
        SITE_EVENTS_FILE.write_text(json.dumps(site, indent=1, ensure_ascii=False), encoding="utf-8")
        print("Saved.")


if __name__ == "__main__":
    main()
