// GET  /api/reminders: which of the signed-in user's emails are on?
// POST /api/reminders { enabled?, newClubEvents?, hourBefore?, events?, clubs? }: turn emails on/off
// and/or update the events and clubs to send about.
import { PREFS, cleanClubs, cleanEvents, getReminders, json, missingConfig, sessionFrom, setReminders } from "./_lib.js";

const prefs = (r) => Object.fromEntries(PREFS.map((p) => [p, !!r[p]]));

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Email reminders aren't set up on the server yet", missing });
  const session = sessionFrom(req);
  if (!session) return json(res, 401, { error: "Sign in again to use email reminders" });

  if (req.method === "GET") {
    const r = await getReminders(session.email);
    return json(res, 200, { ...prefs(r), events: r.events.length });
  }
  if (req.method !== "POST") return json(res, 405, { error: "Use GET or POST" });

  const changes = { name: session.name };
  for (const p of PREFS) if (typeof req.body?.[p] === "boolean") changes[p] = req.body[p];
  if (req.body?.events) changes.events = cleanEvents(req.body.events);
  if (req.body?.clubs) changes.clubs = cleanClubs(req.body.clubs);
  const r = await setReminders(session.email, changes);
  return json(res, 200, { ...prefs(r), events: r.events.length });
}
