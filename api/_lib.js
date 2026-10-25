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
// reminders:<email> = { enabled, name, events: [...], lastSent }, and the set
// "reminders:subscribers" lists everyone with reminders turned on.
export const SUBSCRIBERS = "reminders:subscribers";
export const reminderKey = (email) => `reminders:${email}`;

export async function getReminders(email) {
  return (await db().get(reminderKey(email))) || { enabled: false, events: [] };
}

export async function setReminders(email, changes) {
  const next = { ...(await getReminders(email)), ...changes, updated: new Date().toISOString() };
  await db().set(reminderKey(email), next);
  if (next.enabled) await db().sadd(SUBSCRIBERS, email);
  else await db().srem(SUBSCRIBERS, email);
  return next;
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

// "2026-10-26" for today in Seattle, plus `days` days.
export function seattleDate(days = 0) {
  const d = new Date(Date.now() + days * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);
}

export function json(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}
