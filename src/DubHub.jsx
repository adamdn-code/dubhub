import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, CircleMarker, Popup, ZoomControl, useMap } from "react-leaflet";
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
// when you click a club. Scraped clubs also have `handle` and `instagram`, and may lack `meets`.
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

// Team shown on the About page; details load from each GitHub profile.
const TEAM = [
  { name: "Adam Nguyen", github: "adamxlegend" },
  { name: "Quentin Nguyen", github: "nitneuqqq" },
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

// Scraped events have no class year or major, so they're open to everyone.
function useFilteredEvents(all) {
  const [type, setType] = useState("All");
  const [year, setYear] = useState("All");
  const [major, setMajor] = useState("Any major");

  const events = useMemo(
    () =>
      all.filter(
        (e) =>
          (type === "All" || e.type === type) &&
          (year === "All" || !e.years || e.years.includes(year)) &&
          (major === "Any major" || !e.majors?.length || e.majors.includes(major))
      ),
    [all, type, year, major]
  );

  return { events, type, setType, year, setYear, major, setMajor };
}

function Filters({ f }) {
  const onMap = f.events.filter((e) => e.pos).length;
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
          <option>Any major</option>
          {Object.entries(MAJOR_GROUPS).map(([group, majors]) => (
            <optgroup key={group} label={group}>
              {majors.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <p className="count">
        {onMap} event{onMap === 1 ? "" : "s"} on the map
        {f.events.length > onMap && `, ${f.events.length - onMap} more in Events`}
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
      View post
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
  };

  for (const layer of style.layers) {
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
      <BaseMap />
      {events
        .filter((e) => e.pos)
        .map((e) => (
          <CircleMarker
            key={e.id}
            center={e.pos}
            radius={9 + Math.min((e.going ?? 0) / 6, 8)}
            pathOptions={{ color: "#fff", weight: 2, fillColor: TYPE_COLORS[e.type], fillOpacity: 0.95 }}
          >
            <Popup>
              <strong>{e.title}</strong>
              {[formatWhen(e), e.where, `Hosted by ${e.host}`, going(e, j)].filter(Boolean).map((line) => (
                <div key={line}>{line}</div>
              ))}
              <JoinButton event={e} j={j} /> <PostLink event={e} />
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

function TrendingRow({ events, j }) {
  if (events.length === 0) return null;
  return (
    <section className="trending" aria-labelledby="trending-title">
      <h2 id="trending-title">Trending</h2>
      <ol className="trending-row">
        {trending(events, j).map((e) => (
          <li key={e.id} className="trending-card">
            <span className="dot" style={{ background: TYPE_COLORS[e.type] }} />
            <strong>{e.title}</strong>
            <div className="meta">{[formatWhen(e), e.where, going(e, j)].filter(Boolean).join(" · ")}</div>
            <JoinButton event={e} j={j} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function EventsPage({ events, updated, j }) {
  return (
    <main className="page">
      <h1>Events</h1>
      {updated && (
        <p className="count">
          From club Instagram posts, updated{" "}
          {new Date(updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}
      <TrendingRow events={events} j={j} />
      <h2>All events</h2>
      <EventList events={events} j={j} />
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

// My Events shows events you joined plus every event hosted by a club you're in.
function MyEventsPage({ all, clubList, j, clubs, onBrowse }) {
  const myClubs = clubList.filter((c) => clubs.joined.includes(c.name));
  const mine = all.filter((e) => j.joined.includes(e.id) || myClubs.some((c) => isHostedBy(e, c)));
  return (
    <main className="page">
      <h1>My Events</h1>
      {clubs.joined.length > 0 && (
        <p className="count">Includes events from your clubs: {clubs.joined.join(", ")}</p>
      )}
      {mine.length > 0 ? (
        <EventList events={mine} j={j} />
      ) : (
        <div className="empty">
          <p>You haven't joined any events or clubs yet.</p>
          <button className="join" onClick={onBrowse}>
            Browse events
          </button>
        </div>
      )}
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
        <p>
          <span className="tag">{club.category}</span>
        </p>
        <p>{club.description || club.about || "No description yet. Check their Instagram for more."}</p>
        {club.meets && <p className="meta">Meets {club.meets}</p>}
        {club.instagram && (
          <p>
            <a className="post-link" href={club.instagram} target="_blank" rel="noreferrer">
              @{club.handle} on Instagram
            </a>
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
  const [selected, setSelected] = useState(null);
  const categories = ["All", ...[...new Set(clubList.map((c) => c.category))].sort()];

  const q = query.trim().toLowerCase();
  const clubs = clubList.filter(
    (c) =>
      (category === "All" || c.category === category) &&
      (!q || [c.name, c.handle, c.category, c.about].some((s) => s?.toLowerCase().includes(q)))
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
          const upcoming = hostedBy(all, c).length;
          return (
            <li key={c.name}>
              <div className="grow">
                <button className="club-link" onClick={() => setSelected(c)}>
                  {c.name}
                  <span className="club-hint"> View details &rarr;</span>
                </button>{" "}
                <span className="tag">{c.category}</span>
                {c.about && <div>{c.about}</div>}
                <div className="meta">
                  {[
                    c.meets && `Meets ${c.meets}`,
                    c.handle && c.name !== `@${c.handle}` && `@${c.handle}`,
                    upcoming > 0 && `${upcoming} upcoming event${upcoming === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
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

function ProfilePage({ user, profile, onChange, clubList, clubs, j }) {
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
                <li key={m} className="chip">
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
  const { events: all, updated } = useEvents();
  const clubList = useClubs();
  const f = useFilteredEvents(all);
  const { user, signIn, signOut } = useUser();
  const { profile, update: updateProfile } = useProfile(user);
  const j = useJoined(JOINED_KEY);
  const clubs = useJoined(CLUBS_KEY);

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

      {tab === "Home" && <Home f={f} j={j} />}
      {tab === "Events" && <EventsPage events={f.events} updated={updated} j={j} />}
      {tab === "My Events" && (
        <MyEventsPage all={all} clubList={clubList} j={j} clubs={clubs} onBrowse={() => setTab("Events")} />
      )}
      {tab === "Clubs" && <ClubsPage all={all} clubList={clubList} clubs={clubs} />}
      {tab === "About" && <AboutPage />}
      {tab === "Profile" && (
        <ProfilePage user={user} profile={profile} onChange={updateProfile} clubList={clubList} clubs={clubs} j={j} />
      )}
    </div>
  );
}