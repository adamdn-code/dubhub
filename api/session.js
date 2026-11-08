// POST /api/session { credential }: checks a Google sign-in and returns a DubHub token.
// GET  /api/session (signed in): { email, moderator } -- whether to show the moderators' pages.
import { isModerator, json, makeToken, missingConfig, rememberUser, sessionFrom, verifyGoogle } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const session = sessionFrom(req);
    if (!session) return json(res, 401, { error: "Sign in again" });
    await rememberUser(session).catch(() => {}); // every visit, so "last seen" stays current
    return json(res, 200, { email: session.email, moderator: isModerator(session) });
  }
  if (req.method !== "POST") return json(res, 405, { error: "Use GET or POST" });
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "RSVPs aren't set up on the server yet", missing });

  const user = await verifyGoogle(req.body?.credential || "");
  if (!user) return json(res, 401, { error: "Sign-in couldn't be verified" });
  await rememberUser(user).catch(() => {});
  return json(res, 200, { token: makeToken({ kind: "session", ...user }), email: user.email });
}
