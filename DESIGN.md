---
name: DubHub
description: Campus wayfinding for what's on at UW. Every event hangs off a building-code plate, and the map leads.
colors:
  brick: "#c4432b"
  brick-ink: "#b03a24"
  brick-wash: "#f7e3dd"
  brick-on-slate: "#ff9479"
  sign-slate: "#23262b"
  slate-hover: "#33373d"
  slate-rule: "#3e434a"
  on-slate: "#ffffff"
  on-slate-muted: "#b3b8bf"
  concrete: "#e6e5e0"
  sheet: "#ffffff"
  tint: "#f0efea"
  ink: "#1b1e22"
  muted: "#595e65"
  rule: "#d4d2cb"
  field-line: "#a9a7a0"
  error: "#b3261e"
  brick-dark: "#ec6a4e"
  brick-ink-dark: "#ff8a70"
  brick-wash-dark: "#3a221c"
  sign-slate-dark: "#0c0e10"
  panel-dark: "#1f2226"
  concrete-dark: "#131518"
  sheet-dark: "#1b1e22"
  tint-dark: "#24282d"
  ink-dark: "#ecebe6"
  muted-dark: "#a1a6ad"
  rule-dark: "#2c3035"
  field-line-dark: "#464b52"
  error-dark: "#ff9b8f"
  plate-light: "#e8e7e2"
  map-ground: "#ebeae5"
  map-ground-dark: "#16181b"
  cat-tech: "#2785f7"
  cat-tech-dark: "#3250d4"
  cat-cultural: "#881070"
  cat-cultural-dark: "#804878"
  cat-arts: "#cc5eca"
  cat-arts-dark: "#ca3fa6"
  cat-service: "#18ba86"
  cat-service-dark: "#04a67e"
  cat-sports: "#298805"
  cat-sports-dark: "#267a08"
  cat-academic: "#17c2f9"
  cat-academic-dark: "#228dca"
  cat-faith: "#7647c7"
  cat-faith-dark: "#9361ef"
  cat-social: "#d1900b"
  cat-social-dark: "#c97f2e"
  cat-other: "#8a8398"
  cat-other-dark: "#c4c0cc"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  sign-header:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.04em"
  time:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
    fontFeature: "tnum"
  code:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.02em"
    fontFeature: "tnum"
rounded:
  sign: "2px"
  dot: "50%"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "32px"
components:
  button-going-action:
    backgroundColor: "{colors.brick}"
    textColor: "{colors.on-slate}"
    rounded: "{rounded.sign}"
    padding: "6px 14px"
    height: "36px"
    typography: "{typography.title}"
  button-going-action-hover:
    backgroundColor: "{colors.brick-ink}"
  button-going:
    backgroundColor: "{colors.brick-wash}"
    textColor: "{colors.brick-ink}"
    rounded: "{rounded.sign}"
    padding: "6px 14px"
    height: "36px"
  button:
    backgroundColor: "{colors.sign-slate}"
    textColor: "{colors.on-slate}"
    rounded: "{rounded.sign}"
    padding: "6px 14px"
    height: "36px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: "6px 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: "6px 14px"
    height: "36px"
  chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: "6px 11px"
  chip-on:
    backgroundColor: "{colors.sign-slate}"
    textColor: "{colors.on-slate}"
  plate:
    backgroundColor: "{colors.sign-slate}"
    textColor: "{colors.on-slate}"
    typography: "{typography.code}"
    rounded: "{rounded.sign}"
    padding: "3px 7px 2px"
  plate-now:
    backgroundColor: "{colors.brick}"
    textColor: "{colors.on-slate}"
  starts-now:
    backgroundColor: "{colors.brick}"
    textColor: "{colors.on-slate}"
    rounded: "{rounded.sign}"
    padding: "1px 6px"
  sign-bar:
    backgroundColor: "{colors.sign-slate}"
    textColor: "{colors.on-slate}"
    height: "56px"
    padding: "0 20px"
  sign-panel:
    backgroundColor: "{colors.sign-slate}"
    textColor: "{colors.on-slate}"
    rounded: "{rounded.sign}"
    padding: "14px"
  day-band:
    backgroundColor: "{colors.sign-slate}"
    textColor: "{colors.on-slate}"
    padding: "8px 16px"
