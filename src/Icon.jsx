// An outline icon (24x24) drawn from one SVG path. In its own file because both the site
// (DubHub.jsx) and the map (EventMap.jsx, downloaded separately) draw icons.
export default function Icon({ d }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
      <path d={d} />
    </svg>
  );
}
