// The "Suggested for you" experiment: does the recommender get more people to open and join
// events than the same row sorted by date?
//
// POST /api/exp { visitor, kind: "view" | "open" | "join", n? }   (anyone; signed in when you are)
//   -> { arm }
//
// Every visitor is in one arm for good: signed in, by a hash of your UW email (the same arm on
// every device); signed out, by a random id this browser keeps. The server works the arm out
// itself, so a request can't pick its own. Per person, Redis keeps only counts, under a hash of
// that id, never the email: exp:recs:u:<hash> = { arm, signedIn, views, opens, joins, first, last },
// and the set exp:recs:users:<arm> lists who is in each arm. The Stats page compares the arms
// (api/stats.js -> experimentResults).
import { createHash } from "node:crypto";
import { db, json, missingConfig, sessionFrom } from "./_lib.js";

export const EXPERIMENT = "recs-v1";
export const ARMS = ["recommender", "by-date"];
const VISITOR = /^[a-z0-9]{8,40}$/;
const KINDS = { view: "views", open: "opens", join: "joins" };

// FNV-1a: the browser runs the same function (src/experiment.js), so both agree on the arm.
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function armFor(uid) {
  return ARMS[fnv1a(`${uid}:${EXPERIMENT}`) % ARMS.length];
}

const hashed = (uid) => createHash("sha256").update(uid).digest("hex").slice(0, 24);

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
  if (missingConfig().length) return json(res, 503, { error: "Not set up on the server yet" });
  const { visitor, kind, n } = req.body || {};
  const field = KINDS[kind];
  if (!field) return json(res, 400, { error: "Unknown kind" });
  const session = sessionFrom(req);
  if (!session && !VISITOR.test(visitor || "")) return json(res, 400, { error: "Missing visitor id" });
  const uid = session ? `u:${session.email}` : `a:${visitor}`;
  const arm = armFor(uid);
  const key = `exp:recs:u:${hashed(uid)}`;
  const now = new Date().toISOString();
  const r = db();
  const pipe = r.pipeline();
  pipe.hsetnx(key, "arm", arm);
  pipe.hsetnx(key, "first", now);
  pipe.hset(key, { last: now, ...(session ? { signedIn: 1 } : {}) });
  pipe.hincrby(key, field, Math.max(1, Math.min(9, Number(n) || 1)));
  pipe.sadd(`exp:recs:users:${arm}`, hashed(uid));
  await pipe.exec();
  return json(res, 200, { arm });
}

// Per arm: people, how many of them opened or joined a suggested event, and the totals, plus a
// two-proportion z-test on "joined at least one suggested event" among signed-in people (only
// they can join) and on "opened at least one" among everyone.
export async function experimentResults(r) {
  const out = { experiment: EXPERIMENT, arms: {} };
  for (const arm of ARMS) {
    const ids = (await r.smembers(`exp:recs:users:${arm}`)) || [];
    const rows = [];
    for (let i = 0; i < ids.length; i += 200) {
      const pipe = r.pipeline();
      for (const id of ids.slice(i, i + 200)) pipe.hgetall(`exp:recs:u:${id}`);
      rows.push(...(await pipe.exec()));
    }
    const a = { people: 0, signedIn: 0, opened: 0, joinedSignedIn: 0, views: 0, opens: 0, joins: 0 };
    for (const u of rows) {
      if (!u) continue;
      a.people++;
      const views = Number(u.views || 0), opens = Number(u.opens || 0), joins = Number(u.joins || 0);
      a.views += views;
      a.opens += opens;
      a.joins += joins;
      if (opens > 0) a.opened++;
      if (u.signedIn) {
        a.signedIn++;
        if (joins > 0) a.joinedSignedIn++;
      }
    }
    out.arms[arm] = a;
  }
  const [t, c] = ARMS.map((arm) => out.arms[arm]);
  out.openTest = twoProportion(t.opened, t.people, c.opened, c.people);
  out.joinTest = twoProportion(t.joinedSignedIn, t.signedIn, c.joinedSignedIn, c.signedIn);
  return out;
}

// Difference in rates (treatment - control), its 95% interval, and the two-sided p-value.
export function twoProportion(x1, n1, x2, n2) {
  if (!n1 || !n2) return null;
  const p1 = x1 / n1, p2 = x2 / n2, diff = p1 - p2;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const pooled = (x1 + x2) / (n1 + n2);
  const se0 = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = se0 > 0 ? diff / se0 : 0;
  return { treatment: p1, control: p2, diff, low: diff - 1.96 * se, high: diff + 1.96 * se, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

function normalCdf(x) {
  // Abramowitz and Stegun 7.1.26, good to about 1e-7
  const t = 1 / (1 + 0.3275911 * (x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + y);
}