---

# Design System: DubHub

## Overview

**Creative North Star: "The Campus Sign"**

DubHub is campus wayfinding for what's on. The visual world comes from UW's own signage: dark slate sign panels with white type, the concrete and brick of Red Square underfoot, and building codes like "MGH 241" set as small plates. The full-bleed campus map is the home screen, and anything that floats over it is drawn as a sign: slate, square, edged in 1px, set in one humanist sans.

The density is built for a phone between classes. A ruled white sheet holds the lists, slate day bands divide them, and every row reads left to right as time, plate, title, action. Color is rare on purpose. The chrome is slate and concrete. Scraped event photos, club avatars, and the category dots on the map supply the color. Brick appears only where something is happening now or where the student has committed to it.

The world was chosen to replace a generic event-app look. Its confirmed rejections: purple pill chips, rounded cards floating on shadows, a filled "Join" button on every row, and a centered hero box.

**Key Characteristics:**
- Slate sign panels (top bar, map panels, day bands, plates) over a concrete ground.
- Red Square brick is the only accent, and it always means now, soon, active, or going.
- Building-code plates are the signature, drawn only where a real code exists.
- One typeface (Atkinson Hyperlegible Next) for every word, with tabular figures for times and codes.
- 2px corners, 1px rules, and one shadow, used only for things floating over the map.
- Light and dark themes only.

## Colors

A near-monochrome slate-and-concrete palette with one brick accent and a validated set of category colors that exist only as data on the map.

### Primary
- **Red Square Brick** (brick; brick-dark in dark): Means "on now or starting soon" and "you're going". It is used on the StartsTag ("In 12 min", "Now"), Next up times, the rings on soon pins, the now state of a plate, the active tab's 3px underline, the event "I'm going" button, the going state, text selection, and the focus outline. **Brick Ink** (brick-ink) is brick set as text on white, and it doubles as the hover for the brick button. **Brick Wash** (brick-wash) is the fill behind the going state. On slate panels, brick text lifts to **Brick on Slate** (brick-on-slate) so that it holds its contrast.

### Neutral
- **Sign Slate** (sign-slate): The top bar, map panels (filters, Next up, legend), day bands, plates, the callout stem, and the default button fill. **Slate Hover** (slate-hover) is the hover state on slate. **Slate Rule** (slate-rule) draws the 1px dividers inside slate panels. In dark mode the bar goes to sign-slate-dark and the map panels to panel-dark.
- **On Slate / On Slate Muted** (on-slate, on-slate-muted): White type on signs. The muted tone is for room numbers, secondary lines, sign headers, and inactive tabs.
- **Concrete** (concrete; concrete-dark): The page ground. The map's own ground is slightly lighter (map-ground; map-ground-dark).
- **Sheet** (sheet; sheet-dark): Lists, inputs, pop-ups, and callouts on the light map. **Tint** (tint) is used for row hovers and quiet fills.
- **Ink** (ink; ink-dark): Body text, links, strong edges, and the hover border on outlined controls. **Muted** (muted) is for secondary text.
- **Rule** (rule; rule-dark): 1px dividers between list rows and around chips. **Field Line** (field-line) is the stronger edge used on inputs and outlined buttons.
- **Light Plate** (plate-light): The inverted plate used on dark pages, where a slate plate would sink into the ground.
- **Error** (error; error-dark): Form errors only.

### Category colors (map data)
Eight club-category groups plus gray "Other" color the event dots on the map and the matching chip dots: Tech & Engineering, Cultural (plum), Arts, Service, Sports & Outdoors, Academic & Business, Faith & Spirituality, and Social & Greek Life. Each group has a light-map value and a dark-map value. Both sets were checked pair by pair with the dataviz validator (normal vision and red-green colorblindness) against the map grounds. These colors are data, not chrome. They never fill a button, panel, or heading.

### Named Rules
**The One Brick Rule.** Brick means only four things: on now or starting soon, the active tab, the event "I'm going" action, and "going". Every other button is slate, outlined, or a white sheet. If an element isn't one of those four, it is not brick.

