# DubHub

Every UW Seattle student event on one campus map and one list. Club meetings, study sessions, game nights, tabling and free food are all in one place, so you don't have to follow 200 club Instagram accounts.

Live site: **https://dubhub-test.vercel.app/**

No club has to post anything to DubHub. Scrapers collect events from HuskyLink, club Instagram posts (including the text on their flyers), Discord and Luma, then pin them to real campus buildings.

## What's on the site

- **Now:** what's on now, soon, later today and this week, shown as the clubs' own flyers.
- **Map:** campus map with event pins, filters and a "Next up" list.
- **Clubs:** about 250 student orgs with their Instagram, category and upcoming events, plus an **Applications** view of open club applications and their deadlines.
- **My Events:** events you marked going and events from clubs you joined.
- **Accounts:** sign in with a UW Google account to save events, add friends and fill in a profile.
- **About:** the team, and a Careers page for joining DubHub.
- **Share links:** `#event=<id>` opens one event directly.

## How it's built

| Part | What it is |
| --- | --- |
| `src/` | React 19 + Vite single-page app. Most of the UI is in `DubHub.jsx`, and the map is in `EventMap.jsx` (Leaflet + MapLibre). |
| `public/` | Scraped data the site reads: `events.json`, `clubs.json`, `applications.json`, plus images in `public/ig/`. |
| `api/` | Vercel serverless functions for sign-in, going lists, friends, stats and applications, storing data in Upstash Redis. |
| `scraper/` | Python scrapers and the scheduled runner that keeps `public/` up to date. |

Vercel deploys every push to `main`. Page views are counted with Vercel Analytics (no cookies).

## Run the site locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run lint
```

The site works locally with just the JSON in `public/`. Sign-in and the `api/` functions also need these environment variables, set in Vercel:

- `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`
- `SESSION_SECRET`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` and `KV_REST_API_TOKEN`)
- `MODERATOR_EMAILS`

## The scrapers

`scraper/scheduled_scrape.py` runs everything in order. If the result looks right, it pushes the new data to `main`. Windows Task Scheduler starts it at 12 AM, 6 AM, 12 PM and 6 PM. It runs on a home computer instead of a cloud server because Instagram only lets each home connection read a limited number of club pages without logging in.

Each run:

1. Gets the latest `main`. It only touches the scraped data files, never your code.
2. Once a day, refreshes HuskyLink's clubs and events and looks for clubs' Instagram and Discord accounts.
3. Reads Discord and Luma events, checks a few UW clubs that aren't on HuskyLink, and then reads the next 70 clubs' Instagram posts. Clubs that posted recently are checked first.
4. Checks the result. If clubs went missing or the events vanished, it puts everything back and pushes nothing.
5. Reads the dates and times off new flyers with Windows OCR. If this step fails, only it is undone.
6. Commits and pushes the data.

The logs are in `scraper/state/logs/`, one file per run.

| Script | Source |
| --- | --- |
| `huskylink_scraper.py` | HuskyLink clubs and events |
| `instagram_public_scraper.py` | Club Instagram posts, logged out (see [`scraper/SOURCES.md`](scraper/SOURCES.md)) |
| `flyer_scraper.py`, `flyer_text.py` | Text on event flyers |
| `discord_events.py`, `find_discord_servers.py` | Discord server events |
| `luma_events.py` | UW clubs' Luma calendars |
| `find_unlisted_clubs.py` | UW clubs that aren't on HuskyLink (`--add` adds names, `--following` imports an Instagram following list) |
| `events_common.py` | Finds events in posts (AI or keywords), places them on campus and writes `public/events.json` |

### Setup

You need Python 3.11+ on Windows.

```bash
pip install instaloader requests playwright
pip install winrt-runtime winrt-Windows.Media.Ocr winrt-Windows.Graphics.Imaging winrt-Windows.Storage.Streams winrt-Windows.Foundation winrt-Windows.Foundation.Collections winrt-Windows.Globalization
```

Put your keys in `scraper/.env`. That file is never committed.

```
GROQ_API_KEY=...        # AI that reads events out of posts. Without it, keywords are used.
DISCORD_BOT_TOKEN=...   # optional: the DubHub Discord bot
```

Then, from `scraper/`:

```powershell
python scheduled_scrape.py --dry-run    # check that it could run; changes nothing
python scheduled_scrape.py              # one full run
powershell -ExecutionPolicy Bypass -File setup_schedule.ps1   # run it every 6 hours
schtasks /change /tn "DubHub scraper" /disable                # pause the schedule (/enable to resume)
```

Teammates can run the schedule on their own computers too. Each home network can read more clubs per day, and the runs combine their results.

**Tip:** a run dies if the laptop sleeps partway through, so keep it plugged in with sleep turned off around run times.
