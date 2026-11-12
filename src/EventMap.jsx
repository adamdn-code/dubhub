// The campus map: the base map, the event dots, their hover cards and the labels that show when
// the site opens. Leaflet and MapLibre are most of the site's JavaScript and the site opens on the
// Now page, so this file is its own download: DubHub.jsx asks for it when the Map tab is first
// opened (the browser also fetches it in its spare time after the page loads, see vite.config.js).
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, CircleMarker, Marker, Pane, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import Icon from "./Icon.jsx";
import { eventColor, eventGroup, eventSpan, formatTime, hostName, localDate, placeCode, popularFirst, useNow } from "./eventHelpers.js";
import { MAP_COLORS } from "./mapPalettes.js";

// UW's main campus (15th Ave NE to Montlake Blvd, the Ave's north end to the Cut): where the
// map opens, whatever else is on it.
const UW_CAMPUS = [[47.6500, -122.3135], [47.6605, -122.3005]];

// Space the filter panel covers: its left side on wide screens, its bottom on phones.
function panelPadding(map) {
  const panel = map.getContainer().parentElement?.querySelector(".filters");
  if (!panel) return {};
  return map.getSize().x > 700
    ? { paddingTopLeft: [panel.offsetWidth + 24, 0] }
    : { paddingBottomRight: [0, panel.offsetHeight + 8] };
}

// Opens the map on UW's campus. You can zoom out and pan as far as the area that holds every
// event, but not past it.
function MapArea({ area }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds(area.bounds);
    // getBoundsZoom never goes below the current minimum, so clear the old area's limit first.
    map.setMinZoom(0);
    map.setMinZoom(map.getBoundsZoom(bounds));
    map.setMaxBounds(bounds.pad(0.05));
    map.fitBounds(UW_CAMPUS, panelPadding(map));
  }, [map, area]);

  return null;
}

// How big a callout card is on screen (see .callout in DubHub.css): the picture tile and padding,
// plus the text (the group's name above the event's, then the line under it), which is at most
// 250px wide (past that the event's name wraps to a second line).
const CALLOUT_MAX = 250;
const CALLOUT_CHROME = 9 + 34 + 10 + 14; // left padding, tile, gap, right padding
const CARD_H = 68; // a card's height with a one-line name (two lines add 17px)
const FLYER_W = 120; // the flyer above a plate (see .callout-flyer in DubHub.css): 4:5, plus the gap to the plate
const FLYER_H = 150 + 8;
let measureCtx;
function calloutSize(title, sub, group, flyer = false) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const font = getComputedStyle(document.body).fontFamily;
  measureCtx.font = `700 14px ${font}`;
  const titleW = measureCtx.measureText(title).width;
  measureCtx.font = `12px ${font}`;
  const subW = measureCtx.measureText(sub).width;
  measureCtx.font = `700 10.5px ${font}`;
  const groupW = measureCtx.measureText(group.toUpperCase()).width + group.length * 0.6 + 13; // spacing, dot
  const wraps = CALLOUT_CHROME + titleW > CALLOUT_MAX;
  const w = Math.min(CALLOUT_MAX, CALLOUT_CHROME + Math.max(titleW, subW, groupW));
  const h = wraps ? CARD_H + 17 : CARD_H;
  return flyer ? { w: Math.max(w, FLYER_W), h: h + FLYER_H } : { w, h };
}

// What sits on top of the map (the filters, the welcome box, the dot colors, the zoom buttons), in
// the map's own coordinates, so cards aren't hidden behind them.
function mapOverlays(map) {
  const box = map.getContainer().getBoundingClientRect();
  const els = map.getContainer().parentElement?.querySelectorAll(".filters, .next-up, .map-card, .map-legend, .leaflet-control-zoom");
  return [...(els ?? [])]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width && r.height) // ones hidden on this screen size
    .map((r) => ({ l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top }));
}

// Space kept between cards (and between a card and anything else it shouldn't cover).
const CARD_GAP = 6;

// How long the opening cards stay up, fade included (see .intro-callout in DubHub.css).
const INTRO_MS = 6000;

