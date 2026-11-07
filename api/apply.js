// Job applications from the Careers section of the About page.
//
// POST /api/apply { jobId, name, phone, year, major, links, answers, resume, extra }
//        -> { ok: true }                                      (signed in with a UW account)
//      resume / extra: { name, data } with data the file in base64. A resume is required; extra
//      (a cover letter or portfolio) is optional. PDF or Word, up to the sizes in src/jobs.js.
// GET  /api/apply?mine=1               -> { jobs: [ids of roles you applied to], admin }  (signed in)
// GET  /api/apply?all=1                -> { applications: [...] }  (admins only, no files)
// GET  /api/apply?file=<id>&kind=resume|extra  -> the file itself  (admins only)
//
// Admins are the accounts listed in the ADMIN_EMAILS setting (Vercel > Settings > Environment
// Variables), separated by commas.
//
// Stored in Redis: application:<id> = the application (without files), applications = a list of
// ids (newest first), applied:<email> = the set of roles you applied to (one application per role),
// and appfile:<id>:<kind>:<n> = each file in base64, in pieces small enough for one request each.
import crypto from "node:crypto";
import { db, json, missingConfig, sessionFrom } from "./_lib.js";
import { FILE_LIMITS, JOBS } from "../src/jobs.js";

const MAX_APPLICATIONS = 1000; // keeps the database from filling up if something goes wrong
const PIECE = 400_000; // base64 characters per stored piece
const ID = /^[a-z0-9-]{6,40}$/;

const appKey = (id) => `application:${id}`;
const appliedKey = (email) => `applied:${email}`;
const pieceKey = (id, kind, n) => `appfile:${id}:${kind}:${n}`;

function isAdmin(session) {
  const admins = (process.env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  return Boolean(session && admins.includes(session.email));
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// What a file really is, from its first bytes (not what the browser says): PDF, .docx, or .doc.
function fileType(bytes, name) {
  const starts = (...b) => b.every((x, i) => bytes[i] === x);
  if (starts(0x25, 0x50, 0x44, 0x46)) return { type: "application/pdf", ext: "pdf" };
  if (starts(0x50, 0x4b, 0x03, 0x04) && /\.docx$/i.test(name))
    return { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) && /\.doc$/i.test(name))
    return { type: "application/msword", ext: "doc" };
  return null;
}

// Checks an attached file; returns { file } (or { file: null } if it's optional and missing) or { error }.
function readFile(input, kind, label) {
  if (!input?.data) return kind === "resume" ? { error: "Attach your resume" } : { file: null };
  const data = String(input.data);
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) return { error: `Your ${label} didn't upload correctly. Try attaching it again.` };
  if (data.length > Math.ceil(FILE_LIMITS[kind] / 3) * 4) {
    return { error: `Your ${label} is too big (the limit is ${FILE_LIMITS[kind] / 1024 / 1024} MB)` };
  }
  const bytes = Buffer.from(data, "base64");
  // No slashes, quotes, or invisible characters in the name it downloads with.
  const safe = (c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? "_" : c);
  const name = [...text(input.name, 120)].map(safe).join("") || `${kind}.pdf`;
  const kindOf = fileType(bytes, name);
  if (!kindOf) return { error: `Your ${label} needs to be a PDF or Word document` };
  return { file: { name, type: kindOf.type, size: bytes.length, data, pieces: Math.ceil(data.length / PIECE) } };
}

async function submit(req, res, session) {
  const body = req.body || {};
  const job = JOBS.find((j) => j.id === body.jobId);
  if (!job) return json(res, 400, { error: "That role isn't open anymore" });

  const name = text(body.name, 100) || session.name;
  const answers = {};
  for (const q of job.questions) {
    const answer = text(body.answers?.[q.id], q.max);
    if (q.required && !answer) return json(res, 400, { error: `Answer "${q.label}"` });
    if (answer) answers[q.id] = answer;
  }

  const resume = readFile(body.resume, "resume", "resume");
  if (resume.error) return json(res, 400, { error: resume.error });
  const extra = readFile(body.extra, "extra", "cover letter or portfolio");
  if (extra.error) return json(res, 400, { error: extra.error });

  if ((await db().llen("applications")) >= MAX_APPLICATIONS) {
    return json(res, 503, { error: "We aren't taking more applications right now. Try again soon." });
  }
  // Claimed first, so pressing Submit twice can't send two applications.
  if (!(await db().sadd(appliedKey(session.email), job.id))) {
    return json(res, 409, { error: "You've already applied for this role" });
  }

  const id = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
  const files = { resume: resume.file, extra: extra.file };
  try {
    // "~" in front, so a piece that happens to look like a number comes back as text.
    for (const [kind, file] of Object.entries(files)) {
      for (let n = 0; file && n < file.pieces; n++) {
        await db().set(pieceKey(id, kind, n), `~${file.data.slice(n * PIECE, (n + 1) * PIECE)}`);
      }
    }
    const info = (f) => f && { name: f.name, type: f.type, size: f.size, pieces: f.pieces };
    await db().set(appKey(id), {
      id,
      jobId: job.id,
      jobTitle: job.title,
      name,
      email: session.email,
      phone: text(body.phone, 30),
      year: text(body.year, 30),
      major: text(body.major, 100),
      links: text(body.links, 300),
      answers,
      files: { resume: info(files.resume), extra: info(files.extra) },
      at: new Date().toISOString(),
    });
    await db().lpush("applications", id);
  } catch (err) {
    await db().srem(appliedKey(session.email), job.id); // so you can try again
    throw err;
  }
  return json(res, 200, { ok: true });
}

async function sendFile(req, res) {
  const id = String(req.query.file || "");
  const kind = req.query.kind === "extra" ? "extra" : "resume";
  const app = ID.test(id) ? await db().get(appKey(id)) : null;
  const file = app?.files?.[kind];
  if (!file) return json(res, 404, { error: "No such file" });

  let data = "";
  for (let n = 0; n < file.pieces; n++) data += String((await db().get(pieceKey(id, kind, n))) ?? "").slice(1);
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  res.status(200);
  res.setHeader("Content-Type", file.type);
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.end(Buffer.from(data, "base64"));
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Applications aren't set up on the server yet", missing });
  const session = sessionFrom(req);
  if (!session) return json(res, 401, { error: "Sign in with your UW account to apply" });

  if (req.method === "POST") return submit(req, res, session);
  if (req.method !== "GET") return json(res, 405, { error: "Use GET or POST" });

  if (req.query.mine) {
    const jobs = (await db().smembers(appliedKey(session.email))) || [];
    return json(res, 200, { jobs, admin: isAdmin(session) }); // admin: whether to show the applications
  }
  if (!isAdmin(session)) return json(res, 403, { error: "Only DubHub's team can see applications" });
  if (req.query.file) return sendFile(req, res);

  const ids = (await db().lrange("applications", 0, MAX_APPLICATIONS - 1)) || [];
  if (ids.length === 0) return json(res, 200, { applications: [] });
  const pipe = db().pipeline();
  for (const id of ids) pipe.get(appKey(id));
  return json(res, 200, { applications: (await pipe.exec()).filter(Boolean) });
}
