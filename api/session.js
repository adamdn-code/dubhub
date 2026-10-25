// POST /api/session { credential }: checks a Google sign-in and returns a DubHub token.
import { json, makeToken, missingConfig, verifyGoogle } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Email reminders aren't set up on the server yet", missing });

  const user = await verifyGoogle(req.body?.credential || "");
  if (!user) return json(res, 401, { error: "Sign-in couldn't be verified" });
  return json(res, 200, { token: makeToken({ kind: "session", ...user }), email: user.email });
}