**The Plum Not Red Rule.** No category color may sit near brick's hue. Cultural moved to plum so that a dot is never mistaken for "starting soon". Any new or changed category color is re-run through the all-pairs validator on both map grounds.

**The Content Is The Color Rule.** The chrome stays slate, concrete, and white. Photos, avatars, and map dots carry the color.

## Typography

**Display Font:** Atkinson Hyperlegible Next (with system-ui, -apple-system, Segoe UI, sans-serif), loaded at 400, 500, 700, and 800.
**Body Font:** The same.
**Label/Mono Font:** None. Times and codes use the same face with tabular figures, which the body sets globally.

**Character:** A legibility-first humanist sans set the way campus signs set it. The weight contrast between 400 and 800 does the work that a second family would otherwise do.

### Hierarchy
- **Display** (800, 34px, 1.1, -0.02em; 28px on phones): Page titles.
- **Headline** (800, 20px, -0.01em): Section heads within pages. The wordmark uses the same setting on the sign bar.
- **Title** (700, 15px, 1.25): Event names in Next up and in lists, button labels, and the active tab.
- **Body** (400, 15px, 1.45; 1.5 on pages): Everything else. Secondary lines are 13 to 14px in muted.
- **Sign header** (700, 13px, 0.04em, uppercase): The names of sign panels ("Next up", the filter sign) and in-page side heads, in on-slate-muted. These are panel headings, not decoration above a title.
- **Time** (700, 13 to 14px, tabular): Start times. The end or second line steps down to 400 muted.
- **Code** (700, 12px, 0.02em, tabular; 15px on large plates): Building codes on plates. The room number is set at 400 in the muted tone.

### Named Rules
**The One Face Rule.** Every word, time, and code is set in Atkinson Hyperlegible Next. The Mono cut was tried and dropped because its slab letters read as a typewriter costume, while campus signs set codes in the same humanist sans. Alignment comes from tabular figures, not from a second family.

## Layout

The map is full-bleed beneath a 56px sign bar. On desktop, sign panels pin to the map's corners 16px in: filters at the top left (300px) and Next up at the top right (360px). Content pages run in a centered column up to 1080px, with 32px top padding, at least 20px side padding, and 56px at the bottom. Lists are one ruled sheet. Rows are separated by 1px rules, and day bands are sticky slate headers flush with the bar. Event rows run time (82px column), plate, title and meta, then action. Spacing runs on a tight 6 / 10 / 14 / 20 / 32px rhythm, with 14px as the standard inset inside panels. Breakpoints are at 1100px, 760px, 700px (the phone layout, where the top tabs move to a bottom tab bar and the filters become a bottom sheet), and 520px. Chip rows scroll horizontally on phones and wrap from 701px up.

## Elevation & Depth

