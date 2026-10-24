import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./DubHub.css";

const TABS = ["Home", "Events", "Clubs", "About"];

const TYPE_COLORS = {
  Study: "#4b2e83",
  Club: "#c5503a",
  Food: "#d29a00",
  Hangout: "#1f8a70",
  "Game night": "#2e6fbd",
};

const YEARS = ["Freshman", "Sophomore", "Junior", "Senior"];
const MAJORS = ["Any major", "Computer Science", "Mathematics", "Informatics", "Biology", "Business"];

// Placeholder data: replace with your real events from your backend.
const EVENTS = [
  { id: 1, title: "Calc III study group", type: "Study", host: "Math Club", where: "Odegaard Library", pos: [47.6563, -122.3105], going: 12, years: ["Sophomore", "Junior"], majors: ["Mathematics"] },
  { id: 2, title: "Board game night", type: "Game night", host: "Husky Gamers", where: "HUB Ballroom", pos: [47.6552, -122.305], going: 28, years: YEARS, majors: [] },
  { id: 3, title: "Dinner on the Ave", type: "Food", host: "Alex T.", where: "University Ave", pos: [47.66, -122.313], going: 6, years: ["Freshman"], majors: [] },
  { id: 4, title: "Intro to ML meeting", type: "Club", host: "Data Science Society", where: "Paul G. Allen Center", pos: [47.6531, -122.3059], going: 41, years: YEARS, majors: ["Computer Science", "Mathematics", "Informatics"] },
  { id: 5, title: "Sunset hangout", type: "Hangout", host: "Jordan K.", where: "Gas Works Park", pos: [47.6456, -122.3344], going: 9, years: ["Junior", "Senior"], majors: [] },
  { id: 6, title: "Coffee and study", type: "Study", host: "Priya S.", where: "Capitol Hill", pos: [47.623, -122.3205], going: 4, years: YEARS, majors: ["Biology"] },
];

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

function SignIn({ user, onSignIn, onSignOut }) {
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
        onSignIn({ name: p.name, email: p.email, picture: p.picture });
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
        {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
        <span>{user.name}</span>
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

function useFilteredEvents() {
  const [type, setType] = useState("All");
  const [year, setYear] = useState("All");
  const [major, setMajor] = useState("Any major");

  const events = useMemo(
    () =>
      EVENTS.filter(
        (e) =>
          (type === "All" || e.type === type) &&
          (year === "All" || e.years.includes(year)) &&
          (major === "Any major" || e.majors.length === 0 || e.majors.includes(major))
      ),
    [type, year, major]
  );

  return { events, type, setType, year, setYear, major, setMajor };
}

function Filters({ f }) {
  return (
    <aside className="filters" aria-label="Event filters">
      <h2>Find something to do</h2>

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
        <select value={f.major} onChange={(e) => f.setMajor(e.target.value)}>
          {MAJORS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>

      <p className="count">
        {f.events.length} event{f.events.length === 1 ? "" : "s"} on the map
      </p>
    </aside>
  );
}

function EventMap({ events }) {
  return (
    <MapContainer center={[47.6553, -122.3035]} zoom={14} scrollWheelZoom zoomControl={false} className="map">
      <ZoomControl position="topright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {events.map((e) => (
        <CircleMarker
          key={e.id}
          center={e.pos}
          radius={9 + Math.min(e.going / 6, 8)}
          pathOptions={{ color: "#fff", weight: 2, fillColor: TYPE_COLORS[e.type], fillOpacity: 0.95 }}
        >
          <Popup>
            <strong>{e.title}</strong>
            <br />
            {e.where}
            <br />
            Hosted by {e.host}
            <br />
            {e.going} going
            <br />
            <button className="join">Join event</button>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function Home({ f }) {
  return (
    <main className="home">
      <EventMap events={f.events} />
      <Filters f={f} />
      <div className="tagline">
        <h1>See what's happening at UW, right now.</h1>
        <p>Study sessions, club meetings, game nights, and dinner plans, all on one map.</p>
      </div>
    </main>
  );
}

function EventsPage({ events }) {
  return (
    <main className="page">
      <h1>Events</h1>
      <ul className="list">
        {events.map((e) => (
          <li key={e.id}>
            <span className="dot" style={{ background: TYPE_COLORS[e.type] }} />
            <div>
              <strong>{e.title}</strong>
              <div className="meta">
                {e.where}, hosted by {e.host}, {e.going} going
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function ClubsPage() {
  return (
    <main className="page">
      <h1>Clubs</h1>
      <p>Browse the clubs and RSOs on campus and see what they have coming up. (Hook this up to your clubs list.)</p>
    </main>
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
    </main>
  );
}

export default function DubHub() {
  const [tab, setTab] = useState("Home");
  const f = useFilteredEvents();
  const { user, signIn, signOut } = useUser();

  return (
    <div className="app">
      <header className="nav">
        <div className="logo">DubHub</div>
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
        <SignIn user={user} onSignIn={signIn} onSignOut={signOut} />
      </header>

      {tab === "Home" && <Home f={f} />}
      {tab === "Events" && <EventsPage events={f.events} />}
      {tab === "Clubs" && <ClubsPage />}
      {tab === "About" && <AboutPage />}
    </div>
  );
}