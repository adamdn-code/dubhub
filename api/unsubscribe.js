// GET /api/unsubscribe?t=...: the "Turn off reminders" link at the bottom of every reminder email.
import { PREFS, SITE_URL, missingConfig, readToken, setReminders } from "./_lib.js";

const page = (message) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DubHub reminders</title></head>
<body style="font-family:system-ui,Segoe UI,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#1c1530">
<h1 style="color:#32006e">DubHub</h1><p>${message}</p>
<p><a href="${SITE_URL}" style="color:#32006e;font-weight:600">Back to DubHub</a></p></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (missingConfig().length) return res.status(503).send(page("Reminders aren't set up right now."));

  const t = readToken(req.query.t);
  if (t?.kind !== "unsubscribe") {
    return res.status(400).send(page("This link isn't valid anymore. You can turn reminders off in your DubHub profile."));
  }
  await setReminders(t.email, Object.fromEntries(PREFS.map((p) => [p, false])));
  return res.status(200).send(page("DubHub emails are off. You can turn them back on anytime in your DubHub profile."));
}
