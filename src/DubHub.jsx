import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, CircleMarker, Marker, Popup, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./DubHub.css";

const TABS = ["Home", "Events", "My Events", "Clubs", "About"];

const TYPE_COLORS = {
  Study: "#4b2e83",
  Club: "#c5503a",
  Food: "#d29a00",
  Hangout: "#1f8a70",
  "Game night": "#2e6fbd",
};

const YEARS = ["Freshman", "Sophomore", "Junior", "Senior"];
// Majors grouped by area so the dropdown stays easy to scan.
const MAJOR_GROUPS = {
  Engineering: [
    "Aeronautics & Astronautics",
    "Bioengineering",
    "Chemical Engineering",
    "Civil Engineering",
    "Computer Engineering",
    "Electrical Engineering",
    "Human Centered Design & Engineering",
    "Industrial Engineering",
    "Materials Science",
    "Mechanical Engineering",
  ],
  "Computing & Math": ["Applied Mathematics", "Computer Science", "Informatics", "Mathematics", "Statistics"],
  Sciences: ["Biochemistry", "Biology", "Chemistry", "Environmental Science", "Neuroscience", "Physics"],
  Health: ["Nursing", "Public Health"],
  "Social Sciences": [
    "Anthropology",
    "Economics",
    "International Studies",
    "Political Science",
    "Psychology",
    "Sociology",
  ],
  "Arts & Humanities": ["Art", "Communication", "Design", "English", "History", "Music", "Philosophy"],
  Business: [
    "Accounting",
    "Entrepreneurship",
    "Finance",
    "General Business",
    "Human Resources Management",
    "Information Systems",
    "Management",
    "Marketing",
    "Operations & Supply Chain Management",
  ],
};

// Each major field's color, used on club tags, profile majors and the Major filters.
const FIELD_COLORS = {
  Engineering: "#d9480f",
  "Computing & Math": "#1971c2",
  Sciences: "#2f9e44",
  Health: "#c2255c",
  "Social Sciences": "#7048e8",
  "Arts & Humanities": "#a87400",
  Business: "#0c8599",
};
const MAJOR_FIELDS_ORDER = Object.keys(FIELD_COLORS);
const FIELD_OF_MAJOR = Object.fromEntries(
  Object.entries(MAJOR_GROUPS).flatMap(([field, majors]) => majors.map((m) => [m, field]))
);

// A Major filter choice is a specific major ("Mechanical Engineering") or a whole field ("field:Engineering").
function fieldOf(choice) {
  return choice.startsWith("field:") ? choice.slice(6) : FIELD_OF_MAJOR[choice];
}

// Clubs with no event in this long aren't shown. The scraper already leaves them out of clubs.json;
// this also drops any that age out before the next scrape. Example clubs (no `last_event`) count as active.
const ACTIVE_DAYS = 365;
function isActive(club) {
  if (!("last_event" in club)) return true;
  const cutoff = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString().slice(0, 10);
  return (club.last_event ?? "") >= cutoff;
}

function FieldTag({ field }) {
  const color = FIELD_COLORS[field] ?? "#6a5f85";
  return (
    <span className="tag field-tag" style={{ color, background: `${color}14`, borderColor: `${color}66` }}>
      {field}
    </span>
  );
}

