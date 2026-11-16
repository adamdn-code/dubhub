# What gets a club's event post more engagement?

```
python analysis/engagement/build_db.py   # every snapshot of public/events.json in git -> engagement.db (SQLite)
python analysis/engagement/run.py        # runs queries.sql, then a bootstrap CI over clubs
```

**Outcome.** RSVPs would be the natural target, but only 10 of 329 events have any (HuskyLink and Luma). Instagram likes per post are the usable signal: 134 events across 92 clubs.

**Data.** Events drop out of `events.json` once they pass, so the 21 committed versions of the file are rebuilt into one table, keeping each event's newest snapshot. Multi-day events (one row per day) count once, and likes are averaged per post, because the scraper adds up likes across all posts that promote the same event.

**Method.** Big clubs get more likes on everything, so comparing posts across clubs mostly measures club size. Each post is compared with its own club's average instead (log-likes minus the club mean, clubs with 2+ posts: 74 posts, 32 clubs). The 95% intervals come from resampling whole clubs.

## Results

| Feature | Posts with it | Within-club change in likes | 95% CI |
| --- | --- | --- | --- |
| Promoted in 2+ posts | 6 | +57% | −8% to +162% |
| Collab with another club | 3 | +13% | −20% to +84% |
| Mentions food | 19 | +0% | −20% to +32% |
| Says "free" | 8 | −2% | −41% to +95% |
| Weekend | 6 | −4% | −45% to +15% |
| Place on the map | 42 | −7% | −24% to +15% |

The raw numbers say food posts get **45% more likes** (54.5 vs 37.7). Inside a club the gap is **0%**. The raw gap is confounding: the bigger half of clubs average 69 likes a post and mention food in 34% of posts, against 13 likes and 22% for the smaller half.

No feature has a clear effect at this sample size. The one worth watching is promoting an event more than once (+57%, but n = 6). Re-run this once more snapshots have accumulated.

## Caveats

- Likes are counted when the scraper last saw the post, and post dates aren't stored, so a post scraped soon after it went up has fewer likes. That adds noise and shouldn't bias the within-club comparisons.
- Food, "free" and collab are keyword matches on the caption (`build_db.py`), not hand labels.
