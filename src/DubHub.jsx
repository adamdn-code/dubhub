import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./DubHub.css";

const TABS = ["Home", "Events", "Saved", "Clubs", "About"];

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

// ---- Accounts and saved events ----
// NOTE: this is a front-end-only stand-in. The "account" and each person's saved
// events are kept in this browser's localStorage, so they don't follow you to another
// device and nothing verifies that the email is really yours. To make it real, replace
// the read/write helpers and useAccount() with calls to your backend / UW sign-in.
const USER_KEY = "dubhub:user";
const savedKey = (email) => `dubhub:saved:${email}`;
const UW_EMAIL = /^[^\s@]+@(uw|u\.washington)\.edu$/i;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, full); the app still works for this visit.
  }
}

function useAccount() {
  const [user, setUser] = useState(() => readJSON(USER_KEY, null));
  const [savedIds, setSavedIds] = useState(() => {
    const u = readJSON(USER_KEY, null);
    return u ? readJSON(savedKey(u.email), []) : [];
  });

  // alsoSaveId lets a visitor who clicked "Save" while signed out finish that save after signing in.
  const signIn = (u, alsoSaveId) => {
    const existing = readJSON(savedKey(u.email), []);
    const next = alsoSaveId != null && !existing.includes(alsoSaveId) ? [...existing, alsoSaveId] : existing;
    writeJSON(USER_KEY, u);
    writeJSON(savedKey(u.email), next);
    setUser(u);
    setSavedIds(next);
  };

  const signOut = () => {
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    setUser(null);
    setSavedIds([]);
  };

  const toggleSaved = (id) => {
    if (!user) return;
    const next = savedIds.includes(id) ? savedIds.filter((x) => x !== id) : [...savedIds, id];
    writeJSON(savedKey(user.email), next);
    setSavedIds(next);
  };

  return { user, savedIds, signIn, signOut, toggleSaved };
}

function SaveButton({ saved, onClick }) {
  return (
    <button className={saved ? "save saved" : "save"} aria-pressed={saved} onClick={onClick}>
      {saved ? "Saved ✓" : "Save"}
    </button>
  );
}

function SignInModal({ onClose, onSignIn, savingTitle }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!UW_EMAIL.test(clean)) {
      setError("Use your UW email (it ends in @uw.edu).");
      return;
    }
    onSignIn({ email: clean, name: name.trim() || clean.split("@")[0] });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="signin-title">Sign in with UW ID</h2>
        {savingTitle && <p className="modal-note">Sign in to save "{savingTitle}".</p>}

        <label>
          UW email
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            placeholder="netid@uw.edu"
            autoFocus
            required
          />
        </label>

        <label>
          Name (optional)
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="join">
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
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

function EventMap({ events, savedIds, onToggleSave }) {
  return (
    <MapContainer center={[47.6553, -122.3035]} zoom={14} scrollWheelZoom className="map">
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
            <div className="popup-actions">
              <button className="join">Join event</button>
              <SaveButton saved={savedIds.includes(e.id)} onClick={() => onToggleSave(e.id)} />
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function Home({ f, savedIds, onToggleSave }) {
  return (
    <main className="home">
      <EventMap events={f.events} savedIds={savedIds} onToggleSave={onToggleSave} />
      <Filters f={f} />
      <div className="tagline">
        <h1>See what's happening at UW, right now.</h1>
        <p>Study sessions, club meetings, game nights, and dinner plans, all on one map.</p>
      </div>
    </main>
  );
}

function EventRow({ event: e, children }) {
  return (
    <li>
      <span className="dot" style={{ background: TYPE_COLORS[e.type] }} />
      <div>
        <strong>{e.title}</strong>
        <div className="meta">
          {e.where}, hosted by {e.host}, {e.going} going
        </div>
      </div>
      <div className="row-action">{children}</div>
    </li>
  );
}

function EventsPage({ events, savedIds, onToggleSave }) {
  return (
    <main className="page">
      <h1>Events</h1>
      <ul className="list">
        {events.map((e) => (
          <EventRow key={e.id} event={e}>
            <SaveButton saved={savedIds.includes(e.id)} onClick={() => onToggleSave(e.id)} />
          </EventRow>
        ))}
      </ul>
    </main>
  );
}

function SavedPage({ user, events, onUnsave, onSignInClick }) {
  if (!user) {
    return (
      <main className="page">
        <h1>Saved events</h1>
        <p>Sign in to save events and see them all here.</p>
        <button className="join" onClick={onSignInClick}>
          Sign in with UW ID
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Saved events</h1>
      {events.length === 0 ? (
        <p>You haven't saved any events yet. Press Save on an event in the map or on the Events tab.</p>
      ) : (
        <ul className="list">
          {events.map((e) => (
            <EventRow key={e.id} event={e}>
              <button className="ghost" onClick={() => onUnsave(e.id)}>
                Remove
              </button>
            </EventRow>
          ))}
        </ul>
      )}
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
  const { user, savedIds, signIn, signOut, toggleSaved } = useAccount();
  const [signInOpen, setSignInOpen] = useState(false);
  const [pendingSaveId, setPendingSaveId] = useState(null);

  // Saving needs an account: signed-out visitors get the sign-in box first, then the save completes.
  const requestSave = (id) => {
    if (!user) {
      setPendingSaveId(id);
      setSignInOpen(true);
      return;
    }
    toggleSaved(id);
  };

  const openSignIn = () => {
    setPendingSaveId(null);
    setSignInOpen(true);
  };

  const closeSignIn = () => {
    setSignInOpen(false);
    setPendingSaveId(null);
  };

  const handleSignIn = (u) => {
    signIn(u, pendingSaveId);
    closeSignIn();
  };

  const savedEvents = EVENTS.filter((e) => savedIds.includes(e.id));
  const pendingEvent = EVENTS.find((e) => e.id === pendingSaveId);

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
              {t === "Saved" && user && savedIds.length > 0 ? `Saved (${savedIds.length})` : t}
            </button>
          ))}
        </nav>
        {user ? (
          <div className="account">
            <span className="who">Hi, {user.name}</span>
            <button className="signin" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <button className="signin" onClick={openSignIn}>
            Sign in<span className="long"> with UW ID</span>
          </button>
        )}
      </header>

      {tab === "Home" && <Home f={f} savedIds={savedIds} onToggleSave={requestSave} />}
      {tab === "Events" && <EventsPage events={f.events} savedIds={savedIds} onToggleSave={requestSave} />}
      {tab === "Saved" && <SavedPage user={user} events={savedEvents} onUnsave={toggleSaved} onSignInClick={openSignIn} />}
      {tab === "Clubs" && <ClubsPage />}
      {tab === "About" && <AboutPage />}

      {signInOpen && <SignInModal onClose={closeSignIn} onSignIn={handleSignIn} savingTitle={pendingEvent?.title} />}
    </div>
  );
}