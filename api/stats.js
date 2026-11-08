// The moderators' Stats page.
//
// GET /api/stats  (moderators only) ->
//   { snapshots: [{ sha, at, kind: "scrape" | "change", message, author, upcoming, onMap, clubs,
//                   clubsOnInstagram, byGroup, bySource, joins?, joiners?, applications? }, ...],
//     live: { joins, joiners, applications, byRole: { job id: count }, topJoined: [{ id, count }] } }
//
// Snapshots, oldest first: one for every production deploy (scripts/record-stats.mjs saves them
// as Vercel builds each push, a change or a scrape), after the ones rebuilt from the git history
// for the commits before that (_stats-history.js). `live` is counted right now.
import HISTORY from "./_stats-history.js";
import { db, isModerator, json, missingConfig, sessionFrom } from "./_lib.js";
import { liveCounts, memberEmails } from "../scripts/record-stats.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Use GET" });
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Stats aren't set up on the server yet", missing });
  const session = sessionFrom(req);
  if (!session) return json(res, 401, { error: "Sign in again" });
  if (!isModerator(session)) return json(res, 403, { error: "Only DubHub's moderators can see stats" });

  const saved = Object.values((await db().hgetall("stats:snapshots")) || {});
  const bySha = new Map([...HISTORY, ...saved].map((s) => [s.sha, s]));
  const snapshots = [...bySha.values()].sort((a, b) => a.at.localeCompare(b.at));

  const { perEvent, joins, joiners, applications } = await liveCounts(db());
  const ids = (await db().lrange("applications", 0, 999)) || [];
  const byRole = {};
  if (ids.length) {
    const pipe = db().pipeline();
    for (const id of ids) pipe.get(`application:${id}`);
    for (const app of await pipe.exec()) if (app?.jobId) byRole[app.jobId] = (byRole[app.jobId] ?? 0) + 1;
  }
  const topJoined = perEvent.filter((e) => e.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);

  // Everyone who has signed in, with when they were first and last on DubHub.
  const emails = await memberEmails(db());
  let members = [];
  if (emails.length) {
    const pipe = db().pipeline();
    for (const e of emails) {
      pipe.get(`user:${e}`);
      pipe.scard(`joined:${e}`);
    }
    const out = await pipe.exec();
    members = emails.map((email, i) => {
      const u = out[2 * i] || {};
      return { email, name: u.name || email.split("@")[0], firstSeen: u.firstSeen || null, lastSeen: u.lastSeen || null, joined: out[2 * i + 1] || 0 };
    });
  }

  return json(res, 200, { snapshots, live: { joins, joiners, applications, byRole, topJoined, members } });
}
