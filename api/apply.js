// Job applications from the Careers section of the About page.
//
// POST /api/apply { jobId, name, phone, year, major, links, answers, resume, extra }
//        -> { ok: true }                                      (signed in with a UW account)
//      resume / extra: { name, data } with data the file in base64. A resume is required; extra
//      (a cover letter or portfolio) is optional. PDF or Word, up to the sizes in src/jobs.js.
// GET  /api/apply?mine=1               -> { jobs: [ids of roles you applied to],
//                                           applications: [your applications: status, interview,
//                                           and the team's messages to you] }   (signed in)
// GET  /api/apply?all=1                -> { applications: [...] }  (moderators only, no files)
// GET  /api/apply?file=<id>&kind=resume|extra  -> the file itself  (moderators only)
// PATCH /api/apply { id, status?, message?: { text, internal }, interview?: { start, minutes,
//        where, note } | null }        -> { application }  (moderators only: answer an applicant,
//        leave a private note, set the status, or schedule, change, or cancel an interview)
//
// Moderators are the accounts in the MODERATOR_EMAILS setting (see _lib.js).
//
// Stored in Redis: application:<id> = the application (without files, with its status, interview,
// and thread of messages and changes), applications = a list of ids (newest first),
// applied:<email> = the set of roles you applied to (one application per role), myapps:<email> =
// { role: application id }, and appfile:<id>:<kind>:<n> = each file in base64, in pieces small
// enough for one request each.
import crypto from "node:crypto";
import { db, isModerator, json, missingConfig, sessionFrom } from "./_lib.js";
import { FILE_LIMITS, JOBS } from "../src/jobs.js";

const MAX_APPLICATIONS = 1000; // keeps the database from filling up if something goes wrong
const PIECE = 400_000; // base64 characters per stored piece
const ID = /^[a-z0-9-]{6,40}$/;

const appKey = (id) => `application:${id}`;
const appliedKey = (email) => `applied:${email}`;
const myAppsKey = (email) => `myapps:${email}`;
const STATUSES = ["new", "reviewing", "interview", "offer", "declined"];
const INTERVIEW_MINUTES = [15, 20, 30, 45, 60, 90];
const pieceKey = (id, kind, n) => `appfile:${id}:${kind}:${n}`;

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
      status: "new",
      thread: [],
    });
    await db().lpush("applications", id);
    await db().hset(myAppsKey(session.email), { [job.id]: id });
  } catch (err) {
    await db().srem(appliedKey(session.email), job.id); // so you can try again
    throw err;
  }
  return json(res, 200, { ok: true });
}

// What an applicant sees of their own application: no private notes, and no one's email address.
function applicantView(app) {
  return {
    id: app.id,
    jobId: app.jobId,
    jobTitle: app.jobTitle,
    at: app.at,
    status: app.status ?? "new",
    interview: app.interview ? { start: app.interview.start, minutes: app.interview.minutes, where: app.interview.where, note: app.interview.note } : null,
    messages: (app.thread ?? []).filter((t) => t.kind === "message" && !t.internal).map(({ at, by, text: body }) => ({ at, by, text: body })),
  };
}

async function mine(res, session) {
  const jobs = (await db().smembers(appliedKey(session.email))) || [];
  const ids = (await db().hgetall(myAppsKey(session.email))) || {};
  if (jobs.some((job) => !ids[job])) {
    // Sent before applications were listed per person: find them in the full list, once.
    const all = (await db().lrange("applications", 0, MAX_APPLICATIONS - 1)) || [];
    const pipe = db().pipeline();
    for (const id of all) pipe.get(appKey(id));
    const found = all.length ? await pipe.exec() : [];
    for (const app of found) if (app?.email === session.email) ids[app.jobId] = app.id;
    if (Object.keys(ids).length) await db().hset(myAppsKey(session.email), ids);
  }
  const list = Object.values(ids).filter((id) => ID.test(id));
  const pipe = db().pipeline();
  for (const id of list) pipe.get(appKey(id));
  const apps = list.length ? (await pipe.exec()).filter((app) => app?.email === session.email) : [];
  return json(res, 200, { jobs, applications: apps.map(applicantView) });
}

// A moderator answers an application: a message (to the applicant, or a private note), a new
// status, and/or an interview (null cancels it). Each change is added to the application's thread.
async function update(req, res, session) {
  const body = req.body || {};
  const id = String(body.id || "");
  const app = ID.test(id) ? await db().get(appKey(id)) : null;
  if (!app) return json(res, 404, { error: "That application isn't there anymore" });
  const by = session.name || session.email;
  const at = new Date().toISOString();
  const thread = app.thread ?? [];
  let status = body.status;
  let statusFromInterview = false; // scheduling an interview moves it along without a separate entry

  if (body.interview === null) {
    if (app.interview) thread.push({ kind: "interview-cancelled", by, at });
    app.interview = null;
  } else if (body.interview) {
    const start = Date.parse(body.interview.start);
    const minutes = Number(body.interview.minutes);
    const where = text(body.interview.where, 200);
    if (!Number.isFinite(start) || start < Date.now() - 864e5 || start > Date.now() + 366 * 864e5) {
      return json(res, 400, { error: "Pick a date and time for the interview" });
    }
    if (!INTERVIEW_MINUTES.includes(minutes)) return json(res, 400, { error: "Pick how long the interview is" });
    if (!where) return json(res, 400, { error: "Say where the interview is: a room, or a video call link" });
    app.interview = { start: new Date(start).toISOString(), minutes, where, note: text(body.interview.note, 500), by, at };
    thread.push({ kind: "interview", by, at, interview: app.interview });
    if (status === undefined) {
      status = "interview";
      statusFromInterview = true;
    }
  }

  if (body.message) {
    const message = text(body.message.text, 2000);
    if (!message) return json(res, 400, { error: "Write something first" });
    thread.push({ kind: "message", by, at, text: message, internal: body.message.internal === true });
  }

  if (status !== undefined) {
    if (!STATUSES.includes(status)) return json(res, 400, { error: "That isn't a status" });
    if (status !== (app.status ?? "new") && !statusFromInterview) thread.push({ kind: "status", by, at, status });
    app.status = status;
  }

  app.thread = thread;
  app.updatedAt = at;
  await db().set(appKey(id), app);
  return json(res, 200, { application: app });
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
  if (req.method === "PATCH") {
    if (!isModerator(session)) return json(res, 403, { error: "Only DubHub's moderators can answer applications" });
    return update(req, res, session);
  }
  if (req.method !== "GET") return json(res, 405, { error: "Use GET, POST, or PATCH" });

  if (req.query.mine) return mine(res, session);
  if (!isModerator(session)) return json(res, 403, { error: "Only DubHub's moderators can see applications" });
  if (req.query.file) return sendFile(req, res);

  const ids = (await db().lrange("applications", 0, MAX_APPLICATIONS - 1)) || [];
  if (ids.length === 0) return json(res, 200, { applications: [] });
  const pipe = db().pipeline();
  for (const id of ids) pipe.get(appKey(id));
  return json(res, 200, { applications: (await pipe.exec()).filter(Boolean) });
}