// At most this many cards when the site opens, the soonest events first, so the map isn't buried.
const MAX_INTRO_LABELS = 5;

// The cards over the dots when the site opens (then they fade away). Each goes above its dot, or
// below it if that would cover another card, a labeled dot, or the filters, or run off the map; if
// neither fits it's skipped (hovering the dot still shows its card).
function IntroLabels({ places, dark, onDone }) {
  const map = useMap();
  const [, redraw] = useState(0);

  // Gone once the fade has finished (INTRO_MS matches the animation in DubHub.css).
  useEffect(() => {
    const t = setTimeout(onDone, INTRO_MS + 200);
    return () => clearTimeout(t);
  }, [onDone]);

  useEffect(() => {
    const update = () => redraw((n) => n + 1);
    map.on("zoomend moveend", update);
    return () => map.off("zoomend moveend", update);
  }, [map]);

  const size = map.getSize();
  const taken = mapOverlays(map);
  const fits = (b) =>
    b.l >= 0 && b.t >= 0 && b.r <= size.x && b.b <= size.y && // all on screen
    taken.every((o) => b.r + CARD_GAP <= o.l || b.l - CARD_GAP >= o.r || b.b + CARD_GAP <= o.t || b.t - CARD_GAP >= o.b);
  const shown = [];
  for (const place of [...places].sort((a, b) => a.when.localeCompare(b.when) || b.count - a.count)) {
    if (shown.length === MAX_INTRO_LABELS) break;
    const pt = map.latLngToContainerPoint(place.pos);
    const { w, h } = calloutSize(place.title, place.sub, eventGroup(place.event).name, Boolean(place.event.image));
    const radius = place.lift - STEM;
    for (const dir of ["above", "below"]) {
      const up = dir === "above";
      const top = up ? pt.y - place.lift - h : pt.y + place.lift;
      const card = { l: pt.x - w / 2, r: pt.x + w / 2, t: top, b: top + h };
      // Its stem and dot, which no other card should cover either.
      const dot = { l: pt.x - radius, r: pt.x + radius, t: up ? card.b : pt.y - radius, b: up ? pt.y + radius : card.t };
      if (fits(card) && fits(dot)) {
        taken.push(card, dot);
        shown.push({ ...place, dir });
        break;
      }
    }
  }

  // Each card hangs off an invisible point on its dot, since a dot holds just one card (its hover one).
  return shown.map((p) => (
    <CircleMarker key={`${p.pos.join()}|${p.dir}`} center={p.pos} radius={0} stroke={false} fill={false} interactive={false}>
      <Tooltip
        permanent
        direction={p.dir === "above" ? "top" : "bottom"}
        offset={[0, p.dir === "above" ? -p.lift : p.lift]}
        opacity={1}
        className="event-callout intro-callout"
      >
        <EventCallout event={p.event} title={p.title} sub={p.sub} dark={dark} flyer={p.dir} />
      </Tooltip>
    </CircleMarker>
  ));
}

// Free vector basemap from OpenFreeMap (no API key), drawn with MapLibre inside Leaflet.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
// The map data's licenses require this credit on the map, so it's tucked behind a small "©" button.
const MAP_ATTRIBUTION =
  '<details class="map-credit"><summary aria-label="Map credits">&copy;</summary>' +
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
  "</details>";

