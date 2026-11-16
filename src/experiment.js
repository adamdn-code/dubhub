// The "Suggested for you" experiment (see api/exp.js): which arm this visitor is in, and logging
// what they do with the row. Signed in, the arm follows your UW email to every device; signed
// out, a random id this browser keeps. The arm math matches the server's exactly.
const EXPERIMENT = "recs-v1";
const ARMS = ["recommender", "by-date"];
const VISITOR_KEY = "dubhub-visitor";

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!/^[a-z0-9]{8,40}$/.test(id || "")) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return "nostorage" + Math.floor(Math.random() * 1e9).toString(36);
  }
}

export function armFor(user) {
  const uid = user?.email ? `u:${user.email.toLowerCase()}` : `a:${visitorId()}`;
  return ARMS[fnv1a(`${uid}:${EXPERIMENT}`) % ARMS.length];
}

// Fire and forget: a lost log line never gets in the visitor's way.
export function logExperiment(user, kind, n = 1) {
  try {
    fetch("/api/exp", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
      body: JSON.stringify({ visitor: visitorId(), kind, n }),
    }).catch(() => {});
  } catch {
    // no fetch: skip
  }
}