The system is flat, and depth is reserved for the map. Sheets, lists, and page content sit flat on concrete and are separated by 1px rules and tonal steps (sheet, tint, slate). One shadow token lifts the things that float over the map: the sign panels, the event callouts, the map card, the club modal, and the map controls. In dark mode the same token deepens so it still reads.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 1px 2px rgba(15,17,20,0.18), 0 8px 24px rgba(15,17,20,0.16)`; dark: `0 2px 4px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.35)`): Anything floating over the map, plus the modal.

### Named Rules
**The Only Things That Float Rule.** A shadow means "this is floating over the map". Use the one shadow token for that and nothing else. Page content never casts a shadow.

## Shapes

Corners are square: 2px on every panel, button, chip, plate, input, and callout. Edges are 1px rules. The only circles are the category dots on the map and in chips, and round avatars. Callouts hang from their dot on a 2px slate stem, the way a sign hangs from its post. The favicon repeats the world: a slate square with a brick band along the bottom and the white "DH".

## Components

### Buttons
Slate and square, with brick reserved for the one commitment.
- **Shape:** Square (2px), 36px minimum height, 6px 14px padding, 14px at 700, 16px icon with a 6px gap.
- **I'm going (primary):** A brick fill with white text, used for an event's going action in its callout and its detail sheet. On hover it moves to brick ink.
- **Default:** A slate fill (in dark mode it inverts to a light fill with dark text). On hover it goes to black.
- **Quiet:** Transparent with a field-line border, used in long lists so the page isn't a column of identical filled buttons. On hover the border moves to ink.
- **Secondary:** A white sheet with a field-line border. On hover the border moves to ink.
- **Going (joined):** A brick-wash fill with a brick border, brick-ink text, and a check icon. It looks the same in lists.
- **Focus:** A 2px brick outline offset by 2px, which is the global focus treatment.

### Chips
- **Style:** A white sheet with a 1px rule border, 2px corners, 6px 11px padding, 14px at 500, and an optional 8px category dot.
- **State:** On hover the border moves to field-line. When selected the chip fills slate with on-slate text at 700.

### Plates (signature)
A building code as it appears on a campus sign: white on slate, with the room number in a lighter tone ("MGH 241"). Code type, 3px 7px 2px padding, 2px corners, no wrapping. A large size is used on detail sheets. On dark sign panels and dark pages the plate inverts to a light plate with dark text. A plate for an event happening now fills with brick. Soon pins on the map carry a plate beside their dot. A plate is drawn only when placeCode() derives a real code from the event's location. Places without one get no plate, and the title takes its space.

### Starts tag
"In 12 min" or "Now" in brick-ink time type. "Now" becomes a filled brick tag (1px 6px). On slate panels it uses brick on slate.

### Sign panels (map)
Filters, Next up, and the legend: a slate panel fill, a 1px edge, 2px corners, the float shadow, a 14px inset, a sign header at the top divided by a slate rule, and rows divided by slate rules that turn slate-hover on hover. Next up lists the next five events as plate (80px column), title over place, and time.

### Event callouts (map)
A white sheet on the light map (a slate panel in dark mode) with a max width of 250px, 2px corners, and the float shadow, hanging from its dot on a 2px slate stem. The callout leads with the plate (or the club's picture or the type icon when there is no code). A small uppercase line names the dot's category next to its color so the dot never relies on color alone, and the event name follows. That line is the legend for the dot and is not a general label-above-title device.

### Lists
One ruled sheet per day under a sticky slate day band (14px at 700, with the date's secondary part at 400 muted). Rows turn tint on hover.

### Navigation
- **Sign bar:** 56px of slate holding the wordmark (a 12px brick square plus "DubHub" at 20px 800), tabs at 15px 500 in on-slate-muted, and the theme toggle and sign-in at the end.
- **Active tab:** On-slate text at 700 with a 3px brick underline flush with the bar's bottom edge.
- **Sign-in:** An inverted button (white fill, slate text).
- **Theme toggle:** A 36px square icon button that switches between light and dark, following the device by default.
- **Phones:** The tabs move to a bottom tab bar with 22px icons.

## Do's and Don'ts

### Do:
- **Do** keep brick to its four meanings: now or soon, the active tab, the "I'm going" action, and going.
- **Do** draw a plate only from a code placeCode() actually derives, and let the title take the space when there isn't one.
- **Do** set times and codes in Atkinson Hyperlegible Next with tabular figures.
- **Do** use 2px corners and 1px rules everywhere, and the single float shadow only for things over the map.
- **Do** invert plates to the light plate on dark grounds so they still read as plates.
- **Do** re-validate the category palette for all pairs on both map grounds whenever a category color changes, and keep it off brick's hue.
- **Do** ship every surface in light and dark, following the device unless the user picks one.

### Don't:
- **Don't** make a filled "Join" button on every row. Use the quiet outlined button in lists.
- **Don't** use purple pill chips, rounded floating cards, or a centered hero box.
- **Don't** invent building codes or decorative plates for places that don't have one.
- **Don't** add a second typeface, including the Atkinson Mono cut.
- **Don't** put a shadow on page content, or use any shadow value besides the float token.
- **Don't** use category colors as chrome (buttons, panels, headings).
- **Don't** add themes beyond light and dark.
- **Don't** add invented small labels above titles. The only uppercase lines are sign-panel headers and the callout's category legend.