function restyle(style, C = MAP_COLORS) {
  const green = { "fill-color": C.park, "fill-opacity": 1 };
  const set = {
    background: { "background-color": C.background },
    water: { "fill-color": C.water },
    park: { ...green, "fill-outline-color": C.park },
    landcover_grass: green,
    landcover_wood: { "fill-color": C.wood, "fill-opacity": 1 },
    landuse_pitch: green,
    landuse_track: green,
    landuse_cemetery: green,
    // Buildings are solid blocks with no outlines, in every theme (the fill's own 1px edge too).
    building: { "fill-color": C.building, "fill-outline-color": C.building },
    landuse_school: { "fill-color": C.school },
    landuse_residential: { "fill-opacity": 0 },
    waterway_river: { "line-color": C.water },
    waterway_other: { "line-color": C.water },
    waterway_tunnel: { "line-color": C.water },
    // Flat colors instead of the grass-tuft and striped textures.
    landcover_wetland: { "fill-color": C.wetland, "fill-opacity": 1 },
    road_area_pattern: { "fill-color": C.plaza, "fill-opacity": 1 },
  };

  // Icons that clutter the map: bus stops with their long names ("... & NE Pacific Pl - Bay 5"),
  // parking "P" signs, dorm (residence hall) beds, and (zoomed all the way in) info points, restrooms
  // and trash cans. Hotels share the dorms' "lodging" class, so dorms are hidden by subclass.
  // Also the 3D buildings that pop up when zoomed in; the flat "building" layer still draws them.
  style.layers = style.layers.filter((layer) => layer.id !== "poi_transit" && layer.type !== "fill-extrusion");
  const hidden = ["bus", "parking", "bicycle_parking", "information", "toilets", "waste_basket"];
  const notBusStop = [
    "!",
    ["any", ["match", ["get", "class"], hidden, true, false], ["==", ["get", "subclass"], "dormitory"]],
  ];

  for (const layer of style.layers) {
    if (layer.paint?.["fill-pattern"]) delete layer.paint["fill-pattern"];
    if (layer.id === "building") delete layer.maxzoom; // it hands off to the (removed) 3D layer at zoom 14
    if (/^poi_/.test(layer.id)) layer.filter = ["all", layer.filter, notBusStop];
    const paint = (layer.paint ??= {});
    // Walkways, sidewalks and park edges as solid lines instead of rows of dots.
    if (/path_pedestrian|park_outline/.test(layer.id)) delete paint["line-dasharray"];
    if (set[layer.id]) {
      Object.assign(paint, set[layer.id]);
    } else if (layer.type === "line" && /^(road|bridge|tunnel)_/.test(layer.id) && !/rail|path/.test(layer.id)) {
      const isHighway = (C.major ? /motorway/ : /motorway|trunk/).test(layer.id);
      const isMajor = C.major && !isHighway && /trunk|primary|secondary|tertiary/.test(layer.id);
      paint["line-color"] = layer.id.endsWith("casing")
        ? isHighway ? C.highwayCasing : C.casing
        : isHighway ? C.highway : isMajor ? C.major : C.road;
    } else if (C.dark && layer.type === "fill") {
      paint["fill-color"] = C.plaza; // other land types, so no bright patches on a dark map
    } else if (C.dark && layer.type === "line") {
      paint["line-color"] = /path/.test(layer.id) ? (C.path ?? C.road) : C.road; // paths, rail, borders
    }
    // Light names on a dark map (water names in blue). Highway shields keep their dark numbers,
    // since they sit on white shield signs.
    if (C.iconOpacity && layer.type === "symbol" && layer.layout?.["icon-image"] && !/shield/.test(layer.id)) {
      paint["icon-opacity"] = C.iconOpacity;
    }
    if (C.label && layer.type === "symbol" && layer.layout?.["text-field"] && !/shield/.test(layer.id)) {
      const water = /water/.test(layer.id) && C.waterLabel;
      Object.assign(paint, { "text-color": water || C.label, "text-halo-color": C.labelHalo, "text-halo-width": 1.2 });
    }
  }

  return style;
}

// Street and place names in DubHub's own font (whatever the device shows the site in) instead of
// the map's Noto Sans. MapLibre can draw labels locally in a CSS font, but by default only does it
// for Chinese, Japanese and Korean; this tells it to do it for every character. If a MapLibre
// update renames this internal piece, the labels just stay in Noto Sans.
function labelsInSiteFont(glMap) {
  const glyphs = glMap?.style?.glyphManager;
  if (glyphs && typeof glyphs._doesCharSupportLocalGlyph === "function" && glyphs.localIdeographFontFamily) {
    glyphs._doesCharSupportLocalGlyph = () => true;
  }
}

