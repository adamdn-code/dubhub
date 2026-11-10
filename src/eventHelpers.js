// Small things the whole site asks about one event: its building code, its times as text, its
// host and its color. They live here, not in DubHub.jsx, so the map (EventMap.jsx, which is
// downloaded separately) can use them too.
//
// These run for every event each time a page redraws, so the slow parts are done once and
// remembered: the browser's date formatting is set up a single time (building a formatter is by
// far the slowest step), and answers that never change (a time's text, a place's code, an event's
// start and end) are kept after the first time they're worked out.
import { useEffect, useState } from "react";
import { groupFor } from "./eventGroups.js";

// UW building codes, as on campus signs and the time schedule. Matched against an event's place:
// a code already at the start ("HUB 314", "MEB 248") is kept as is; otherwise a known building
// name gives its code. Places that aren't UW buildings get no code (none is made up).
const BUILDING_CODES = [
  ["uw club", null], // the faculty club behind the HUB, not the HUB itself
  ["husky union building", "HUB"], ["hub", "HUB"], ["odegaard", "OUG"], ["suzzallo", "SUZ"], ["allen library", "ALB"],
  ["kane hall", "KNE"], ["savery", "SAV"], ["mary gates", "MGH"], ["gates center", "CSE2"], ["allen center", "CSE"],
  ["physics/astronomy", "PAB"], ["padelford", "PDL"], ["gowen", "GWN"], ["smith hall", "SMI"], ["denny hall", "DEN"],
  ["paccar", "PCAR"], ["dempsey", "DEM"], ["sieg", "SIG"], ["johnson hall", "JHN"], ["kincaid", "KIN"], ["bagley", "BAG"],
  ["guthrie", "GTH"], ["loew hall", "LOW"], ["mechanical engineering", "MEB"], ["more hall", "MOR"], ["ima", "IMA"],
  ["meany", "MNY"], ["thomson hall", "THO"], ["raitt", "RAI"], ["art building", "ART"], ["music building", "MUS"],
  ["communications building", "CMU"], ["condon", "CDH"], ["architecture hall", "ARC"], ["gould hall", "GLD"],
  ["winkenwerder", "WFS"], ["anderson hall", "AND"], ["miller hall", "MLR"], ["clark hall", "CLK"], ["parrington", "PAR"],
  ["chemistry building", "CHB"], ["health sciences", "HSB"], ["alder hall", "ALD"], ["founders", "FNDR"],
  ["schmitz", "SMZ"], ["kelly ecc", "ECC"], ["ethnic cultural", "ECC"], ["red square", "RED SQ"], ["quad", "QUAD"],
  ["husky stadium", "STADIUM"], ["hec ed", "HEC ED"], ["denny field", "DENNY FLD"],
];
// Each name as a whole-word pattern, built once instead of on every look-up.
const BUILDING_PATTERNS = BUILDING_CODES.map(([name, code]) => [new RegExp(`\\b${name.replace("/", "\\/")}\\b`), code]);
const CODE_AT_START = /^([A-Z]{2,5}\d?)(?:\s+(\w*\d\w*))?\b/;

function findPlaceCode(where) {
  const m = where.match(CODE_AT_START);
  if (m && m[1] !== "UW") return { code: m[1], room: m[2] ?? null };
  const lower = where.toLowerCase();
  const hit = BUILDING_PATTERNS.find(([pattern]) => pattern.test(lower));
  if (!hit?.[1]) return null;
  const room = where.match(/\b(\d{2,4}[A-Z]?)\b/)?.[1] ?? null;
  return { code: hit[1], room };
}

// { code, room }: "HUB 314" -> { code: "HUB", room: "314" }; "Mary Gates Hall" -> { code: "MGH" }.
// Null for places with no code. Remembered per place, so don't change what it returns.
const placeCodes = new Map();
export function placeCode(where) {
  if (!where || where === "Online") return null;
  let code = placeCodes.get(where);
  if (code === undefined) {
    code = findPlaceCode(where);
    placeCodes.set(where, code);
  }
  return code;
}

