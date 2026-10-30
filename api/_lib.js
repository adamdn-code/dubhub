// Shared code for DubHub's server functions (files starting with _ aren't exposed as endpoints).
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   VITE_GOOGLE_CLIENT_ID     already set; used to check sign-ins on the server too
//   KV_REST_API_URL / KV_REST_API_TOKEN   added automatically when you connect Upstash Redis
//   GMAIL_USER                the Gmail address reminders are sent from
//   GMAIL_APP_PASSWORD        a Gmail "app password" for that account (not its normal password)
//   SESSION_SECRET            any long random string; signs DubHub's own login tokens
//   CRON_SECRET               any long random string; Vercel sends it when running the daily job

import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import nodemailer from "nodemailer";

const env = process.env;
export const SITE_URL = env.SITE_URL || "https://dubhub-test.vercel.app";
export const TIME_ZONE = "America/Los_Angeles";

export function missingConfig() {
  const needed = {
    "Upstash Redis": (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL) && (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN),
    GMAIL_USER: env.GMAIL_USER,
    GMAIL_APP_PASSWORD: env.GMAIL_APP_PASSWORD,
    SESSION_SECRET: env.SESSION_SECRET,
    VITE_GOOGLE_CLIENT_ID: env.VITE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID,
  };
  return Object.keys(needed).filter((k) => !needed[k]);
}

let redis;
export function db() {
  redis ??= new Redis({
    url: env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL,
    token: env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

// ------------------------------------------------------------ sessions ---
// After Google sign-in is checked once, DubHub gives the browser its own signed token
// (Google's expires after an hour; this one lasts 180 days).
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (data) => crypto.createHmac("sha256", env.SESSION_SECRET).update(data).digest("base64url");

export function makeToken(payload, days = 180) {
  const data = b64(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 }));
  return `${data}.${sign(data)}`;
}

export function readToken(token) {
  const [data, sig] = (token || "").split(".");
  if (!data || !sig) return null;
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function sessionFrom(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const s = m && readToken(m[1]);
  return s?.kind === "session" ? s : null;
}

// Checks a Google sign-in credential with Google, and that it's a verified @uw.edu account for DubHub.
export async function verifyGoogle(credential) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) return null;
  const t = await r.json();
  const clientId = env.VITE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const verified = t.email_verified === true || t.email_verified === "true";
  if (t.aud !== clientId || t.hd !== "uw.edu" || !verified) return null;
  return { email: t.email.toLowerCase(), name: t.name || t.email };
}

// ---------------------------------------------------------------- data ---
// reminders:<email> = { enabled, newClubEvents, hourBefore, name, events: [...], clubs: [...],
// lastSent, seenClubEvents: [ids], soonSent: [ids] }. "enabled" is the morning email; the set
// "reminders:subscribers" lists everyone with any kind of email turned on.
export const SUBSCRIBERS = "reminders:subscribers";
export const reminderKey = (email) => `reminders:${email}`;
export const PREFS = ["enabled", "newClubEvents", "hourBefore"];

export async function getReminders(email) {
  return (await db().get(reminderKey(email))) || { enabled: false, events: [] };
}

export async function setReminders(email, changes) {
  const next = { ...(await getReminders(email)), ...changes, updated: new Date().toISOString() };
  await db().set(reminderKey(email), next);
  if (PREFS.some((p) => next[p])) await db().sadd(SUBSCRIBERS, email);
  else await db().srem(SUBSCRIBERS, email);
  return next;
}

// The clubs someone joined, so new club events can be matched to them (same rule as the site).
export function cleanClubs(clubs) {
  return (Array.isArray(clubs) ? clubs : []).slice(0, 200).map((c) => ({
    name: typeof c?.name === "string" ? c.name.slice(0, 160) : "",
    handle: /^[\w.]{1,40}$/.test(c?.handle) ? c.handle.toLowerCase() : null,
  })).filter((c) => c.name);
}

export function isHostedBy(event, club) {
  const host = (event.host || "").toLowerCase();
  if (club.handle && (host === `@${club.handle}` || host.endsWith(`(@${club.handle})`))) return true;
  return event.host === club.name || (event.host || "").startsWith(`${club.name} (@`);
}

// The site's current events (the scrapers update public/events.json).
export async function siteEvents() {
  const r = await fetch(`${SITE_URL}/events.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(`events.json: HTTP ${r.status}`);
  return (await r.json()).events || [];
}

// Only keep the event fields the email needs, and cap the list so nobody can store a huge blob.
export function cleanEvents(events) {
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
  return (Array.isArray(events) ? events : []).slice(0, 100).map((e) => ({
    id: String(e?.id ?? "").slice(0, 80),
    title: str(e?.title, 120) || "Event",
    date: /^\d{4}-\d{2}-\d{2}$/.test(e?.date) ? e.date : null,
    start: /^\d{2}:\d{2}$/.test(e?.start) ? e.start : null,
    end: /^\d{2}:\d{2}$/.test(e?.end) ? e.end : null,
    where: str(e?.where, 120),
    host: str(e?.host, 120),
    url: /^https:\/\//.test(e?.url) ? str(e.url, 300) : null,
  }));
}

// --------------------------------------------------------------- email ---
let mailer;
export function sendMail(message) {
  mailer ??= nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  return mailer.sendMail({ from: `"DubHub" <${env.GMAIL_USER}>`, ...message });
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function time(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function eventLine(e) {
  const when = e.start ? `${time(e.start)}${e.end ? `–${time(e.end)}` : ""}` : "Time not listed";
  return { when, where: e.where || "Location not listed", host: e.host };
}

// "Thu, Oct 29" for an event's "2026-10-29" date.
export function day(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  });
}

// The DubHub email layout: a heading, a list of events, and the turn-off link.
export function emailLayout({ greeting, events, showDate, footer, unsubscribeUrl }) {
  const html = events.map((e) => {
    const l = eventLine(e);
    const title = e.url ? `<a href="${esc(e.url)}" style="color:#32006e">${esc(e.title)}</a>` : esc(e.title);
    const when = showDate && e.date ? `${day(e.date)}, ${l.when}` : l.when;
    return `<p style="margin:0 0 12px"><strong>${title}</strong><br>${esc(when)} · ${esc(l.where)}${l.host ? `<br><span style="color:#6a5f85">${esc(l.host)}</span>` : ""}</p>`;
  }).join("");
  const text = events.map((e) => {
    const l = eventLine(e);
    const when = showDate && e.date ? `${day(e.date)}, ${l.when}` : l.when;
    return `- ${e.title}: ${when}, ${l.where}${e.url ? ` (${e.url})` : ""}`;
  }).join("\n");
  return {
    text: `${greeting}\n\n${text}\n\nSee everything at ${SITE_URL}\n\n${footer} Turn these off: ${unsubscribeUrl}\n`,
    html: `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px;color:#1c1530">
<h2 style="margin:0;color:#32006e">DubHub</h2>
<p>${esc(greeting)}</p>
${html}
<p style="margin-top:24px"><a href="${SITE_URL}" style="color:#32006e;font-weight:600">Open DubHub</a></p>
<p style="font-size:12px;color:#6a5f85">${esc(footer)} <a href="${esc(unsubscribeUrl)}" style="color:#6a5f85">Turn these off</a></p></div>`,
  };
}

// The minutes since midnight right now in Seattle.
export function seattleMinutes() {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date()).split(":").map(Number);
  return h * 60 + m;
}

// "2026-10-26" for today in Seattle, plus `days` days.
export function seattleDate(days = 0) {
  const d = new Date(Date.now() + days * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);
}

export function json(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}
