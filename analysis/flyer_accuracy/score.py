"""Scores the scraper's date, start time and place against hand labels for 100 random Instagram events.

    python analysis/flyer_accuracy/score.py

labels.csv: one row per sampled event (random.seed(2026) over Instagram events with a flyer saved,
public/events.json as of 2026-11-15). true_date / true_start are what the post says, read from the
flyer and the caption together, the way a student would; where_ok is 1 when the extracted place
names the same place. Rows with no true_date are excluded (the post's meaning depends on the date
it was posted, which isn't stored). A multi-day event counts as one event per day, as the scraper
lists it.
"""
import csv
import math
from pathlib import Path


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return c - h, c + h


rows = [r for r in csv.DictReader(open(Path(__file__).with_name("labels.csv"))) if r["true_date"]]
n = len(rows)
checks = {
    "date": [r["extracted_date"] == r["true_date"] for r in rows],
    "start time": [r["extracted_start"] == r["true_start"] for r in rows],
    "place": [r["where_ok"] == "1" for r in rows],
}
checks["all three"] = [all(c) for c in zip(*checks.values())]
print(f"{n} events scored ({100 - n} excluded)")
for name, ok in checks.items():
    k = sum(ok)
    lo, hi = wilson(k, n)
    print(f"  {name:<11} {k}/{n} = {100 * k / n:.1f}%  (95% CI {100 * lo:.0f}-{100 * hi:.0f}%)")
print("Misses:")
for r, ok in zip(rows, checks["all three"]):
    if not ok:
        print(f"  #{r['n']}: {r['note']}")
