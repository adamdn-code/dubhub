// GET /api/send-reminders: run once a day by Vercel Cron (see vercel.json). Emails everyone who
// turned reminders on about their events today and tomorrow (Seattle time).
import {
  SITE_URL,
  SUBSCRIBERS,
  db,
  getReminders,
  json,
  makeToken,
  missingConfig,
  seattleDate,
  sendMail,
  setReminders,
} from "./_lib.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function time(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function eventLine(e) {
  const when = e.start ? `${time(e.start)}${e.end ? `–${time(e.end)}` : ""}` : "Time not listed";
  return { when, where: e.where || "Location not listed", host: e.host };
}

export function buildEmail(name, today, tomorrow, unsubscribeUrl) {
  const section = (label, list) => {
    if (!list.length) return { html: "", text: "" };
    const html = `<h3 style="margin:24px 0 8px;color:#4b2e83">${label}</h3>` + list.map((e) => {
      const l = eventLine(e);
      const title = e.url ? `<a href="${esc(e.url)}" style="color:#32006e">${esc(e.title)}</a>` : esc(e.title);
      return `<p style="margin:0 0 12px"><strong>${title}</strong><br>${esc(l.when)} · ${esc(l.where)}${l.host ? `<br><span style="color:#6a5f85">${esc(l.host)}</span>` : ""}</p>`;
    }).join("");
    const text = `${label}\n` + list.map((e) => {
      const l = eventLine(e);
      return `- ${e.title}: ${l.when}, ${l.where}${e.url ? ` (${e.url})` : ""}`;
    }).join("\n") + "\n\n";
    return { html, text };
  };

  const first = (name || "there").split(" ")[0];
  const t = section("Today", today);
  const m = section("Tomorrow", tomorrow);
  const count = today.length + tomorrow.length;
  return {
    subject: today.length
      ? `You have ${today.length} DubHub event${today.length === 1 ? "" : "s"} today`
      : `Coming up tomorrow on DubHub: ${tomorrow[0].title}${tomorrow.length > 1 ? ` + ${tomorrow.length - 1} more` : ""}`,
    text: `Hi ${first},\n\nHere ${count === 1 ? "is your event" : "are your events"} on DubHub:\n\n${t.text}${m.text}See everything at ${SITE_URL}\n\nDon't want these emails? ${unsubscribeUrl}\n`,
    html: `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px;color:#1c1530">
<h2 style="margin:0;color:#32006e">DubHub</h2>
<p>Hi ${esc(first)}, here ${count === 1 ? "is your event" : "are your events"}:</p>
${t.html}${m.html}
<p style="margin-top:24px"><a href="${SITE_URL}" style="color:#32006e;font-weight:600">Open DubHub</a></p>
<p style="font-size:12px;color:#6a5f85">You're getting this because you turned on email reminders in your DubHub profile.
<a href="${esc(unsubscribeUrl)}" style="color:#6a5f85">Turn off reminders</a></p></div>`,
  };
}

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; nobody else should trigger mass emails.
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: "Not allowed" });
  }
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Not set up", missing });

  const today = seattleDate(0);
  const tomorrow = seattleDate(1);
  const emails = (await db().smembers(SUBSCRIBERS)) || [];
  const results = { today, subscribers: emails.length, sent: 0, nothingToSend: 0, alreadySent: 0, failed: 0 };

  for (const email of emails) {
    const r = await getReminders(email);
    if (!r.enabled) continue;
    if (r.lastSent === today) {
      results.alreadySent++;
      continue;
    }
    const byTime = (a, b) => (a.start || "99").localeCompare(b.start || "99");
    const todays = r.events.filter((e) => e.date === today).sort(byTime);
    const tomorrows = r.events.filter((e) => e.date === tomorrow).sort(byTime);
    if (!todays.length && !tomorrows.length) {
      results.nothingToSend++;
      continue;
    }
    const unsubscribe = `${SITE_URL}/api/unsubscribe?t=${makeToken({ kind: "unsubscribe", email }, 365)}`;
    try {
      await sendMail({ to: email, ...buildEmail(r.name, todays, tomorrows, unsubscribe) });
      await setReminders(email, { lastSent: today });
      results.sent++;
    } catch (e) {
      console.error(`Reminder to ${email} failed:`, e.message);
      results.failed++;
    }
  }
  console.log("Reminders:", results);
  return json(res, 200, results);
}