function BaseMap({ palette, onReady }) {
  const map = useMap();

  // Redrawn in the new theme's colors when the theme changes.
  useEffect(() => {
    map.attributionControl?.setPrefix(false); // drop the "Leaflet" credit; only the map data's stays
    let layer;
    let cancelled = false;
    fetch(MAP_STYLE)
      .then((r) => r.json())
      .then((style) => {
        if (cancelled) return;
        layer = L.maplibreGL({
          style: restyle(style, palette),
          attribution: MAP_ATTRIBUTION,
          localIdeographFontFamily: getComputedStyle(document.body).fontFamily,
        }).addTo(map);
        const gl = layer.getMaplibreMap();
        labelsInSiteFont(gl);
        gl.once("load", onReady); // the first complete picture of the map: time to reveal it
      })
      .catch(() => onReady()); // no map tiles (offline): show the dots on the plain ground
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, palette, onReady]);

  return null;
}

// Pans the map to an event picked from the Next up sign.
function FlyTo({ event }) {
  const map = useMap();
  useEffect(() => {
    if (!event?.pos) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) map.setView(event.pos, Math.max(map.getZoom(), 17));
    else map.flyTo(event.pos, Math.max(map.getZoom(), 17), { duration: 1.1 });
  }, [map, event]);
  return null;
}

// Clicking the map itself (not a dot) closes the panel.
function MapClicks({ onClick }) {
  useMapEvents({ click: onClick });
  return null;
}

// Whether an event is on now or starts within the next day (for the opening labels).
// Times are the viewer's local time; an event with no time counts as all day.
const INTRO_HOURS = 24;
function isSoon(e) {
  if (!e.date) return true; // sample events have no date
  const start = new Date(`${e.date}T${e.start ?? "00:00"}`);
  const end = new Date(`${e.date}T${e.end ?? e.start ?? "23:59"}`);
  const now = Date.now();
  return end >= now && start <= now + INTRO_HOURS * 36e5;
}

// A map marker that's just a styled element (a glow, a ripple), cached so re-renders hand Leaflet
// the same icon and don't rebuild it (which would restart its animation).
const iconCache = new Map();
function cssIcon(className, size) {
  const key = `${className}|${size}`;
  if (!iconCache.has(key)) iconCache.set(key, L.divIcon({ className, iconSize: [size, size], html: "<span></span>" }));
  return iconCache.get(key);
}

// A dot's size: bigger the more people are going.
function dotRadius(e) {
  return 9 + Math.min((e.rsvps ?? e.going ?? 0) / 6, 8);
}

// How long a callout card's stem is (it matches .callout::after in DubHub.css).
const STEM = 10;

// Map flair: what's happening at a given moment (the time slider's position), today's busiest
// buildings as glowing hotspots with name labels, and pulsing rings on what's live.
function spanOf(e) {
  return e.date && e.start ? eventSpan(e) : null;
}

// "live": on at that moment; "soon": starts within the next hour; "later": later today; null: other.
function stateAt(e, at) {
  const span = spanOf(e);
  if (!span) return null;
  if (span.start <= at && at < span.end) return "live";
  if (span.start > at && span.start - at <= 36e5) return "soon";
  if (e.date === localDate(0) && span.start > at) return "later";
  return null;
}

// A building's short name for its label: the code where there is one, else the place up to a comma.
function placeName(where) {
  const p = placeCode(where);
  if (p && /^[A-Z0-9 ]+$/.test(p.code) && p.code.length <= 5) {
    return where.replace(/\s*\b\d{2,4}[A-Z]?\b.*$/, "").trim() || p.code;
  }
  return where.split(",")[0].replace(/\s*\b(Room|Rm\.?)\s*\S+$/i, "").trim();
}

// Today's places with something on from this moment on, busiest first.
function hotPlaces(events, at) {
  const byPlace = new Map();
  for (const e of events) {
    if (!e.pos || !e.where || e.where === "Online" || e.date !== localDate(0)) continue;
    const span = spanOf(e);
    if (span && span.end < at) continue;
    const key = e.pos.join();
    const p = byPlace.get(key) ?? { pos: e.pos, name: placeName(e.where), events: [] };
    p.events.push(e);
    byPlace.set(key, p);
  }
  return [...byPlace.values()].sort((a, b) => b.events.length - a.events.length);
}

const LABELS_SHOWN = 3;

