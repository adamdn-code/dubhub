"""Runs queries.sql against engagement.db and adds a bootstrap 95% CI to the main result.

    python analysis/engagement/build_db.py && python analysis/engagement/run.py
"""
import math
import random
import sqlite3
from pathlib import Path

HERE = Path(__file__).parent
db = sqlite3.connect(HERE / "engagement.db")
for stmt in [s.strip() for s in (HERE / "queries.sql").read_text().split(";")]:
    body = "\n".join(l for l in stmt.splitlines() if not l.startswith("--")).strip()
    if not body:
        continue
    cur = db.execute(stmt)
    if cur.description:
        title = next((l[3:] for l in stmt.splitlines() if l.startswith("-- ") and l[3:4].isdigit()), "")
        print(f"\n{title}")
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        w = [max(len(str(c)), *(len(str(r[i])) for r in rows)) for i, c in enumerate(cols)]
        print("  " + "  ".join(str(c).ljust(w[i]) for i, c in enumerate(cols)))
        for r in rows:
            print("  " + "  ".join(str(v).ljust(w[i]) for i, v in enumerate(r)))

# Bootstrap over clubs (resample whole clubs, since posts from one club aren't independent).
FEATURES = {
    "mentions food": "mentions_food", "says free": "says_free", "collab with another club": "is_collab",
    "promoted in 2+ posts": "posts >= 2", "weekend": "weekday IN (0, 6)", "place on the map": "on_map",
}
rows = db.execute(f"SELECT host, lift, {', '.join(FEATURES.values())} FROM lift").fetchall()
clubs = {}
for r in rows:
    clubs.setdefault(r[0], []).append(r[1:])
hosts = list(clubs)


def effect(sample, k):
    yes = [r[0] for h in sample for r in clubs[h] if r[k + 1]]
    no = [r[0] for h in sample for r in clubs[h] if not r[k + 1]]
    return math.exp(sum(yes) / len(yes) - sum(no) / len(no)) - 1 if yes and no else None


random.seed(0)
print(f"\nBootstrap 95% CI, {len(hosts)} clubs resampled 4000 times")
for k, name in enumerate(FEATURES):
    draws = sorted(d for d in (effect(random.choices(hosts, k=len(hosts)), k) for _ in range(4000)) if d is not None)
    lo, hi = draws[int(0.025 * len(draws))], draws[int(0.975 * len(draws))]
    print(f"  {name:<26} {100 * effect(hosts, k):+5.0f}%   ({100 * lo:+.0f}% to {100 * hi:+.0f}%)")
