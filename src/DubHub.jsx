import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
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

// Placeholder data: replace with your real clubs list.
const CLUBS = [
  { name: "Math Club", category: "Academic", about: "Problem sessions, study groups, and talks from math faculty.", meets: "Tuesdays, Padelford Hall" },
  { name: "Husky Gamers", category: "Gaming", about: "Board games, video games, and tournaments for every skill level.", meets: "Fridays, HUB" },
  { name: "Data Science Society", category: "Tech", about: "Workshops and projects on machine learning and data analysis.", meets: "Wednesdays, Allen Center" },
  { name: "Husky Hiking Club", category: "Outdoors", about: "Weekend day hikes and trips around the Cascades.", meets: "Saturdays, meet at Red Square" },
  { name: "Vietnamese Student Association", category: "Cultural", about: "Culture nights, food events, and community for Vietnamese students and friends.", meets: "Thursdays, HUB" },
  { name: "Pre-Health Society", category: "Academic", about: "Advising, MCAT prep, and volunteer opportunities for pre-med students.", meets: "Mondays, Mary Gates Hall" },
  { name: "Husky Coding Club", category: "Tech", about: "Hackathons, interview practice, and building side projects together.", meets: "Thursdays, CSE2" },
  { name: "Climbing Club", category: "Outdoors", about: "Climbing sessions at the IMA wall and trips to local crags.", meets: "Tuesdays, IMA" },
  { name: "Film Society", category: "Arts", about: "Weekly screenings, discussions, and student film projects.", meets: "Wednesdays, Kane Hall" },
  { name: "Entrepreneurship Club", category: "Business", about: "Startup talks, pitch nights, and networking with founders.", meets: "Mondays, PACCAR Hall" },
];

// Team shown on the About page; details load from each GitHub profile.
const TEAM = [
  { name: "Adam Nguyen", github: "adamxlegend" },
  { name: "Quentin Nguyen", github: "nitneuqqq" },
];

const JOINED_KEY = "dubhub-joined";

function useJoined() {
  const [joined, setJoined] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(JOINED_KEY)) ?? [];
    } catch {
      return [];
    }
  });

  const toggle = useCallback((id) => {
    setJoined((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      try {
        localStorage.setItem(JOINED_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked: joins last for this visit only.
      }
      return next;
    });
  }, []);

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

// Seattle city limits, roughly: the map can't be panned or zoomed out past this.
const SEATTLE_BOUNDS = [
  [47.48, -122.46],
  [47.74, -122.22],
];

function JoinButton({ event, j }) {
  const isJoined = j.joined.includes(event.id);
  return (
    <button className={isJoined ? "join joined" : "join"} aria-pressed={isJoined} onClick={() => j.toggle(event.id)}>
      {isJoined ? "Joined ✓ (leave)" : "Join event"}
    </button>
  );
}

function going(event, j) {
  return event.going + (j.joined.includes(event.id) ? 1 : 0);
}

function EventMap({ events, j }) {
  return (
    <MapContainer
      center={[47.6553, -122.3035]}
      zoom={14}
      minZoom={12}
      maxBounds={SEATTLE_BOUNDS}
      maxBoundsViscosity={1}
      scrollWheelZoom
      zoomControl={false}
      className="map"
    >
      <ZoomControl position="topright" />
      <TileLayer
        attribution="Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
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
            {going(e, j)} going
            <br />
            <JoinButton event={e} j={j} />
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function Home({ f, j }) {
  return (
    <main className="home">
      <EventMap events={f.events} j={j} />
      <Filters f={f} />
      <div className="tagline">
        <h1>See what's happening at UW, right now.</h1>
        <p>Study sessions, club meetings, game nights, and dinner plans, all on one map.</p>
      </div>
    </main>
  );
}

function EventList({ events, j }) {
  return (
    <ul className="list">
      {events.map((e) => (
        <li key={e.id}>
          <span className="dot" style={{ background: TYPE_COLORS[e.type] }} />
          <div className="grow">
            <strong>{e.title}</strong>
            <div className="meta">
              {e.where}, hosted by {e.host}, {going(e, j)} going
            </div>
          </div>
          <JoinButton event={e} j={j} />
        </li>
      ))}
    </ul>
  );
}

function EventsPage({ events, j }) {
  return (
    <main className="page">
      <h1>Events</h1>
      <EventList events={events} j={j} />
    </main>
  );
}

function MyEventsPage({ j, onBrowse }) {
  const mine = EVENTS.filter((e) => j.joined.includes(e.id));
  return (
    <main className="page">
      <h1>My Events</h1>
      {mine.length > 0 ? (
        <EventList events={mine} j={j} />
      ) : (
        <div className="empty">
          <p>You haven't joined any events yet.</p>
          <button className="join" onClick={onBrowse}>
            Browse events
          </button>
        </div>
      )}
    </main>
  );
}

function ClubsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(CLUBS.map((c) => c.category))];

  const q = query.trim().toLowerCase();
  const clubs = CLUBS.filter(
    (c) =>
      (category === "All" || c.category === category) &&
      (!q || [c.name, c.category, c.about].some((s) => s.toLowerCase().includes(q)))
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
      </div>
      <p className="count">
        {clubs.length} club{clubs.length === 1 ? "" : "s"}
      </p>
      <ul className="list">
        {clubs.map((c) => {
          const upcoming = EVENTS.filter((e) => e.host === c.name).length;
          return (
            <li key={c.name}>
              <div className="grow">
                <strong>{c.name}</strong> <span className="tag">{c.category}</span>
                <div>{c.about}</div>
                <div className="meta">
                  Meets {c.meets}
                  {upcoming > 0 && `, ${upcoming} upcoming event${upcoming === 1 ? "" : "s"}`}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {clubs.length === 0 && <p className="empty">No clubs match "{query}".</p>}
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

function TeamMember({ name, github }) {
  const p = useGitHubProfile(github);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("");

  return (
    <li className="member">
      {github ? (
        <img src={`https://github.com/${github}.png?size=160`} alt="" />
      ) : (
        <span className="avatar">{initials}</span>
      )}
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
  const f = useFilteredEvents();
  const { user, signIn, signOut } = useUser();
  const j = useJoined();

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

      {tab === "Home" && <Home f={f} j={j} />}
      {tab === "Events" && <EventsPage events={f.events} j={j} />}
      {tab === "My Events" && <MyEventsPage j={j} onBrowse={() => setTab("Events")} />}
      {tab === "Clubs" && <ClubsPage />}
      {tab === "About" && <AboutPage />}
    </div>
  );
}