function MajorSelect({ value, onChange, ...props }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      <option>Any major</option>
      {Object.entries(MAJOR_GROUPS).map(([group, majors]) => (
        <optgroup key={group} label={group}>
          <option value={`field:${group}`}>All {group}</option>
          {majors.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Sample events, shown only until the scraper (scraper/) has written public/events.json.
const SAMPLE_EVENTS = [
  { id: 1, title: "Calc III study group", type: "Study", host: "Math Club", where: "Odegaard Library", pos: [47.6563, -122.3105], going: 12, years: ["Sophomore", "Junior"], majors: ["Mathematics"] },
  { id: 2, title: "Board game night", type: "Game night", host: "Husky Gamers", where: "HUB Ballroom", pos: [47.6552, -122.305], going: 28, years: YEARS, majors: [] },
  { id: 3, title: "Dinner on the Ave", type: "Food", host: "Alex T.", where: "University Ave", pos: [47.66, -122.313], going: 6, years: ["Freshman"], majors: [] },
  { id: 4, title: "Intro to ML meeting", type: "Club", host: "Data Science Society", where: "Paul G. Allen Center", pos: [47.6531, -122.3059], going: 41, years: YEARS, majors: ["Computer Science", "Mathematics", "Informatics"] },
  { id: 5, title: "Sunset hangout", type: "Hangout", host: "Jordan K.", where: "Gas Works Park", pos: [47.6456, -122.3344], going: 9, years: ["Junior", "Senior"], majors: [] },
  { id: 6, title: "Coffee and study", type: "Study", host: "Priya S.", where: "Capitol Hill", pos: [47.623, -122.3205], going: 4, years: YEARS, majors: ["Biology"] },
];

// Example clubs, shown only until the scraper (scraper/) has written public/clubs.json.
// `about` is the one-line blurb shown in the list; `description` is the longer text shown
// when you click a club. Scraped clubs also have `handle`, `instagram` and `website` (or null), and may lack `meets`.
const SAMPLE_CLUBS = [
  {
    name: "Math Club",
    category: "Academic",
    about: "Problem sessions, study groups, and talks from math faculty.",
    description:
      "A relaxed community for anyone who likes math, whether you're a major or just curious. Members work through problem sets together, prepare for competitions, and hear guest talks about research and careers. No experience needed, and snacks usually show up.",
    meets: "Tuesdays, Padelford Hall",
  },
  {
    name: "Husky Gamers",
    category: "Gaming",
    about: "Board games, video games, and tournaments for every skill level.",
    description:
      "A friendly space to play games and meet people, from tabletop classics to console and PC tournaments. Beginners are welcome, and each week mixes casual open play with the occasional organized bracket. Bring a game you love or just show up and join a table.",
    meets: "Fridays, HUB",
  },
  {
    name: "Data Science Society",
    category: "Tech",
    about: "Workshops and projects on machine learning and data analysis.",
    description:
      "Hands-on workshops and team projects covering data analysis, visualization, and machine learning. Sessions range from beginner-friendly intros to deeper dives, and members often turn what they learn into portfolio projects. Great for anyone building skills for internships or research.",
    meets: "Wednesdays, Allen Center",
  },
  {
    name: "Husky Hiking Club",
    category: "Outdoors",
    about: "Weekend day hikes and trips around the Cascades.",
    description:
      "Day hikes and weekend trips to trails around Washington, planned for a range of fitness levels. It's an easy way to get off campus, find a ride, and meet people who like being outside. Check each trip's details for distance, difficulty, and what to bring.",
    meets: "Saturdays, meet at Red Square",
  },
  {
    name: "Vietnamese Student Association",
    category: "Cultural",
    about: "Culture nights, food events, and community for Vietnamese students and friends.",
    description:
      "A community for Vietnamese students and anyone interested in the culture. Expect culture nights, shared meals, performances, and casual hangouts that make campus feel more like home. Everyone is welcome, whether or not you have a Vietnamese background.",
    meets: "Thursdays, HUB",
  },
  {
    name: "Pre-Health Society",
    category: "Academic",
    about: "Advising, MCAT prep, and volunteer opportunities for pre-med students.",
    description:
      "Support for students heading toward careers in medicine and health. The club shares advising tips, exam prep resources, and volunteer and shadowing opportunities, and connects you with peers on the same path. Open to all majors on a pre-health track.",
    meets: "Mondays, Mary Gates Hall",
  },
  {
    name: "Husky Coding Club",
    category: "Tech",
    about: "Hackathons, interview practice, and building side projects together.",
    description:
      "A place to build things and get better at programming with other students. Members run hackathons, practice technical interviews, and team up on side projects, with mentors helping newer coders get started. All languages and experience levels are welcome.",
    meets: "Thursdays, CSE2",
  },
  {
    name: "Climbing Club",
    category: "Outdoors",
    about: "Climbing sessions at the IMA wall and trips to local crags.",
    description:
      "Regular climbing sessions at the IMA wall plus trips to outdoor crags around the region. Beginners can learn the basics and borrow gear, while experienced climbers find partners and projects. Safety and a welcoming atmosphere come first.",
    meets: "Tuesdays, IMA",
  },
  {
    name: "Film Society",
    category: "Arts",
    about: "Weekly screenings, discussions, and student film projects.",
    description:
      "Weekly screenings of films from many eras and countries, followed by relaxed discussion. Members also collaborate on student film projects, from writing and shooting to editing. Whether you want to watch, talk, or make, there's a spot for you.",
    meets: "Wednesdays, Kane Hall",
  },
  {
    name: "Entrepreneurship Club",
    category: "Business",
    about: "Startup talks, pitch nights, and networking with founders.",
    description:
      "For students who want to start something or learn how startups work. The club hosts talks from founders, pitch nights where you can test an idea, and networking events with people in the local startup scene. Open to every major, with or without an idea yet.",
    meets: "Mondays, PACCAR Hall",
  },
];

// Team shown on the About page; details load from each GitHub profile. `photo` (a file in
// public/team/) is used instead of the GitHub picture when set.
const TEAM = [
  { name: "Adam Nguyen", github: "adamxlegend" },
  { name: "Quentin Nguyen", github: "nitneuqqq" },
  { name: "Kelan Huynh", github: null, linkedin: "https://www.linkedin.com/in/kelanhuynh", photo: "/team/kelan.jpg" },
];

const JOINED_KEY = "dubhub-joined";
const CLUBS_KEY = "dubhub-clubs";

// A saved list of IDs: event IDs under JOINED_KEY, club names under CLUBS_KEY.
function useJoined(key) {
  const [joined, setJoined] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? [];
    } catch {
      return [];
    }
  });

  const toggle = useCallback((id) => {
    setJoined((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage blocked: joins last for this visit only.
      }
      return next;
    });
  }, [key]);

  return { joined, toggle };
}

// Sign-in uses Google, limited to UW's Google accounts (@uw.edu).
// Set VITE_GOOGLE_CLIENT_ID in .env.local. This check runs in the browser only,
// so a backend must verify the ID token before trusting it for anything important.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const UW_DOMAIN = "uw.edu";
const USER_KEY = "dubhub-user";

function decodeJwt(token) {
  const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function useUser() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  });

  const signIn = useCallback((u) => {
    setUser(u);
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      // Storage blocked: stay signed in for this visit only.
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      // Nothing stored.
    }
    window.google?.accounts.id.disableAutoSelect();
  }, []);

  return { user, signIn, signOut };
}

