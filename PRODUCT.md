# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
UW Seattle students, mostly on their phones, checking what is happening on campus today or this week and deciding what to go to. Club officers and the DubHub hiring team also use the site, but browsing students are the primary audience every decision serves first.

## Product Purpose
DubHub puts every student event at UW (club meetings, study sessions, game nights, tabling, tailgates, food) on one campus map and one list, so a student can find something to do right now without following 150 club Instagram accounts. Success: a student opens it, sees what is on near them soon, and marks themselves going.

## Positioning
Events are scraped automatically from HuskyLink, club Instagram posts, and club Discord servers, then pinned to real campus buildings. No club has to post anything for its events to appear. On branch dubhub-now the front door is time, not place: what's on now and next, as the clubs' own flyers, with the map one tab away.

## Operating Context
- Now (the front page, on branch dubhub-now): every event that hasn't ended, grouped On now / Starting soon (3 hours) / Later today / Tomorrow / Later this week, shown as the clubs' own flyers; search, type, club type and how-far-ahead filters.
- Map: the campus map with event dots, filters, a Next up list and labels on events starting soon.
- Share links: #event=<id> opens an event directly, from the share sheet or a copied link.
- My Events: events the student marked going plus events from clubs they joined.
- Clubs: ~150 student orgs (name, Instagram handle, category, description, upcoming events) and an Applications view for open club applications with deadlines.
- About: the team, plus hidden Stats and Hiring pages; Careers lets people apply to join DubHub.
- Sign in with a UW Google account; going lists, friends and messages, profile (year, major).
- Data refreshes from Python scrapers on a schedule; `events.json`, `clubs.json`, `applications.json` in `public/`.

## Capabilities and Constraints
- React 19 + Vite single-page app; Leaflet + MapLibre vector base map; Vercel-style `api/` functions with Upstash Redis.
- All existing features, routes, data flows, and API calls must keep working.
- Themes: light and dark only (following the device by default, user can override). The previous extra themes (Rainier, Cherry Blossom, Sunset, Evergreen) are retired.
- Event and club imagery comes from scraped Instagram posts and avatars; quality varies widely.

## Brand Commitments
- Name: DubHub.
- UW purple and gold are not binding; the palette is open.
- Voice: plain, short, student-to-student. No hype.

## Evidence on Hand
Real scraped events, clubs, club avatars (`public/ig/`), team photos (`public/team/`). No testimonials or usage numbers exist beyond the internal Stats page; none may be invented.

## Product Principles
1. The map and the clock come first: where and when beat everything else.
2. Real content leads; chrome stays out of its way. Scraped photos and club names are the color of the site.
3. One glance on a phone between classes should be enough to decide.
4. Never require a club to do work for its events to show up.
