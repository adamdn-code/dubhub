"""
Runs DubHub's scrapers on a schedule and pushes the new events and clubs to GitHub, so the site
stays fresh without anyone asking. Windows Task Scheduler starts it every 6 hours (set up with
setup_schedule.ps1); Instagram only lets a home connection read about 150 club pages every few
hours without logging in, so it runs on a computer at home rather than on a cloud server.

Each run:
  1. Gets the latest main from GitHub. It only works on main, never pushes commits of yours that
     aren't on GitHub yet, and only touches the scraped data files, so code you're editing is left
     alone. If it can't update cleanly it skips the run and says why in the log.
  2. Once a day: refreshes HuskyLink's clubs and events, looks for new clubs' Instagram accounts
     on their websites, and checks a few accounts seen on club websites.
  3. Reads the next 80 clubs' Instagram posts (instagram_public_scraper.py stops on its own if
     Instagram asks to log in; the clubs left go first next time).
  4. Checks the result (no clubs lost or renamed, events still there) and pushes the data to main.
     If something looks wrong it puts the data back the way it was and pushes nothing.

Logs: scraper/state/logs/ (one file per run, the last 60 kept).
Run once by hand (from this folder):
    python scheduled_scrape.py
    python scheduled_scrape.py --dry-run    # only check that it could run, change nothing
Change or stop the schedule:
    schtasks /query /tn "DubHub scraper"
    schtasks /change /tn "DubHub scraper" /disable      (/enable to turn it back on)
    schtasks /delete /tn "DubHub scraper" /f
"""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
STATE = HERE / "state"
LOGS = STATE / "logs"
LOCK = STATE / "scheduled_scrape.lock"
DAILY_STAMP = STATE / "scheduled_daily.txt"
SNAPSHOT = STATE / "before_scheduled_run"
BRANCH = "main"
KEEP_LOGS = 60
FETCH_TRIES, FETCH_WAIT = 10, 30  # up to ~5 minutes for the internet to come back after waking

# Files the scrapers write. GENERATED ones are rebuilt every run, so leftovers can be thrown away
# when they'd block getting the latest main; club_instagram.json is partly typed by hand, so it's
# never thrown away.
GENERATED = ["public/events.json", "public/clubs.json", "public/ig", "scraper/club_activity.json",
             "scraper/club_fields.json", "scraper/huskylink.json"]
DATA = GENERATED + ["scraper/club_instagram.json"]
SNAPSHOT_FILES = [p for p in DATA if p.endswith(".json")]

# Most a step may take before it's stopped (minutes).
STEPS = {
    "HuskyLink": (["huskylink_scraper.py", "--skip-past"], 20),
    "Instagram accounts on club websites": (["find_instagram_handles.py"], 20),
    "Check accounts seen on club websites": (["guess_instagram_handles.py", "--maybe-only", "--limit", "15"], 30),
    "Instagram": (["instagram_public_scraper.py"], 120),
}

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
GIT = shutil.which("git") or r"C:\Program Files\Git\cmd\git.exe"
# Under pythonw (how the scheduler starts this) each step still gets a real Python to run in.
PY = str(Path(sys.executable).with_name("python.exe")) if Path(sys.executable).name.lower() == "pythonw.exe" else sys.executable
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}

log_file = None


def log(message):
    line = f"[{datetime.now():%H:%M:%S}] {message}"
    if log_file:
        log_file.write(line + "\n")
        log_file.flush()
    if sys.stdout:
        print(line, flush=True)