function MapFlair({ events, at, dark }) {
  const places = hotPlaces(events, at);
  return (
    <>
      {/* Hotspots: a soft glow under each busy building, bigger the more is on there. A CSS
          gradient on a plain element, not a blurred SVG circle, so panning and the pulsing rings
          never have to re-blur it. */}
      <Pane name="hot-glows" style={{ zIndex: 350 }}>
        {places.map((p) => (
          <Marker
            key={`hot|${p.pos.join()}`}
            position={p.pos}
            interactive={false}
            keyboard={false}
            icon={cssIcon(`hot-glow ${p.events.length > 1 ? "hot-ink" : "hot-gold"}${dark ? " dark" : ""}`, 2 * (34 + Math.min(p.events.length, 6) * 12))}
          />
        ))}
      </Pane>
      {/* Labels: the busiest buildings named, with how many events are on there today */}
      {places.slice(0, LABELS_SHOWN).map((p) => (
        <CircleMarker key={`label|${p.pos.join()}`} center={p.pos} radius={0} stroke={false} fill={false} interactive={false}>
          <Tooltip permanent direction="right" offset={[16, 0]} opacity={1} className="place-label">
            <strong>{p.name}</strong>
            <span>
              {p.events.length} event{p.events.length === 1 ? "" : "s"}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

// The map starts hidden (.map-pending) while its tiles load, behind the loader Home shows; once the
// first picture is ready it opens outward from the middle of the screen (.map-reveal) and its dots
// fade in after it.
function MapReveal({ ready }) {
  const map = useMap();
  useEffect(() => {
    if (!ready) return;
    const el = map.getContainer();
    el.classList.remove("map-pending");
    el.classList.add("map-reveal");
  }, [map, ready]);
  return null;
}

export default function EventMap({ events, area, introLabels, shown, flyTo, onPin, onMapClick, onReady, palette, at }) {
  const [ready, setReady] = useState(false);
  const [intro, setIntro] = useState(Boolean(introLabels)); // decided once, when the map opens
  const markReady = useCallback(() => setReady(true), []);
  const endIntro = useCallback(() => setIntro(false), []); // a stable function, so the cards' clock isn't reset
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);
  // If the tiles never arrive, don't leave the loader up forever.
  useEffect(() => {
    const t = setTimeout(markReady, 6000);
    return () => clearTimeout(t);
  }, [markReady]);
  const located = events.filter((e) => e.pos);
  // Events at the exact same spot draw their dots on top of each other, so hovering any of them
  // shows all of them, and clicking opens the most popular.
  const atSpot = new Map();
  for (const e of located) atSpot.set(e.pos.join(), [...(atSpot.get(e.pos.join()) ?? []), e]);
  for (const list of atSpot.values()) list.sort(popularFirst);
  // The hovered spot's cards stay up while the mouse is anywhere in one rectangle: the dot, the
  // cards, and the strip between them. Leave it and they fade out.
  const [hoverSpot, setHoverSpot] = useState(null);
  const [hoverClosing, setHoverClosing] = useState(false);
  const hoverTimer = useRef();
  const keepHover = () => {
    clearTimeout(hoverTimer.current);
    setHoverClosing(false);
  };
  const leaveHover = () => {
    clearTimeout(hoverTimer.current);
    // A beat to cross between the dot and the cards, then the fade (matches .callout-stack.closing)
    hoverTimer.current = setTimeout(() => {
      setHoverClosing(true);
      hoverTimer.current = setTimeout(() => {
        setHoverSpot(null);
        setHoverClosing(false);
      }, 180);
    }, 60);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hovered = hoverSpot && (atSpot.get(hoverSpot) ?? []).filter((x) => x.id !== shown?.id);
  const realNow = useNow();
  const moment = at ?? realNow;
  // One intro label per place, so events in the same building don't pile up. Only events
  // happening in the next day get one; the rest are still dots you can hover.
  const byPlace = new Map();
  for (const e of located.filter(isSoon)) byPlace.set(e.pos.join(), [...(byPlace.get(e.pos.join()) ?? []), e]);
  const places = [...byPlace.values()].map((list) => {
    const clubs = new Set(list.map(hostName));
    return {
      pos: list[0].pos,
      count: list.length,
      when: list.map((e) => `${e.date ?? ""}T${e.start ?? "00:00"}`).sort()[0], // its soonest event
      event: list[0], // whose club picture the card shows
      title: list.length > 1 ? `${list[0].title} +${list.length - 1} more` : list[0].title,
      sub: clubs.size > 1 ? `${clubs.size} clubs` : hostName(list[0]),
      lift: Math.max(...list.map(dotRadius)) + STEM, // from the dot's center to the card
    };
  });

  return (
    <MapContainer
      center={[47.6553, -122.3035]}
      zoom={15}
      maxBoundsViscosity={1}
      zoomSnap={0.25} // so UW's campus fits snugly on any screen size, not just at whole zoom steps
      scrollWheelZoom
      zoomControl={false}
      className="map map-pending"
    >
      <MapReveal ready={ready} />
      <ZoomControl position="bottomright" />
      <FlyTo event={flyTo} />
      <MapArea area={area} />
      <BaseMap palette={palette} onReady={markReady} />
      <MapFlair events={located} at={moment} dark={palette?.dark} />
      {/* Live and soon: a ring rippling out from the dot. Plain elements in their own layer, so
          the animation runs on the GPU instead of repainting the map's dots every frame. */}
      <Pane name="ripples" style={{ zIndex: 390 }}>
        {located.map((e) => {
          const state = stateAt(e, moment);
          return state === "live" || state === "soon" ? (
            <Marker
              key={`pulse|${e.id}`}
              position={e.pos}
              interactive={false}
              keyboard={false}
              icon={cssIcon(`ripple ripple-${state}${palette?.dark ? " dark" : ""}`, 2 * dotRadius(e))}
            />
          ) : null;
        })}
      </Pane>
      {/* The open event: a soft purple halo around its dot, instead of a dark ring */}
      {shown?.pos && (
        <CircleMarker
          key={`halo|${shown.id}`}
          center={shown.pos}
          radius={dotRadius(shown) + 10}
          interactive={false}
          pathOptions={{
            color: palette?.dark ? "#b9a3f5" : "#4b2e83",
            weight: 2,
            opacity: 0.9,
            fillColor: palette?.dark ? "#b9a3f5" : "#4b2e83",
            fillOpacity: 0.2,
          }}
        />
      )}
      {located.map((e) => {
        const on = shown?.id === e.id;
        const state = stateAt(e, moment);
        const soon = state === "live" || state === "soon";
        // Scrubbed to another time: what isn't on then fades back.
        const faded = at != null && state !== "live" && state !== "soon" && !on;
        const radius = dotRadius(e) + (on ? 3 : 0);
        return (
          <CircleMarker
            key={e.id}
            center={e.pos}
            radius={radius}
            pathOptions={{
              color: on ? "#fff" : soon ? (palette?.dark ? "#ff5c6c" : "#d0263d") : palette?.dark ? "#16181b" : "#fff",
              weight: on ? 3 : soon ? 4 : 2,
              fillColor: eventColor(e, palette?.dark),
              fillOpacity: faded ? 0.18 : 1,
              opacity: faded ? 0.3 : 1,
            }}
            bubblingMouseEvents={false}
            eventHandlers={{
              // Click: the detailed panel (with Join), for the most popular event at this spot.
              click: () => {
                setHoverSpot(null);
                onPin(atSpot.get(e.pos.join())[0]);
              },
              // Hover: a small card above the dot for each event at this spot.
              mouseover: () => {
                keepHover();
                setHoverSpot(e.pos.join());
              },
              mouseout: leaveHover,
            }}
          />
        );
      })}
      {hovered?.length > 0 && (
        <CircleMarker key={`hover|${hoverSpot}`} center={hovered[0].pos} radius={0} stroke={false} fill={false} interactive={false}>
          <Tooltip
            permanent
            interactive
            direction="top"
            offset={[0, -(Math.max(...atSpot.get(hoverSpot).map(dotRadius)) + STEM)]}
            opacity={1}
            className="event-callout"
          >
            <HoverStack
              events={hovered}
              closing={hoverClosing}
              dark={palette?.dark}
              onEnter={keepHover}
              onLeave={leaveHover}
              onPick={(x) => {
                setHoverSpot(null);
                onPin(x);
              }}
            />
          </Tooltip>
        </CircleMarker>
      )}
      <MapClicks onClick={onMapClick} />
      {intro && ready && <IntroLabels places={places} dark={palette?.dark} onDone={endIntro} />}
    </MapContainer>
  );
}

// Events starting within three hours (or on now) keep their building's code plate beside the dot,
// like a sign on the building: one plate per place, brick while something there is on now.
// Each hangs off an invisible point, since a dot's own tooltip is its hover card.

// The hover cards for one spot. Each is a button that opens that event's panel.
function HoverStack({ events, closing, dark, onEnter, onLeave, onPick }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current); // a click here isn't a click on the map
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);
  return (
    <div ref={ref} className={closing ? "callout-stack closing" : "callout-stack"} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {events.map((x, i) => (
        // --i: how far from the dot, so the cards rise one after another, nearest first
        <button key={x.id} type="button" className="callout-pick" style={{ "--i": events.length - 1 - i }} onClick={() => onPick(x)}>
          <EventCallout event={x} dark={dark} />
        </button>
      ))}
    </div>
  );
}

// Line icons for each event type (the callout's icon tile).
const TYPE_ICONS = {
  Study: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",
  Club: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  Food: "M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7",
  Hangout: "M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2",
  "Game night": "M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4a2 2 0 0 1 1.4-.6h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.3a4 4 0 0 0-4-3.7z",
};
const PIN_ICON = "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";

// Club pictures that didn't load, so the cards don't keep asking for them.
const brokenLogos = new Set();

// A card on the map, as in DubHub's cover art: the club's picture (or, if it has none, an icon for
// the kind of event on white), the event's name, and a line under it, with a stem to the dot.
// Hovering a dot shows one (with where it is); so do the soonest events when the site opens.
function EventCallout({ event, title = event.title, sub, dark, flyer = false }) {
  // `flyer` is where the card sits ("above" or "below" its dot) when the event's flyer should show too.
  const [, setBroken] = useState(false);
  const [flyerReady, setFlyerReady] = useState(false);
  const showFlyer = flyer && event.image && !brokenLogos.has(event.image);
  const group = eventGroup(event);
  const code = placeCode(event.where)?.code;
  const logo = event.club?.logo;
  const picture = !code && logo && !brokenLogos.has(logo);
  const line = sub ?? [event.start && formatTime(event.start), event.where ?? hostName(event)].filter(Boolean).join(", ");
  const plate = (
    <div className="callout">
      <span className={code ? "callout-icon callout-code" : "callout-icon"}>
        {code ? (
          <span className={code.length > 4 ? "small" : undefined}>{code}</span>
        ) : picture ? (
          <img
            src={logo}
            alt=""
            decoding="async"
            onError={() => {
              brokenLogos.add(logo);
              setBroken(true);
            }}
          />
        ) : (
          <Icon d={TYPE_ICONS[event.type] ?? PIN_ICON} />
        )}
      </span>
      <span className="callout-text">
        {/* What the dot's color means, so it never rests on color alone */}
        <span className="callout-group">
          <i style={{ background: dark ? group.dark : group.light }} />
          {group.name}
        </span>
        <strong>{title}</strong>
        <span>{line}</span>
      </span>
    </div>
  );
  if (!showFlyer) return plate;
  // The flyer sits on the far side of the plate from the dot, and pops in once it has loaded
  // (a picture that fails just never shows).
  return (
    <div className={flyer === "below" ? "callout-wrap below" : "callout-wrap"}>
      <img
        className={flyerReady ? "callout-flyer ready" : "callout-flyer"}
        src={event.image}
        alt=""
        decoding="async"
        onLoad={() => setFlyerReady(true)}
        onError={() => {
          brokenLogos.add(event.image);
          setBroken(true);
        }}
      />
      {plate}
    </div>
  );
}
