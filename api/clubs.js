// The clubs you joined, saved under your account so they follow you to any browser or device.
//
// GET  /api/clubs                              -> { clubs: [club names], clubbed: [event ids] }   (signed in)
// POST /api/clubs { club, joined }              -> { clubs }        join (true) or leave (false) one club
// POST /api/clubs { add: [names], clubbed: [ids] } -> { clubs, clubbed }
//        add several clubs at once (the first sync from a browser, or going to events), and/or
//        remember which events have already made you a member of their club, so leaving that club
//        later sticks on every device.
//
// Stored in Redis as the sets myclubs:<email> and myclubbed:<email>. Only you can read them.
import { db, json, missingConfig, sessionFrom } from "./_lib.js";

const MAX_CLUBS = 500;
const MAX_ADD = 200;
const clubsKey = (email) => `myclubs:${email}`;
const clubbedKey = (email) => `myclubbed:${email}`;

// Club names are free text from the scrapers; keep only sensible strings.
const cleanNames = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((n) => typeof n === "string")
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n.length <= 200)
    .slice(0, MAX_ADD);
const cleanIds = (list) =>
  (Array.isArray(list) ? list : [])
    .map(String)
    .filter((id) => /^[\w.:-]{1,80}$/.test(id))
    .slice(0, MAX_ADD * 5);

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Saving clubs isn't set up on the server yet", missing });
  const session = sessionFrom(req);
  if (!session) return json(res, 401, { error: "Sign in again to save your clubs" });
  const redis = db();

  if (req.method === "GET") {
    const [clubs, clubbed] = await Promise.all([redis.smembers(clubsKey(session.email)), redis.smembers(clubbedKey(session.email))]);
    return json(res, 200, { clubs: (clubs || []).map(String), clubbed: (clubbed || []).map(String) });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const key = clubsKey(session.email);

    if (typeof body.club === "string") {
      const [club] = cleanNames([body.club]);
      if (!club) return json(res, 400, { error: "Unknown club" });
      if (body.joined) {
        if ((await redis.scard(key)) >= MAX_CLUBS) return json(res, 400, { error: "That's the most clubs you can join" });
        await redis.sadd(key, club);
      } else {
        await redis.srem(key, club);
      }
      return json(res, 200, { clubs: ((await redis.smembers(key)) || []).map(String) });
    }

    const add = cleanNames(body.add);
    const clubbed = cleanIds(body.clubbed);
    if (add.length && (await redis.scard(key)) + add.length <= MAX_CLUBS + MAX_ADD) await redis.sadd(key, ...add);
    if (clubbed.length) await redis.sadd(clubbedKey(session.email), ...clubbed);
    const [clubs, all] = await Promise.all([redis.smembers(key), redis.smembers(clubbedKey(session.email))]);
    return json(res, 200, { clubs: (clubs || []).map(String), clubbed: (all || []).map(String) });
  }

  return json(res, 405, { error: "Use GET or POST" });
}
