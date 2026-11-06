// Who's going to each event (signed-in UW users who pressed Join).
//
// GET  /api/going?ids=a,b,c           -> { going: { a: ["Adam N.", ...], ... } }   (anyone)
// GET  /api/going?mine=1              -> { ids: [event ids you joined] }            (signed in)
// POST /api/going { eventId, going }   -> { going: [...names for that event] }     (signed in)
//
// Stored in Redis as the hash going:<event id> = { email: shown name }, plus the set
// joined:<email> of event ids, so your Joins follow you to any device. Only the shown name
// ("Adam N.") ever leaves the server, never the email address.
import { db, json, missingConfig, sessionFrom } from "./_lib.js";

const ID = /^[\w.:-]{1,80}$/;
const key = (id) => `going:${id}`;
const mineKey = (email) => `joined:${email}`;

// "Adam Nguyen" -> "Adam N.": enough to recognize a friend, without full names on a public page.
export function shownName(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "A UW student";
  return words.length === 1 ? words[0] : `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "RSVPs aren't set up on the server yet", missing });

  if (req.method === "GET" && req.query.mine) {
    const session = sessionFrom(req);
    if (!session) return json(res, 401, { error: "Sign in again to RSVP" });
    return json(res, 200, { ids: (await db().smembers(mineKey(session.email))) || [] });
  }

  if (req.method === "GET") {
    const ids = String(req.query.ids || "").split(",").filter((id) => ID.test(id)).slice(0, 200);
    if (ids.length === 0) return json(res, 200, { going: {} });
    const pipe = db().pipeline();
    for (const id of ids) pipe.hvals(key(id));
    const lists = await pipe.exec();
    const going = {};
    ids.forEach((id, i) => {
      if (lists[i]?.length) going[id] = lists[i];
    });
    return json(res, 200, { going });
  }

  if (req.method === "POST") {
    const session = sessionFrom(req);
    if (!session) return json(res, 401, { error: "Sign in again to RSVP" });
    const { eventId, going } = req.body || {};
    if (!ID.test(eventId || "")) return json(res, 400, { error: "Unknown event" });
    if (going) {
      await db().hset(key(eventId), { [session.email]: shownName(session.name) });
      await db().sadd(mineKey(session.email), eventId);
    } else {
      await db().hdel(key(eventId), session.email);
      await db().srem(mineKey(session.email), eventId);
    }
    return json(res, 200, { going: (await db().hvals(key(eventId))) || [] });
  }

  return json(res, 405, { error: "Use GET or POST" });
}