def git(*args, check=False):
    """Run git in the repo; returns (exit code, output)."""
    p = subprocess.run([GIT, *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", creationflags=NO_WINDOW, env=ENV)
    out = (p.stdout + p.stderr).strip()
    if check and p.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {out[:300]}")
    return p.returncode, out


def step(name):
    """Run one scraper, its output going to the log. Returns whether it finished without an error."""
    args, minutes = STEPS[name]
    log(f"--- {name}: python {' '.join(args)}")
    started = time.time()
    try:
        p = subprocess.run([PY, "-u", *args], cwd=HERE, stdout=log_file, stderr=subprocess.STDOUT,
                           creationflags=NO_WINDOW, env=ENV, timeout=minutes * 60)
        code = p.returncode
    except subprocess.TimeoutExpired:
        code = f"stopped after {minutes} minutes"
    log(f"--- {name} done in {(time.time() - started) / 60:.1f} min (exit {code})")
    return code == 0


def site_counts():
    """Events and clubs on the site now, and each Instagram club's shown name."""
    try:
        events = json.loads((REPO / "public/events.json").read_text(encoding="utf-8"))["events"]
        clubs = json.loads((REPO / "public/clubs.json").read_text(encoding="utf-8"))["clubs"]
    except (OSError, ValueError, KeyError):
        return None
    return {"events": len(events), "clubs": len(clubs), "names": [c["name"] for c in clubs],
            "by_handle": {c["handle"]: c["name"] for c in clubs if c.get("handle")}}


def looks_right(before, after):
    """(ok?, why) for the site files after a run, compared with before it."""
    if not after:
        return False, "events.json or clubs.json is missing or unreadable"
    if len(set(after["names"])) != len(after["names"]):
        return False, "some club is listed twice"
    if before:
        # A few clubs can age out of "event in the past year" from one run to the next; many can't.
        if after["clubs"] < before["clubs"] - 5:
            return False, f"clubs went from {before['clubs']} to {after['clubs']}"
        if after["events"] < min(before["events"] // 2, 40):
            return False, f"events went from {before['events']} to {after['events']}"
        renamed = [(n, after["by_handle"][h]) for h, n in before["by_handle"].items()
                   if h in after["by_handle"] and after["by_handle"][h] != n]
        if renamed:  # members are saved by club name, so a rename would drop them
            return False, f"clubs were renamed: {renamed[:3]}"
    return True, ""


def snapshot():
    SNAPSHOT.mkdir(parents=True, exist_ok=True)
    for rel in SNAPSHOT_FILES:
        src = REPO / rel
        if src.exists():
            shutil.copy2(src, SNAPSHOT / Path(rel).name)


def restore():
    """Put the data files back the way they were before this run."""
    for rel in SNAPSHOT_FILES:
        saved = SNAPSHOT / Path(rel).name
        if saved.exists():
            shutil.copy2(saved, REPO / rel)
    git("checkout", "--", "public/ig")  # pictures this run deleted come back; new ones are harmless


def get_latest_main(dry=False):
    """Fast-forward to GitHub's main. Returns why it can't, or None when it's up to date.
    A dry run only fetches and reports."""
    code, branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if code or branch != BRANCH:
        return f"the repo is on branch {branch!r}, not {BRANCH}"
    # Right after the computer wakes up (when a missed run starts) the internet can take a minute
    # or two to come back, so try for a few minutes before giving up.
    for attempt in range(1, FETCH_TRIES + 1):
        code, out = git("fetch", "--quiet", "origin", BRANCH)
        if code == 0:
            break
        if attempt < FETCH_TRIES:
            log(f"Couldn't reach GitHub yet ({out[:120]}); trying again in {FETCH_WAIT} seconds.")
            time.sleep(FETCH_WAIT)
    if code:
        return f"couldn't reach GitHub ({out[:200]})"
    _, ahead = git("rev-list", "--count", f"origin/{BRANCH}..HEAD")
    if ahead.strip() not in ("", "0"):
        return f"{BRANCH} has {ahead.strip()} commit(s) that aren't on GitHub yet; push or drop them first"
    if dry:
        _, behind = git("rev-list", "--count", f"HEAD..origin/{BRANCH}")
        log(f"Dry run: {behind.strip()} new commit(s) on GitHub to fast-forward to.")
        return None
    code, out = git("merge", "--ff-only", "--quiet", f"origin/{BRANCH}")
    if code:
        # Usually last run's data that never got pushed: rebuild it instead of keeping it.
        log("Couldn't update main with the data files as they are; throwing away last run's leftovers and retrying.")
        git("checkout", "--", *GENERATED)
        git("clean", "-fdq", "--", "public/ig")
        code, out = git("merge", "--ff-only", "--quiet", f"origin/{BRANCH}")
        if code:
            return f"local changes clash with GitHub's main ({out[:300]})"
    return None


def commit_and_push(before, after):
    git("add", "-A", "--", *DATA)
    code, _ = git("diff", "--cached", "--quiet", "--", *DATA)
    if code == 0:
        log("Nothing new to push.")
        return
    delta = lambda k: f"{after[k] - before[k]:+d}" if before else "new"
    message = (f"Scheduled scrape: {after['events']} events, {after['clubs']} clubs\n\n"
               f"Events {delta('events')} and clubs {delta('clubs')} since the last run. "
               f"Pushed by scraper/scheduled_scrape.py.")
    code, out = git("commit", "--quiet", "-m", message, "--", *DATA)
    if code:
        log(f"Commit failed: {out[:300]}")
        return
    code, out = git("push", "--quiet", "origin", BRANCH)
    if code:
        # Someone pushed in the meantime. Undo the commit (the data stays); the next run gets their
        # changes first and pushes a fresh scrape.
        git("reset", "--soft", "HEAD~1")
        log(f"Push failed, will try again next run: {out[:300]}")
        return
    log(f"Pushed: {after['events']} events, {after['clubs']} clubs (events {delta('events')}, clubs {delta('clubs')}).")


def main():
    global log_file
    dry = "--dry-run" in sys.argv
    LOGS.mkdir(parents=True, exist_ok=True)
    log_file = open(LOGS / f"{datetime.now():%Y-%m-%d_%H%M}{'_dry' if dry else ''}.log", "w", encoding="utf-8")
    for old in sorted(LOGS.glob("*.log"))[:-KEEP_LOGS]:
        old.unlink(missing_ok=True)

    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 3 * 3600:
        log("Another scheduled run is still going; skipping this one.")
        return
    LOCK.write_text(str(os.getpid()))
    try:
        why = get_latest_main(dry)
        if why:
            log(f"Skipping this run: {why}.")
            return
        before = site_counts()
        log(f"Up to date with GitHub. The site has {before['events'] if before else '?'} events and "
            f"{before['clubs'] if before else '?'} clubs.")
        daily = not DAILY_STAMP.exists() or DAILY_STAMP.read_text().strip() != date.today().isoformat()
        if dry:
            log(f"Dry run: would run {'the daily steps and ' if daily else ''}Instagram, then push. Nothing changed.")
            return

        snapshot()
        if daily:
            step("HuskyLink")
            step("Instagram accounts on club websites")
            step("Check accounts seen on club websites")
            DAILY_STAMP.write_text(date.today().isoformat())
        step("Instagram")

        after = site_counts()
        ok, why = looks_right(before, after)
        if not ok:
            restore()
            log(f"Not pushing: {why}. Put the data back the way it was.")
            return
        commit_and_push(before, after)
    except Exception as e:  # keep the log useful whatever went wrong
        log(f"Run failed: {e!r}")
        raise
    finally:
        LOCK.unlink(missing_ok=True)
        log("Done.")
        log_file.close()


if __name__ == "__main__":
    main()
