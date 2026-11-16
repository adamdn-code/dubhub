// Clubs students suggest by Instagram username, for the scraper's club finder
// (scraper/find_unlisted_clubs.py) to check: it keeps one only if it's a UW Seattle student group
// with recent posts, and then the club shows up on the Clubs page once it has an event.
//
// POST /api/suggest { handle }  (signed in)  -> { ok: true }
// GET  /api/suggest                          -> { handles: [usernames, newest first] }
//
// Stored in Redis as the hash club-suggestions: username -> { first, count }, plus the set
// suggested:<email> of the usernames each person suggested (at most PER_PERSON). GET only ever gives
// out the usernames, never who suggested them.
import { db, json, missingConfig, sessionFrom } from "./_lib.js";

const KEY = "club-suggestions";
const HANDLE = /^[a-z0-9._]{1,30}$/;
const PER_PERSON = 20;
const MOST = 2000;

// "@UWFigma", "instagram.com/uwfigma/" and "uwfigma" are all the same username.
export function cleanHandle(text) {
  return String(text || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Suggestions aren't set up on the server yet", missing });
  const redis = db();

  if (req.method === "GET") {
    const all = (await redis.hgetall(KEY)) || {};
    const handles = Object.entries(all)
      .sort(([, a], [, b]) => String(b?.first ?? "").localeCompare(String(a?.first ?? "")))
      .map(([h]) => h);
    return json(res, 200, { handles });
  }

  if (req.method === "POST") {
    const session = sessionFrom(req);
    if (!session) return json(res, 401, { error: "Sign in to suggest a club" });
    const handle = cleanHandle(req.body?.handle);
    if (!HANDLE.test(handle) || /^[._]|[._]$/.test(handle)) return json(res, 400, { error: "That doesn't look like an Instagram username." });
    const mine = `suggested:${session.email}`;
    if (await redis.sismember(mine, handle)) return json(res, 200, { ok: true });
    if ((await redis.scard(mine)) >= PER_PERSON) return json(res, 429, { error: "Thanks! That's the most clubs one person can suggest for now." });
    const old = await redis.hget(KEY, handle);
    if (!old && (await redis.hlen(KEY)) >= MOST) return json(res, 503, { error: "We have a lot of suggestions to check. Try again in a few days." });
    await redis.hset(KEY, { [handle]: { first: old?.first ?? new Date().toISOString(), count: (old?.count ?? 0) + 1 } });
    await redis.sadd(mine, handle);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "Use GET or POST" });
}
