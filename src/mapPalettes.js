// The map's colors in each theme. Kept in their own small file because both the site (which
// picks the palette for the current theme) and the map (EventMap.jsx, downloaded separately) need them.

// The light map: the dark map's layering in daylight. Each layer sits a clear step from the
// ground (white streets on lavender, buildings a shade deeper, freeways in lilac) so the map
// reads at a glance instead of washing out, while staying soft enough for the event dots to lead.
export const MAP_COLORS = {
  background: "#e8e3f0", // lavender ground
  water: "#aab3e8",
  park: "#c6dccd", // cool sage, so the green sits with the lavender instead of fighting it
  wood: "#b7d0c0",
  wetland: "#cfe1d6",
  plaza: "#dfd8ea",
  building: "#cbbfe0", // buildings tinted purple
  school: "#e1daec",
  road: "#ffffff",
  major: "#ffffff", // keeps trunk roads white, so only freeways turn gold
  highway: "#c2b2e3", // freeways in lilac, so they stand out from the white streets in the map's own colors
  casing: "#bdb0d6",
  highwayCasing: "#8f7bbf",
  label: "#2e2346",
  labelHalo: "#f6f3fa",
  waterLabel: "#3a3f8c",
  iconOpacity: 0.7,
};

// The dark map: the top bar's slate, with streets a step lighter and water in a deep blue-gray.
export const DARK_MAP = {
  dark: true,
  background: "#17112a", // night, in purple
  water: "#1d1a44",
  park: "#1c2025",
  wood: "#1a1e22",
  wetland: "#1d2126",
  plaza: "#1b1430",
  building: "#271d40",
  school: "#1c1530",
  road: "#30254f",
  major: "#45366e",
  highway: "#8a7542", // freeways in gold
  path: "#241b3c",
  casing: "#17112a",
  highwayCasing: "#3d3220",
  label: "#cfc6e6",
  labelHalo: "#120d20",
  waterLabel: "#9ea3e6",
  iconOpacity: 0.5,
};

export const MAP_PALETTES = { light: MAP_COLORS, dark: DARK_MAP };