function useGoogleScript(enabled) {
  const [ready, setReady] = useState(() => Boolean(window.google?.accounts));

  useEffect(() => {
    if (!enabled || ready) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, [enabled, ready]);

  return ready;
}

function SignIn({ user, onSignIn, onSignOut, onOpenProfile }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const buttonRef = useRef(null);
  const ready = useGoogleScript(open && Boolean(GOOGLE_CLIENT_ID));

  useEffect(() => {
    if (!open || !ready || !buttonRef.current) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      hd: UW_DOMAIN,
      callback: ({ credential }) => {
        const p = decodeJwt(credential);
        if (p.hd !== UW_DOMAIN || !p.email_verified) {
          setError("That isn't a UW account. Sign in with your @uw.edu email.");
          return;
        }
        setError("");
        setOpen(false);
        const u = { name: p.name, email: p.email, picture: p.picture };
        onSignIn(u);
        // Also get a DubHub server token (used for email reminders); fine if the server isn't set up.
        fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.token && onSignIn({ ...u, session: d.token }))
          .catch(() => {});
      },
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
    });
  }, [open, ready, onSignIn]);

  if (user) {
    return (
      <div className="user">
        <button className="user-button" onClick={onOpenProfile} title="Your profile">
          {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
          <span>{user.name}</span>
        </button>
        <button className="signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="signin-wrap">
      <button className="signin" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Sign in with UW ID
      </button>
      {open && (
        <div className="signin-pop" role="dialog" aria-label="Sign in">
          {GOOGLE_CLIENT_ID ? (
            <>
              <p>Use your UW Google account (NetID@uw.edu).</p>
              <div ref={buttonRef} />
            </>
          ) : (
            <p>Sign-in isn't set up yet: add VITE_GOOGLE_CLIENT_ID to .env.local.</p>
          )}
          {error && <p className="signin-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

// Loads the scraped clubs; falls back to the examples if there aren't any yet.
function useClubs() {
  const [clubs, setClubs] = useState([]);

  useEffect(() => {
    fetch("/clubs.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => setClubs(d?.clubs?.length ? d.clubs : SAMPLE_CLUBS));
  }, []);

  return clubs;
}

// Loads the scraped events; falls back to the samples if there aren't any yet.
function useEvents() {
  const [data, setData] = useState({ events: [], updated: null });

  useEffect(() => {
    fetch("/events.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => setData(d?.events?.length ? d : { events: SAMPLE_EVENTS, updated: null }));
  }, []);

  return data;
}

// "When" choices: how many days after today each one reaches (rolling, so "This week" is always 7 days).
const WHEN_DAYS = { Today: 0, "This week": 6, "This month": 30, "Any time": null };

// "YYYY-MM-DD" for today plus `days`, in the viewer's own time zone.
function localDate(days = 0) {
  return new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA");
}

function inWhen(event, when) {
  if (WHEN_DAYS[when] == null || !event.date) return true; // sample events have no date
  return event.date >= localDate(0) && event.date <= localDate(WHEN_DAYS[when]);
}

function WhenSelect({ value, onChange, ...props }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {Object.keys(WHEN_DAYS).map((w) => (
        <option key={w}>{w}</option>
      ))}
    </select>
  );
}

// Gives each event `fields`: its own majors' fields (sample events) or its host club's fields.
function withFields(events, clubList) {
  return events.map((e) => ({
    ...e,
    fields: e.majors?.length
      ? [...new Set(e.majors.map((m) => FIELD_OF_MAJOR[m]).filter(Boolean))]
      : clubList.find((c) => isHostedBy(e, c))?.fields ?? [],
  }));
}

// Dots are colored by the event's (first) major field; general-interest events are gray.
const NO_FIELD_COLOR = "#8a8398";
function eventColor(e) {
  return FIELD_COLORS[e.fields?.[0]] ?? NO_FIELD_COLOR;
}

// Scraped events have no class year, so they're open to every year. A major (or field) choice
// shows events in that major's field, e.g. Mechanical Engineering -> Engineering.
function useFilteredEvents(all) {
  const [when, setWhen] = useState("This week");
  const [type, setType] = useState("All");
  const [year, setYear] = useState("All");
  const [major, setMajor] = useState("Any major");

  const events = useMemo(() => {
    const field = major === "Any major" ? null : fieldOf(major);
    return all.filter(
      (e) =>
        inWhen(e, when) &&
        (type === "All" || e.type === type) &&
        (year === "All" || !e.years || e.years.includes(year)) &&
        (!field || e.fields.includes(field))
    );
  }, [all, when, type, year, major]);

  return { events, when, setWhen, type, setType, year, setYear, major, setMajor };
}

function Filters({ f }) {
  const onMap = f.events.filter((e) => e.pos).length;
  return (
    <aside className="filters" aria-label="Event filters">
      <h2>Find something to do</h2>

      <label>
        When
        <WhenSelect value={f.when} onChange={f.setWhen} />
      </label>

      <label>
        Event type
        <select value={f.type} onChange={(e) => f.setType(e.target.value)}>
          <option>All</option>
          {Object.keys(TYPE_COLORS).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>

      <label>
        Class year
        <select value={f.year} onChange={(e) => f.setYear(e.target.value)}>
          <option>All</option>
          {YEARS.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </label>

      <label>
        Major
        <MajorSelect value={f.major} onChange={f.setMajor} />
      </label>
      {f.major !== "Any major" && (
        <p className="count">
          Showing <FieldTag field={fieldOf(f.major)} /> events
        </p>
      )}

      <p className="count">
        {f.events.length === 0 && f.when !== "Any time" ? (
          <>
            Nothing {f.when.toLowerCase()} yet.{" "}
            <button className="link-button" onClick={() => f.setWhen(f.when === "Today" ? "This week" : "Any time")}>
              Show {f.when === "Today" ? "this week" : "any time"}
            </button>
          </>
        ) : (
          <>
            {onMap} event{onMap === 1 ? "" : "s"} on the map
            {f.events.length > onMap && `, ${f.events.length - onMap} more in Events`}
          </>
        )}
      </p>
    </aside>
  );
}

// Map areas from smallest to largest. The map uses the smallest one that fits every event with a
// location, and can't be panned or zoomed out past it; it grows when an event shows up farther out.
const MAP_AREAS = [
  { name: "UW campus", bounds: [[47.6475, -122.3195], [47.662, -122.295]] },
  { name: "University District", bounds: [[47.645, -122.33], [47.676, -122.287]] },
  { name: "North-central Seattle", bounds: [[47.615, -122.365], [47.695, -122.265]] },
  { name: "Seattle", bounds: [[47.48, -122.46], [47.74, -122.22]] },
];

function mapAreaFor(events) {
  const inside = ([lat, lng], [[s, w], [n, e]]) => lat >= s && lat <= n && lng >= w && lng <= e;
  const spots = events.filter((ev) => ev.pos).map((ev) => ev.pos);
  return MAP_AREAS.find((a) => spots.every((p) => inside(p, a.bounds))) ?? MAP_AREAS.at(-1);
}

// Leave room for the filter panel on wide screens.
const panelPadding = (map) => (map.getSize().x > 700 ? [260, 0] : [0, 0]);

// Fits the map to its area and keeps it there (it can't be zoomed out or panned past it).
function MapArea({ area }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds(area.bounds);
    // getBoundsZoom never goes below the current minimum, so clear the old area's limit first.
    map.setMinZoom(0);
    map.setMinZoom(map.getBoundsZoom(bounds));
    map.setMaxBounds(bounds.pad(0.05));
    map.fitBounds(bounds, { paddingTopLeft: panelPadding(map) });
  }, [map, area]);

  return null;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const labelIcons = new Map(); // reuse icons so re-renders don't restart the fade animation
function labelIcon(text, dir) {
  const key = `${dir}|${text}`;
  if (!labelIcons.has(key)) {
    labelIcons.set(key, L.divIcon({ className: "intro-anchor", html: `<span class="intro-label ${dir}">${escapeHtml(text)}</span>`, iconSize: [0, 0] }));
  }
  return labelIcons.get(key);
}

// A label's on-screen width: its text in the label font (bold 13px), plus padding and a small gap.
let measureCtx;
function labelWidth(text) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = `700 13px ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(text).width + 20 + 8;
}

// Event names shown over their dots when the site opens. Each label goes above its dot, or below it
// if that would overlap a label already placed; if neither fits it's skipped (hover still works).
function IntroLabels({ places }) {
  const map = useMap();
  const [, redraw] = useState(0);

  useEffect(() => {
    const update = () => redraw((n) => n + 1);
    map.on("zoomend moveend", update);
    return () => map.off("zoomend moveend", update);
  }, [map]);

  const taken = [];
  const shown = [];
  for (const place of [...places].sort((a, b) => b.count - a.count)) {
    const pt = map.latLngToContainerPoint(place.pos);
    const w = labelWidth(place.text);
    const h = 28;
    for (const dir of ["above", "below"]) {
      const top = dir === "above" ? pt.y - 12 - h : pt.y + 12;
      const box = { l: pt.x - w / 2, r: pt.x + w / 2, t: top, b: top + h };
      if (taken.every((o) => box.r < o.l || box.l > o.r || box.b < o.t || box.t > o.b)) {
        taken.push(box);
        shown.push({ ...place, dir });
        break;
      }
    }
  }

  return shown.map((p) => (
    <Marker key={p.pos.join()} position={p.pos} icon={labelIcon(p.text, p.dir)} interactive={false} keyboard={false} />
  ));
}

function JoinButton({ event, j }) {
  const isJoined = j.joined.includes(event.id);
  return (
    <button className={isJoined ? "join joined" : "join"} aria-pressed={isJoined} onClick={() => j.toggle(event.id)}>
      {isJoined ? "Joined ✓ (leave)" : "Join event"}
    </button>
  );
}

// "12 going", or null for scraped events, which have no real attendance numbers.
function going(event, j) {
  if (event.going == null) return null;
  return `${event.going + (j.joined.includes(event.id) ? 1 : 0)} going`;
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "Thu, Oct 29, 7:00 PM–8:30 PM"
function formatWhen(e) {
  if (!e.date) return null;
  const [y, m, d] = e.date.split("-").map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (!e.start) return day;
  return `${day}, ${formatTime(e.start)}${e.end ? `–${formatTime(e.end)}` : ""}`;
}

function PostLink({ event }) {
  if (!event.url) return null;
  return (
    <a className="post-link" href={event.url} target="_blank" rel="noreferrer">
      {event.source === "huskylink" ? "View on HuskyLink" : "View post"}
    </a>
  );
}

// Google Calendar "add event" link, or null if the event has no date.
// Times are UW (Seattle) time; events with no start time become all-day, and no end means one hour.
function googleCalendarUrl(e) {
  if (!e.date) return null;
  const day = e.date.replaceAll("-", "");
  let dates;
  if (e.start) {
    const [h, m] = e.start.split(":").map(Number);
    const end = e.end ?? `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const stamp = (hhmm) => `${day}T${hhmm.replace(":", "")}00`;
    dates = `${stamp(e.start)}/${stamp(end)}`;
  } else {
    const [y, mo, d] = e.date.split("-").map(Number);
    const next = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10).replaceAll("-", "");
    dates = `${day}/${next}`;
  }
  const details = [e.description?.slice(0, 1500), e.url].filter(Boolean).join("\n\n");
  const params = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates, ctz: "America/Los_Angeles" });
  if (details) params.set("details", details);
  if (e.where) params.set("location", e.where === "Online" ? "Online" : `${e.where}, University of Washington, Seattle`);
  return `https://calendar.google.com/calendar/render?${params}`;
}

function CalendarLink({ event }) {
  const url = googleCalendarUrl(event);
  if (!url) return null;
  return (
    <a className="post-link" href={url} target="_blank" rel="noreferrer">
      Add to Google Calendar
    </a>
  );
}

// Free vector basemap from OpenFreeMap (no API key), drawn with MapLibre inside Leaflet.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Apple Maps-like palette: white roads with gray edges, soft blue water, light green parks.
const MAP_COLORS = {
  background: "#f4f2ee",
  water: "#a6d1f2",
  park: "#b5e0a0",
  wood: "#a6d98f",
  wetland: "#c5e6b4",
  plaza: "#ece9e4",
  building: "#e5e2dc",
  school: "#ece8e1",
  road: "#ffffff",
  highway: "#fdfcfa",
  casing: "#dcd8d1",
  highwayCasing: "#c9c4bb",
};

function restyle(style) {
  const C = MAP_COLORS;
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
    building: { "fill-color": C.building },
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
  // parking "P" signs, and (zoomed all the way in) info points, restrooms and trash cans.
  style.layers = style.layers.filter((layer) => layer.id !== "poi_transit");
  const hidden = ["bus", "parking", "bicycle_parking", "information", "toilets", "waste_basket"];
  const notBusStop = ["!", ["match", ["get", "class"], hidden, true, false]];

  for (const layer of style.layers) {
    if (layer.paint?.["fill-pattern"]) delete layer.paint["fill-pattern"];
    if (/^poi_/.test(layer.id)) layer.filter = ["all", layer.filter, notBusStop];
    const paint = (layer.paint ??= {});
    if (set[layer.id]) {
      Object.assign(paint, set[layer.id]);
    } else if (layer.type === "line" && /^(road|bridge|tunnel)_/.test(layer.id) && !/rail|path/.test(layer.id)) {
      const isHighway = /motorway|trunk/.test(layer.id);
      paint["line-color"] = layer.id.endsWith("casing")
        ? isHighway ? C.highwayCasing : C.casing
        : isHighway ? C.highway : C.road;
    }
  }
  return style;
}

function BaseMap() {
  const map = useMap();

  useEffect(() => {
    let layer;
    let cancelled = false;
    fetch(MAP_STYLE)
      .then((r) => r.json())
      .then((style) => {
        if (cancelled) return;
        layer = L.maplibreGL({ style: restyle(style), attribution: MAP_ATTRIBUTION }).addTo(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

// Hovering a dot opens its pop-up (same as clicking). It stays open while the mouse is on the dot
// or the pop-up, so its buttons can still be clicked, and closes shortly after the mouse leaves.
let popupCloseTimer;
const closeSoon = (layer) => {
  popupCloseTimer = setTimeout(() => layer.closePopup(), 300);
};
const HOVER_POPUP = {
  mouseover: (ev) => {
    clearTimeout(popupCloseTimer);
    ev.target.openPopup();
  },
  mouseout: (ev) => closeSoon(ev.target),
  popupopen: (ev) => {
    const el = ev.popup.getElement();
    el.onmouseenter = () => clearTimeout(popupCloseTimer);
    el.onmouseleave = () => closeSoon(ev.target);
  },
};

function EventMap({ events, area, introLabels, j }) {
  const located = events.filter((e) => e.pos);
  // One intro label per place, so events in the same building don't pile up.
  const byPlace = new Map();
  for (const e of located) byPlace.set(e.pos.join(), [...(byPlace.get(e.pos.join()) ?? []), e]);
  const places = [...byPlace.values()].map((list) => ({
    pos: list[0].pos,
    count: list.length,
    text: list.length > 1 ? `${list[0].title} +${list.length - 1} more` : list[0].title,
  }));

  return (
    <MapContainer
      center={[47.6553, -122.3035]}
      zoom={15}
      maxBoundsViscosity={1}
      scrollWheelZoom
      zoomControl={false}
      className="map"
    >
      <ZoomControl position="topright" />
      <MapArea area={area} />
      <BaseMap />
      {located.map((e) => (
        <CircleMarker
          key={e.id}
          center={e.pos}
          radius={9 + Math.min((e.going ?? 0) / 6, 8)}
          pathOptions={{ color: "#fff", weight: 2, fillColor: eventColor(e), fillOpacity: 0.95 }}
          eventHandlers={HOVER_POPUP}
        >
          <Popup autoPan={false}>
            <strong>{e.title}</strong>
            {[formatWhen(e), e.where, `Hosted by ${e.host}`, going(e, j)].filter(Boolean).map((line) => (
              <div key={line}>{line}</div>
            ))}
            <JoinButton event={e} j={j} /> <PostLink event={e} />
          </Popup>
        </CircleMarker>
      ))}
      {introLabels && <IntroLabels places={places} />}
    </MapContainer>
  );
}

function MapLegend({ events }) {
  const located = events.filter((e) => e.pos);
  const fields = MAJOR_FIELDS_ORDER.filter((field) => located.some((e) => e.fields[0] === field));
  const general = located.some((e) => !e.fields.length);
  if (!fields.length && !general) return null;
  return (
    <ul className="map-legend" aria-label="Dot colors">
      {fields.map((field) => (
        <li key={field}>
          <span className="dot" style={{ background: FIELD_COLORS[field] }} />
          {field}
        </li>
      ))}
      {general && (
        <li>
          <span className="dot" style={{ background: NO_FIELD_COLOR }} />
          General interest
        </li>
      )}
    </ul>
  );
}

function Home({ f, area, introLabels, j }) {
  return (
    <main className="home">
      <EventMap events={f.events} area={area} introLabels={introLabels} j={j} />
      <MapLegend events={f.events} />
      <Filters f={f} />
      <div className="tagline">
        <h1>See what's happening at UW, right now.</h1>
        <p>Study sessions, club meetings, game nights, and dinner plans, all on one map.</p>
      </div>
    </main>
  );
}

function EventTitle({ event, onSelect }) {
  return (
    <button className="club-link" onClick={() => onSelect(event)}>
      {event.title}
    </button>
  );
}

function EventDetail({ event, j, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="club-backdrop" onClick={onClose}>
      <div
        className="club-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="club-close" aria-label="Close" onClick={onClose} autoFocus>
          &times;
        </button>
        <h2 id="event-detail-title">{event.title}</h2>
        <p>
          <span className="tag">{event.type}</span>
        </p>
        <p className="meta">
          {[formatWhen(event), event.where ?? "Location not listed", `Hosted by ${event.host}`, going(event, j)]
            .filter(Boolean)
            .map((line) => (
              <span key={line} className="event-detail-line">
                {line}
              </span>
            ))}
        </p>
        <p className="event-description">{event.description || "No description yet."}</p>
        <p className="club-links">
          <CalendarLink event={event} />
          <PostLink event={event} />
        </p>
        <JoinButton event={event} j={j} />
      </div>
    </div>
  );
}

function EventList({ events, j, onSelect }) {
  return (
    <ul className="list">
      {events.map((e) => (
        <li key={e.id}>
          <span className="dot" style={{ background: eventColor(e) }} />
          <div className="grow">
            <EventTitle event={e} onSelect={onSelect} />
            <div className="meta">
              {[formatWhen(e), e.where ?? "Location not listed", `hosted by ${e.host}`, going(e, j)]
                .filter(Boolean)
                .join(", ")}
            </div>
            <PostLink event={e} />
          </div>
          <JoinButton event={e} j={j} />
        </li>
      ))}
    </ul>
  );
}

// Most popular first by "going" count. Scraped events have no counts yet,
// so they rank after counted events, soonest first.
function trending(events, j, limit = 5) {
  const count = (e) => (e.going == null ? -1 : e.going + (j.joined.includes(e.id) ? 1 : 0));
  const when = (e) => `${e.date ?? "9999"}T${e.start ?? ""}`;
  return [...events].sort((a, b) => count(b) - count(a) || when(a).localeCompare(when(b))).slice(0, limit);
}

function TrendingRow({ events, j, onSelect }) {
  if (events.length === 0) return null;
  return (
    <section className="trending" aria-labelledby="trending-title">
      <h2 id="trending-title">Trending</h2>
      <ol className="trending-row">
        {trending(events, j).map((e) => (
          <li key={e.id} className="trending-card">
            <span className="dot" style={{ background: eventColor(e) }} />
            <EventTitle event={e} onSelect={onSelect} />
            <div className="meta">{[formatWhen(e), e.where, going(e, j)].filter(Boolean).join(" · ")}</div>
            <JoinButton event={e} j={j} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function EventsPage({ events, updated, j, when, onWhenChange }) {
  const [selected, setSelected] = useState(null);
  return (
    <main className="page">
      <div className="page-head">
        <h1>Events</h1>
        <WhenSelect aria-label="When" value={when} onChange={onWhenChange} />
      </div>
      {updated && (
        <p className="count">
          From HuskyLink and club Instagram posts, updated{" "}
          {new Date(updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}
      <TrendingRow events={events} j={j} onSelect={setSelected} />
      <h2>All events</h2>
      <EventList events={events} j={j} onSelect={setSelected} />
      {selected && <EventDetail event={selected} j={j} onClose={() => setSelected(null)} />}
    </main>
  );
}

function ClubJoinButton({ club, clubs }) {
  const isMember = clubs.joined.includes(club.name);
  return (
    <button className={isMember ? "join joined" : "join"} aria-pressed={isMember} onClick={() => clubs.toggle(club.name)}>
      {isMember ? "Member ✓ (leave)" : "Join club"}
    </button>
  );
}

// Scraped events name the host "Club Name (@handle)" or "@handle"; match by handle when we have one.
function isHostedBy(event, club) {
  const host = event.host.toLowerCase();
  if (club.handle && (host === `@${club.handle}` || host.endsWith(`(@${club.handle})`))) return true;
  return event.host === club.name || event.host.startsWith(`${club.name} (@`);
}

function hostedBy(all, club) {
  return all.filter((e) => isHostedBy(e, club));
}

// Events you joined plus every event hosted by a club you're in.
function myEventsFor(all, clubList, j, clubs) {
  const myClubs = clubList.filter((c) => clubs.joined.includes(c.name));
  return all.filter((e) => j.joined.includes(e.id) || myClubs.some((c) => isHostedBy(e, c)));
}

function MyEventsPage({ all, clubList, j, clubs, onBrowse }) {
  const mine = myEventsFor(all, clubList, j, clubs);
  const [selected, setSelected] = useState(null);
  return (
    <main className="page">
      <h1>My Events</h1>
      {clubs.joined.length > 0 && (
        <p className="count">Includes events from your clubs: {clubs.joined.join(", ")}</p>
      )}
      {mine.length > 0 ? (
        <EventList events={mine} j={j} onSelect={setSelected} />
      ) : (
        <div className="empty">
          <p>You haven't joined any events or clubs yet.</p>
          <button className="join" onClick={onBrowse}>
            Browse events
          </button>
        </div>
      )}
      {selected && <EventDetail event={selected} j={j} onClose={() => setSelected(null)} />}
    </main>
  );
}

function ClubDetail({ club, hosted, clubs, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="club-backdrop" onClick={onClose}>
      <div
        className="club-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="club-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="club-close" aria-label="Close" onClick={onClose} autoFocus>
          &times;
        </button>
        <h2 id="club-detail-title">{club.name}</h2>
        <p className="tags">
          <span className="tag">{club.category}</span>
          {club.fields?.map((field) => (
            <FieldTag key={field} field={field} />
          ))}
        </p>
        <p>{club.description || club.about || (club.instagram ? "No description yet. Check their Instagram for more." : "No description yet.")}</p>
        {club.meets && <p className="meta">Meets {club.meets}</p>}
        {(club.website || club.instagram) && (
          <p className="club-links">
            {club.website && (
              <a className="post-link" href={club.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
            {club.instagram && (
              <a className="post-link" href={club.instagram} target="_blank" rel="noreferrer">
                @{club.handle} on Instagram
              </a>
            )}
          </p>
        )}
        <ClubJoinButton club={club} clubs={clubs} />

        <h3>Upcoming events</h3>
        {hosted.length === 0 ? (
          <p className="empty">No upcoming events listed yet.</p>
        ) : (
          <ul className="club-events">
            {hosted.map((e) => (
              <li key={e.id}>
                <strong>{e.title}</strong>
                <div className="meta">{[formatWhen(e), e.where].filter(Boolean).join(", ")}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ClubsPage({ all, clubList, clubs: membership }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [major, setMajor] = useState("Any major");
  const [selected, setSelected] = useState(null);
  const categories = ["All", ...[...new Set(clubList.map((c) => c.category))].sort()];

  const q = query.trim().toLowerCase();
  const field = major === "Any major" ? null : fieldOf(major);
  const clubs = clubList.filter(
    (c) =>
      isActive(c) &&
      (category === "All" || c.category === category) &&
      (!field || c.fields?.includes(field)) &&
      (!q || [c.name, c.handle, c.category, c.about, ...(c.fields ?? [])].some((s) => s?.toLowerCase().includes(q)))
  );

  return (
    <main className="page">
      <h1>Clubs</h1>
      <div className="club-search">
        <input
          type="search"
          placeholder="Search clubs"
          aria-label="Search clubs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <MajorSelect aria-label="Major" value={major} onChange={setMajor} />
      </div>
      <div className="club-options">
        <p className="count">
          {clubs.length} club{clubs.length === 1 ? "" : "s"}
          {field && (
            <>
              {" "}
              in <FieldTag field={field} />
            </>
          )}
        </p>
      </div>
      <ul className="list">
        {clubs.map((c) => {
          const upcoming = hostedBy(all, c).length;
          return (
            <li key={c.name}>
              <div className="grow">
                <button className="club-link" onClick={() => setSelected(c)}>
                  {c.name}
                  <span className="club-hint"> View details &rarr;</span>
                </button>{" "}
                <span className="tag">{c.category}</span>{" "}
                {c.fields?.map((f) => (
                  <FieldTag key={f} field={f} />
                ))}
                {c.about && <div>{c.about}</div>}
                <div className="meta">
                  {[
                    c.meets && `Meets ${c.meets}`,
                    c.handle && c.name !== `@${c.handle}` && `@${c.handle}`,
                    upcoming > 0 && `${upcoming} upcoming event${upcoming === 1 ? "" : "s"}`,
                    !upcoming && c.last_event && `Last event ${formatWhen({ date: c.last_event })}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
                {c.website && (
                  <a className="post-link" href={c.website} target="_blank" rel="noreferrer">
                    Website
                  </a>
                )}
              </div>
              <ClubJoinButton club={c} clubs={membership} />
            </li>
          );
        })}
      </ul>
      {clubs.length === 0 && <p className="empty">No clubs match "{query}".</p>}

      {selected && (
        <ClubDetail
          club={selected}
          hosted={hostedBy(all, selected)}
          clubs={membership}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

// Each signed-in account gets its own profile on this device: { year, majors, phone, sms }.
const PROFILE_KEY = "dubhub-profile";
const MAX_MAJORS = 3;
const EMPTY_PROFILE = { year: "", majors: [], phone: "", sms: false };

function loadProfile(email) {
  try {
    return { ...EMPTY_PROFILE, ...JSON.parse(localStorage.getItem(`${PROFILE_KEY}:${email}`)) };
  } catch {
    return EMPTY_PROFILE;
  }
}

// "(206) 555-0123", "206.555.0123" or "+1 206 555 0123" -> "2065550123"; null if not a US number.
function phoneDigits(text) {
  let d = (text || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

function useProfile(user) {
  const [profiles, setProfiles] = useState({});
  const profile = user ? profiles[user.email] ?? loadProfile(user.email) : null;

  const update = useCallback(
    (changes) => {
      if (!user) return;
      const next = { ...(profiles[user.email] ?? loadProfile(user.email)), ...changes };
      setProfiles((p) => ({ ...p, [user.email]: next }));
      try {
        localStorage.setItem(`${PROFILE_KEY}:${user.email}`, JSON.stringify(next));
      } catch {
        // Storage blocked: the profile lasts for this visit only.
      }
    },
    [user, profiles]
  );

  return { profile, update };
}

// Morning email reminders, stored on the server (api/). status: "loading" | "on" | "off" |
// "needs-signin" (signed in before reminders existed, so no server token) | "unavailable".
function useEmailReminders(user, myEvents) {
  const session = user?.session;
  const [state, setState] = useState({ session: null, status: "loading", error: "" });
  const current = state.session === session ? state : { session, status: "loading", error: "" };
  const status = !user ? "off" : !session ? "needs-signin" : current.status;

  const call = useCallback(
    (method, body) =>
      fetch("/api/reminders", {
        method,
        headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
        body: body && JSON.stringify(body),
      }).then(async (r) => {
        if (r.status === 401) return { status: "needs-signin" };
        if (!r.ok) return { status: "unavailable" };
        const d = await r.json();
        return { status: d.enabled ? "on" : "off" };
      }),
    [session]
  );

  // Ask the server whether reminders are on (they can be turned off from an email's link).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    call("GET")
      .catch(() => ({ status: "unavailable" }))
      .then((s) => !cancelled && setState({ session, error: "", ...s }));
    return () => {
      cancelled = true;
    };
  }, [session, call]);

  // Only the fields the email needs.
  const snapshot = JSON.stringify(
    myEvents.map(({ id, title, date, start, end, where, host, url }) => ({ id, title, date, start, end, where, host, url }))
  );

  // Keep the server's copy of My Events up to date while reminders are on.
  useEffect(() => {
    if (status !== "on") return;
    const t = setTimeout(() => call("POST", { events: JSON.parse(snapshot) }).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [status, snapshot, call]);

  const setEnabled = (enabled) => {
    setState({ session, status: "loading", error: "" });
    call("POST", { enabled, events: JSON.parse(snapshot) })
      .catch(() => ({ status: enabled ? "off" : "on", error: "Couldn't reach DubHub. Try again." }))
      .then((s) => setState({ session, error: "", ...s }));
  };

  return { status, error: current.error, setEnabled };
}

function ProfilePage({ user, profile, onChange, clubList, clubs, j, email }) {
  if (!user) {
    return (
      <main className="page">
        <h1>Your profile</h1>
        <p className="empty">Sign in with your UW ID (top right) to set up your profile.</p>
      </main>
    );
  }

  const myClubs = clubList.filter((c) => clubs.joined.includes(c.name));
  const addMajor = (m) => m && onChange({ majors: [...profile.majors, m] });
  const removeMajor = (m) => onChange({ majors: profile.majors.filter((x) => x !== m) });

  return (
    <main className="page">
      <div className="profile-head">
        {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
        <div>
          <h1>{user.name}</h1>
          <div className="meta">{user.email}</div>
        </div>
      </div>

      <h2>About you</h2>
      <div className="profile-form">
        <label>
          Class year
          <select value={profile.year} onChange={(e) => onChange({ year: e.target.value })}>
            <option value="">Choose your year</option>
            {YEARS.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>

        <div className="profile-field">
          <span id="majors-label">Majors {profile.majors.length > 0 && `(${profile.majors.length}/${MAX_MAJORS})`}</span>
          {profile.majors.length > 0 && (
            <ul className="chips" aria-labelledby="majors-label">
              {profile.majors.map((m) => (
                <li
                  key={m}
                  className="chip"
                  title={FIELD_OF_MAJOR[m]}
                  style={FIELD_COLORS[FIELD_OF_MAJOR[m]] && {
                    color: FIELD_COLORS[FIELD_OF_MAJOR[m]],
                    background: `${FIELD_COLORS[FIELD_OF_MAJOR[m]]}14`,
                  }}
                >
                  {m}
                  <button aria-label={`Remove ${m}`} onClick={() => removeMajor(m)}>
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
          {profile.majors.length < MAX_MAJORS && (
            <select aria-labelledby="majors-label" value="" onChange={(e) => addMajor(e.target.value)}>
              <option value="">{profile.majors.length ? "Add another major" : "Add a major"}</option>
              {Object.entries(MAJOR_GROUPS).map(([group, majors]) => (
                <optgroup key={group} label={group}>
                  {majors
                    .filter((m) => !profile.majors.includes(m))
                    .map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
        <p className="count">Saved automatically on this device.</p>
      </div>

      <h2>Notifications</h2>
      <div className="profile-form">
        <label className="check">
          <input
            type="checkbox"
            checked={email.status === "on"}
            disabled={email.status !== "on" && email.status !== "off"}
            onChange={(e) => email.setEnabled(e.target.checked)}
          />
          Email me reminders for my events
        </label>
        <p className="count">
          A morning email to {user.email} on days you have something in My Events (today and tomorrow).
        </p>
        {email.status === "needs-signin" && (
          <p className="notice">Sign out and sign back in to turn on email reminders.</p>
        )}
        {email.status === "unavailable" && (
          <p className="notice">Email reminders aren't set up on the server yet.</p>
        )}
        {email.error && <p className="field-error">{email.error}</p>}
      </div>

      <div className="profile-form">
        <label>
          Phone number
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(206) 555-0123"
            value={profile.phone}
            onChange={(e) => onChange({ phone: e.target.value, ...(phoneDigits(e.target.value) ? {} : { sms: false }) })}
          />
        </label>
        {profile.phone && !phoneDigits(profile.phone) && (
          <p className="field-error">Enter a 10-digit US phone number.</p>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={profile.sms}
            disabled={!phoneDigits(profile.phone)}
            onChange={(e) => onChange({ sms: e.target.checked })}
          />
          Text me reminders for events I join
        </label>
        <p className="count">
          By checking this box, you agree to receive text messages from DubHub about events you join. Message
          frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.
        </p>
        <p className="notice">Text reminders are coming soon. We aren't sending texts yet.</p>
      </div>

      <h2>Your clubs</h2>
      {myClubs.length > 0 ? (
        <ul className="chips">
          {myClubs.map((c) => (
            <li key={c.name} className="chip">
              {c.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">You haven't joined any clubs yet.</p>
      )}
      <p className="meta">
        {j.joined.length} event{j.joined.length === 1 ? "" : "s"} joined
      </p>
    </main>
  );
}

function useGitHubProfile(login) {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!login) return;
    let cancelled = false;
    fetch(`https://api.github.com/users/${login}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => !cancelled && setProfile(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [login]);

  return profile;
}

function TeamMember({ name, github, linkedin, photo }) {
  const p = useGitHubProfile(github);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("");
  const picture = photo || (github && `https://github.com/${github}.png?size=160`);

  return (
    <li className="member">
      {picture ? <img src={picture} alt="" /> : <span className="avatar">{initials}</span>}
      <div>
        <strong>{name}</strong>
        {p?.bio && <div>{p.bio}</div>}
        <div className="meta">
          {[p?.location, p && `${p.public_repos} public repo${p.public_repos === 1 ? "" : "s"}`].filter(Boolean).join(", ")}
        </div>
        {github && (
          <a href={`https://github.com/${github}`} target="_blank" rel="noreferrer">
            @{github} on GitHub
          </a>
        )}
        {linkedin && (
          <a href={linkedin} target="_blank" rel="noreferrer">
            {name.split(" ")[0]} on LinkedIn
          </a>
        )}
      </div>
    </li>
  );
}

function AboutPage() {
  return (
    <main className="page">
      <h1>About DubHub</h1>
      <p>
        DubHub is a map of what UW students are doing. Post an event, pick who can see it by class year or major, and
        join one to get added to its group chat.
      </p>
      <p>Sign in with your UW ID so everyone on the map is a real student.</p>
      <h2>Made by</h2>
      <ul className="team">
        {TEAM.map((m) => (
          <TeamMember key={m.name} {...m} />
        ))}
      </ul>
    </main>
  );
}

export default function DubHub() {
  const [tab, setTab] = useState("Home");
  const { events: loaded, updated } = useEvents();
  const clubList = useClubs();
  const all = useMemo(() => withFields(loaded, clubList), [loaded, clubList]);
  const f = useFilteredEvents(all);
  // Event names flash over their dots for a few seconds when the site first opens.
  const [introLabels, setIntroLabels] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntroLabels(false), 5000);
    return () => clearTimeout(t);
  }, []);
  // Based on every event, not just the filtered ones, so the map doesn't jump around while filtering.
  const mapArea = useMemo(() => mapAreaFor(all), [all]);
  const { user, signIn, signOut } = useUser();
  const { profile, update: updateProfile } = useProfile(user);
  const j = useJoined(JOINED_KEY);
  const clubs = useJoined(CLUBS_KEY);
  const myEvents = useMemo(() => myEventsFor(all, clubList, j, clubs), [all, clubList, j, clubs]);
  const email = useEmailReminders(user, myEvents);

  return (
    <div className="app">
      <header className="nav">
        <button className="logo" onClick={() => setTab("Home")}>
          DubHub
        </button>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "tab active" : "tab"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <SignIn user={user} onSignIn={signIn} onSignOut={signOut} onOpenProfile={() => setTab("Profile")} />
      </header>

      {tab === "Home" && <Home f={f} area={mapArea} introLabels={introLabels} j={j} />}
      {tab === "Events" && (
        <EventsPage events={f.events} updated={updated} j={j} when={f.when} onWhenChange={f.setWhen} />
      )}
      {tab === "My Events" && (
        <MyEventsPage all={all} clubList={clubList} j={j} clubs={clubs} onBrowse={() => setTab("Events")} />
      )}
      {tab === "Clubs" && <ClubsPage all={all} clubList={clubList} clubs={clubs} />}
      {tab === "About" && <AboutPage />}
      {tab === "Profile" && (
        <ProfilePage
          user={user}
          profile={profile}
          onChange={updateProfile}
          clubList={clubList}
          clubs={clubs}
          j={j}
          email={email}
        />
      )}
    </div>
  );
}