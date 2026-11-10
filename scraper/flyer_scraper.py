"""
The image scraper: reads the text on club flyers and fills in the dates, times and rooms clubs
only put on the picture. Run it after the regular scrapers:

    python instagram_public_scraper.py     # the regular scraper, as always
    python flyer_scraper.py                # then this

It's kept apart from the regular scrapers on purpose, so it can't break them:
  - It never changes their files. It reads the posts they saved (state/posts.json) and keeps what
    it finds in its own file, state/flyers.json.
  - It only touches the site's events (public/events.json): it writes them again with its findings
    laid over the regular ones. Delete state/flyers.json, or just run a regular scraper again,
    and the site is back to what the regular scrapers found.
  - It only writes them when this computer's copy of the posts is current (it ran a regular
    scraper since anyone else did). Otherwise it would bring back older versions of other clubs'
    posts, so it saves what it read and waits.
  - It never replaces a post's events with fewer ones: if reading the flyer finds fewer upcoming
    events than the regular scraper did, the regular ones stay.
  - It asks the AI with a different model than the regular scrapers (Groq's free limits are per
    model), so it can't use up their daily allowance.
  - It reads at most PER_RUN posts a run, newest first, and if the AI isn't available it leaves
    those posts for the next run instead of guessing.
  - scheduled_scrape.py runs it as its own step after the regular ones; if it fails or its result
    looks wrong, that run's regular data is pushed without it.

How the text is read: flyer_text.py (Windows' built-in OCR, or a Groq picture model as a backup).

Setup (one time, Windows): see flyer_text.py. Without it the scraper uses the Groq backup, at
most 30 flyers a run.
Other ways to run it:
    python flyer_scraper.py --limit 10      # read fewer flyers
    python flyer_scraper.py --dry-run       # read and look for events, but write nothing
"""

import hashlib
import json
import re
import sys
import time
from datetime import date, datetime, timedelta

import requests

import events_common as ec  # the regular scrapers' code, used as is (nothing in it is changed)
from flyer_text import ReaderUnavailable, can_read, read_flyer, reader_name

FLYERS_FILE = ec.STATE_DIR / "flyers.json"
PER_RUN = 60
# Not the regular scrapers' model (ec.PREFERRED_MODELS starts with the one they use), so the two
# don't share a daily limit. Both of these are on Groq's free plan.
MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"]

# The regular prompt (events_common.ai_prompt), with its note about the picture's text replaced:
# here that text comes from OCR, which misreads some letters, and it adds to the caption.
REGULAR_RULE = """- "Text in the picture" is the text on the post's flyer (from Instagram's picture description);
  use it together with the caption, since the date, time or room is often only on the flyer."""
FLYER_RULE = """- "Text in the picture" is the text on the post's flyer, read from the picture by OCR; use it
  together with the caption, since the date, time or room is often only on the flyer. OCR misreads
  some letters (I or l for 1, O for 0, S for 5, "IOEh" for "10th") and can jumble the order of
  lines, so read it for meaning and only use details that fit the rest of the post. It adds to
  the caption, it doesn't replace it: keep every event the caption lists, and where the two
  disagree, go with the caption.
- Something that runs over several days ("Nov 19-21", "January 8-10") is one event per day."""
TEXT_IN_PROMPT = 1200  # characters of flyer text the AI sees (the regular prompt shows 500)

_regular_prompt = ec.ai_prompt


def flyer_prompt(batch):
    prompt = _regular_prompt(batch)
    for p in batch:
        if p.get("image_text"):
            prompt = prompt.replace(f"Text in the picture: {p['image_text'][:500]}",
                                    f"Text in the picture: {p['image_text'][:TEXT_IN_PROMPT]}", 1)
    return prompt.replace(REGULAR_RULE, FLYER_RULE)


def find_events(batch):
    """The regular AI event finder (events_common.ai_extract), with this scraper's prompt and models.
    A list of event lists, or None when the AI isn't available."""
    ec.ai_prompt, ec.PREFERRED_MODELS = flyer_prompt, MODELS  # (only inside this program)
    return ec.ai_extract(batch)


def fingerprint(post):
    """Which version of a post a finding is about: if the regular scraper reads the post again and
    its caption changes, the flyer is read again too."""
    return hashlib.sha1(f"{post.get('posted')}|{post.get('caption')}|{post.get('image_src')}".encode()).hexdigest()[:12]


def upcoming(events):
    return [e for e in events or [] if e["date"] >= ec.TODAY.isoformat()]


def with_flyers(store, flyers):
    """The regular scrapers' posts, with each flyer's findings laid over its post's events."""
    merged = dict(store)
    for key, found in flyers.items():
        post = store.get(key)
        if not post or found.get("of") != fingerprint(post) or "events" not in found:
            continue
        if len(upcoming(found["events"])) < len(upcoming(post.get("events"))):
            continue  # never fewer events than the regular scraper found
        merged[key] = {**post, "events": found["events"], "found_with": "ai",
                       "image_text": "\n".join(filter(None, [post.get("image_text"), found.get("text")]))}
    return merged


