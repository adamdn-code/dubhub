// GET  /api/reminders: is the signed-in user's email reminder on?
// POST /api/reminders { enabled?, events? }: turn it on/off and/or update the events to remind about.
import { cleanEvents, getReminders, json, missingConfig, sessionFrom, setReminders } from "./_lib.js";

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Email reminders aren't set up on the server yet", missing });
  const session = sessionFrom(req);
  if (!session) return json(res, 401, { error: "Sign in again to use email reminders" });

  if (req.method === "GET") {
    const r = await getReminders(session.email);
    return json(res, 200, { enabled: !!r.enabled, events: r.events.length });
  }
  if (req.method !== "POST") return json(res, 405, { error: "Use GET or POST" });

  const changes = { name: session.name };
  if (typeof req.body?.enabled === "boolean") changes.enabled = req.body.enabled;
  if (req.body?.events) changes.events = cleanEvents(req.body.events);
  const r = await setReminders(session.email, changes);
  return json(res, 200, { enabled: !!r.enabled, events: r.events.length });
}
