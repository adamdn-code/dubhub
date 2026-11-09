import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, CircleMarker, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./DubHub.css";
import { APPLY_YEARS, FILE_ACCEPT, FILE_LIMITS, JOBS, SAMPLE_JOBS } from "./jobs.js";
import { CATEGORY_GROUPS, NO_FIELD_COLOR, OTHER_GROUP, groupFor, isHostedBy } from "./eventGroups.js";

const TABS = ["Events", "Home", "My Events", "Clubs", "About"];

// Outline icons (24x24) for the tab bar; on phones the tabs move to the bottom with these.
const TAB_ICONS = {
  Home: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  Events: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  "My Events": "M6 3h12v18l-6-4-6 4z",
  Clubs: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6v1",
  About: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01",
  Stats: "M4 20V11M10 20V5M16 20v-6M2 20h20",
  Hiring: "M3 7h18v13H3zM8 7V4h8v3M3 12h18",
};

// What each tab is called on screen ("Home" is the map).
const TAB_LABELS = { Events: "Now", Home: "Map" };

function Icon({ d }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d={d} />
    </svg>
  );
}

const CLOSE_ICON = "M6 6l12 12M18 6 6 18";
const CHECK_ICON = "M4.5 12.5l5 5L19.5 7";
const BACK_ICON = "M15 5l-7 7 7 7";
const SHARE_ICON = "M12 3v12M7 8l5-5 5 5M5 14v7h14v-7";
const PLUS_ICON = "M12 5v14M5 12h14";
const SUN_ICON = "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";
const MOON_ICON = "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z";

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
const CODE_AT_START = /^([A-Z]{2,5}\d?)(?:\s+(\w*\d\w*))?\b/;

// { code, rest }: "HUB 314" -> { code: "HUB", room: "314" }; "Mary Gates Hall" -> { code: "MGH" }.
function placeCode(where) {
  if (!where || where === "Online") return null;
  const m = where.match(CODE_AT_START);
  if (m && m[1] !== "UW") return { code: m[1], room: m[2] ?? null };
  const lower = where.toLowerCase();
  const hit = BUILDING_CODES.find(([name]) => new RegExp(`\\b${name.replace("/", "\\/")}\\b`).test(lower));
  if (!hit?.[1]) return null;
  const room = where.match(/\b(\d{2,4}[A-Z]?)\b/)?.[1] ?? null;
  return { code: hit[1], room };
}

// A building-code plate, like the ones on campus signs: "MGH 241". Nothing for places with no code.
function Plate({ where, size }) {
  const p = placeCode(where);
  if (!p) return null;
  return (
    <span className={size ? `plate plate-${size}` : "plate"} title={where}>
      {p.code}
      {p.room && <span className="plate-room">{p.room}</span>}
    </span>
  );
}

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

// "Data Science Society" -> "DS", "@uwetruck" -> "U".
function initials(name) {
  const words = (name || "").replace(/^@/, "").split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
}

// An event photo or club logo, or (if there isn't one, or it fails to load) a colored tile with initials.
function Thumb({ src, label, color, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img className={`thumb ${className}`} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    );
  }
  return (
    <span className={`thumb thumb-fallback ${className}`} style={{ background: color }} aria-hidden="true">
      {initials(label)}
    </span>
  );
}

function clubColor(club) {
  return FIELD_COLORS[club.fields?.[0]] ?? "#4b2e83";
}

function FieldTag({ field }) {
  const color = FIELD_COLORS[field] ?? "#6a5f85";
  return (
    <span className="tag field-tag" style={{ "--tag": color }}>
      {field}
    </span>
  );
}

// The filters pick a whole field ("Engineering"), since events and clubs are sorted by field, not
// by single major. The profile page still lets you pick your specific majors.
function MajorSelect({ value, onChange, ...props }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      <option>Any major</option>
      {MAJOR_FIELDS_ORDER.map((field) => (
        <option key={field} value={`field:${field}`}>
          {field}
        </option>
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
  // No GitHub profile photo yet (GitHub would show a pattern), so initials until a photo is added.
  { name: "Adam Nguyen", role: "Cofounder @ DubHub", github: "adamdn-code", githubPhoto: false },
  { name: "Quentin Nguyen", role: "Cofounder @ DubHub", github: "nitneuqqq" },
  {
    name: "Abdulsemed Abdulsemed",
    role: "Head of Engineering, Information School at the University of Washington",
    github: null,
    linkedin: "https://www.linkedin.com/in/abdulsemedabdulsemed/",
    photo: "/team/abdulsemed.jpg",
  },
  {
    name: "Kelan Huynh",
    role: "Ambassador, Corporate Banking Club at the University of Washington",
    github: null,
    linkedin: "https://www.linkedin.com/in/kelanhuynh",
    photo: "/team/kelan.jpg",
  },
  {
    name: "Jenny Vong",
    role: "Ambassador, Informatics at the University of Washington",
    github: null,
    linkedin: "https://www.linkedin.com/in/jenny-vong-2597553b2",
    photo: "/team/jenny.jpg",
  },
  {
    name: "Vincent Le",
    role: "Ambassador, Foster School of Business at the University of Washington",
    github: null,
    linkedin: "https://www.linkedin.com/in/vincenthoanvinhle/",
    photo: "/team/vincent.jpg",
  },
  {
    // No photo yet, so his initials show; add public/team/leonardo.jpg and a `photo` line for one.
    name: "Leonardo Escobar",
    role: "Ambassador, University of Nevada, Las Vegas",
    github: null,
    linkedin: "https://www.linkedin.com/in/leonardo-nanez-escobar-628ba3449/",
  },
  {
    name: "Claude",
    role: "AI Intern @ DubHub",
    note: "Wrote a suspicious amount of this website. Paid entirely in tokens. Has never been to Red Square.",
    github: null,
    secret: true, // invisible until you hover over (or tap) its spot
  },
];

const THEME_KEY = "dubhub-theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

// Light or dark. Follows the device until someone flips the switch in the top bar, which is then
// remembered in this browser. Sets <html data-theme>, which DubHub.css reads; MAP_PALETTES has
// each one's map. (Older picks like "sunset" from the retired themes fall back to the device.)
const THEMES = [
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

function useTheme() {
  const [choice, setChoice] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEMES.some((t) => t.id === saved) ? saved : null;
    } catch {
      return null;
    }
  });
  const [deviceDark, setDeviceDark] = useState(() => darkQuery().matches);

  useEffect(() => {
    const q = darkQuery();
    const onChange = (e) => setDeviceDark(e.matches);
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (choice) document.documentElement.dataset.theme = choice;
    else delete document.documentElement.dataset.theme;
  }, [choice]);

  const pick = (id) => {
    setChoice(id);
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      // Private browsing can block storage; the choice still lasts until the page closes.
    }
  };
  return { theme: choice ?? (deviceDark ? "dark" : "light"), pick };
}

// The top-bar light/dark switch: shows the mode you'd switch to.
function ThemeToggle({ theme, onPick }) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className="theme-toggle" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => onPick(next)}>
      <Icon d={next === "dark" ? MOON_ICON : SUN_ICON} />
    </button>
  );
}

const OLD_JOINED_KEY = "dubhub-joined"; // Joins from before sign-in was required (moved to the server)

// Reads and clears that old list.
function readOldJoins() {
  try {
    const old = JSON.parse(localStorage.getItem(OLD_JOINED_KEY)) ?? [];
    localStorage.removeItem(OLD_JOINED_KEY);
    return Array.isArray(old) ? old : [];
  } catch {
    return [];
  }
}
const CLUBS_KEY = "dubhub-clubs";

// A saved list of IDs (club names under CLUBS_KEY).
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