// "YYYY-MM-DD" for today plus `days`, in the viewer's own time zone.
export function localDate(days = 0) {
  const d = new Date(Date.now() + days * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const SHORT_DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const FULL_DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

// "1:40 PM" for a moment in time (a Date, or milliseconds).
export function clockTime(when) {
  return CLOCK.format(when);
}

// "7:00 PM" for an event's "19:00".
const times = new Map();
export function formatTime(hhmm) {
  let text = times.get(hhmm);
  if (text === undefined) {
    const [h, m] = hhmm.split(":").map(Number);
    text = CLOCK.format(new Date(2000, 0, 1, h, m));
    times.set(hhmm, text);
  }
  return text;
}

// "Thu, Oct 29" for a "2026-10-29" date.
const shortDays = new Map();
function shortDay(date) {
  let text = shortDays.get(date);
  if (text === undefined) {
    const [y, m, d] = date.split("-").map(Number);
    text = SHORT_DAY.format(new Date(y, m - 1, d));
    shortDays.set(date, text);
  }
  return text;
}

// "Thu, Oct 29, 7:00 PM–8:30 PM"
export function formatWhen(e) {
  if (!e.date) return null;
  const day = shortDay(e.date);
  if (!e.start) return day;
  return `${day}, ${formatTime(e.start)}${e.end ? `–${formatTime(e.end)}` : ""}`;
}

// "Today", "Tomorrow", or "Wed, Nov 4" for an event's "2026-11-04" date.
export function dayLabel(date) {
  if (!date) return "Date not listed";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return shortDay(date);
}

// "Saturday, November 7"
export function fullDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return FULL_DAY.format(new Date(y, m - 1, d));
}

// When an event starts and ends, as times (an event with no end runs an hour; no start, all day).
// Remembered per event, so don't change what it returns.
const spans = new WeakMap();
export function eventSpan(e) {
  if (!e.date) return null;
  let span = spans.get(e);
  if (!span) {
    const start = new Date(`${e.date}T${e.start ?? "00:00"}`).getTime();
    const end = e.end ? new Date(`${e.date}T${e.end}`).getTime() : e.start ? start + 36e5 : new Date(`${e.date}T23:59`).getTime();
    span = { start, end, allDay: !e.start };
    spans.set(e, span);
  }
  return span;
}

// When an event starts, said the way a sign would: "Now", "In 12 min", "In 2 hr". Nothing for
// events more than three hours off (their time is right next to it).
export function startsIn(e, now = Date.now()) {
  if (!e.date || !e.start) return null;
  const { start, end } = eventSpan(e);
  if (now >= start && now <= end) return "Now";
  const min = Math.round((start - now) / 6e4);
  if (min < 0 || min > 180) return null;
  return min < 60 ? `In ${Math.max(min, 1)} min` : `In ${Math.round(min / 60)} hr`;
}

// "Product Space @ UW (@uwproductspace)" -> "Product Space @ UW"; "@vsauw" stays as is.
export function hostName(event) {
  return event.club?.name ?? event.host.replace(/\s*\(@[\w.]+\)$/, "");
}

// Dots are colored by the host club's group (src/eventGroups.js has the groups and their colors).
export function eventGroup(e) {
  return groupFor(e.club?.category, e.fields?.[0]);
}

// `dark`: the color for a dark map (MAP_PALETTES' `dark`).
export function eventColor(e, dark = false) {
  const g = eventGroup(e);
  return dark ? g.dark : g.light;
}

// Events sharing a spot, most popular first (then soonest).
export function popularFirst(x, y) {
  return (y.rsvps ?? y.going ?? 0) - (x.rsvps ?? x.going ?? 0) || `${x.date}T${x.start}`.localeCompare(`${y.date}T${y.start}`);
}

// The current time, ticking once a minute.
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);
  return now;
}
