import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, CircleMarker, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./DubHub.css";

const TABS = ["Home", "Events", "My Events", "Clubs", "About"];

// Outline icons (24x24) for the tab bar; on phones the tabs move to the bottom with these.
const TAB_ICONS = {
  Home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  Events: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  "My Events": "M6 3h12v18l-6-4-6 4z",
  Clubs: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6v1",
  About: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01",
};

function Icon({ d }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
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
    <span className="tag field-tag" style={{ color, background: `${color}14`, borderColor: `${color}66` }}>
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
    name: "Kelan Huynh",
    role: "Ambassador, Corporate Banking Club at the University of Washington",
    github: null,
    linkedin: "https://www.linkedin.com/in/kelanhuynh",
    photo: "/team/kelan.jpg",
  },
  {
    name: "Jenny Vong",
    role: "Ambassador, Foster School of Business at the University of Washington",
    github: null,
    linkedin: "https://www.linkedin.com/in/jenny-vong-2597553b2",
    photo: "/team/jenny.jpg",
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

// The site's themes. Light or dark follows the device until someone picks a theme from the
// top-bar menu, which is then remembered in this browser. Sets <html data-theme>, which
// DubHub.css reads; MAP_PALETTES has each theme's map. `swatch`: top bar, buttons, page.
const THEMES = [
  { id: "light", name: "Light", swatch: ["#32006e", "#4b2e83", "#f4f2f8"] },
  { id: "dark", name: "Dark", swatch: ["#32006e", "#c9b6ff", "#14111c"] },
  { id: "rainier", name: "Rainier", swatch: ["#0b3a5b", "#1d6fa5", "#eef5fa"] },
  { id: "blossom", name: "Cherry Blossom", swatch: ["#7a2e4f", "#c2477a", "#fdf3f6"] },
  { id: "sunset", name: "Sunset", swatch: ["#3a1424", "#e0663c", "#1c1218"] },
  { id: "evergreen", name: "Evergreen", swatch: ["#173d2c", "#2f7a55", "#f1f5ef"] },
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

const PALETTE_ICON =
  "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M16.5 12h.01";

// The top-bar theme button: opens a small menu of themes with color swatches.
function ThemePicker({ theme, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className="theme-toggle"
        aria-label="Theme"
        title="Theme"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon d={PALETTE_ICON} />
      </button>
      {open && (
        <ul className="theme-menu" aria-label="Themes">
          {THEMES.map((t) => (
            <li key={t.id}>
              <button
                className={t.id === theme ? "theme-option on" : "theme-option"}
                aria-pressed={t.id === theme}
                onClick={() => {
                  onPick(t.id);
                  setOpen(false);
                }}
              >
                <span className="theme-swatch" aria-hidden="true">
                  {t.swatch.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
function SignInPage({ user, pendingEvent, onSignIn, onBack }) {
  const stale = user && !user.token; // signed in before RSVPs existed, or the login expired
  return (
    <main className="page signin-page">
      <div className="signin-card">
        <p className="filters-eyebrow">DubHub</p>
        <h1>{stale ? "Sign in again" : "Sign in to DubHub"}</h1>
        {pendingEvent ? (
          <p className="signin-reason">
            Sign in to join <strong>{pendingEvent.title}</strong>.
          </p>
        ) : (
          <p className="signin-reason">Sign in to join events and see who's going.</p>
        )}
        <ul className="signin-perks">
          <li>Join events and get them in My Events</li>
          <li>Friends see you're going (as first name and last initial)</li>
          <li>Your events follow you to any device</li>
        </ul>
        <GoogleSignIn onSignIn={onSignIn} />
        <p className="meta">UW accounts only (NetID@uw.edu).</p>
        <button className="link-button" onClick={onBack}>
          ← Back
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

// Dots are colored by the event's (first) major field; general-interest events are gray.
const NO_FIELD_COLOR = "#8a8398";
function eventColor(e) {
  return FIELD_COLORS[e.fields?.[0]] ?? NO_FIELD_COLOR;
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
      <h2>Find something to do</h2>

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
// plus the text, which is at most 250px wide (past that the event's name wraps to a second line).
const CALLOUT_MAX = 250;
const CALLOUT_CHROME = 9 + 34 + 10 + 14; // left padding, tile, gap, right padding
let measureCtx;
function calloutSize(title, sub) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const font = getComputedStyle(document.body).fontFamily;
  measureCtx.font = `700 14px ${font}`;
  const titleW = measureCtx.measureText(title).width;
  measureCtx.font = `12px ${font}`;
  const subW = measureCtx.measureText(sub).width;
  const wraps = CALLOUT_CHROME + titleW > CALLOUT_MAX;
  return { w: Math.min(CALLOUT_MAX, CALLOUT_CHROME + Math.max(titleW, subW)), h: wraps ? 71 : 54 };
}

// What sits on top of the map (the filters, the welcome box, the dot colors, the zoom buttons), in
// the map's own coordinates, so cards aren't hidden behind them.
function mapOverlays(map) {
  const box = map.getContainer().getBoundingClientRect();
  const els = map.getContainer().parentElement?.querySelectorAll(".filters, .tagline, .map-legend, .leaflet-control-zoom");
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
function IntroLabels({ places }) {
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
    const { w, h } = calloutSize(place.title, place.sub);
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
        <EventCallout event={p.event} title={p.title} sub={p.sub} />
      </Tooltip>
    </CircleMarker>
  ));
}

function JoinButton({ event, j }) {
  const isJoined = j.joined.includes(String(event.id));
  return (
    <button
      className={isJoined ? "join joined" : "join"}
      aria-pressed={isJoined}
      title={isJoined ? "Click to leave this event" : j.signedIn ? undefined : "Sign in to join"}
      onClick={() => j.toggle(event.id)}
    >
      {isJoined ? "Joined ✓" : "Join"}
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
// The map data's licenses require this credit on the map, so it's tucked behind a small "©" button.
const MAP_ATTRIBUTION =
  '<details class="map-credit"><summary aria-label="Map credits">&copy;</summary>' +
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
  "</details>";

// Apple Maps-like palette: white roads with gray edges, soft blue water, light green parks.
const MAP_COLORS = {
  background: "#f4f2ee",
  water: "#a6d1f2",
  park: "#b5e0a0",
  wood: "#a6d98f",
  wetland: "#c5e6b4",
  plaza: "#ece9e4",
  building: "#e5e2dc",
  buildingOutline: "#b8b1a5",
  school: "#ece8e1",
  road: "#ffffff",
  highway: "#fdfcfa",
  casing: "#dcd8d1",
  highwayCasing: "#c9c4bb",
};

// Apple Maps' dark mode: charcoal ground with borderless streets a step lighter (big streets
// lighter still), muted gold freeways, deep green parks, and slate-blue water with blue names.
const APPLE_DARK_MAP = {
  dark: true,
  background: "#232325",
  water: "#1d3145",
  park: "#20392a",
  wood: "#1e3527",
  wetland: "#22382c",
  plaza: "#29292c",
  building: "#2b2b2e", // close to the ground, so neighborhoods stay calm zoomed out
  buildingOutline: "#333337",
  school: "#28282b",
  road: "#3b3b40",
  major: "#4f4f56", // main streets
  highway: "#8a7448", // freeways only (main streets are `major`)
  path: "#303034", // walking paths, fainter than streets
  casing: "#232325",
  highwayCasing: "#5a4c31",
  label: "#d4d4d9",
  labelHalo: "#1c1c1e",
  waterLabel: "#7ea6cc",
};

// Each theme's map. Light keeps the normal (Apple Maps-like) map, Dark is Apple Maps' dark
// mode, and the other themes recolor it.
const MAP_PALETTES = {
  light: MAP_COLORS,
  dark: APPLE_DARK_MAP,
  // Glacier blues: cool water, frosty parks and blue-gray streets.
  rainier: {
    background: "#eef3f7",
    water: "#8cc3e8",
    park: "#c9e3d2",
    wood: "#b9d9c4",
    wetland: "#d4e9dc",
    plaza: "#e8eef3",
    building: "#dde6ee",
    buildingOutline: "#a9b9c8",
    school: "#e6edf3",
    road: "#ffffff",
    highway: "#fdfeff",
    casing: "#cfdbe5",
    highwayCasing: "#b9c9d6",
  },
  // The Quad in spring: pink parks, blush buildings.
  blossom: {
    background: "#fbf3f2",
    water: "#b8d8f0",
    park: "#f6cfe0",
    wood: "#eebfd3",
    wetland: "#f3d9e5",
    plaza: "#f6ecec",
    building: "#efe4e4",
    buildingOutline: "#cdb5b9",
    school: "#f5eaea",
    road: "#ffffff",
    highway: "#fffafb",
    casing: "#ecdcdf",
    highwayCasing: "#dcc6cb",
  },
  // Dusk over Lake Washington: a dark map with violet water and warm streets.
  sunset: {
    dark: true,
    background: "#2b1d25",
    water: "#3b3f6b",
    park: "#3a3a2c",
    wood: "#34362a",
    wetland: "#3c3d31",
    plaza: "#33242c",
    building: "#3d2b34",
    buildingOutline: "#574049",
    school: "#31232a",
    road: "#5a3f45",
    highway: "#7a4b3f",
    casing: "#2a1c23",
    highwayCasing: "#2f2026",
    label: "#f3d8c8",
    labelHalo: "#2b1d25",
  },
  // Pacific Northwest forest: lush greens.
  evergreen: {
    background: "#eef2ea",
    water: "#9cc9d6",
    park: "#9fd18b",
    wood: "#86c17a",
    wetland: "#b6d9a7",
    plaza: "#e6ebe2",
    building: "#dee4d8",
    buildingOutline: "#a8b4a0",
    school: "#e7ece2",
    road: "#ffffff",
    highway: "#fbfdf8",
    casing: "#d2dacb",
    highwayCasing: "#bec9b5",
  },
};

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
    if (C.dark && layer.type === "symbol" && layer.layout?.["text-field"] && !/shield/.test(layer.id)) {
      const water = /water/.test(layer.id) && C.waterLabel;
      Object.assign(paint, { "text-color": water || C.label, "text-halo-color": C.labelHalo, "text-halo-width": 1.2 });
    }
  }

  // Thicker outlines so neighboring buildings stand apart (a fill's own outline is only 1px).
  const i = style.layers.findIndex((layer) => layer.id === "building");
  if (i >= 0) {
    const building = style.layers[i];
    style.layers.splice(i + 1, 0, {
      id: "building-outline",
      type: "line",
      source: building.source,
      "source-layer": building["source-layer"],
      minzoom: building.minzoom,
      paint: {
        "line-color": C.buildingOutline,
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 16, 1, 18, 1.75],
      },
    });
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
  return (
    <aside className="map-card" aria-label={`${e.title}, hosted by ${hostName(e)}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button className="map-card-close" aria-label="Close" onClick={onClose}>
        &times;
      </button>
      <div className="map-popup">
        <div className="map-popup-club">
          <Thumb src={e.club?.logo} label={hostName(e)} color={eventColor(e)} className="map-popup-logo" />
          <span className="map-popup-club-label">Hosted by</span>
          <span className="map-popup-club-name">{hostName(e)}</span>
          <GreekTag event={e} />
        </div>
        <div className="map-popup-main">
          <strong>{e.title}</strong>
          {[formatWhen(e), e.where, going(e, j)].filter(Boolean).map((line) => (
            <div key={line}>{line}</div>
          ))}
          {shortText(e.description) && <p className="map-popup-desc">{shortText(e.description)}</p>}
          <JoinButton event={e} j={j} /> <PostLink event={e} />
        </div>
      </div>
    </aside>
  );
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

function EventMap({ events, area, introLabels, shown, onPin, onMapClick, palette }) {
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
      <ZoomControl position="topright" />
      <MapArea area={area} />
      <BaseMap palette={palette} />
      {located.map((e) => {
        const on = shown?.id === e.id;
        const radius = dotRadius(e) + (on ? 3 : 0);
        return (
          <CircleMarker
            key={e.id}
            center={e.pos}
            radius={radius}
            pathOptions={{ color: on ? "#b7a57a" : "#fff", weight: on ? 4 : 2, fillColor: eventColor(e), fillOpacity: 0.95 }}
            bubblingMouseEvents={false}
            eventHandlers={{ click: () => onPin(e) }}
          >
            {/* Hover: a small card above the dot. Click: the detailed panel (with Join). */}
            {!on && (
              <Tooltip direction="top" offset={[0, -(radius + STEM)]} opacity={1} className="event-callout">
                <EventCallout event={e} />
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}
      <MapClicks onClick={onMapClick} />
      {introLabels && <IntroLabels places={places} />}
    </MapContainer>
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
function EventCallout({ event, title = event.title, sub = event.where ?? hostName(event) }) {
  const [, setBroken] = useState(false);
  const logo = event.club?.logo;
  const picture = logo && !brokenLogos.has(logo);
  return (
    <div className="callout">
      <span className="callout-icon">
        {picture ? (
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
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
    </div>
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

function Home({ f, area, introLabels, j, palette }) {
  const [shown, setShown] = useState(null); // { event, pinned }
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
        onPin={(e) => show(e, true)}
        onMapClick={close}
        palette={palette}
      />
      <MapLegend events={f.events} />
      <Filters f={f} />
      <div className="tagline">
        <h1>See what's happening at UW, right now.</h1>
        <p>Study sessions, club meetings, game nights, and dinner plans, all on one map.</p>
      </div>
      {event && <MapEventCard event={event} j={j} onEnter={keep} onLeave={hideSoon} onClose={close} />}
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
        {event.image && <HeroImage src={event.image} />}
        <h2 id="event-detail-title">{event.title}</h2>
        <p className="detail-tags">
          <span className="tag">{event.type}</span>
          <GreekTag event={event} />
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
        <GoingList event={event} j={j} />
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
      <h3 className="day-label">{label}</h3>
      <ul className={columns === 3 ? "list cards cards-3" : "list cards"}>
        {list
          .sort((a, b) => (a.start ?? "99").localeCompare(b.start ?? "99"))
          .map((e) => (
            <li key={e.id} className="event-row">
              <div className="event-time">
                {e.start ? formatTime(e.start) : "All day"}
                {e.end && <span>{formatTime(e.end)}</span>}
              </div>
              <Thumb src={e.image} label={e.title} color={eventColor(e)} className="event-thumb" />
              <div className="grow">
                <EventTitle event={e} onSelect={onSelect} />
                <div className="meta">
                  <span className="dot" style={{ background: eventColor(e) }} />
                  <GreekTag event={e} />
                  {[e.type, e.where, e.host, going(e, j)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <JoinButton event={e} j={j} />
            </li>
          ))}
      </ul>
    </section>
  ));
}

// Trending: how much interest an event has, weighted toward the next few days.
//   interest = 8 per RSVP + 1 per Instagram like + 3 per comment + 5 per extra post promoting it
//   score    = (1 + log2(1 + interest)) / (1 + days until it / 3)
// The log keeps one viral post from swamping everything; the second part halves an event's weight
// three days out. Only events in the next TRENDING_DAYS count. With no interest data, the soonest win.
const TRENDING_DAYS = 14;

function interest(e) {
  const rsvps = e.rsvps ?? e.going ?? 0; // sample events have "going" instead of RSVPs
  return 8 * rsvps + (e.likes ?? 0) + 3 * (e.comments ?? 0) + 5 * ((e.posts ?? 1) - 1);
}

function trendScore(e) {
  const days = e.date ? (Date.parse(e.date) - Date.parse(localDate(0))) / 864e5 : 3; // samples have no date
  if (days < 0 || days > TRENDING_DAYS) return null;
  return (1 + Math.log2(1 + interest(e))) / (1 + days / 3);
}

// Why an event is trending besides its RSVPs (which "N going" already shows), e.g. "84 likes".
function trendReason(e) {
  const likes = e.likes ? `${e.likes} like${e.likes === 1 ? "" : "s"}` : null;
  return [likes, e.posts > 1 && `Posted ${e.posts}×`].filter(Boolean).join(" · ") || null;
}

function trending(events, limit = 5) {
  const when = (e) => `${e.date ?? "9999"}T${e.start ?? ""}`;
  return events
    .map((e) => ({ e, score: trendScore(e) }))
    .filter((x) => x.score != null)
    .sort((a, b) => b.score - a.score || when(a.e).localeCompare(when(b.e)))
    .slice(0, limit)
    .map((x) => x.e);
}

function TrendingRow({ events, j, onSelect }) {
  const top = trending(events);
  if (top.length === 0) return null;
  return (
    <section className="trending" aria-labelledby="trending-title">
      <h2 id="trending-title">Trending</h2>
      <ol className="trending-row">
        {top.map((e) => (
          <li key={e.id} className="trending-card">
            <Thumb src={e.image} label={e.title} color={eventColor(e)} className="trending-thumb" />
            <EventTitle event={e} onSelect={onSelect} />
            <div className="meta">
              <GreekTag event={e} />
              {[formatWhen(e), e.where, going(e, j), trendReason(e)].filter(Boolean).join(" · ")}
            </div>
            <JoinButton event={e} j={j} />
          </li>
        ))}
      </ol>
    </section>
  );
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

function EventsPage({ f, updated, j }) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const events = q
    ? f.events.filter((e) => [e.title, e.host, e.where, e.description].some((s) => s?.toLowerCase().includes(q)))
    : f.events;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Events</h1>
        <WhenSelect aria-label="When" value={f.when} onChange={f.setWhen} />
      </div>
      {updated && (
        <p className="page-sub">
          From HuskyLink and club Instagram posts · updated{" "}
          {new Date(updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search events, clubs, places"
          aria-label="Search events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ChipFilter label="Event type" options={["All", ...Object.keys(TYPE_COLORS)]} value={f.type} onChange={f.setType} />
        <ChipFilter label="Club type" options={[ALL_CLUBS, ...f.clubTypes]} value={f.club} onChange={f.setClub} />
      </div>
      {!q && <TrendingRow events={events} j={j} onSelect={setSelected} />}
      <h2>{q ? `${events.length} result${events.length === 1 ? "" : "s"}` : "All events"}</h2>
      {events.length > 0 ? (
        <EventList events={events} j={j} onSelect={setSelected} />
      ) : (
        <p className="empty">No events match{q ? ` "${query}"` : " these filters"}.</p>
      )}
      {selected && <EventDetail event={selected} j={j} onClose={() => setSelected(null)} />}
    </main>
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
      {isMember ? "Joined ✓" : "Join"}
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
  return all.filter((e) => j.joined.includes(String(e.id)) || myClubs.some((c) => isHostedBy(e, c)));
}

function MyEventsPage({ all, clubList, j, clubs, onBrowse, onFindClubs }) {
  const mine = myEventsFor(all, clubList, j, clubs);
  const [selected, setSelected] = useState(null);
  return (
    <main className="page">
      <h1>My Events</h1>
      {clubs.joined.length > 0 && (
        <p className="page-sub">
          Events you joined, plus everything from {clubs.joined.length === 1 ? clubs.joined[0] : `your ${clubs.joined.length} clubs`}
        </p>
      )}
      {mine.length > 0 ? (
        <EventList events={mine} j={j} onSelect={setSelected} columns={3} />
      ) : (
        <div className="empty-card">
          <h2>Nothing here yet</h2>
          <p>
            Join an event to save it here, or join a club and every event it posts shows up here on its own.
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
          &times;
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

// Clubs taking applications (members, officers, project teams, recruitment), soonest deadline first.
function ApplicationsRow({ apps, onSelectClub }) {
  if (apps.length === 0) return null;
  return (
    <section className="trending applications" aria-labelledby="applications-title">
      <h2 id="applications-title">Open applications</h2>
      <ol className="trending-row">
        {apps.map((a) => (
          <li key={a.id} className="trending-card apply-card">
            <span className="apply-club">
              <Thumb src={a.club?.logo ?? a.logo} label={hostName(a)} color={a.club ? clubColor(a.club) : NO_FIELD_COLOR} className="apply-logo" />
              {a.club ? (
                <button className="club-link apply-club-name" onClick={() => onSelectClub(a.club)}>
                  {hostName(a)}
                </button>
              ) : (
                <span className="apply-club-name">{hostName(a)}</span>
              )}
            </span>
            <strong className="apply-for">{a.for}</strong>
            <span className={a.due.soon ? "meta apply-due soon" : "meta apply-due"}>
              {a.due.soon ? (
                <>
                  <span className="tag tag-soon">{a.due.left}</span>
                  Due {a.due.day}
                </>
              ) : (
                a.due.text
              )}
            </span>
            <ApplyLinks app={a} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClubsPage({ all, clubList, clubs: membership, applications }) {
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
  const visibleApps = open.filter(
    (a) =>
      (category === "All" || a.club?.category === category) &&
      (!field || a.club?.fields?.includes(field)) &&
      (!q || [hostName(a), a.for].some((s) => s?.toLowerCase().includes(q)))
  );
  const applying = new Set(open.map((a) => a.club?.name).filter(Boolean));

  return (
    <main className="page">
      <h1>Clubs</h1>
      <p className="page-sub">Student organizations at UW Seattle. Join one to get its events in My Events.</p>
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
      <ApplicationsRow apps={visibleApps} onSelectClub={setSelected} />
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
                    .join(" · ")}
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
  const { profile, update: updateProfile } = useProfile(user);

  // The sign-in page remembers where you came from and the event you tried to join.
  const [signInFrom, setSignInFrom] = useState({ tab: "Home", eventId: null });
  const pendingJoin = useRef(null);
  const openSignIn = useCallback(
    (eventId = null) => {
      setSignInFrom({ tab: tab === "Sign in" ? signInFrom.tab : tab, eventId });
      pendingJoin.current = eventId;
      setTab("Sign in");
    },
    [tab, signInFrom.tab]
  );
  const j = useGoing(user, all, openSignIn);
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
              <Icon d={TAB_ICONS[t]} />
              <span>{t}</span>
            </button>
          ))}
        </nav>
        <div className="nav-end">
          <ThemePicker theme={theme.theme} onPick={theme.pick} />
          <Account user={user} onOpenSignIn={() => openSignIn()} onSignOut={signOut} onOpenProfile={() => setTab("Profile")} />
        </div>
      </header>

      {tab === "Home" && <Home f={f} area={mapArea} introLabels={introLabels} j={j} palette={MAP_PALETTES[theme.theme]} />}
      {tab === "Events" && <EventsPage f={f} updated={updated} j={j} />}
      {tab === "My Events" && (
        <MyEventsPage
          all={all}
          clubList={clubList}
          j={j}
          clubs={clubs}
          onBrowse={() => setTab("Events")}
          onFindClubs={() => setTab("Clubs")}
        />
      )}
      {tab === "Clubs" && <ClubsPage all={all} clubList={clubList} clubs={clubs} applications={applications} />}
      {tab === "About" && <AboutPage />}
      {tab === "Sign in" && (
        <SignInPage user={user} pendingEvent={pendingEvent} onSignIn={finishSignIn} onBack={() => setTab(signInFrom.tab)} />
      )}
      {tab === "Profile" && (
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