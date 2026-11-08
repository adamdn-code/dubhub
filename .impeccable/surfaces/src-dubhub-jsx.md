---
version: 1
slug: "src-dubhub-jsx"
primary_target: "src/DubHub.jsx"
related_targets: ["src/DubHub.css"]
---

# DubHub app shell (all tabs), branch dubhub-wild

Scope: the whole DubHub SPA. Visitor mode: Operate. Audience: UW students on phones asking "what's happening right now?". The user asked for the redesign to be "really creative and stylistic, really bonkers and cool". Constraints: every feature keeps working; light + dark only. Product shape kept from dubhub-now: Now is the front page, the map is a tab, #event=<id> share links.

## Direction contract

THESIS: DubHub is the night network map of campus: every kind of club event is a colored line, every event a station, and all of them leave from one glowing NOW interchange. It refuses the event feed and the card grid; the schedule is drawn as a transit diagram.

OWN-WORLD: Midnight-blue enamel ground (#0a1430) with porcelain white (#f3f1ea) for type, station ticks and sign plates; the line inks are the club-category colors from src/eventGroups.js (the validated dark set on midnight, the light set on day porcelain #eef0f4). Overpass, the highway and transit sign face, in fixed sizes, tabular figures. Lines bend only at 45 and 90 degrees. Rounded only where transit is round: stations, line bullets, the interchange.

STORY: A student opens DubHub, sees the network fanning out from NOW, follows a line to the next station, taps it, says they're going, and shares the link.

FIRST VIEWPORT: Midnight bar (DUBHUB, tabs Now / Map / My Events / Clubs / About, sign-in). Below: the live time as a station sign, then the Network: a wide diagram with the NOW interchange at the left, one line per club category fanning out at 45 degrees into horizontal lanes, stations at each upcoming event (schematic, evenly spaced by start time, time headers above), stations about to start pulsing. Under it, Departures: rows with the line bullet, time, event, host, building plate and an "I'm going" button.

FORM: Midnight Transit, a dealt challenger from the bolder re-roll (round 1), chosen by the user. seed:526a28962363cb16. Signature move: the network diagram leaving from the NOW interchange, with the next stations pulsing.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