def read_flyers(store, flyers, limit):
    """Read the flyers of recent posts not read yet, and look for events in the ones with text."""
    recent = (ec.TODAY - ec.timedelta(days=ec.LOOKBACK_DAYS)).isoformat()
    waiting = sorted(((k, v) for k, v in store.items()
                      if (v.get("posted") or "") >= recent and v.get("image_src")
                      and flyers.get(k, {}).get("of") != fingerprint(v)),
                     key=lambda kv: kv[1]["posted"], reverse=True)
    if not waiting:
        print("No new flyers to read.")
        return
    print(f"Reading {min(limit, len(waiting))} flyer(s) with {reader_name()} "
          f"({max(0, len(waiting) - limit)} left for later runs)...")
    with_text = []
    for key, post in waiting[:limit]:
        if not can_read():
            print(f"{reader_name()} can't read more flyers this run; the rest wait for the next run.")
            break
        picture = post_picture(key, post)
        if picture is None:
            flyers[key] = {"of": fingerprint(post), "read": False}  # Instagram's link has expired
            continue
        try:
            text = read_flyer(picture)
        except ReaderUnavailable:
            continue
        if not text:
            flyers[key] = {"of": fingerprint(post), "read": True, "text": None}
            continue
        with_text.append((key, post, text))
    print(f"{len(with_text)} flyer(s) had text.")

    for i in range(0, len(with_text), ec.AI_BATCH):
        chunk = with_text[i:i + ec.AI_BATCH]
        batch = [{**ec_post(key, post), "image_text": "\n".join(filter(None, [post.get("image_text"), text]))}
                 for key, post, text in chunk]
        found = find_events(batch)
        if found is None:
            print(f"The AI isn't available; {len(with_text) - i} flyer(s) wait for the next run.")
            return
        for (key, post, text), events in zip(chunk, found):
            flyers[key] = {"of": fingerprint(post), "read": True, "text": text, "events": events}
        if i + ec.AI_BATCH < len(with_text):
            time.sleep(3)  # stay under Groq's free per-minute limit


def post_picture(key, post):
    """The post's picture: the site's saved copy if there is one, else Instagram's link (those
    expire within days). None if neither works."""
    saved = ec.IG_POST_IMAGES / f"{key}.jpg"
    if re.fullmatch(r"[\w-]+", key) and saved.exists():
        return saved.read_bytes()
    try:
        r = requests.get(post["image_src"], headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        return r.content if r.ok and r.headers.get("content-type", "").startswith("image/") else None
    except requests.RequestException:
        return None


def ec_post(key, v):
    """A saved post in the shape the AI event finder takes."""
    return {"key": key, "club": v["club"], "caption": v["caption"], "url": v["url"], "source": v["source"],
            "posted": date.fromisoformat(v["posted"]) if v.get("posted") else None}


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else PER_RUN
    store = ec.load_store()
    flyers = ec._load(FLYERS_FILE, {})
    flyers = {k: v for k, v in flyers.items() if k in store}  # forget posts the regular scrapers forgot
    if reader_name():
        read_flyers(store, flyers, limit)
    else:
        print("No way to read flyers on this computer (see flyer_text.py for setup); "
              "putting the earlier findings back on the site.")
    merged = with_flyers(store, flyers)
    changed = [k for k in store if merged[k] is not store[k]]
    before, after = sum(len(upcoming(store[k].get("events"))) for k in changed), sum(len(upcoming(merged[k]["events"])) for k in changed)
    timed = lambda posts: sum(1 for p in posts for e in upcoming(p.get("events")) if e["start"])
    print(f"Flyers add to {len(changed)} post(s): {before} -> {after} upcoming events, "
          f"{timed(store[k] for k in changed)} -> {timed(merged[k] for k in changed)} with a time.")
    if dry:
        print("Dry run: nothing written.")
        return
    ec._save(FLYERS_FILE, flyers)
    if not changed:
        print("Nothing to add to the site.")
        return
    why = site_is_newer()
    if why:
        print(f"Not writing the site's events: {why}. The flyers read are saved (state/flyers.json) "
              "and go on the site after this computer next runs a regular scraper.")
        return
    ec.write_site_events(merged)
    WROTE_FILE.write_text(json.loads(ec.SITE_EVENTS_FILE.read_text(encoding="utf-8"))["updated"])


# When this scraper last wrote the site's events (their "updated" time), to tell its own writes
# from another computer's.
WROTE_FILE = ec.STATE_DIR / "flyers_wrote.txt"


def site_is_newer():
    """Why the site's events are newer than this computer's copy of the posts (another computer
    ran the scrapers since this one did), or None. Writing them from an older copy would bring
    back old versions of other clubs' posts, so then this scraper doesn't write them."""
    try:
        updated = datetime.fromisoformat(json.loads(ec.SITE_EVENTS_FILE.read_text(encoding="utf-8"))["updated"])
    except (OSError, ValueError, KeyError):
        return None  # no site events yet: nothing to overwrite
    saved = datetime.fromtimestamp(ec.POSTS_FILE.stat().st_mtime)
    # (a regular scraper saves the posts, then writes the site's events a moment later)
    if updated <= saved + timedelta(minutes=15):
        return None
    if WROTE_FILE.exists() and WROTE_FILE.read_text().strip() == updated.isoformat(timespec="minutes"):
        return None  # this scraper's own last write
    return (f"they were written {updated:%b %d %H:%M}, after this computer last ran a regular scraper "
            f"({saved:%b %d %H:%M})")


if __name__ == "__main__":
    main()
