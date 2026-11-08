---
version: 1
slug: "src-dubhub-jsx"
primary_target: "src/DubHub.jsx"
related_targets: ["src/DubHub.css"]
---

# DubHub app shell (all tabs), branch dubhub-now

Scope: the whole DubHub SPA. Visitor mode: Operate. Audience: UW students on phones between classes asking "what's happening right now?". Constraints: every feature keeps working; light + dark only. Product bet: "Now" (events by time from now) is the front page; the map is a tab; any event can be shared as a link.

## Direction contract

THESIS: DubHub is the telephone pole on the Ave, kept current: real club flyers, sorted by how soon they start, with a tear-off tab to say you're going. It refuses the map-first front page and the grid of identical soft cards.

OWN-WORLD: Xerox black (#111214) shell bar and type; cool paper ground (#ecece8 light, #121314 dark); white flyer sheets with a strip of translucent tape; fluoro copy-paper colors with jobs: fluoro yellow (#f2ff3d) is the action ("I'm going"), fluoro orange (#ff7417) is "on now", fluoro pink (#ff5da2) is "starting soon"; flyers with no picture are set as type on a fluoro sheet. Archivo, condensed and heavy for headlines, normal width for UI text, tabular figures. Square corners, 1px black rules.

STORY: A student opens DubHub, sees what is on now and next as a wall of flyers, taps one, tears off "I'm going", and shares the link with a friend.

FIRST VIEWPORT: Black bar (DUBHUB wordmark, tabs Now / Map / My Events / Clubs / About, sign-in). Below: a heavy condensed headline with the live day and time, a search field and one row of filters, then "On now" and "Starting soon" sections as a grid of flyers (picture, title, host, time sticker, building label, tear-off "I'm going" tab). Primary action: the tear-off tab on each flyer.

FORM: The Ave Flyer Wall, grounded candidate 1 of 7 (IMPECCABLE'S PICK, chosen by the user over the assigned Ticket & Wristband). seed:526a28962363cb16. Signature move: the tear-off tab that tears away when you mark yourself going.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
