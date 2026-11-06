// Shared code for DubHub's server functions (files starting with _ aren't exposed as endpoints).
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   VITE_GOOGLE_CLIENT_ID     already set; used to check sign-ins on the server too
//   KV_REST_API_URL / KV_REST_API_TOKEN   added automatically when you connect Upstash Redis
//                             (Vercel > Project > Storage > Upstash Redis)
//   SESSION_SECRET            any long random string; signs DubHub's own login tokens

import crypto from "node:crypto";
import { Redis } from "@upstash/redis";

const env = process.env;

export function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Names of the settings that aren't set (never their values).
export function missingConfig() {
  const needed = {
    "Upstash Redis": (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL) && (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN),
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
