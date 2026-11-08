---
version: 1
slug: "src-dubhub-jsx"
primary_target: "src/DubHub.jsx"
related_targets: ["src/DubHub.css"]
---

# DubHub app shell (all tabs)

Scope: the whole DubHub SPA (Home map, Events, My Events, Clubs, About and its sub-pages). Visitor mode: Operate. Audience: UW students on phones between classes deciding what to go to. Constraints: every feature, route and API call keeps working; light + dark only.

## Direction contract

THESIS: DubHub is campus wayfinding for what's on. Every event hangs off a building-code plate the way a UW sign hangs off a building, and the map leads. It refuses the vibe-coded event app: purple pill chips, floating rounded cards on shadows, a filled "Join" button on every row, a centered hero box.

OWN-WORLD: Sign slate (#23262b) shell bar and map panels; concrete ground (#e7e6e1 light, #141619 dark); white sheets with 1px rules; Red Square brick (#c4432b) is the only accent: now/soon, the active tab, the primary action, and "going". Atkinson Hyperlegible Next for every word, times and codes in it with tabular figures (the Mono cut was tried and dropped: its slab letters read as a typewriter costume, and campus signs set codes in the same humanist sans). Square corners (2px max), no decorative shadows.

STORY: A student opens DubHub, sees what is starting next and in which building, taps one, marks going, and it shows up in My Events.

FIRST VIEWPORT: 56px slate sign bar (wordmark, tabs with a brick underline, sign-in). Full-bleed campus map beneath. Top-left: slate filter sign, 320px. Top-right: "Next up" sign, the next five events as code plate + title + time. Pins for events starting soon carry a code plate; the rest are category dots. Primary action: an event's Going button in its callout and detail sheet.

FORM: Campus Wayfinding, grounded candidate 1 of 7 (IMPECCABLE'S PICK, chosen by the user over the assigned Time Schedule). seed:c5e019efe851ff94. Signature move: building-code plates on pins, lists, and detail sheets.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