// Who's going to each event, and which events you joined. Joining needs a UW sign-in: your Joins
// are saved on the server under your account (so they follow you to any device), and signed out,
// Join doesn't change anything; it sends you to the sign-in page instead (`onNeedSignIn`).
function useGoing(user, events, onNeedSignIn) {
  const [names, setNames] = useState({});
  // Your joined event ids, tagged with the login they belong to, so a different account (or
  // signing out) never shows someone else's.
  const [mine, setMine] = useState({ token: null, ids: [] });
  const ids = useMemo(() => events.map((e) => e.id).join(","), [events]);

  useEffect(() => {
    let cancelled = false;
    const list = ids ? ids.split(",") : [];
    for (let i = 0; i < list.length; i += 100) {
      fetch(`/api/going?ids=${encodeURIComponent(list.slice(i, i + 100).join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && d?.going && setNames((n) => ({ ...n, ...d.going })))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [ids]);

  // A token the server turned down (expired) counts as signed out until the next sign-in.
  const [rejected, setRejected] = useState(null);
  const token = user?.token && user.token !== rejected ? user.token : null;
  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Your joined events, from the server.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/going?mine=1", { headers: auth })
      .then((r) => {
        if (r.status === 401) setRejected(token);
        return r.ok ? r.json() : null;
      })
      // Merged with any Join made while this was loading (it's on its way to the server).
      .then((d) => !cancelled && d?.ids && setMine((m) => ({ token, ids: [...new Set([...d.ids, ...(m.token === token ? m.ids : [])])] })))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, auth]);

  // Joins saved in this browser before sign-in was required: add the upcoming ones to your
  // account once, then forget the old list.
  useEffect(() => {
    if (!token || !ids) return;
    const old = readOldJoins();
    const upcoming = new Set(ids.split(","));
    for (const id of old.filter((x) => upcoming.has(String(x)))) {
      fetch("/api/going", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ eventId: String(id), going: true }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setNames((n) => ({ ...n, [id]: d.going }));
          setMine((m) => ({ token, ids: [...new Set([...(m.token === token ? m.ids : []), String(id)])] }));
        })
        .catch(() => {});
    }
  }, [token, ids, auth]);

  const setGoing = useCallback(
    (id, going) => {
      if (!token) return onNeedSignIn(going ? id : null);
      const update = (list) => (going ? [...new Set([...list, String(id)])] : list.filter((x) => x !== String(id)));
      setMine((m) => ({ token, ids: update(m.token === token ? m.ids : []) }));
      fetch("/api/going", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ eventId: String(id), going }),
      })
        .then((r) => {
          if (r.status === 401) {
            setRejected(token); // the login expired: undo, and sign in again
            setMine((m) => ({ ...m, ids: m.ids.filter((x) => x !== String(id)) }));
            onNeedSignIn(going ? id : null);
          }
          return r.ok ? r.json() : null;
        })
        .then((d) => d && setNames((n) => ({ ...n, [id]: d.going })))
        .catch(() => {});
    },
    [token, auth, onNeedSignIn]
  );

  const joined = useMemo(() => (token && mine.token === token ? mine.ids : []), [token, mine]);
  const toggle = useCallback((id) => setGoing(id, !joined.includes(String(id))), [setGoing, joined]);
  return { joined, toggle, join: (id) => setGoing(id, true), names, signedIn: Boolean(token) };
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

// Whether you're one of DubHub's moderators (MODERATOR_EMAILS on the server), who see the Stats
// tab and job applications. Asked once per sign-in.
function useModerator(user) {
  const token = user?.token;
  const [state, setState] = useState({ token: null, moderator: false });
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/session", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setState({ token, moderator: d?.moderator === true }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);
  return Boolean(token) && state.token === token && state.moderator;
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

// The UW Google sign-in button. On success it checks the sign-in with DubHub's server, which
// returns a token for RSVPs, and calls onSignIn with the user (token included).
function GoogleSignIn({ onSignIn }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef(null);
  const ready = useGoogleScript(Boolean(GOOGLE_CLIENT_ID));

  useEffect(() => {
    if (!ready || !buttonRef.current) return;
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
        setBusy(true);
        fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d?.token) throw new Error("no token");
            onSignIn({ name: p.name, email: p.email, picture: p.picture, token: d.token });
          })
          .catch(() => setError("Couldn't finish signing in. Please try again in a moment."))
          .finally(() => setBusy(false));
      },
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: 280,
    });
  }, [ready, onSignIn]);

  if (!GOOGLE_CLIENT_ID) return <p className="signin-error">Sign-in isn't set up yet: add VITE_GOOGLE_CLIENT_ID to .env.local.</p>;
  return (
    <>
      <div ref={buttonRef} className="google-button" />
      {busy && <p className="meta">Signing you in…</p>}
      {error && <p className="signin-error">{error}</p>}
    </>
  );
}

// Top-right corner: "Sign in" (opens the sign-in page), or your name and Sign out.
function Account({ user, onOpenSignIn, onSignOut, onOpenProfile }) {
  if (!user) {
    return (
      <button className="signin" onClick={onOpenSignIn}>
        Sign in<span className="wide-only"> with UW ID</span>
      </button>
    );
  }
  return (
    <div className="user">
      <button className="user-button" onClick={onOpenProfile} title="Your profile">
        {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
        <span className="wide-only">{user.name}</span>
      </button>
      <button className="signout wide-only" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

// The sign-in page. Join sends signed-out visitors here; after signing in they go back to where
// they were, and the event they tried to join is joined.
function SignInPage({ user, pendingEvent, pendingJob, onSignIn, onBack }) {
  const stale = user && !user.token; // signed in before RSVPs existed, or the login expired
  return (
    <main className="page signin-page">
      <div className="signin-card">
        <h1>{stale ? "Sign in again" : "Sign in to DubHub"}</h1>
        {pendingJob ? (
          <p className="signin-reason">
            Sign in to apply for <strong>{pendingJob.title}</strong>.
          </p>
        ) : pendingEvent ? (
          <p className="signin-reason">
            Sign in to say you're going to <strong>{pendingEvent.title}</strong>.
          </p>
        ) : (
          <p className="signin-reason">Sign in to mark the events you're going to and see who else is going.</p>
        )}
        {pendingJob ? (
          <ul className="signin-perks">
            <li>Apply with your UW account, no new password</li>
            <li>See which roles you've applied for</li>
            <li>We'll reply to your UW email</li>
          </ul>
        ) : (
          <ul className="signin-perks">
            <li>Events you're going to collect in My Events</li>
            <li>Friends see you're going (as first name and last initial)</li>
            <li>Your events follow you to any device</li>
          </ul>
        )}
        <GoogleSignIn onSignIn={onSignIn} />
        <p className="meta">UW accounts only (NetID@uw.edu).</p>
        <button className="link-button" onClick={onBack}>
          <Icon d={BACK_ICON} /> Back
        </button>
      </div>
    </main>
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

// Open club applications the scraper found in Instagram posts (scraper/events_common.py).
function useApplications() {
  const [apps, setApps] = useState([]);
  useEffect(() => {
    fetch("/applications.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => setApps(d?.applications ?? []));
  }, []);
  return apps;
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

  // events.json only refreshes when a scraper runs, so hide events whose day has passed.
  const today = new Date().toLocaleDateString("en-CA");
  const events = useMemo(() => data.events.filter((e) => !e.date || e.date >= today), [data.events, today]);
  return { events, updated: data.updated };
}

// "When" choices: how many days after today each one reaches (rolling, so "This week" is always 7 days).
const WHEN_DAYS = { Today: 0, "This week": 6, "This month": 30, "Any time": null };
const DEFAULT_WHEN = "This week";

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

// Gives each event its host `club` (when it's a known club) and `fields`: its own majors'
// fields (sample events) or its host club's fields.
function withFields(events, clubList) {
  return events.map((e) => {
    const club = clubList.find((c) => isHostedBy(e, c));
    return {
      ...e,
      club,
      fields: e.majors?.length
        ? [...new Set(e.majors.map((m) => FIELD_OF_MAJOR[m]).filter(Boolean))]
        : club?.fields ?? [],
    };
  });
}

// "Product Space @ UW (@uwproductspace)" -> "Product Space @ UW"; "@vsauw" stays as is.
function hostName(event) {
  return event.club?.name ?? event.host.replace(/\s*\(@[\w.]+\)$/, "");
}

// The first couple of sentences of a description, for small spaces like the map pop-up.
function shortText(text, max = 150) {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

// Dots are colored by the host club's group (src/eventGroups.js has the groups and their colors).
function eventGroup(e) {
  return groupFor(e.club?.category, e.fields?.[0]);
}

// `dark`: the color for a dark map (MAP_PALETTES' `dark`).
function eventColor(e, dark = false) {
  const g = eventGroup(e);
  return dark ? g.dark : g.light;
}

// "Club type" choices: the categories of clubs hosting events, Greek Life first (fraternity and
// sorority events are a big part of campus life), then the rest by how many events they have.
const ALL_CLUBS = "All clubs";
function clubTypesOf(events) {
  const counts = {};
  for (const e of events) if (e.club?.category) counts[e.club.category] = (counts[e.club.category] ?? 0) + 1;
  return Object.keys(counts).sort(
    (a, b) => (b === "Greek Life") - (a === "Greek Life") || counts[b] - counts[a] || a.localeCompare(b)
  );
}

// Scraped events have no class year, so they're open to every year. A major (or field) choice
// shows events in that major's field, e.g. Mechanical Engineering -> Engineering.
function useFilteredEvents(all) {
  const [when, setWhen] = useState(DEFAULT_WHEN);
  const [type, setType] = useState("All");
  const [year, setYear] = useState("All");
  const [major, setMajor] = useState("Any major");
  const [club, setClub] = useState(ALL_CLUBS);
  const clubTypes = useMemo(() => clubTypesOf(all), [all]);

  const events = useMemo(() => {
    const field = major === "Any major" ? null : fieldOf(major);
    return all.filter(
      (e) =>
        inWhen(e, when) &&
        (type === "All" || e.type === type) &&
        (year === "All" || !e.years || e.years.includes(year)) &&
        (!field || e.fields.includes(field)) &&
        (club === ALL_CLUBS || e.club?.category === club)
    );
  }, [all, when, type, year, major, club]);

  return { events, when, setWhen, type, setType, year, setYear, major, setMajor, club, setClub, clubTypes };
}

function Filters({ f }) {
  return (
    <aside className="filters" aria-label="Event filters">
      <h2>Filter the map</h2>

      <div className="filter-grid">
        <label>
          <span className="filter-label">When</span>
          <WhenSelect value={f.when} onChange={f.setWhen} className={f.when !== DEFAULT_WHEN ? "set" : undefined} />
        </label>

        <label>
          <span className="filter-label">Event type</span>
          <select value={f.type} onChange={(e) => f.setType(e.target.value)} className={f.type !== "All" ? "set" : undefined}>
            <option value="All">All types</option>
            {Object.keys(TYPE_COLORS).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="filter-label">Class year</span>
          <select value={f.year} onChange={(e) => f.setYear(e.target.value)} className={f.year !== "All" ? "set" : undefined}>
            <option value="All">All years</option>
            {YEARS.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="filter-label">Major</span>
          <MajorSelect value={f.major} onChange={f.setMajor} className={f.major !== "Any major" ? "set" : undefined} />
        </label>

        <label className="filter-wide">
          <span className="filter-label">Club type</span>
          <select value={f.club} onChange={(e) => f.setClub(e.target.value)} className={f.club !== ALL_CLUBS ? "set" : undefined}>
            <option>{ALL_CLUBS}</option>
            {f.clubTypes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {f.major !== "Any major" && (
        <p className="count">
          Showing <FieldTag field={fieldOf(f.major)} /> events
        </p>
      )}

      {/* Only when the filters hide everything: a nudge to look further ahead. */}
      {f.events.length === 0 && f.when !== "Any time" && (
        <p className="count">
          Nothing {f.when.toLowerCase()} yet.{" "}
          <button className="link-button" onClick={() => f.setWhen(f.when === "Today" ? "This week" : "Any time")}>
            Show {f.when === "Today" ? "this week" : "any time"}
          </button>
        </p>
      )}
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
let measureCtx;
function calloutSize(title, sub, group) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const font = getComputedStyle(document.body).fontFamily;
  measureCtx.font = `700 14px ${font}`;
  const titleW = measureCtx.measureText(title).width;
  measureCtx.font = `12px ${font}`;
  const subW = measureCtx.measureText(sub).width;
  measureCtx.font = `700 10.5px ${font}`;
  const groupW = measureCtx.measureText(group.toUpperCase()).width + group.length * 0.6 + 13; // spacing, dot
  const wraps = CALLOUT_CHROME + titleW > CALLOUT_MAX;
  return { w: Math.min(CALLOUT_MAX, CALLOUT_CHROME + Math.max(titleW, subW, groupW)), h: wraps ? CARD_H + 17 : CARD_H };
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

// At most this many cards when the site opens, the soonest events first, so the map isn't buried.
const MAX_INTRO_LABELS = 5;

// The cards over the dots when the site opens (then they fade away). Each goes above its dot, or
// below it if that would cover another card, a labeled dot, or the filters, or run off the map; if
// neither fits it's skipped (hovering the dot still shows its card).
function IntroLabels({ places, dark }) {
  const map = useMap();
  const [, redraw] = useState(0);

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
    const { w, h } = calloutSize(place.title, place.sub, eventGroup(place.event).name);
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
        <EventCallout event={p.event} title={p.title} sub={p.sub} dark={dark} />
      </Tooltip>
    </CircleMarker>
  ));
}

// "Going" for an event. `quiet`: the outlined version for long lists, so a page of events isn't a
// column of identical filled buttons. Once you're going it turns brick, in lists too.
function JoinButton({ event, j, quiet = false }) {
  const isJoined = j.joined.includes(String(event.id));
  return (
    <button
      className={["join", quiet ? "quiet" : "go", isJoined && "joined"].filter(Boolean).join(" ")}
      aria-pressed={isJoined}
      aria-label={`${isJoined ? "Going to" : "Go to"} ${event.title}`}
      title={isJoined ? "You're going. Click to take it back" : j.signedIn ? undefined : "Sign in to say you're going"}
      onClick={() => j.toggle(event.id)}
    >
      {isJoined && <Icon d={CHECK_ICON} />}
      {isJoined ? "Going" : "I'm going"}
    </button>
  );
}

// Names of the DubHub users going (signed in when they joined).
function whoGoing(event, j) {
  return j.names?.[event.id] ?? [];
}

// "Going: Adam N., Kelan H. + 3 on HuskyLink". Nothing when nobody's going.
function GoingList({ event, j }) {
  const names = whoGoing(event, j);
  const others = event.rsvps ?? 0;
  if (names.length === 0 && others === 0) return null;
  return (
    <p className="going-list">
      <strong>Going:</strong> {names.join(", ")}
      {others > 0 && `${names.length ? " + " : ""}${others} on HuskyLink`}
    </p>
  );
}

// "12 going": RSVPs on HuskyLink (sample events have `going`) plus DubHub users who joined, you
// included. Nothing at all when nobody's going.
function going(event, j) {
  const count = (event.rsvps ?? event.going ?? 0) + whoGoing(event, j).length;
  return count > 0 ? `${count} going` : null;
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
      {event.source === "huskylink" ? "View on HuskyLink" : event.source === "discord" ? "View on Discord" : "View post"}
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
// The map data's licenses require this credit on the map, so it's tucked behind a small "©" button.
const MAP_ATTRIBUTION =
  '<details class="map-credit"><summary aria-label="Map credits">&copy;</summary>' +
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
  "</details>";

// The light map: campus in the site's concrete and white, quiet enough that the event dots and the
// slate panels carry the color. Parks and water stay recognizable, just muted.
const MAP_COLORS = {
  background: "#ebeae5",
  water: "#b4cad8",
  park: "#c9d8bd",
  wood: "#bfd1b2",
  wetland: "#d0dcc6",
  plaza: "#e4e3dd",
  building: "#dad8d1",
  school: "#e6e5df",
  road: "#ffffff",
  highway: "#fbfaf7",
  casing: "#d6d4cd",
  highwayCasing: "#c4c1b8",
};

// The dark map: the top bar's slate, with streets a step lighter and water in a deep blue-gray.
const DARK_MAP = {
  dark: true,
  background: "#16181b",
  water: "#1a2632",
  park: "#1b231d",
  wood: "#19211b",
  wetland: "#1c241e",
  plaza: "#1a1c1f",
  building: "#222529",
  school: "#1a1c20",
  road: "#2b2f34",
  major: "#3a3f45", // main streets
  highway: "#5a4a40", // freeways only, in a dim brick
  path: "#23262a", // walking paths, fainter than streets
  casing: "#16181b",
  highwayCasing: "#3a302a",
  label: "#c3c7cc",
  labelHalo: "#121417",
  waterLabel: "#8ea6bd",
  iconOpacity: 0.75, // place icons a little softer, so they don't glare
};

const MAP_PALETTES = { light: MAP_COLORS, dark: DARK_MAP };

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
    if (C.dark && layer.type === "symbol" && layer.layout?.["text-field"] && !/shield/.test(layer.id)) {
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

function BaseMap({ palette }) {
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
        labelsInSiteFont(layer.getMaplibreMap());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, palette]);

  return null;
}

// Hovering a dot opens its pop-up (same as clicking). It stays open while the mouse is on the dot
// or the pop-up, so its buttons can still be clicked, and closes shortly after the mouse leaves.
// The hovered (or tapped) dot's event, shown in a panel docked in the map's corner instead of a
// pop-up above the dot, so it's never cut off at the map's edge.
function MapEventCard({ event, j, onEnter, onLeave, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const e = event;
  const desc = shortText(e.description, 180);
  return (
    <aside className="map-card" aria-label={`${e.title}, hosted by ${hostName(e)}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <header className="map-card-sign">
        <Plate where={e.where} size="lg" />
        <span className="map-card-where">{e.where ?? "Location not listed"}</span>
        <button className="map-card-close" aria-label="Close" onClick={onClose}>
          <Icon d={CLOSE_ICON} />
        </button>
      </header>
      <div className="map-card-body">
        <p className="map-card-when">
          <StartsTag event={e} />
          {formatWhen(e)}
        </p>
        <h2 className="map-card-title">{e.title}</h2>
        <p className="map-card-host">
          <Thumb src={e.club?.logo} label={hostName(e)} color={eventColor(e)} className="map-card-logo" />
          <span>{hostName(e)}</span>
          <GreekTag event={e} />
        </p>
        {desc && <p className="map-card-desc">{desc}</p>}
        {going(e, j) && <p className="map-card-going">{going(e, j)}</p>}
        <div className="map-card-actions">
          <JoinButton event={e} j={j} />
          <ShareButton event={e} />
          <CalendarLink event={e} />
          <PostLink event={e} />
        </div>
      </div>
    </aside>
  );
}

// When an event starts, said the way a sign would: "Now", "In 12 min", "In 2 hr". Nothing for
// events more than three hours off (their time is right next to it).
function startsIn(e, now = Date.now()) {
  if (!e.date || !e.start) return null;
  const start = new Date(`${e.date}T${e.start}`).getTime();
  const end = e.end ? new Date(`${e.date}T${e.end}`).getTime() : start + 36e5;
  if (now >= start && now <= end) return "Now";
  const min = Math.round((start - now) / 6e4);
  if (min < 0 || min > 180) return null;
  return min < 60 ? `In ${Math.max(min, 1)} min` : `In ${Math.round(min / 60)} hr`;
}

function StartsTag({ event }) {
  const label = startsIn(event);
  if (!label) return null;
  return <span className={label === "Now" ? "starts now" : "starts"}>{label}</span>;
}

// The "Next up" sign on the map: the next few events that haven't ended, soonest first.
const NEXT_UP_COUNT = 5;
function upcoming(events, now = Date.now()) {
  const endOf = (e) => new Date(`${e.date}T${e.end ?? e.start ?? "23:59"}`).getTime();
  return events
    .filter((e) => e.date && e.pos && endOf(e) >= now)
    .sort((x, y) => `${x.date}T${x.start ?? "00:00"}`.localeCompare(`${y.date}T${y.start ?? "00:00"}`))
    .slice(0, NEXT_UP_COUNT);
}

function NextUp({ events, onPick }) {
  const next = upcoming(events);
  return (
    <section className="next-up" aria-labelledby="next-up-title">
      <h2 id="next-up-title">Next up</h2>
      {next.length === 0 ? (
        <p className="next-up-empty">Nothing else on the map for these filters.</p>
      ) : (
        <ol>
          {next.map((e) => (
            <li key={e.id}>
              <button className={placeCode(e.where) ? "next-up-row" : "next-up-row no-plate"} onClick={() => onPick(e)}>
                {placeCode(e.where) && (
                  <span className="next-up-plate">
                    <Plate where={e.where} />
                  </span>
                )}
                <span className="next-up-text">
                  <strong>{e.title}</strong>
                  <span>{hostName(e)}</span>
                </span>
                <span className={startsIn(e) ? "next-up-time soon" : "next-up-time"}>
                  {e.date === localDate(0) ? (e.start ? formatTime(e.start) : "All day") : dayLabel(e.date)}
                  <StartsTag event={e} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Pans the map to an event picked from the Next up sign.
function FlyTo({ event }) {
  const map = useMap();
  useEffect(() => {
    if (event?.pos) map.panTo(event.pos, { animate: true, duration: 0.4 });
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

// A dot's size: bigger the more people are going.
function dotRadius(e) {
  return 9 + Math.min((e.rsvps ?? e.going ?? 0) / 6, 8);
}

// How long a callout card's stem is (it matches .callout::after in DubHub.css).
const STEM = 10;

function EventMap({ events, area, introLabels, shown, flyTo, onPin, onMapClick, palette }) {
  const located = events.filter((e) => e.pos);
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
      className="map"
    >
      <ZoomControl position="bottomright" />
      <FlyTo event={flyTo} />
      <MapArea area={area} />
      <BaseMap palette={palette} />
      {located.map((e) => {
        const on = shown?.id === e.id;
        const soon = startsIn(e) != null;
        const radius = dotRadius(e) + (on ? 3 : 0);
        return (
          <CircleMarker
            key={e.id}
            center={e.pos}
            radius={radius}
            pathOptions={{
              color: on ? (palette?.dark ? "#fff" : "#18222c") : soon ? (palette?.dark ? "#ff5c6c" : "#d0263d") : palette?.dark ? "#16181b" : "#fff",
              weight: on || soon ? 4 : 2,
              fillColor: eventColor(e, palette?.dark),
              fillOpacity: 1,
            }}
            bubblingMouseEvents={false}
            eventHandlers={{ click: () => onPin(e) }}
          >
            {/* Hover: a small card above the dot. Click: the detailed panel (with Join). */}
            {!on && (
              <Tooltip direction="top" offset={[0, -(radius + STEM)]} opacity={1} className="event-callout">
                <EventCallout event={e} dark={palette?.dark} />
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}
      <SoonPlates events={located} shownId={shown?.id} />
      <MapClicks onClick={onMapClick} />
      {introLabels && <IntroLabels places={places} dark={palette?.dark} />}
    </MapContainer>
  );
}

// Events starting within three hours (or on now) keep their building's code plate beside the dot,
// like a sign on the building: one plate per place, brick while something there is on now.
// Each hangs off an invisible point, since a dot's own tooltip is its hover card.
function SoonPlates({ events, shownId }) {
  const byPlace = new Map();
  for (const e of events) {
    const label = startsIn(e);
    const code = placeCode(e.where)?.code;
    if (!label || !code || e.id === shownId) continue;
    const key = e.pos.join();
    const prev = byPlace.get(key);
    if (!prev || (label === "Now" && !prev.now)) byPlace.set(key, { pos: e.pos, code, now: label === "Now", r: dotRadius(e) });
  }
  return [...byPlace.values()].map((p) => (
    <CircleMarker key={`plate|${p.pos.join()}`} center={p.pos} radius={0} stroke={false} fill={false} interactive={false}>
      <Tooltip permanent direction="right" offset={[p.r + 4, 0]} opacity={1} className="pin-plate">
        <span className={p.now ? "plate plate-now" : "plate"}>{p.code}</span>
      </Tooltip>
    </CircleMarker>
  ));
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
function EventCallout({ event, title = event.title, sub, dark }) {
  const [, setBroken] = useState(false);
  const group = eventGroup(event);
  const code = placeCode(event.where)?.code;
  const logo = event.club?.logo;
  const picture = !code && logo && !brokenLogos.has(logo);
  const line = sub ?? [event.start && formatTime(event.start), event.where ?? hostName(event)].filter(Boolean).join(", ");
  return (
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
}

// What the dot colors mean: the groups on the map right now, always in the same order.
function MapLegend({ events, dark }) {
  const shown = new Set(events.filter((e) => e.pos).map(eventGroup));
  const groups = [...CATEGORY_GROUPS, OTHER_GROUP].filter((g) => shown.has(g));
  if (!groups.length) return null;
  return (
    <ul className="map-legend" aria-label="Dot colors">
      {groups.map((g) => (
        <li key={g.name}>
          <span className="dot" style={{ background: dark ? g.dark : g.light }} />
          {g.name}
        </li>
      ))}
    </ul>
  );
}

function Home({ f, area, introLabels, j, palette }) {
  const [shown, setShown] = useState(null); // { event, pinned }
  const [flyTo, setFlyTo] = useState(null); // an event picked from the Next up sign
  const hideTimer = useRef();
  const keep = () => clearTimeout(hideTimer.current);
  const show = (event, pinned = false) => {
    keep();
    setShown((s) => ({ event, pinned: pinned || (s?.pinned && s.event.id === event.id) }));
  };
  const hideSoon = () => {
    keep();
    hideTimer.current = setTimeout(() => setShown((s) => (s?.pinned ? s : null)), 300);
  };
  const close = useCallback(() => {
    keep();
    setShown(null);
  }, []);
  // If filters remove the shown event from the map, drop the panel too.
  const event = shown && f.events.find((e) => e.id === shown.event.id);

  return (
    <main className="home">
      <EventMap
        events={f.events}
        area={area}
        introLabels={introLabels}
        shown={event}
        flyTo={flyTo}
        onPin={(e) => show(e, true)}
        onMapClick={close}
        palette={palette}
      />
      <MapLegend events={f.events} dark={palette?.dark} />
      <Filters f={f} />
      <h1 className="visually-hidden">Events on the UW campus map</h1>
      {event ? (
        <MapEventCard event={event} j={j} onEnter={keep} onLeave={hideSoon} onClose={close} />
      ) : (
        <NextUp
          events={f.events}
          onPick={(e) => {
            setFlyTo(e);
            show(e, true);
          }}
        />
      )}
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
          <Icon d={CLOSE_ICON} />
        </button>
        {event.image && <HeroImage src={event.image} />}
        <h2 id="event-detail-title">{event.title}</h2>
        <p className="detail-tags">
          <StartsTag event={event} />
          <GreekTag event={event} />
        </p>
        <dl className="facts">
          <dt>When</dt>
          <dd>{formatWhen(event) ?? "Date not listed"}</dd>
          <dt>Where</dt>
          <dd>
            <Plate where={event.where} />
            {event.where ?? "Location not listed"}
          </dd>
          <dt>Host</dt>
          <dd>{hostName(event)}</dd>
          {event.type && (
            <>
              <dt>Type</dt>
              <dd>{event.type}</dd>
            </>
          )}
          {going(event, j) && (
            <>
              <dt>Going</dt>
              <dd>{going(event, j)}</dd>
            </>
          )}
        </dl>
        <GoingList event={event} j={j} />
        {/* The action right under the facts, before a description that can run long */}
        <div className="detail-actions">
          <JoinButton event={event} j={j} />
          <ShareButton event={event} />
          <CalendarLink event={event} />
          <PostLink event={event} />
        </div>
        <p className="event-description">{event.description || "No description yet."}</p>
      </div>
    </div>
  );
}

// The event's flyer at the top of its pop-up, shown whole (flyers often have text on them).
function HeroImage({ src }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="event-hero" src={src} alt="" decoding="async" onError={() => setFailed(true)} />;
}

// "Today", "Tomorrow", or "Wed, Nov 4" for an event's "2026-11-04" date.
function dayLabel(date) {
  if (!date) return "Date not listed";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// "Saturday, November 7"
function fullDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// Events grouped under a heading per day, in date order (undated ones last).
function EventList({ events, j, onSelect, columns = 2 }) {
  const days = [];
  for (const e of [...events].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))) {
    const label = dayLabel(e.date);
    if (days.at(-1)?.label !== label) days.push({ label, events: [] });
    days.at(-1).events.push(e);
  }
  return days.map(({ label, events: list }) => (
    <section key={label} className="day">
      <h3 className="day-label">
        {label}
        {list[0].date && /^(Today|Tomorrow)$/.test(label) && <span>{fullDay(list[0].date)}</span>}
      </h3>
      <ul className={columns === 3 ? "list cards cards-3" : "list cards"}>
        {list
          .sort((a, b) => (a.start ?? "99").localeCompare(b.start ?? "99"))
          .map((e) => (
            <li key={e.id} className="event-row">
              <div className="event-time">
                {e.start ? formatTime(e.start) : "All day"}
                {e.end && <span>{formatTime(e.end)}</span>}
                <StartsTag event={e} />
              </div>
              <Thumb src={e.image} label={e.title} color={eventColor(e)} className="event-thumb" />
              <div className="grow">
                <EventTitle event={e} onSelect={onSelect} />
                <div className="meta">
                  <span className="dot" style={{ background: eventColor(e) }} title={eventGroup(e).name} />
                  <GreekTag event={e} />
                  {[hostName(e), e.where, going(e, j)].filter(Boolean).join(", ")}
                </div>
              </div>
              <Plate where={e.where} />
              <JoinButton event={e} j={j} quiet />
            </li>
          ))}
      </ul>
    </section>
  ));
}

// Pill buttons for picking one option (filters shared with the map use these too).
// Fraternity and sorority events get a Greek Life label so they're easy to spot.
function GreekTag({ event }) {
  return event.club?.category === "Greek Life" ? <span className="tag tag-greek">Greek Life</span> : null;
}

function ChipFilter({ label, options, value, onChange }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} className={o === value ? "chip-btn on" : "chip-btn"} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// When an event starts and ends, as times (an event with no end runs an hour; no start, all day).
function eventSpan(e) {
  if (!e.date) return null;
  const start = new Date(`${e.date}T${e.start ?? "00:00"}`).getTime();
  const end = e.end ? new Date(`${e.date}T${e.end}`).getTime() : e.start ? start + 36e5 : new Date(`${e.date}T23:59`).getTime();
  return { start, end, allDay: !e.start };
}

// The Now page's sections, in order. Every event that hasn't ended lands in exactly one.
const NOW_SECTIONS = [
  { id: "now", title: "On now" },
  { id: "soon", title: "Starting soon", note: "In the next 3 hours" },
  { id: "today", title: "Later today" },
  { id: "tomorrow", title: "Tomorrow" },
  { id: "later", title: "Later this week" },
];

function sectionOf(e, now = Date.now()) {
  const span = eventSpan(e);
  if (!span || span.end < now) return null;
  if (!span.allDay && span.start <= now) return "now";
  if (!span.allDay && span.start - now <= 3 * 36e5) return "soon";
  if (e.date === localDate(0)) return "today"; // later today, or all day today
  if (e.date === localDate(1)) return "tomorrow";
  return "later";
}

// One event in the agenda: its time on the left, then what it is, who's hosting and where, the
// club's flyer as a small picture, and the going toggle. The whole row opens the event.
function AgendaRow({ event: e, section, j, onSelect, index = 0 }) {
  const [broken, setBroken] = useState(false);
  const live = section === "now";
  const soon = section === "soon" ? startsIn(e) : null;
  const day = section === "later"; // tomorrow's heading already says which day
  return (
    <li className={live ? "agenda-row live" : "agenda-row"} style={{ "--i": Math.min(index, 12) }}>
      <div className="agenda-time">
        {day && <span className="agenda-day">{dayLabel(e.date)}</span>}
        <span className="agenda-start">{e.start ? formatTime(e.start) : "All day"}</span>
        {e.end && <span className="agenda-end">to {formatTime(e.end)}</span>}
        {soon && <span className="agenda-soon">{soon.replace(/^In /, "in ")}</span>}
      </div>
      <button className="agenda-main" onClick={() => onSelect(e)}>
        <span className="agenda-title">{e.title}</span>
        <span className="agenda-host">
          <span className="dot" style={{ background: eventColor(e) }} title={eventGroup(e).name} />
          <span>{hostName(e)}</span>
        </span>
        <span className="agenda-where">
          <Plate where={e.where} />
          {e.where && !placeCode(e.where) && <span>{e.where}</span>}
          {going(e, j) && <span className="agenda-going">{going(e, j)}</span>}
        </span>
      </button>
      {e.image && !broken ? (
        <img className="agenda-pic" src={e.image} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="agenda-pic agenda-pic-none" style={{ background: eventColor(e) }} aria-hidden="true">
          {initials(hostName(e))}
        </span>
      )}
      <GoingToggle event={e} j={j} color={eventColor(e)} />
    </li>
  );
}

// The going toggle on each row: a round button with a plus; once you're going it fills green with
// a check, popping and throwing a small burst in the event's color.
const BURST = 8;
function GoingToggle({ event, j, color }) {
  const isJoined = j.joined.includes(String(event.id));
  const [burst, setBurst] = useState(0);
  return (
    <button
      className={isJoined ? "going-toggle on" : "going-toggle"}
      aria-pressed={isJoined}
      aria-label={`${isJoined ? "You're going to" : "Go to"} ${event.title}`}
      title={isJoined ? "You're going. Tap to undo" : j.signedIn ? "I'm going" : "Sign in to say you're going"}
      onClick={() => {
        if (!isJoined && j.signedIn) setBurst((n) => n + 1);
        j.toggle(event.id);
      }}
      style={{ "--burst": color }}
    >
      <Icon d={isJoined ? CHECK_ICON : PLUS_ICON} />
      {burst > 0 && (
        <span className="burst" key={burst} aria-hidden="true">
          {Array.from({ length: BURST }, (_, i) => (
            <i key={i} style={{ "--a": `${(360 / BURST) * i}deg` }} />
          ))}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- the hero's flyer fan
// Today's real club flyers, fanned across the purple band: the next event's flyer biggest and in
// front, the ones after it tucked behind, fanning out to the right. Tap one to open its event.
const FAN_COUNT = 5;
function FlyerFan({ events, now, onSelect }) {
  const next = events
    .filter((e) => e.image && ["now", "soon", "today"].includes(sectionOf(e, now)))
    .slice(0, FAN_COUNT);
  if (!next.length) return null;
  const lead = next[0];
  return (
    <div className="fan">
      <div className="fan-cards" style={{ "--n": next.length }}>
        {next.map((e, i) => (
          <button
            key={e.id}
            className={i === 0 ? "fan-card lead" : "fan-card"}
            style={{ "--k": i }}
            onClick={() => onSelect(e)}
            aria-label={`${e.title}, ${e.start ? formatTime(e.start) : "all day"}`}
          >
            <img src={e.image} alt="" loading={i === 0 ? "eager" : "lazy"} decoding="async" />
          </button>
        ))}
      </div>
      <p className="fan-caption">
        Next up: <strong>{lead.title}</strong>
        {lead.start && <>, {formatTime(lead.start)}</>}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------ the day strip
// Today drawn as a timeline: each event a bar from its start to its end in its category's color,
// stacked into as few rows as fit, with the red now marker crossing them. Tap a bar to open it.
const STRIP_FROM = 8; // 8 AM
const STRIP_TO = 24; // midnight
const STRIP_LANES = 4;
function DayStrip({ events, now, onSelect }) {
  const today = localDate(0);
  const hours = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h + m / 60;
  };
  const bars = events
    .filter((e) => e.date === today && e.start)
    .map((e) => ({ e, from: Math.max(hours(e.start), STRIP_FROM), to: Math.min(e.end ? hours(e.end) : hours(e.start) + 1, STRIP_TO) }))
    .filter((x) => x.to > STRIP_FROM && x.from < STRIP_TO)
    .sort((x, y) => x.from - y.from);
  // Greedy lanes: each bar takes the first lane that's free by its start.
  const laneEnds = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end <= bar.from);
    if (lane < 0 && laneEnds.length < STRIP_LANES) lane = laneEnds.length;
    if (lane < 0) lane = laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = bar.to;
    bar.lane = lane;
  }
  const lanes = Math.max(1, laneEnds.length);
  const pct = (h) => ((h - STRIP_FROM) / (STRIP_TO - STRIP_FROM)) * 100;
  const d = new Date(now);
  const nowH = d.getHours() + d.getMinutes() / 60;
  const ticks = [];
  for (let h = STRIP_FROM; h <= STRIP_TO; h += 2) ticks.push(h);
  const tickLabel = (h) => (h === 12 ? "Noon" : h === 24 ? "12 AM" : `${h % 12} ${h < 12 ? "AM" : "PM"}`);
  if (!bars.length) return null;
  return (
    <div className="day-strip" style={{ "--lanes": lanes }} aria-label="Today's events on a timeline">
      <div className="day-strip-track">
        {ticks.map((h) => (
          <span key={h} className={h === STRIP_FROM ? "strip-tick first" : h === STRIP_TO ? "strip-tick last" : "strip-tick"} style={{ left: `${pct(h)}%` }}>
            <span>{tickLabel(h)}</span>
          </span>
        ))}
        {bars.map(({ e, from, to, lane }) => (
          <button
            key={e.id}
            className={from <= nowH && nowH < to ? "strip-bar live" : "strip-bar"}
            style={{
              left: `${pct(from)}%`,
              width: `max(${pct(to) - pct(from)}%, 10px)`,
              top: `calc(${lane} * var(--lane-h))`,
              background: eventColor(e),
            }}
            title={`${e.title}, ${formatTime(e.start)}`}
            aria-label={`${e.title}, ${formatTime(e.start)}`}
            onClick={() => onSelect(e)}
          />
        ))}
        {nowH >= STRIP_FROM && nowH <= STRIP_TO && <span className="strip-now" style={{ left: `${pct(nowH)}%` }} />}
      </div>
    </div>
  );
}

// The red line at the current time, between what's on and what's next.
function NowLine({ now }) {
  return (
    <li className="now-line" aria-label={`Now, ${new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}>
      <span className="now-line-time">{new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
      <span className="now-line-rule" />
    </li>
  );
}

// "Sat, Nov 8 · 1:40 PM", ticking once a minute.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);
  return now;
}

function NowPage({ f, updated, j, onSelect }) {
  const [query, setQuery] = useState("");
  const now = useNow();
  const q = query.trim().toLowerCase();
  const events = q
    ? f.events.filter((e) => [e.title, e.host, e.club?.name, e.where, e.description].some((s) => s?.toLowerCase().includes(q)))
    : f.events;

  const seen = new Map();
  for (const e of events) {
    const key = `${hostName(e)}|${e.date}|${e.start ?? ""}`;
    const prev = seen.get(key);
    if (!prev || (!prev.image && e.image)) seen.set(key, e);
  }
  const unique = [...seen.values()];
  const sections = NOW_SECTIONS.map((sec) => ({ ...sec, events: [] }));
  const when = (e) => `${e.date}T${e.start ?? "99"}`; // all-day events after the timed ones that day
  for (const e of unique.sort((x, y) => when(x).localeCompare(when(y)))) {
    const id = sectionOf(e, now);
    if (id) sections.find((sec) => sec.id === id).events.push(e);
  }
  const shown = sections.filter((sec) => sec.events.length);
  const clock = new Date(now);

  return (
    <main className="page now-page">
      <section className="now-hero">
        <div className="now-hero-inner">
          <header className="now-head">
            <h1>What's on</h1>
            <p className="now-date">{clock.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
            <DayStrip events={unique} now={now} onSelect={onSelect} />
          </header>
          <FlyerFan events={sections.flatMap((sec) => sec.events)} now={now} onSelect={onSelect} />
        </div>
      </section>
      <div className="now-body">
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search events, clubs, places"
          aria-label="Search events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-row">
          <ChipFilter label="Event type" options={["All", ...Object.keys(TYPE_COLORS)]} value={f.type} onChange={f.setType} />
          <select
            aria-label="Club type"
            className={f.club !== ALL_CLUBS ? "filter-select set" : "filter-select"}
            value={f.club}
            onChange={(e) => f.setClub(e.target.value)}
          >
            <option>{ALL_CLUBS}</option>
            {f.clubTypes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <WhenSelect aria-label="How far ahead" className="filter-select" value={f.when} onChange={f.setWhen} />
        </div>
      </div>
      {shown.length === 0 && (
        <div className="empty-wall">
          <p>{q ? `Nothing matches "${query}".` : "Nothing coming up for these filters."}</p>
          {f.when !== "Any time" && (
            <button className="link-button" onClick={() => f.setWhen("Any time")}>
              Look further ahead
            </button>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="agenda">
          {/* Today: on now, the now line, then starting soon and later today, as one list */}
          {sections.slice(0, 3).some((sec) => sec.events.length) && (
            <section aria-labelledby="day-today">
              <h2 id="day-today" className="agenda-head">
                Today
              </h2>
              <ol className="agenda-list">
                {sections[0].events.map((e, i) => (
                  <AgendaRow key={e.id} event={e} section="now" j={j} onSelect={onSelect} index={i} />
                ))}
                <NowLine now={now} />
                {[...sections[1].events, ...sections[2].events].map((e, i) => (
                  <AgendaRow key={e.id} event={e} section={sectionOf(e, now)} j={j} onSelect={onSelect} index={sections[0].events.length + i + 1} />
                ))}
              </ol>
            </section>
          )}
          {sections.slice(3).filter((sec) => sec.events.length).map((sec) => (
            <section key={sec.id} aria-labelledby={`day-${sec.id}`}>
              <h2 id={`day-${sec.id}`} className="agenda-head">
                {sec.title}
              </h2>
              <ol className="agenda-list">
                {sec.events.map((e) => (
                  <AgendaRow key={e.id} event={e} section={sec.id} j={j} onSelect={onSelect} />
                ))}
              </ol>
            </section>
          ))}
          {updated && (
            <p className="agenda-source">
              Events come from HuskyLink, club Instagram posts and club Discord servers. Last updated{" "}
              {new Date(updated).toLocaleString("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}.
            </p>
          )}
        </div>
      )}
      </div>
    </main>
  );
}

// ------------------------------------------------------------------------------ share links
// An event's own link: dubhub.../#event=<id> opens straight to it.
function eventLink(e) {
  return `${location.origin}${location.pathname}#event=${encodeURIComponent(e.id)}`;
}

function linkedEventId() {
  const m = location.hash.match(/^#event=(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Opens the phone's share sheet, or copies the link where there isn't one.
function ShareButton({ event }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = eventLink(event);
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, text: `${event.title} · ${formatWhen(event) ?? ""}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Closing the share sheet throws; nothing to do.
    }
  };
  return (
    <button className="link-button share-button" onClick={share}>
      <Icon d={SHARE_ICON} />
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

function ClubJoinButton({ club, clubs }) {
  const isMember = clubs.joined.includes(club.name);
  return (
    <button
      className={isMember ? "join joined" : "join"}
      aria-pressed={isMember}
      aria-label={`${isMember ? "Leave" : "Join"} ${club.name}`}
      title={isMember ? "Click to leave this club" : undefined}
      onClick={() => clubs.toggle(club.name)}
    >
      {isMember && <Icon d={CHECK_ICON} />}
      {isMember ? "Member" : "Join"}
    </button>
  );
}


function hostedBy(all, club) {
  return all.filter((e) => isHostedBy(e, club));
}

// Events you joined plus every event hosted by a club you're in.
function myEventsFor(all, clubList, j, clubs) {
  const myClubs = clubList.filter((c) => clubs.joined.includes(c.name));
  return all.filter((e) => j.joined.includes(String(e.id)) || myClubs.some((c) => isHostedBy(e, c)));
}

function MyEventsPage({ all, clubList, j, clubs, applications, onBrowse, onFindClubs }) {
  const mine = myEventsFor(all, clubList, j, clubs);
  const [selected, setSelected] = useState(null);
  const [openClub, setOpenClub] = useState(null);
  // Open applications from the clubs you joined, soonest deadline first.
  const open = useMemo(() => openApplications(applications, clubList), [applications, clubList]);
  const myApps = open.filter((a) => a.club && clubs.joined.includes(a.club.name));
  // The clubs you joined, in the order you joined them. One that's left the Clubs page (no events
  // in a year) still shows by name once the club list has loaded.
  const myClubs = clubList.length
    ? clubs.joined.map((name) => clubList.find((c) => c.name === name) ?? { name, gone: true })
    : [];
  return (
    <main className="page">
      <h1>My Events</h1>
      {clubs.joined.length > 0 && (
        <p className="page-sub">
          Events you joined, plus everything from {clubs.joined.length === 1 ? clubs.joined[0] : `your ${clubs.joined.length} clubs`}
        </p>
      )}
      {myClubs.length > 0 && (
        <section className="my-clubs" aria-labelledby="my-clubs-title">
          <h2 id="my-clubs-title">Your clubs</h2>
          <ul className="my-club-row">
            {myClubs.map((c) => {
              const upcoming = c.gone ? 0 : hostedBy(all, c).length;
              return (
                <li key={c.name}>
                  <button className="my-club" onClick={() => !c.gone && setOpenClub(c)} disabled={c.gone}>
                    <Thumb src={c.logo} label={c.name} color={c.gone ? NO_FIELD_COLOR : clubColor(c)} className="my-club-logo" />
                    <span className="my-club-text">
                      <span className="my-club-name">{c.name}</span>
                      <span className="meta">
                        {c.gone
                          ? "No recent events"
                          : [c.category, upcoming ? `${upcoming} upcoming event${upcoming === 1 ? "" : "s"}` : "No upcoming events"]
                              .filter(Boolean)
                              .join(", ")}
                      </span>
                      {myApps.some((a) => a.club?.name === c.name) && <span className="tag tag-apply">Applications open</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {clubs.joined.length === 0 && mine.length > 0 && (
        <p className="count">
          Join clubs to see all their events and applications here.{" "}
          <button className="link-button" onClick={onFindClubs}>
            Find clubs
          </button>
        </p>
      )}
      {myApps.length > 0 && (
        <section className="my-apps" aria-labelledby="my-apps-title">
          <h2 id="my-apps-title">Applications from your clubs</h2>
          <ul className="apply-grid">
            {myApps.map((a) => (
              <li key={a.id}>
                <ApplicationCard app={a} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {clubs.joined.length > 0 && myApps.length === 0 && (
        <p className="count">None of your clubs are taking applications right now. When one opens, it shows up here.</p>
      )}
      {mine.length > 0 && (myApps.length > 0 || myClubs.length > 0) && <h2>Your events</h2>}
      {mine.length > 0 ? (
        <EventList events={mine} j={j} onSelect={setSelected} columns={3} />
      ) : (
        <div className="empty-card">
          <h2>Nothing here yet</h2>
          <p>
            Tap I'm going on an event to save it here, or join a club and every event it posts, and any application it opens, shows up
            here on its own.
          </p>
          <div className="empty-actions">
            <button className="join" onClick={onBrowse}>
              Browse events
            </button>
            <button className="join secondary" onClick={onFindClubs}>
              Find clubs
            </button>
          </div>
        </div>
      )}
      {selected && <EventDetail event={selected} j={j} onClose={() => setSelected(null)} />}
      {openClub && (
        <ClubDetail
          club={openClub}
          hosted={hostedBy(all, openClub)}
          apps={open.filter((a) => a.club?.name === openClub.name)}
          clubs={clubs}
          onClose={() => setOpenClub(null)}
        />
      )}
    </main>
  );
}

function ClubDetail({ club, hosted, apps = [], clubs, onClose }) {
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
          <Icon d={CLOSE_ICON} />
        </button>
        <div className="detail-head">
          <Thumb src={club.logo} label={club.name} color={clubColor(club)} className="club-avatar large" />
          <h2 id="club-detail-title">{club.name}</h2>
        </div>
        <p className="tags">
          <span className={club.category === "Greek Life" ? "tag tag-greek" : "tag"}>{club.category}</span>
          {club.fields?.map((field) => (
            <FieldTag key={field} field={field} />
          ))}
        </p>
        <p>{club.description || club.about || (club.instagram ? "No description yet. Check their Instagram for more." : "No description yet.")}</p>
        {club.meets && <p className="meta">Meets {club.meets}</p>}
        {(club.website || club.instagram || club.discord) && (
          <p className="club-links">
            {club.website && !(club.discord && /discord(app)?\.(gg|com)\//i.test(club.website)) && (
              <a className="post-link" href={club.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
            {club.instagram && (
              <a className="post-link" href={club.instagram} target="_blank" rel="noreferrer">
                @{club.handle} on Instagram
              </a>
            )}
            {club.discord && (
              <a className="post-link" href={club.discord} target="_blank" rel="noreferrer">
                Join the Discord
              </a>
            )}
          </p>
        )}
        <ClubJoinButton club={club} clubs={clubs} />

        {apps.length > 0 && (
          <>
            <h3>Applications open</h3>
            <ul className="club-events">
              {apps.map((a) => (
                <li key={a.id}>
                  <strong>{a.for}</strong>
                  <div className="meta">{a.due.text}</div>
                  <ApplyLinks app={a} />
                </li>
              ))}
            </ul>
          </>
        )}

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

        <div className="officer-note">
          <p>
            <strong>Run this club?</strong> Add DubHub to {club.discord ? "your club's Discord" : "your club's Discord server"}{" "}
            and the events in its Events tab and #announcements show up here on their own.
          </p>
          <DiscordBotLink className="join secondary" />
        </div>
      </div>
    </div>
  );
}

const CLUBS_PAGE = 40; // clubs shown before "Show more"; there are over a thousand

// "Due Fri, Nov 14 · 5 days left"; deadlines within 3 days count as closing soon.
function deadlineOf(app) {
  if (!app.deadline) return { text: "No deadline listed", soon: false, days: Infinity };
  const due = new Date(`${app.deadline}T00:00`);
  const days = Math.round((due - new Date(new Date().toDateString())) / 864e5);
  const day = due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const left = days === 0 ? "Last day" : days === 1 ? "1 day left" : `${days} days left`;
  return { text: `Due ${day} · ${left.toLowerCase()}`, day, left, soon: days <= 3, days };
}

// Applications still open today (the file only refreshes when the scraper runs).
function openApplications(apps, clubList) {
  return apps
    .map((a) => ({ ...a, club: clubList.find((c) => isHostedBy(a, c)), due: deadlineOf(a) }))
    .filter((a) => a.due.days >= 0)
    .sort((a, b) => a.due.days - b.due.days || (b.posted ?? "").localeCompare(a.posted ?? ""));
}

function ApplyLinks({ app }) {
  return (
    <span className="apply-actions">
      <a className="join" href={app.link || app.post} target="_blank" rel="noreferrer">
        {app.link ? "Apply" : "How to apply"}
      </a>
      {app.link && (
        <a className="post-link" href={app.post} target="_blank" rel="noreferrer">
          See post
        </a>
      )}
    </span>
  );
}

// What an application is for. The scraper's AI says so for new ones ("kind"); older ones are sorted
// by the words in what they're for (the same words as scraper/events_common.py's KIND_WORDS).
const APPLICATION_KINDS = ["Membership", "Officer & board", "Team & staff", "Auditions & tryouts", "Programs", "Other"];
const KIND_WORDS = [
  ["Auditions & tryouts", /audition|try-?outs?|cast|perform/i],
  ["Officer & board", /officer|board|lead|chair|president|director|committee|exec/i],
  ["Programs", /mentor|program|fellow|cohort|intern|scholar/i],
  ["Membership", /member|join|interest|recruit|sorority|fraternity|rush|\bfam\b/i],
  ["Team & staff", /team|staff|writer|\bdj|volunteer|submission|crew|position|editor|photographer/i],
];
function kindOf(app) {
  if (APPLICATION_KINDS.includes(app.kind)) return app.kind;
  return KIND_WORDS.find(([, words]) => words.test(app.for))?.[0] ?? "Other";
}

// A club's category, for clubs on the Clubs page or (from the scraper) ones that aren't yet.
const appCategory = (app) => app.club?.category ?? app.category;

function ApplicationCard({ app, onSelectClub }) {
  return (
    <article className="apply-card">
      <span className="apply-club">
        <Thumb src={app.club?.logo ?? app.logo} label={hostName(app)} color={app.club ? clubColor(app.club) : NO_FIELD_COLOR} className="apply-logo" />
        {app.club && onSelectClub ? (
          <button className="club-link apply-club-name" onClick={() => onSelectClub(app.club)}>
            {hostName(app)}
          </button>
        ) : (
          <span className="apply-club-name">{hostName(app)}</span>
        )}
      </span>
      <strong className="apply-for">{app.for}</strong>
      <span className="apply-tags">
        <span className="tag">{kindOf(app)}</span>
        {appCategory(app) === "Greek Life" && <span className="tag tag-greek">Greek Life</span>}
      </span>
      <span className={app.due.soon ? "meta apply-due soon" : "meta apply-due"}>
        {app.due.soon ? (
          <>
            <span className="tag tag-soon">{app.due.left}</span>
            Due {app.due.day}
          </>
        ) : (
          app.due.text
        )}
      </span>
      <ApplyLinks app={app} />
    </article>
  );
}

const ANY_KIND = "All kinds";
const DEADLINES = ["Any deadline", "Due this week", "No deadline"];

// The Applications view of the Clubs tab: every open application, soonest deadline first, with
// filters for what it's for, when it's due and the kind of club.
function ApplicationsView({ open, onSelectClub }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(ANY_KIND);
  const [deadline, setDeadline] = useState(DEADLINES[0]);
  const [clubType, setClubType] = useState(ALL_CLUBS);
  const kinds = [ANY_KIND, ...APPLICATION_KINDS.filter((k) => open.some((a) => kindOf(a) === k))];
  const clubTypes = [ALL_CLUBS, ...[...new Set(open.map(appCategory).filter(Boolean))].sort()];

  const q = query.trim().toLowerCase();
  const shown = open.filter(
    (a) =>
      (kind === ANY_KIND || kindOf(a) === kind) &&
      (deadline === DEADLINES[0] || (deadline === "Due this week" ? a.due.days <= 7 : !a.deadline)) &&
      (clubType === ALL_CLUBS || appCategory(a) === clubType) &&
      (!q || [hostName(a), a.for, kindOf(a)].some((s) => s?.toLowerCase().includes(q)))
  );

  return (
    <>
      <p className="page-sub">Clubs taking applications right now, found in their Instagram posts. Soonest deadline first.</p>
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search applications or clubs"
          aria-label="Search applications"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ChipFilter label="Kind" options={kinds} value={kind} onChange={setKind} />
        <ChipFilter label="Deadline" options={DEADLINES} value={deadline} onChange={setDeadline} />
        {clubTypes.length > 2 && <ChipFilter label="Club type" options={clubTypes} value={clubType} onChange={setClubType} />}
      </div>
      <p className="count">
        {shown.length} open application{shown.length === 1 ? "" : "s"}
      </p>
      {shown.length > 0 ? (
        <ul className="apply-grid">
          {shown.map((a) => (
            <li key={a.id}>
              <ApplicationCard app={a} onSelectClub={onSelectClub} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{open.length ? "No applications match these filters." : "No open applications right now. Check back soon."}</p>
      )}
    </>
  );
}

function ClubsPage({ all, clubList, clubs: membership, applications }) {
  const [view, setView] = useState("Clubs");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [major, setMajor] = useState("Any major");
  const [limit, setLimit] = useState(CLUBS_PAGE);
  const [selected, setSelected] = useState(null);
  const categories = ["All", ...[...new Set(clubList.map((c) => c.category))].sort()];

  const q = query.trim().toLowerCase();
  const field = major === "Any major" ? null : fieldOf(major);
  const clubs = clubList.filter(
    (c) =>
      (category === "All" || c.category === category) &&
      (!field || c.fields?.includes(field)) &&
      (!q || [c.name, c.handle, c.category, c.about, ...(c.fields ?? [])].some((s) => s?.toLowerCase().includes(q)))
  );
  const filter = (set) => (value) => {
    set(value);
    setLimit(CLUBS_PAGE);
  };
  const open = useMemo(() => openApplications(applications, clubList), [applications, clubList]);
  const applying = new Set(open.map((a) => a.club?.name).filter(Boolean));

  return (
    <main className="page">
      <h1>Clubs</h1>
      <div className="view-switch" role="tablist" aria-label="Show clubs or open applications">
        {["Clubs", "Applications"].map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
            {v}
            {v === "Applications" && open.length > 0 && <span className="count-badge">{open.length}</span>}
          </button>
        ))}
      </div>
      {view === "Applications" ? (
        <ApplicationsView open={open} onSelectClub={setSelected} />
      ) : (
        <>
      <p className="page-sub">
        Student organizations at UW Seattle. Join one to get its events in My Events. Run a club?{" "}
        <DiscordBotLink className="post-link">Add DubHub to your Discord</DiscordBotLink>
      </p>
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search by name, Instagram, or topic"
          aria-label="Search clubs"
          value={query}
          onChange={(e) => filter(setQuery)(e.target.value)}
        />
        <ChipFilter label="Category" options={categories} value={category} onChange={filter(setCategory)} />
        <MajorSelect aria-label="Major" className="major-select" value={major} onChange={filter(setMajor)} />
      </div>
      <p className="count">
        {clubs.length.toLocaleString()} club{clubs.length === 1 ? "" : "s"}
        {field && (
          <>
            {" "}
            in <FieldTag field={field} />
          </>
        )}
      </p>
      <ul className="list cards">
        {clubs.slice(0, limit).map((c) => {
          const upcoming = hostedBy(all, c).length;
          return (
            <li key={c.name} className="club-row">
              <Thumb src={c.logo} label={c.name} color={clubColor(c)} className="club-avatar" />
              <button className="club-main" onClick={() => setSelected(c)}>
                <span className="club-title">
                  <span className="club-name">{c.name}</span>
                  <span className={c.category === "Greek Life" ? "tag tag-greek" : "tag"}>{c.category}</span>
                  {applying.has(c.name) && <span className="tag tag-apply">Applications open</span>}
                  {c.fields?.map((f) => (
                    <FieldTag key={f} field={f} />
                  ))}
                </span>
                {c.about && <span className="club-about">{c.about}</span>}
                <span className="meta">
                  {[
                    c.meets && `Meets ${c.meets}`,
                    c.handle && c.name !== `@${c.handle}` && `@${c.handle}`,
                    upcoming > 0 && `${upcoming} upcoming event${upcoming === 1 ? "" : "s"}`,
                    !upcoming && c.last_event && `Last event ${formatWhen({ date: c.last_event })}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </button>
              <ClubJoinButton club={c} clubs={membership} />
            </li>
          );
        })}
      </ul>
      {clubs.length > limit && (
        <button className="show-more" onClick={() => setLimit((n) => n + CLUBS_PAGE * 2)}>
          Show more clubs ({(clubs.length - limit).toLocaleString()} more)
        </button>
      )}
      {clubs.length === 0 && <p className="empty">No clubs match{q ? ` "${query}"` : ""}.</p>}
        </>
      )}

      {selected && (
        <ClubDetail
          club={selected}
          hosted={hostedBy(all, selected)}
          apps={open.filter((a) => a.club?.name === selected.name)}
          clubs={membership}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

// Each signed-in account gets its own profile on this device: { year, majors }.
const PROFILE_KEY = "dubhub-profile";
const MAX_MAJORS = 3;
const EMPTY_PROFILE = { year: "", majors: [] };

function loadProfile(email) {
  try {
    return { ...EMPTY_PROFILE, ...JSON.parse(localStorage.getItem(`${PROFILE_KEY}:${email}`)) };
  } catch {
    return EMPTY_PROFILE;
  }
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

function ProfilePage({ user, profile, onChange, clubList, clubs, j, onSignOut }) {
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
        <div className="grow">
          <h1>{user.name}</h1>
          <div className="meta">{user.email}</div>
        </div>
        <button className="join secondary" onClick={onSignOut}>
          Sign out
        </button>
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
                    <Icon d={CLOSE_ICON} />
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

// "Cofounder @dubhub" and "Cofounder @ DubHub" say the same thing (so a GitHub bio that repeats
// the role isn't shown twice).
const sameWords = (a, b) => (a || "").toLowerCase().replace(/[^a-z0-9]/g, "") === (b || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function TeamMember({ name, role, note, github, githubPhoto = true, linkedin, photo, secret }) {
  const p = useGitHubProfile(github);
  const [photoFailed, setPhotoFailed] = useState(false);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("");
  const picture = photo || (github && githubPhoto && `https://github.com/${github}.png?size=192`);

  return (
    <li className={secret ? "member member-secret" : "member"} tabIndex={secret ? 0 : undefined}>
      {picture && !photoFailed ? (
        <img src={picture} alt="" onError={() => setPhotoFailed(true)} />
      ) : (
        <span className={name === "Claude" ? "avatar claude" : "avatar"}>{initials}</span>
      )}
      <strong>{name}</strong>
      {role && <div className="member-role">{role}</div>}
      {(note || (p?.bio && !sameWords(p.bio, role))) && <p className="member-note">{note || p.bio}</p>}
      {p && (
        <div className="meta">
          {[p.location, `${p.public_repos} public repo${p.public_repos === 1 ? "" : "s"}`].filter(Boolean).join(", ")}
        </div>
      )}
      <div className="member-links">
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

// ------------------------------------------------------------ careers ---
// The Careers section of the About page: DubHub's roles (src/jobs.js), an application form for each
// (its questions, a resume, and an optional cover letter), and, for DubHub's team, the applications
// people sent. Applying takes a UW sign-in; api/apply.js checks and stores everything.

const FILE_ICON = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5";

const authHeader = (user) => ({ Authorization: `Bearer ${user.token}` });

function fileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// The roles you've applied for, so their cards say so (kept per sign-in, like Joins).
function useMyApplications(user) {
  const token = user?.token;
  const [mine, setMine] = useState({ token: null, jobs: [], apps: [] });
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/apply?mine=1", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d) =>
          !cancelled &&
          d?.jobs &&
          setMine((m) => ({
            token,
            jobs: [...new Set([...d.jobs, ...(m.token === token ? m.jobs : [])])],
            apps: d.applications ?? [],
          }))
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);
  const markApplied = useCallback(
    (jobId) =>
      setMine((m) => ({
        token,
        jobs: [...new Set([...(m.token === token ? m.jobs : []), jobId])],
        apps: m.token === token ? m.apps : [],
      })),
    [token]
  );
  const current = mine.token === token;
  // Your roles, a way to mark a new one, and your applications (status, interview, messages).
  return [current ? mine.jobs : [], markApplied, current ? mine.apps : []];
}

// Every application, for DubHub's moderators, and `update` to answer one (the server checks too).
function useHiring(user, moderator) {
  const token = user?.token;
  const [all, setAll] = useState({ token: null, list: null, error: false });
  useEffect(() => {
    if (!token || !moderator) return;
    let cancelled = false;
    fetch("/api/apply?all=1", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => !cancelled && setAll({ token, list: d.applications ?? [], error: false }))
      .catch(() => !cancelled && setAll({ token, list: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [token, moderator]);
  // Saves a change to one application. Resolves to an error message, or null when it worked.
  const update = useCallback(
    async (id, change) => {
      try {
        const r = await fetch("/api/apply", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, ...change }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return d.error || "Couldn't save that. Try again.";
        setAll((a) => ({ ...a, list: a.list?.map((x) => (x.id === id ? d.application : x)) ?? null }));
        return null;
      } catch {
        return "Couldn't reach DubHub. Check your connection and try again.";
      }
    },
    [token]
  );
  const current = moderator && all.token === token;
  return { list: current ? all.list : null, error: current && all.error, update };
}

// A file picker you can also drop a file on: a PDF or Word document up to `limit` bytes.
function FilePicker({ label, hint, file, limit, onChange }) {
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);
  const pick = (f) => {
    if (!f) return;
    if (!/\.(pdf|docx?)$/i.test(f.name)) return setError("Use a PDF or Word document.");
    if (f.size > limit) return setError(`That file is ${fileSize(f.size)}. The limit is ${fileSize(limit)}.`);
    setError(null);
    onChange(f);
  };
  return (
    <div className="file-field">
      <span className="field-label">{label}</span>
      {file ? (
        <div className="file-chosen">
          <span className="file-icon">
            <Icon d={FILE_ICON} />
          </span>
          <span className="file-name">{file.name}</span>
          <span className="meta">{fileSize(file.size)}</span>
          <button type="button" className="link-button" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      ) : (
        <label
          className={over ? "file-drop over" : "file-drop"}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files[0]);
          }}
        >
          <input type="file" accept={FILE_ACCEPT} aria-label={label} onChange={(e) => pick(e.target.files[0])} />
          <span>
            <strong>Choose a file</strong> or drop it here
          </span>
          <span className="meta">{hint}</span>
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ApplicationForm({ job, user, onApplied, onNeedSignIn }) {
  const [form, setForm] = useState({ name: user.name ?? "", phone: "", year: "", major: "", links: "" });
  const [answers, setAnswers] = useState({});
  const [resume, setResume] = useState(null);
  const [extra, setExtra] = useState(null);
  const [status, setStatus] = useState({ sending: false, error: null, done: null });
  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!resume) return setStatus({ sending: false, error: "Attach your resume (a PDF or Word document).", done: null });
    setStatus({ sending: true, error: null, done: null });
    try {
      const body = {
        jobId: job.id,
        ...form,
        answers,
        resume: { name: resume.name, data: await readBase64(resume) },
        extra: extra ? { name: extra.name, data: await readBase64(extra) } : null,
      };
      const r = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(user) },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) return onNeedSignIn(job.id); // the sign-in expired
      if (r.ok || r.status === 409) {
        onApplied(job.id);
        return setStatus({ sending: false, error: null, done: r.ok ? "sent" : "already" });
      }
      setStatus({ sending: false, error: d.error || "Something went wrong. Try again in a minute.", done: null });
    } catch {
      setStatus({ sending: false, error: "Couldn't send your application. Check your connection and try again.", done: null });
    }
  }

  if (status.done) {
    return (
      <div className="apply-done" role="status">
        <span className="apply-done-icon">
          <Icon d={CHECK_ICON} />
        </span>
        <h3>{status.done === "sent" ? "Application sent!" : "You've already applied"}</h3>
        <p>
          {status.done === "sent"
            ? `Thanks for applying to be our ${job.title}. We'll be in touch at ${user.email}.`
            : `We already have your application for ${job.title}.`}
        </p>
      </div>
    );
  }

  return (
    <form className="apply-form" onSubmit={submit}>
      <div className="apply-row">
        <label>
          <span className="field-label">Full name</span>
          <input value={form.name} onChange={field("name")} required maxLength={100} autoComplete="name" />
        </label>
        <label>
          <span className="field-label">Phone (optional)</span>
          <input type="tel" value={form.phone} onChange={field("phone")} maxLength={30} autoComplete="tel" />
        </label>
      </div>
      <p className="meta apply-email">
        We'll reply to <strong>{user.email}</strong>.
      </p>
      <div className="apply-row">
        <label>
          <span className="field-label">Class year</span>
          <select value={form.year} onChange={field("year")} required>
            <option value="">Choose one</option>
            {APPLY_YEARS.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Major</span>
          <input value={form.major} onChange={field("major")} maxLength={100} placeholder="e.g. Informatics" />
        </label>
      </div>
      <label>
        <span className="field-label">LinkedIn, portfolio, or GitHub (optional)</span>
        <input value={form.links} onChange={field("links")} maxLength={300} inputMode="url" placeholder="https://" />
      </label>
      {job.questions.map((q) => (
        <label key={q.id}>
          <span className="field-label">
            {q.label}
            {!q.required && " (optional)"}
          </span>
          <textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            required={q.required}
            maxLength={q.max}
            rows={4}
          />
          <span className="char-count">
            {(answers[q.id] ?? "").length}/{q.max}
          </span>
        </label>
      ))}
      <FilePicker
        label="Resume"
        hint="PDF or Word, up to 2 MB"
        file={resume}
        limit={FILE_LIMITS.resume}
        onChange={(f) => {
          setResume(f);
          setStatus((st) => ({ ...st, error: null }));
        }}
      />
      <FilePicker
        label="Cover letter or portfolio (optional)"
        hint="PDF or Word, up to 1 MB"
        file={extra}
        limit={FILE_LIMITS.extra}
        onChange={setExtra}
      />
      {status.error && (
        <p className="form-error" role="alert">
          {status.error}
        </p>
      )}
      <button className="join apply-submit" disabled={status.sending}>
        {status.sending ? "Sending…" : "Submit application"}
      </button>
    </form>
  );
}

function JobDialog({ job, user, applied, myApp, startOnForm, onApplied, onNeedSignIn, onClose }) {
  const signedIn = Boolean(user?.token);
  const [applying, setApplying] = useState(startOnForm && signedIn && !applied);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="club-backdrop" onClick={onClose}>
      <div
        className="club-modal job-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="club-close" aria-label="Close" onClick={onClose} autoFocus>
          <Icon d={CLOSE_ICON} />
        </button>
        <span className="job-team">{job.team}</span>
        <h2 id="job-title">{job.title}</h2>
        <p className="meta">
          {job.location} · {job.type}
        </p>
        {applying ? (
          <ApplicationForm job={job} user={user} onApplied={onApplied} onNeedSignIn={onNeedSignIn} />
        ) : (
          <>
            <p>{job.about}</p>
            <h3>What you'll do</h3>
            <ul>
              {job.youWill.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <h3>You might be a fit if</h3>
            <ul>
              {job.fit.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {applied ? (
              myApp ? (
                <MyApplication app={myApp} job={job} />
              ) : (
                <p className="applied-note">
                  <Icon d={CHECK_ICON} /> You've applied for this role.
                </p>
              )
            ) : (
              <button className="join apply-submit" onClick={() => (signedIn ? setApplying(true) : onNeedSignIn(job.id))}>
                {signedIn ? "Apply" : "Sign in to apply"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// What each question asked, for showing answers to the team (roles may have changed since).
function questionLabel(jobId, questionId) {
  return JOBS.find((j) => j.id === jobId)?.questions.find((q) => q.id === questionId)?.label ?? questionId;
}

function Careers({ user, moderator, onNeedSignIn, onOpenHiring, reopenJobId, onReopened }) {
  const [applied, markApplied, myApps] = useMyApplications(user);
  const myApp = (jobId) => myApps.find((a) => a.jobId === jobId);
  // A role you signed in to apply for opens again, right on its form.
  const [open, setOpen] = useState(() => (reopenJobId ? { id: reopenJobId, form: true } : null));
  useEffect(() => {
    if (reopenJobId) onReopened();
  }, [reopenJobId, onReopened]);
  const close = useCallback(() => setOpen(null), []);
  const job = JOBS.find((j) => j.id === open?.id);

  return (
    <section className="careers">
      <h2 id="careers">Careers</h2>
      <p>DubHub is built by UW students, for UW students. Want to help? Pick a role and apply with your UW account.</p>
      {SAMPLE_JOBS && <p className="careers-note">These are sample roles while we set up hiring. Real ones are coming soon.</p>}
      <ul className="jobs">
        {JOBS.map((j) => (
          <li key={j.id} className="job-card">
            <span className="job-team">{j.team}</span>
            <strong className="job-title">{j.title}</strong>
            <span className="meta">
              {j.location} · {j.type}
            </span>
            <p>{j.summary}</p>
            <div className="job-foot">
              <button className="join" onClick={() => setOpen({ id: j.id, form: false })}>
                {applied.includes(j.id) ? "View role" : "View & apply"}
              </button>
              {applied.includes(j.id) && (
                <span className="applied-tag">
                  <Icon d={CHECK_ICON} /> {APPLICANT_STATUS[myApp(j.id)?.status] ?? "Applied"}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {moderator && (
        <p className="careers-note mod-note">
          Moderators: read and answer applications in the{" "}
          <button className="link-button" onClick={onOpenHiring}>
            Hiring
          </button>{" "}
          tab.
        </p>
      )}
      {job && (
        <JobDialog
          key={job.id}
          job={job}
          user={user}
          applied={applied.includes(job.id)}
          myApp={myApp(job.id)}
          startOnForm={open.form}
          onApplied={markApplied}
          onNeedSignIn={onNeedSignIn}
          onClose={close}
        />
      )}
    </section>
  );
}

// --------------------------------------------------------------- friends ---
// Friends and messages (api/social.js): add friends by their UW email, see the events they're
// going to, and message them. The mailbox in the top bar shows how many messages and friend
// requests are waiting.

const MAIL_ICON = "M3 6h18v12H3zM3 7l9 6 9-6";

// Your friends, requests, and conversations, checked every so often (more often on the Friends page).
function useSocial(user, often) {
  const token = user?.token;
  const [state, setState] = useState({ token: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/social", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && data && setState({ token, data }))
      .catch(() => {});
    const timer = setTimeout(() => setTick((t) => t + 1), often ? 8000 : 30000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, often, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // Sends a request, an answer, or a message. Resolves to an error message, or null when it worked.
  const act = useCallback(
    async (action, email, text) => {
      try {
        const r = await fetch("/api/social", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action, email, text }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return d.error || "That didn't work. Try again.";
        refresh();
        return null;
      } catch {
        return "Couldn't reach DubHub. Check your connection.";
      }
    },
    [token, refresh]
  );
  const data = state.token === token ? state.data : null;
  const waiting = data ? data.unread + data.incoming.length : 0;
  return { data, waiting, act, refresh };
}

function MailButton({ count, active, onClick }) {
  return (
    <button
      className={active ? "theme-toggle mail-button on" : "theme-toggle mail-button"}
      onClick={onClick}
      aria-label={count ? `Friends and messages, ${count} new` : "Friends and messages"}
      title="Friends and messages"
    >
      <Icon d={MAIL_ICON} />
      {count > 0 && <span className="mail-count">{count > 9 ? "9+" : count}</span>}
    </button>
  );
}

function Avatar({ person }) {
  const [failed, setFailed] = useState(false);
  if (person.picture && !failed) {
    return <img className="friend-avatar" src={person.picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <span className="friend-avatar initials">{initials(person.name)}</span>;
}

// One conversation, checked every few seconds while it's open.
function Conversation({ user, friend, isFriend, onSend }) {
  const token = user.token;
  const [state, setState] = useState({ with: null, messages: [] });
  const [tick, setTick] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const end = useRef(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/social?with=${encodeURIComponent(friend.email)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setState({ with: friend.email, messages: d.messages }))
      .catch(() => {});
    const timer = setTimeout(() => setTick((t) => t + 1), 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, friend.email, tick]);
  const messages = state.with === friend.email ? state.messages : [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const err = await onSend(friend.email, text);
    setError(err);
    if (!err) {
      setText("");
      setTick((t) => t + 1);
    }
  };

  return (
    <div className="convo">
      <ul className="convo-list" aria-live="polite">
        {messages.length === 0 && <li className="meta convo-empty">No messages yet. Say hi!</li>}
        {messages.map((m, i) => (
          <li key={i} className={m.from === "me" ? "bubble mine" : "bubble"}>
            <span>{m.text}</span>
            <time>{dateTime(m.at)}</time>
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ul>
      {isFriend ? (
        <form className="convo-send" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={`Message ${firstName(friend.name)}`}
            aria-label={`Message ${friend.name}`}
          />
          <button className="join" disabled={!text.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="meta">You're no longer friends, so you can't send new messages.</p>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function FriendsPage({ user, social, events, onOpenEvent }) {
  const { data, act } = social;
  const [email, setEmail] = useState("");
  const [note, setNote] = useState(null);
  const [openEmail, setOpenEmail] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    const err = await act("request", address.includes("@") ? address : `${address}@uw.edu`);
    setNote(err ? { error: err } : { ok: "Request sent. You'll be friends once they accept." });
    if (!err) setEmail("");
  };

  if (!data) {
    return (
      <main className="page friends-page">
        <h1>Friends</h1>
        <p className="meta">Loading…</p>
      </main>
    );
  }
  const convoOf = (address) => data.conversations.find((c) => c.email === address);
  // Friends, plus anyone you've talked to who isn't a friend anymore (to read the old messages).
  const people = [
    ...data.friends.map((f) => ({ ...f, isFriend: true })),
    ...data.conversations.filter((c) => !data.friends.some((f) => f.email === c.email)).map((c) => ({ ...c, going: [], isFriend: false })),
  ].sort((a, b) => (convoOf(b.email)?.last.at ?? "").localeCompare(convoOf(a.email)?.last.at ?? "") || a.name.localeCompare(b.name));
  const open = people.find((p) => p.email === openEmail);
  const goingTo = (p) =>
    p.going
      .map((id) => events.find((e) => String(e.id) === String(id)))
      .filter(Boolean)
      .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));

  return (
    <main className={open ? "page friends-page reading" : "page friends-page"}>
      <div className="stats-head">
        <h1>Friends</h1>
        <span className="meta">See what your friends are going to, and message them. Only friends can message you.</span>
      </div>
      <div className="friends">
        <div className="friends-side">
          <form className="add-friend" onSubmit={add}>
            <label className="field-label" htmlFor="add-friend">
              Add a friend
            </label>
            <div className="add-friend-row">
              <input
                id="add-friend"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Their NetID or UW email"
                autoComplete="off"
              />
              <button className="join" disabled={!email.trim()}>
                Add
              </button>
            </div>
            {note && <p className={note.error ? "form-error" : "meta"}>{note.error || note.ok}</p>}
          </form>

          {data.incoming.length > 0 && (
            <section>
              <h2 className="side-head">Friend requests</h2>
              <ul className="people">
                {data.incoming.map((p) => (
                  <li key={p.email} className="person">
                    <Avatar person={p} />
                    <span className="person-text">
                      <strong>{p.name}</strong>
                      <span className="meta">{p.email}</span>
                    </span>
                    <span className="person-actions">
                      <button className="join" onClick={() => act("accept", p.email)}>
                        Accept
                      </button>
                      <button className="link-button" onClick={() => act("decline", p.email)}>
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="side-head">Your friends</h2>
            {people.length === 0 ? (
              <p className="meta">No friends yet. Add someone by their UW email above.</p>
            ) : (
              <ul className="people">
                {people.map((p) => {
                  const convo = convoOf(p.email);
                  return (
                    <li key={p.email}>
                      <button className={p.email === openEmail ? "person on" : "person"} onClick={() => setOpenEmail(p.email)}>
                        <Avatar person={p} />
                        <span className="person-text">
                          <strong>{p.name}</strong>
                          <span className="meta">
                            {convo
                              ? `${convo.last.from === "me" ? "You: " : ""}${convo.last.text}`
                              : `Going to ${goingTo(p).length} event${goingTo(p).length === 1 ? "" : "s"}`}
                          </span>
                        </span>
                        {convo?.unread > 0 && <span className="mail-count inline">{convo.unread}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {data.outgoing.length > 0 && (
            <section>
              <h2 className="side-head">Waiting for them to accept</h2>
              <ul className="people">
                {data.outgoing.map((p) => (
                  <li key={p.email} className="person">
                    <Avatar person={p} />
                    <span className="person-text">
                      <strong>{p.name}</strong>
                      <span className="meta">{p.email}</span>
                    </span>
                    <button className="link-button" onClick={() => act("remove", p.email)}>
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {open ? (
          <article className="friend-detail">
            <button className="link-button hiring-back" onClick={() => setOpenEmail(null)}>
              <Icon d={BACK_ICON} /> Friends
            </button>
            <div className="friend-head">
              <Avatar person={open} />
              <div>
                <h2>{open.name}</h2>
                <p className="meta">{open.email}</p>
              </div>
              {open.isFriend && (
                <button
                  className="link-button unfriend"
                  onClick={() => {
                    if (window.confirm(`Remove ${open.name} from your friends?`)) act("remove", open.email);
                  }}
                >
                  Unfriend
                </button>
              )}
            </div>
            {open.isFriend && (
              <>
                <h3>Going to</h3>
                {goingTo(open).length ? (
                  <ul className="friend-events">
                    {goingTo(open).map((e) => (
                      <li key={e.id}>
                        <button className="club-link" onClick={() => onOpenEvent(e)}>
                          {e.title}
                        </button>
                        <span className="meta">{[formatWhen(e), e.where].filter(Boolean).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="meta">Not going to any upcoming events yet.</p>
                )}
              </>
            )}
            <h3>Messages</h3>
            <Conversation key={open.email} user={user} friend={open} isFriend={open.isFriend} onSend={(to, text) => act("message", to, text)} />
          </article>
        ) : (
          <div className="hiring-empty meta">Pick a friend to see their events and message them.</div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- hiring ---
// The Hiring tab, for moderators: read every application, set where it stands, schedule an
// interview (with a Google Calendar invite for the applicant), and write back. Applicants see the
// status, the interview, and the responses (never the private notes) on their application in the
// Careers section; each response can also go out by email.

const STATUS_LABELS = { new: "New", reviewing: "Reviewing", interview: "Interview", offer: "Offer", declined: "Not moving forward" };
// What applicants see for each status.
const APPLICANT_STATUS = { new: "Applied", reviewing: "Applied", interview: "Interview", offer: "Offer", declined: "Closed" };
const CALENDAR_ICON = "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4";
const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "there";

// Ready-made responses: each fills in the message and the status it moves the application to.
const RESPONSE_TEMPLATES = [
  {
    label: "Invite to interview",
    status: "interview",
    text: (app, me) =>
      `Hi ${firstName(app.name)},\n\nThanks for applying to be DubHub's ${app.jobTitle}! We'd love to meet you for a short interview. You'll find the time and place on your application in the Careers section of DubHub's About page. If it doesn't work for you, just reply and we'll find another time.\n\n${firstName(me)}`,
  },
  {
    label: "Still reviewing",
    status: "reviewing",
    text: (app, me) =>
      `Hi ${firstName(app.name)},\n\nThanks for applying to be DubHub's ${app.jobTitle}. We're reading every application carefully and will get back to you soon.\n\n${firstName(me)}`,
  },
  {
    label: "Make an offer",
    status: "offer",
    text: (app, me) =>
      `Hi ${firstName(app.name)},\n\nWe loved meeting you, and we'd like to offer you the ${app.jobTitle} role at DubHub! Let us know if you're in, and we'll set up a time to get you started.\n\n${firstName(me)}`,
  },
  {
    label: "Not moving forward",
    status: "declined",
    text: (app, me) =>
      `Hi ${firstName(app.name)},\n\nThank you for applying to be DubHub's ${app.jobTitle}, and for the thought you put into your answers. We've decided not to move forward this time, but we hope you'll keep using DubHub and apply again in the future.\n\n${firstName(me)}`,
  },
];

const calStamp = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function interviewWhen(interview) {
  const start = new Date(interview.start);
  const end = new Date(start.getTime() + interview.minutes * 60000);
  const time = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time(start)} – ${time(end)}`;
}

// A Google Calendar event, filled in. `guests` get the invite from Google when it's saved.
function interviewCalendarUrl({ title, start, minutes, where, details, guests }) {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${calStamp(start)}/${calStamp(Date.parse(start) + minutes * 60000)}`,
    location: where,
    details: details || "",
  });
  if (guests) q.set("add", guests);
  return `https://calendar.google.com/calendar/render?${q}`;
}

// The same event as an .ics file, for any other calendar app.
function downloadIcs({ title, start, minutes, where, details }) {
  const esc = (t) => String(t ?? "").replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DubHub//Hiring//EN",
    "BEGIN:VEVENT",
    `UID:${calStamp(start)}-${Math.random().toString(36).slice(2)}@dubhub`,
    `DTSTAMP:${calStamp(Date.now())}`,
    `DTSTART:${calStamp(start)}`,
    `DTEND:${calStamp(Date.parse(start) + minutes * 60000)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc(details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "dubhub-interview.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function downloadApplicationFile(user, app, kind) {
  const r = await fetch(`/api/apply?file=${encodeURIComponent(app.id)}&kind=${kind}`, { headers: authHeader(user) });
  if (!r.ok) throw new Error(String(r.status));
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = app.files[kind].name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const mailtoFor = (app, body) =>
  `mailto:${app.email}?subject=${encodeURIComponent(`Your DubHub application: ${app.jobTitle}`)}&body=${encodeURIComponent(body)}`;

// An interview's time and place, with ways to put it on a calendar. With `guest`, the Google
// Calendar link also invites them, so Google emails them the invite once it's saved.
function InterviewCard({ interview, title, guest, details, children }) {
  const cal = { title, start: interview.start, minutes: interview.minutes, where: interview.where, details: details ?? interview.note ?? "" };
  return (
    <div className="interview-card">
      <span className="interview-icon">
        <Icon d={CALENDAR_ICON} />
      </span>
      <div>
        <strong>{interviewWhen(interview)}</strong>
        <span className="meta">
          {/^https?:\/\/\S+$/i.test(interview.where) ? (
            <a href={interview.where} target="_blank" rel="noreferrer noopener">
              Video call link
            </a>
          ) : (
            interview.where
          )}
        </span>
        {interview.note && <p>{interview.note}</p>}
        <div className="interview-links">
          <a href={interviewCalendarUrl({ ...cal, guests: guest })} target="_blank" rel="noreferrer noopener">
            {guest ? "Add to Google Calendar and invite them" : "Add to Google Calendar"}
          </a>
          <button type="button" className="link-button" onClick={() => downloadIcs(cal)}>
            Download for another calendar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// An applicant's own application, inside its role: where it stands, the interview, and messages.
function MyApplication({ app, job }) {
  return (
    <div className="my-application">
      <h3>Your application</h3>
      <p className="meta">
        Sent {shortDate(app.at)} · <strong>{APPLICANT_STATUS[app.status] ?? "Applied"}</strong>
      </p>
      {app.interview && (
        <InterviewCard
          interview={app.interview}
          title={`DubHub interview: ${job.title}`}
          details={`Your interview for DubHub's ${job.title}.${app.interview.note ? `\n\n${app.interview.note}` : ""}`}
        />
      )}
      {app.messages.length > 0 ? (
        <ul className="thread">
          {app.messages.map((m, i) => (
            <li key={i} className="thread-item">
              <span className="thread-head">
                <strong>{m.by}</strong> from DubHub · {dateTime(m.at)}
              </span>
              <p>{m.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        !app.interview && <p className="meta">We'll reply here, and at your UW email.</p>
      )}
    </div>
  );
}

function StatusChip({ status }) {
  return <span className={`status-chip ${status ?? "new"}`}>{STATUS_LABELS[status ?? "new"]}</span>;
}

function InterviewForm({ initial, busy, onSave, onCancel }) {
  const start = initial ? new Date(initial.start) : null;
  const [date, setDate] = useState(start ? start.toLocaleDateString("en-CA") : localDate(1));
  const [time, setTime] = useState(start ? start.toTimeString().slice(0, 5) : "15:00");
  const [minutes, setMinutes] = useState(initial?.minutes ?? 30);
  const [where, setWhere] = useState(initial?.where ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const submit = (e) => {
    e.preventDefault();
    onSave({ start: new Date(`${date}T${time}`).toISOString(), minutes: Number(minutes), where, note });
  };
  return (
    <form className="apply-form interview-form" onSubmit={submit}>
      <div className="apply-row">
        <label>
          <span className="field-label">Date</span>
          <input type="date" value={date} min={localDate(0)} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          <span className="field-label">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
      </div>
      <div className="apply-row">
        <label>
          <span className="field-label">Length</span>
          <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[15, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Where</span>
          <input
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="HUB 250, or a Zoom or Meet link"
            maxLength={200}
            required
          />
        </label>
      </div>
      <label>
        <span className="field-label">Note for them (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
      </label>
      <div className="form-buttons">
        <button className="join" disabled={busy}>
          {initial ? "Save the new time" : "Schedule"}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Everything that happened on an application: responses, private notes, interviews, and status changes.
function Thread({ app }) {
  const items = app.thread ?? [];
  if (!items.length) return <p className="meta">No responses yet.</p>;
  return (
    <ul className="thread">
      {items.map((t, i) => (
        <li key={i} className={t.kind !== "message" ? "thread-item event" : t.internal ? "thread-item note" : "thread-item"}>
          <span className="thread-head">
            <strong>{t.by}</strong> · {dateTime(t.at)}
            {t.internal && <span className="note-tag">Private note</span>}
          </span>
          {t.kind === "message" && <p>{t.text}</p>}
          {t.kind === "message" && !t.internal && (
            <a className="thread-email" href={mailtoFor(app, t.text)}>
              Email it to {firstName(app.name)}
            </a>
          )}
          {t.kind === "interview" && (
            <p>
              Scheduled an interview: {interviewWhen(t.interview)}, {t.interview.where}
            </p>
          )}
          {t.kind === "interview-cancelled" && <p>Cancelled the interview</p>}
          {t.kind === "status" && <p>Set the status to {STATUS_LABELS[t.status]}</p>}
        </li>
      ))}
    </ul>
  );
}

function ResponseComposer({ app, user, busy, onSend }) {
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState(""); // "" keeps the status as it is
  const applyTemplate = (t) => {
    setText(t.text(app, user.name));
    setStatus(t.status);
    setInternal(false);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (await onSend({ message: { text, internal }, ...(status ? { status } : {}) })) {
      setText("");
      setStatus("");
      setInternal(false);
    }
  };
  return (
    <form className="composer" onSubmit={submit}>
      <div className="templates">
        <span className="meta">Start from:</span>
        {RESPONSE_TEMPLATES.map((t) => (
          <button key={t.label} type="button" className="chip-btn" onClick={() => applyTemplate(t)}>
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        maxLength={2000}
        placeholder={internal ? "A note for the other moderators" : `Write to ${firstName(app.name)}`}
        aria-label={internal ? "Private note" : `Response to ${app.name}`}
      />
      <div className="composer-foot">
        <label className="check">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          Private note (only moderators see it)
        </label>
        <label className="status-after">
          <span>Then set the status to</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{STATUS_LABELS[app.status ?? "new"]} (no change)</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="join" disabled={busy || !text.trim()}>
          {internal ? "Save note" : "Send response"}
        </button>
      </div>
      {!internal && <p className="meta composer-hint">They'll see it on their application. Use “Email it” to send it to their inbox too.</p>}
    </form>
  );
}

function ApplicationDetail({ app, user, onUpdate, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const save = async (change) => {
    setBusy(true);
    setError(null);
    const err = await onUpdate(app.id, change);
    setBusy(false);
    setError(err);
    return !err;
  };
  const download = (kind) => downloadApplicationFile(user, app, kind).catch(() => setError("Couldn't download that file. Try again."));

  return (
    <article className="hiring-detail">
      <button className="link-button hiring-back" onClick={onBack}>
        <Icon d={BACK_ICON} /> All applications
      </button>
      <div className="detail-top">
        <div>
          <h2>{app.name}</h2>
          <p className="meta">
            {app.jobTitle} · applied {dateTime(app.at)}
          </p>
        </div>
        <label className="status-pick">
          <span className="field-label">Status</span>
          <select value={app.status ?? "new"} disabled={busy} onChange={(e) => save({ status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="meta">
        <a href={`mailto:${app.email}`}>{app.email}</a>
        {[app.phone, app.year, app.major].filter(Boolean).map((x) => ` · ${x}`)}
      </p>
      {app.links &&
        (/^https?:\/\/\S+$/i.test(app.links) ? (
          <p>
            <a href={app.links} target="_blank" rel="noreferrer noopener">
              {app.links}
            </a>
          </p>
        ) : (
          <p>{app.links}</p>
        ))}
      <div className="app-files">
        {["resume", "extra"].map(
          (kind) =>
            app.files?.[kind] && (
              <button key={kind} className="join" onClick={() => download(kind)}>
                {kind === "resume" ? "Resume" : "Cover letter / portfolio"} ({fileSize(app.files[kind].size)})
              </button>
            )
        )}
      </div>
      <dl className="answers">
        {Object.entries(app.answers || {}).map(([q, answer]) => (
          <div key={q}>
            <dt>{questionLabel(app.jobId, q)}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>

      <h3>Interview</h3>
      {scheduling ? (
        <InterviewForm
          initial={app.interview}
          busy={busy}
          onCancel={() => setScheduling(false)}
          onSave={async (interview) => {
            if (await save({ interview })) setScheduling(false);
          }}
        />
      ) : app.interview ? (
        <InterviewCard
          interview={app.interview}
          title={`DubHub interview: ${app.name} (${app.jobTitle})`}
          guest={app.email}
          details={`Interview with ${app.name} for DubHub's ${app.jobTitle}.${app.interview.note ? `\n\n${app.interview.note}` : ""}`}
        >
          <div className="interview-actions">
            <button className="link-button" onClick={() => setScheduling(true)}>
              Change the time
            </button>
            <button className="link-button" disabled={busy} onClick={() => save({ interview: null })}>
              Cancel the interview
            </button>
          </div>
        </InterviewCard>
      ) : (
        <button className="join" onClick={() => setScheduling(true)}>
          Schedule an interview
        </button>
      )}

      <h3>Responses</h3>
      <Thread app={app} />
      <ResponseComposer app={app} user={user} busy={busy} onSend={save} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function HiringPage({ user }) {
  const { list, error, update } = useHiring(user, true);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState(null);
  const apps = list ?? [];
  const shown = apps.filter((a) => (!role || a.jobId === role) && (!status || (a.status ?? "new") === status));
  const open = apps.find((a) => a.id === openId);
  const counts = {};
  for (const a of apps) counts[a.status ?? "new"] = (counts[a.status ?? "new"] ?? 0) + 1;

  return (
    <main className={open ? "page hiring-page reading" : "page hiring-page"}>
      <div className="stats-head">
        <h1>Hiring</h1>
        <span className="meta">
          Only moderators can see this page. Applicants see your responses and interview times (not private notes) on their
          application.
        </span>
      </div>
      {error && <p className="form-error">Couldn't load the applications. Try reloading the page.</p>}
      {!list && !error && <p className="meta">Loading applications…</p>}
      {list && (
        <div className="hiring">
          <div className="hiring-list">
            <div className="hiring-filters">
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
                <option value="">All roles</option>
                {JOBS.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="">Any status ({apps.length})</option>
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label} ({counts[key] ?? 0})
                  </option>
                ))}
              </select>
            </div>
            {shown.length === 0 ? (
              <p className="meta hiring-none">
                {apps.length ? "No applications match." : "No applications yet. They'll show up here as people apply."}
              </p>
            ) : (
              <ul>
                {shown.map((a) => (
                  <li key={a.id}>
                    <button className={a.id === openId ? "hiring-row on" : "hiring-row"} onClick={() => setOpenId(a.id)}>
                      <span className="hiring-row-top">
                        <strong>{a.name}</strong>
                        <StatusChip status={a.status} />
                      </span>
                      <span className="meta">
                        {a.jobTitle} · {shortDate(a.at)}
                      </span>
                      {a.interview && <span className="meta">Interview {interviewWhen(a.interview)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {open ? (
            <ApplicationDetail key={open.id} app={open} user={user} onUpdate={update} onBack={() => setOpenId(null)} />
          ) : (
            <div className="hiring-empty meta">Pick an application to read it.</div>
          )}
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- stats ---
// The Stats page, for moderators only: how DubHub is doing over time, with a point for every
// update that goes live (each change and each scrape; see scripts/record-stats.mjs), and right
// now. The charts follow the dataviz skill: thin marks on hairline grids, a legend for two or
// more series, values on hover and keyboard focus, and every chart's numbers in a table too.

const TREND_SERIES = [
  { key: "upcoming", name: "Upcoming events", color: "var(--chart-1)" },
  { key: "clubs", name: "Clubs", color: "var(--chart-2)" },
];

const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString());
const shortDate = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const dateTime = (t) =>
  new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function useStats(user) {
  const token = user?.token;
  const [state, setState] = useState({ token: null, data: null, error: false });
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/stats", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => !cancelled && setState({ token, data, error: false }))
      .catch(() => !cancelled && setState({ token, data: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [token]);
  return state.token === token ? state : { data: null, error: false };
}

// How wide a chart can draw, kept up to date as the window changes.
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// Round axis steps (1, 2, or 5 times a power of ten) from 0 to just past `max`.
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((st) => st >= raw);
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

// A column with a rounded top and a square bottom (on the baseline).
function columnPath(x, y, w, h) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Lines over time, one point per update. A crosshair finds the nearest update under the pointer
// (or with the arrow keys) and the tooltip lists every series there.
function TrendChart({ points, series }) {
  const [box, width] = useWidth();
  const [active, setActive] = useState(null);
  const W = Math.max(width, 280);
  const H = 240;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const times = points.map((pt) => Date.parse(pt.at));
  const [t0, t1] = [times[0], times.at(-1)];
  const ticks = niceTicks(Math.max(...points.flatMap((pt) => series.map((ser) => pt[ser.key] ?? 0))));
  const top = ticks.at(-1);
  const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const dayTicks = [];
  const every = Math.max(1, Math.ceil(((t1 - t0) / 864e5) / Math.max(1, Math.floor((W - pad.l - pad.r) / 90))));
  for (let t = new Date(new Date(t0).toDateString()).getTime() + 864e5; t <= t1; t += every * 864e5) dayTicks.push(t);
  const nearest = (px) => times.reduce((best, t, i) => (Math.abs(x(t) - px) < Math.abs(x(times[best]) - px) ? i : best), 0);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setActive(nearest(((e.clientX - r.left) / r.width) * W));
  };
  const onKey = (e) => {
    if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? points.length) - 1));
    else if (e.key === "ArrowRight") setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
    else return;
    e.preventDefault();
  };
  const pt = active == null ? null : points[active];
  const tipLeft = active == null ? 0 : x(times[active]);
  // A value that's still blank breaks the line instead of dropping it to zero (fillGaps fills
  // the known gaps first).
  const linePath = (key) => {
    let d = "";
    let drawing = false;
    points.forEach((p2, i) => {
      if (p2[key] == null) return void (drawing = false);
      d += `${drawing ? "L" : "M"}${x(times[i]).toFixed(1)},${y(p2[key]).toFixed(1)}`;
      drawing = true;
    });
    return d;
  };

  return (
    <div className="chart" ref={box}>
      <ul className="chart-legend">
        {series.map((ser) => (
          <li key={ser.key}>
            <span className="key" style={{ background: ser.color }} />
            {ser.name} <strong>{fmt(points.at(-1)?.[ser.key])}</strong>
          </li>
        ))}
      </ul>
      {width > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${series.map((ser) => ser.name).join(" and ")} at each update. Use the arrow keys to step through them.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(points.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {dayTicks.map((t) => (
            <text key={t} className="tick" x={x(t)} y={H - 8} textAnchor="middle">
              {shortDate(t)}
            </text>
          ))}
          {series.map((ser) => (
            <path key={ser.key} className="line" stroke={ser.color} d={linePath(ser.key)} />
          ))}
          {pt && <line className="crosshair" x1={tipLeft} x2={tipLeft} y1={pad.t} y2={H - pad.b} />}
          {series.map((ser) => {
            const i = active ?? points.length - 1;
            const v = points[i][ser.key];
            return v == null ? null : <circle key={ser.key} className="dot" cx={x(times[i])} cy={y(v)} r={4} fill={ser.color} />;
          })}
        </svg>
      )}
      {pt && (
        <div className={tipLeft > W * 0.6 ? "chart-tip left" : "chart-tip"} style={{ left: tipLeft }}>
          <span className="tip-when">
            {dateTime(pt.at)} · {pt.kind === "scrape" ? "Scrape" : "Change"}
          </span>
          {pt.message && <span className="tip-what">{pt.message}</span>}
          {series.map((ser) => (
            <span key={ser.key} className="tip-row">
              <span className="key" style={{ background: ser.color }} />
              <strong>{fmt(pt[ser.key])}</strong> {ser.name.toLowerCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// One column per day; the busiest day is labeled, and every column shows its count on hover or focus.
function DayColumns({ days }) {
  const [box, width] = useWidth();
  const [active, setActive] = useState(null);
  const W = Math.max(width, 260);
  const H = 190;
  const pad = { l: 30, r: 4, t: 18, b: 26 };
  const ticks = niceTicks(Math.max(...days.map((d) => d.count)), 3);
  const top = ticks.at(-1);
  const band = (W - pad.l - pad.r) / days.length;
  const bar = Math.min(24, band * 0.62);
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const busiest = days.reduce((m, d, i) => (d.count > days[m].count ? i : m), 0);
  const labelEvery = band < 34 ? 2 : 1;
  const shown = active ?? busiest;

  return (
    <div className="chart" ref={box}>
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = pad.l + band * i + band / 2;
            const day = new Date(`${d.date}T12:00`);
            const label = `${day.toLocaleDateString([], { weekday: "short" })} ${day.getDate()}`;
            return (
              <g
                key={d.date}
                className={i === active ? "column on" : "column"}
                tabIndex={0}
                aria-label={`${label}: ${d.count} events`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <rect className="hit" x={cx - band / 2} y={pad.t} width={band} height={H - pad.t - pad.b} />
                <path d={columnPath(cx - bar / 2, y(d.count), bar, y(0) - y(d.count))} fill="var(--chart-1)" />
                {i === shown && d.count > 0 && (
                  <text className="cap" x={cx} y={y(d.count) - 6} textAnchor="middle">
                    {d.count}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text className="tick" x={cx} y={H - 8} textAnchor="middle">
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// Ranked bars (largest first), each with its value at the tip. `swatch` ties a row to the map's colors.
function BarList({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bar-label">
            {r.swatch && <i style={{ background: r.swatch }} />}
            <span>{r.label}</span>
          </span>
          <span className="bar-track">
            <span className="bar" style={{ "--share": r.value / max }} />
            <span className="bar-value">{fmt(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Every chart's numbers, for reading without the chart.
function ChartTable({ head, rows }) {
  return (
    <details className="chart-table">
      <summary>Show as a table</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function StatTile({ label, value, delta, note }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{fmt(value)}</strong>
      {delta != null ? (
        <span className={delta > 0 ? "stat-delta up" : "stat-delta"}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {fmt(Math.abs(delta))} {note}
        </span>
      ) : (
        note && <span className="stat-delta">{note}</span>
      )}
    </div>
  );
}

const counted = (obj) =>
  Object.entries(obj)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "");

// The few updates with a blank count (when the Clubs page briefly listed all ~1,180 HuskyLink
// clubs; see siteStats in src/eventGroups.js) take the last known count, so the lines run straight
// through instead of spiking or breaking.
function fillGaps(snapshots, keys = ["upcoming", "onMap", "clubs", "clubsOnInstagram"]) {
  const last = {};
  const filled = snapshots.map((sn) => {
    const copy = { ...sn };
    for (const key of keys) {
      if (copy[key] == null) copy[key] = last[key] ?? null;
      else last[key] = copy[key];
    }
    return copy;
  });
  for (const key of keys) {
    // Blanks at the very start take the first known count.
    const first = filled.find((sn) => sn[key] != null)?.[key] ?? null;
    for (const sn of filled) {
      if (sn[key] != null) break;
      sn[key] = first;
    }
  }
  return filled;
}

// Everyone who has signed in, most recently active first, with a search for long lists.
function MembersList({ members }) {
  const [q, setQ] = useState("");
  const sorted = [...members].sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.name.localeCompare(b.name));
  const shown = sorted.filter((m) => !q || `${m.name} ${m.email}`.toLowerCase().includes(q.toLowerCase()));
  const [week] = useState(() => Date.now() - 7 * 864e5); // a week before the page opened
  const active = members.filter((m) => m.lastSeen && Date.parse(m.lastSeen) >= week).length;
  return (
    <section className="chart-card wide">
      <div className="members-head">
        <div>
          <h2>Members</h2>
          <p className="chart-sub">
            {fmt(members.length)} people have signed in so far · {fmt(active)} active in the last week.
          </p>
        </div>
        <input className="members-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or emails" aria-label="Search members" />
      </div>
      <div className="table-scroll members-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>UW email</th>
              <th>First signed in</th>
              <th>Last active</th>
              <th>Events joined</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.email}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>{m.firstSeen ? shortDate(m.firstSeen) : "Before Nov 7"}</td>
                <td>{m.lastSeen ? dateTime(m.lastSeen) : "–"}</td>
                <td>{fmt(m.joined)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="meta">No one matches.</p>}
      </div>
    </section>
  );
}

function StatsPage({ user, events, clubs, dark }) {
  const { data, error } = useStats(user);
  const snapshots = useMemo(() => fillGaps(data?.snapshots ?? []), [data]);
  const live = data?.live;

  // Right now, from what the site has loaded (the same counting as the snapshots).
  const onMap = events.filter((e) => e.pos).length;
  const byGroup = {};
  const bySource = {};
  for (const e of events) {
    const g = eventGroup(e).name;
    byGroup[g] = (byGroup[g] ?? 0) + 1;
    const src = { instagram: "Instagram", huskylink: "HuskyLink" }[e.source] ?? "Other";
    bySource[src] = (bySource[src] ?? 0) + 1;
  }
  const groupRows = [...CATEGORY_GROUPS, OTHER_GROUP]
    .map((g) => ({ label: g.name, value: byGroup[g.name] ?? 0, swatch: dark ? g.dark : g.light }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = localDate(i);
    return { date, count: events.filter((e) => e.date === date).length };
  });

  // Compared with the latest update at least a week before the newest one.
  const latest = snapshots.at(-1);
  const weekAgo = latest && [...snapshots].reverse().find((sn) => Date.parse(sn.at) <= Date.parse(latest.at) - 7 * 864e5);
  const delta = (key, now) => (weekAgo?.[key] != null ? now - weekAgo[key] : null);
  const scrapes = snapshots.filter((sn) => sn.kind === "scrape").length;

  const joined = (live?.topJoined ?? [])
    .map((t) => ({ label: events.find((e) => String(e.id) === t.id)?.title, value: t.count }))
    .filter((r) => r.label);
  const roles = JOBS.map((job) => ({ label: job.title, value: live?.byRole?.[job.id] ?? 0 })).sort((a, b) => b.value - a.value);
  const recent = snapshots.slice(-12).reverse();

  return (
    <main className="page stats-page">
      <div className="stats-head">
        <h1>Stats</h1>
        <span className="meta">Only moderators can see this page. It gets a new point every time a change or a scrape goes live.</span>
      </div>
      {error && (
        <p className="form-error">Couldn't load the history and live counts. The charts below use what this page has loaded.</p>
      )}

      <div className="stat-row">
        <StatTile label="Upcoming events" value={events.length} delta={delta("upcoming", events.length)} note="vs a week ago" />
        <StatTile label="On the map" value={onMap} delta={delta("onMap", onMap)} note="vs a week ago" />
        <StatTile label="Clubs" value={clubs.length} delta={delta("clubs", clubs.length)} note="vs a week ago" />
        <StatTile
          label="Members"
          value={live?.members?.length}
          delta={weekAgo?.members != null && live ? live.members.length - weekAgo.members : null}
          note={weekAgo?.members != null ? "vs a week ago" : "signed in so far"}
        />
        <StatTile label="People who joined events" value={live?.joiners} note={live ? `${fmt(live.joins)} joins in all` : null} />
        <StatTile label="Job applications" value={live?.applications} />
      </div>

      {snapshots.length > 1 && (
        <section className="chart-card wide">
          <h2>Upcoming events and clubs over time</h2>
          <p className="chart-sub">
            One point per update: {fmt(scrapes)} scrapes and {fmt(snapshots.length - scrapes)} changes since{" "}
            {shortDate(snapshots[0].at)}. Upcoming events drop as events pass.
          </p>
          <TrendChart points={snapshots} series={TREND_SERIES} />
          <ChartTable
            head={["When", "Update", "Upcoming events", "Clubs"]}
            rows={[...snapshots].reverse().map((sn) => [dateTime(sn.at), sn.message || sn.kind, fmt(sn.upcoming), fmt(sn.clubs)])}
          />
        </section>
      )}

      <div className="stats-grid two">
        <section className="chart-card">
          <h2>Upcoming events by club type</h2>
          <p className="chart-sub">The same groups and colors as the map.</p>
          <BarList rows={groupRows} />
          <ChartTable head={["Club type", "Events"]} rows={groupRows.map((r) => [r.label, fmt(r.value)])} />
        </section>
        <section className="chart-card">
          <h2>Events in the next two weeks</h2>
          <p className="chart-sub">Events per day, starting today.</p>
          <DayColumns days={days} />
          <ChartTable head={["Day", "Events"]} rows={days.map((d) => [d.date, fmt(d.count)])} />
        </section>
      </div>
      <div className="stats-grid">
        <section className="chart-card">
          <h2>Where events come from</h2>
          <p className="chart-sub">Upcoming events by the site they were found on.</p>
          <BarList rows={counted(bySource)} />
        </section>
        <section className="chart-card">
          <h2>Most-joined events</h2>
          <p className="chart-sub">Upcoming events with the most people going.</p>
          {joined.length ? <BarList rows={joined} /> : <p className="meta">{live ? "No one has joined an upcoming event yet." : "–"}</p>}
        </section>
        <section className="chart-card">
          <h2>Job applications by role</h2>
          <p className="chart-sub">From the Careers section on the About page.</p>
          <BarList rows={roles} />
        </section>
      </div>
      {live?.members && <MembersList members={live.members} />}
      {recent.length > 0 && (
        <section className="chart-card wide">
          <h2>Recent updates</h2>
          <p className="chart-sub">What went live, and how the counts moved.</p>
          <ul className="update-list">
            {recent.map((sn, i) => {
              const before = snapshots[snapshots.length - 2 - i];
              const moved = (key) => (before && sn[key] != null && before[key] != null ? sn[key] - before[key] : 0);
              return (
                <li key={sn.sha}>
                  <span className={sn.kind === "scrape" ? "update-kind scrape" : "update-kind"}>
                    {sn.kind === "scrape" ? "Scrape" : "Change"}
                  </span>
                  <span className="update-what">{sn.message || "–"}</span>
                  <span className="meta">
                    {dateTime(sn.at)}
                    {moved("upcoming") || moved("clubs")
                      ? ` · events ${signed(moved("upcoming")) || "±0"}, clubs ${signed(moved("clubs")) || "±0"}`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

// Club officers add the DubHub bot to their Discord with this link; scraper/discord_events.py then
// reads the servers it's in. It only asks to view channels and read message history.
const DISCORD_BOT_INVITE =
  "https://discord.com/oauth2/authorize?client_id=1568776849167745124&scope=bot&permissions=66560";

function DiscordBotLink({ className = "join", children = "Add DubHub to your Discord" }) {
  return (
    <a className={`${className} discord-bot-link`} href={DISCORD_BOT_INVITE} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function AboutPage({ user, moderator, onNeedSignIn, onOpenHiring, reopenJobId, onReopened }) {
  return (
    <main className="page">
      <h1>About DubHub</h1>
      <p className="about-lead">
        DubHub puts every student event at UW on one campus map. Club events come in on their own from HuskyLink, club
        Instagram posts and club Discord servers, so no one has to post anything twice.
      </p>
      <p>Sign in with your UW ID to mark the events you're going to and see which friends are going too.</p>
      <p>
        Want to help build it?{" "}
        <button
          className="link-button"
          onClick={() => document.getElementById("careers")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          See open roles
        </button>
      </p>
      <h2>Made by</h2>
      <ul className="team">
        {TEAM.map((m) => (
          <TeamMember key={m.name} {...m} />
        ))}
      </ul>
      <section className="officers" id="club-officers" aria-labelledby="officers-title">
        <h2 id="officers-title">For club officers</h2>
        <p>
          DubHub already lists your club's events from HuskyLink and Instagram. If you post events on Discord too, add
          the DubHub bot to your server and they show up here on their own: everything in your server's Events tab, plus
          event posts in channels like #announcements or #events.
        </p>
        <p className="meta">
          You need permission to manage the server to add it. The bot only asks to view channels and read message
          history, and only reads your Events tab and announcement channels. Remove it from your server any time.
        </p>
        <DiscordBotLink />
      </section>
      <Careers
        user={user}
        moderator={moderator}
        onNeedSignIn={onNeedSignIn}
        onOpenHiring={onOpenHiring}
        reopenJobId={reopenJobId}
        onReopened={onReopened}
      />
    </main>
  );
}

export default function DubHub() {
  const [tab, setTab] = useState("Events");
  const [linkedId, setLinkedId] = useState(linkedEventId);
  useEffect(() => {
    const onHash = () => setLinkedId(linkedEventId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const openEvent = useCallback((e) => {
    history.pushState(null, "", `#event=${encodeURIComponent(e.id)}`);
    setLinkedId(String(e.id));
  }, []);
  const closeEvent = useCallback(() => {
    history.pushState(null, "", location.pathname + location.search);
    setLinkedId(null);
  }, []);
  const { events: loaded, updated } = useEvents();
  const clubList = useClubs();
  const applications = useApplications();
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
  const moderator = useModerator(user);
  const tabs = moderator ? [...TABS, "Stats", "Hiring"] : TABS;
  // Stats and Hiring are for moderators only.
  const social = useSocial(user, tab === "Friends");
  // Stats and Hiring are for moderators only, and Friends needs a sign-in.
  const view =
    ((tab === "Stats" || tab === "Hiring") && !moderator) || (tab === "Friends" && !user?.token) ? "Home" : tab;
  const [friendEvent, setFriendEvent] = useState(null);
  const { profile, update: updateProfile } = useProfile(user);

  // The sign-in page remembers where you came from and the event you tried to join (or the role
  // you tried to apply for, whose form opens again once you're signed in).
  const [signInFrom, setSignInFrom] = useState({ tab: "Events", eventId: null, jobId: null });
  const pendingJoin = useRef(null);
  const openSignIn = useCallback(
    (eventId = null, jobId = null) => {
      setSignInFrom({ tab: tab === "Sign in" ? signInFrom.tab : tab, eventId, jobId });
      pendingJoin.current = eventId;
      setTab("Sign in");
    },
    [tab, signInFrom.tab]
  );
  const j = useGoing(user, all, openSignIn);
  const applyFor = useCallback((jobId) => openSignIn(null, jobId), [openSignIn]);
  const reopened = useCallback(() => setSignInFrom((s) => (s.jobId ? { ...s, jobId: null } : s)), []);
  const pendingEvent = all.find((e) => String(e.id) === String(signInFrom.eventId));
  const finishSignIn = useCallback(
    (u) => {
      signIn(u);
      setTab(signInFrom.tab);
    },
    [signIn, signInFrom.tab]
  );
  // Once signed in, join the event that sent you to the sign-in page.
  const { join } = j;
  useEffect(() => {
    if (user?.token && pendingJoin.current != null) {
      join(pendingJoin.current);
      pendingJoin.current = null;
    }
  }, [user?.token, join]);
  const clubs = useJoined(CLUBS_KEY);
  const theme = useTheme();

  return (
    <div className="app">
      <header className="nav">
        <button className="logo" onClick={() => setTab("Events")} aria-label="DubHub, what's on now">
          DubHub
        </button>
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={view === t}
              className={view === t ? "tab active" : "tab"}
              onClick={() => setTab(t)}
            >
              <Icon d={TAB_ICONS[t]} />
              <span>{TAB_LABELS[t] ?? t}</span>
            </button>
          ))}
        </nav>
        <div className="nav-end">
          {user?.token && <MailButton count={social.waiting} active={view === "Friends"} onClick={() => setTab("Friends")} />}
          <ThemeToggle theme={theme.theme} onPick={theme.pick} />
          <Account user={user} onOpenSignIn={() => openSignIn()} onSignOut={signOut} onOpenProfile={() => setTab("Profile")} />
        </div>
      </header>

      {view === "Home" && <Home f={f} area={mapArea} introLabels={introLabels} j={j} palette={MAP_PALETTES[theme.theme]} />}
      {view === "Events" && <NowPage f={f} updated={updated} j={j} onSelect={openEvent} />}
      {view === "My Events" && (
        <MyEventsPage
          all={all}
          clubList={clubList}
          j={j}
          clubs={clubs}
          applications={applications}
          onBrowse={() => setTab("Events")}
          onFindClubs={() => setTab("Clubs")}
        />
      )}
      {view === "Clubs" && <ClubsPage all={all} clubList={clubList} clubs={clubs} applications={applications} />}
      {view === "About" && (
        <AboutPage
          user={user}
          moderator={moderator}
          onOpenHiring={() => setTab("Hiring")}
          onNeedSignIn={applyFor}
          reopenJobId={user?.token ? signInFrom.jobId : null}
          onReopened={reopened}
        />
      )}
      {view === "Stats" && <StatsPage user={user} events={all} clubs={clubList} dark={MAP_PALETTES[theme.theme]?.dark} />}
      {view === "Hiring" && <HiringPage user={user} />}
      {view === "Friends" && <FriendsPage user={user} social={social} events={all} onOpenEvent={setFriendEvent} />}
      {view === "Friends" && friendEvent && <EventDetail event={friendEvent} j={j} onClose={() => setFriendEvent(null)} />}
      {linkedId && all.find((e) => String(e.id) === linkedId) && (
        <EventDetail event={all.find((e) => String(e.id) === linkedId)} j={j} onClose={closeEvent} />
      )}
      {view === "Sign in" && (
        <SignInPage
          user={user}
          pendingEvent={pendingEvent}
          pendingJob={JOBS.find((x) => x.id === signInFrom.jobId)}
          onSignIn={finishSignIn}
          onBack={() => setTab(signInFrom.tab)}
        />
      )}
      {view === "Profile" && (
        <ProfilePage
          user={user}
          profile={profile}
          onChange={updateProfile}
          clubList={clubList}
          clubs={clubs}
          j={j}
          onSignOut={() => {
            signOut();
            setTab("Home");
          }}
        />
      )}
    </div>
  );
}