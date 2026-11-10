// The map's colors in each theme. Kept in their own small file because both the site (which
// picks the palette for the current theme) and the map (EventMap.jsx, downloaded separately) need them.

// The light map: campus in the site's concrete and white, quiet enough that the event dots and the
// slate panels carry the color. Parks and water stay recognizable, just muted.
export const MAP_COLORS = {
  background: "#f1eef6", // lavender ground
  water: "#c9cdef",
  park: "#dfe9d6",
  wood: "#d6e3cb",
  wetland: "#e1eadb",
  plaza: "#ece7f3",
  building: "#e2dbef", // buildings tinted purple
  school: "#efeaf6",
  road: "#ffffff",
  highway: "#fdfcff",
  casing: "#d9d1e8",
  highwayCasing: "#c7bbdd",
  label: "#4a3d66",
  labelHalo: "#f7f4fb",
  waterLabel: "#4b4f9a",
  iconOpacity: 0.55,
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
