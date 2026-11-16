# Flyer extraction accuracy

How often does the scraper get an Instagram event's date, start time and place right?

I drew 100 Instagram events at random (`random.seed(2026)`) from the 174 in `public/events.json` that had a flyer image saved, on 2026-11-15. For each one I read the flyer and the caption the way a student would and wrote down the real date, start time and place (`labels.csv`). Two posts were excluded because their date depends on the day they were posted, which isn't stored. That left 98 to score.

```
python analysis/flyer_accuracy/score.py
```

| Field | Correct | 95% CI (Wilson) |
| --- | --- | --- |
| Date | 95/98 (96.9%) | 91–99% |
| Start time | 95/98 (96.9%) | 91–99% |
| Place | 96/98 (98.0%) | 93–99% |
| All three | 91/98 (92.9%) | 86–96% |

Start time counts as right when the post gives no time and the scraper leaves it blank. Among the 82 posts that do give a time, 79 were right.

## What went wrong

- **Time missed (3).** The time was only printed on the flyer, in a decorative font (#11, #13, #68). The date and place on the same flyers were read correctly.
- **Relative dates (3).** "Greek/Student Night Saturday" in a Dec 4–5 series (#89), "this Saturday" next to a printed 14 Nov (#98), and "3 weeks until Giving Tuesday" (#99). The extractor guessed a date when it had to reason about the calendar.
- **Place missed (1).** "@ UW IMA" at the bottom of a flyer (#95).

Multi-day events are scored the way the scraper lists them, one event per day.
