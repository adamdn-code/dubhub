// What kind of club hosts an event, in the 8 groups the map colors its dots by (plus gray "Other"),
// and the site's headline numbers. Shared by the site (src/DubHub.jsx), the snapshot saved at
// every deploy for the Stats page (scripts/record-stats.mjs), and the history rebuilt from git
// (scripts/stats-history.mjs), so they all count the same way.

// More than 8 colors blur together on a map, where any two dots can sit side by side. Each group
// has a color for the light maps and one for the dark ones, and both sets were checked with the
// dataviz palette validator for every pair (normal vision, and red-green colorblindness with the
// map's cards naming the group). Cultural moved from red to plum in Nov 2026 (red is the site's brick
// accent); rechecked on every pair against the map grounds #ebeae5 (light) and #16181b (dark).
export const NO_FIELD_COLOR = "#8a8398";
export const CATEGORY_GROUPS = [
  { name: "Tech & Engineering", categories: ["Tech", "Engineering"], light: "#2785f7", dark: "#3250d4" },
  { name: "Cultural", categories: ["Cultural"], light: "#881070", dark: "#804878" }, // plum: kept off red, which is the site's "starting soon" color
  { name: "Arts", categories: ["Arts"], light: "#cc5eca", dark: "#ca3fa6" },
  { name: "Service", categories: ["Service"], light: "#18ba86", dark: "#04a67e" },
  { name: "Sports & Outdoors", categories: ["Sports", "Outdoors"], light: "#298805", dark: "#267a08" },
  { name: "Academic & Business", categories: ["Academic", "Business"], light: "#17c2f9", dark: "#228dca" },
  { name: "Faith & Spirituality", categories: ["Faith & Spirituality"], light: "#7647c7", dark: "#9361ef" },
  { name: "Social & Greek Life", categories: ["Social", "Gaming", "Greek Life"], light: "#d1900b", dark: "#c97f2e" },
];
export const OTHER_GROUP = { name: "Other", light: NO_FIELD_COLOR, dark: "#c4c0cc" };

const GROUP_OF_CATEGORY = Object.fromEntries(CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => [c, g])));
// A host with no category goes by its majors' field instead (the sample events).
const GROUP_OF_FIELD = {
  Engineering: "Tech & Engineering",
  "Computing & Math": "Tech & Engineering",
  "Arts & Humanities": "Arts",
  Business: "Academic & Business",
  Sciences: "Academic & Business",
  Health: "Academic & Business",
  "Social Sciences": "Academic & Business",
};

// A host's group, from its HuskyLink category (or else its first field).
export function groupFor(category, field) {
  return GROUP_OF_CATEGORY[category] ?? CATEGORY_GROUPS.find((g) => g.name === GROUP_OF_FIELD[field]) ?? OTHER_GROUP;
}

// Whether `club` hosts `event`: by its Instagram handle, or by its name.
export function isHostedBy(event, club) {
  const host = event.host.toLowerCase();
  if (club.handle && (host === `@${club.handle}` || host.endsWith(`(@${club.handle})`))) return true;
  return event.host === club.name || event.host.startsWith(`${club.name} (@`);
}

const SOURCE_NAMES = { instagram: "Instagram", huskylink: "HuskyLink" };

// More clubs than this means the Clubs page was listing every HuskyLink club (it briefly did in
// October), which can't be compared with the usual list, so those counts are left blank (the same
// rule as scraper/club_growth.py).
const ALL_HUSKYLINK_CLUBS = 1000;

// The numbers the Stats page follows over time. `today` is "YYYY-MM-DD"; earlier events are over.
export function siteStats(events, clubs, today) {
  const upcoming = events.filter((e) => !e.date || e.date >= today);
  const byGroup = {};
  const bySource = {};
  for (const e of upcoming) {
    const club = clubs.find((c) => isHostedBy(e, c));
    const group = groupFor(club?.category, club?.fields?.[0]).name;
    byGroup[group] = (byGroup[group] ?? 0) + 1;
    const source = SOURCE_NAMES[e.source] ?? "Other";
    bySource[source] = (bySource[source] ?? 0) + 1;
  }
  return {
    upcoming: upcoming.length,
    onMap: upcoming.filter((e) => e.pos).length,
    clubs: clubs.length > ALL_HUSKYLINK_CLUBS ? null : clubs.length,
    clubsOnInstagram: clubs.length > ALL_HUSKYLINK_CLUBS ? null : clubs.filter((c) => c.handle).length,
    byGroup,
    bySource,
  };
}
