// Friends and messages, for signed-in UW students.
//
// GET  /api/social              -> { friends: [{ email, name, picture, going: [event ids] }],
//                                   incoming: [{ email, name }], outgoing: [{ email, name }],
//                                   conversations: [{ email, name, last: { from, text, at }, unread }],
//                                   unread }
// GET  /api/social?with=<email> -> { messages: [{ from: "me" | "them", text, at }] }  (friends only;
//                                   marks the conversation read)
// POST /api/social { action, email, text? }
//      "request"  ask someone (by their UW email) to be friends; if they already asked you, you're friends
//      "accept" / "decline"  answer a request
//      "remove"   unfriend (the conversation stays, but neither of you can send more)
//      "message"  send a friend a message (text, up to 1000 characters)
//
// Only friends see each other's events and can message each other, so nobody gets messages from
// strangers, and an email address is only shown to that person's friends.
//
// Stored in Redis: user:<email> = { name, picture } (saved at each sign-in, see session.js),
// friends:<email>, freq:in:<email>, freq:out:<email> = sets of emails, dm:<a>|<b> = the
// conversation (a list, oldest first, at most 500), inbox:<email> = { other email: last message
// time }, and unread:<email> = { other email: count }.
import { db, json, missingConfig, rememberUser, sessionFrom } from "./_lib.js";

const EMAIL = /^[a-z0-9._%+-]+@uw\.edu$/;
const MAX_MESSAGES = 500;
const key = {
  user: (e) => `user:${e}`,
  friends: (e) => `friends:${e}`,
  inbox: (e) => `freq:in:${e}`,
  outbox: (e) => `freq:out:${e}`,
  dm: (a, b) => `dm:${[a, b].sort().join("|")}`,
  convos: (e) => `inbox:${e}`,
  unread: (e) => `unread:${e}`,
};

// Names (and pictures) for a list of emails, as one request.
async function people(emails) {
  if (!emails.length) return [];
  const pipe = db().pipeline();
  for (const e of emails) pipe.get(key.user(e));
  const found = await pipe.exec();
  return emails.map((email, i) => ({ email, name: found[i]?.name || email.split("@")[0], picture: found[i]?.picture || null }));
}

async function overview(res, me) {
  const pipe = db().pipeline();
  pipe.smembers(key.friends(me));
  pipe.smembers(key.inbox(me));
  pipe.smembers(key.outbox(me));
  pipe.hgetall(key.convos(me));
  pipe.hgetall(key.unread(me));
  const [friendList, incoming, outgoing, convos, unread] = await pipe.exec();
  const friends = await people(friendList || []);
  if (friends.length) {
    const going = db().pipeline();
    for (const f of friends) going.smembers(`joined:${f.email}`);
    (await going.exec()).forEach((ids, i) => (friends[i].going = ids || []));
  }

  const others = Object.keys(convos || {});
  const lasts = others.length ? await (() => {
    const p = db().pipeline();
    for (const o of others) p.lrange(key.dm(me, o), -1, -1);
    return p.exec();
  })() : [];
  const named = await people(others);
  const conversations = others
    .map((email, i) => {
      const last = lasts[i]?.[0];
      return {
        email,
        name: named[i].name,
        picture: named[i].picture,
        last: last && { from: last.from === me ? "me" : "them", text: last.text, at: last.at },
        unread: Number(unread?.[email] || 0),
      };
    })
    .filter((c) => c.last)
    .sort((a, b) => b.last.at.localeCompare(a.last.at));

  return json(res, 200, {
    friends: friends.sort((a, b) => a.name.localeCompare(b.name)),
    incoming: await people(incoming || []),
    outgoing: await people(outgoing || []),
    conversations,
    unread: conversations.reduce((sum, c) => sum + c.unread, 0),
  });
}

async function conversation(res, me, other) {
  if (!(await db().sismember(key.friends(me), other))) {
    // Unfriended: you can still read what was said, but not new messages from them.
    if (!(await db().hexists(key.convos(me), other))) return json(res, 403, { error: "You can only message friends" });
  }
  const list = (await db().lrange(key.dm(me, other), 0, -1)) || [];
  await db().hdel(key.unread(me), other);
  return json(res, 200, { messages: list.map((m) => ({ from: m.from === me ? "me" : "them", text: m.text, at: m.at })) });
}

async function act(req, res, me, myName) {
  const { action, text } = req.body || {};
  const other = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL.test(other)) return json(res, 400, { error: "Use their UW email (NetID@uw.edu)" });
  if (other === me) return json(res, 400, { error: "That's you!" });
  const r = db();

  if (action === "request") {
    if (await r.sismember(key.friends(me), other)) return json(res, 200, { ok: true, status: "friends" });
    if (await r.sismember(key.inbox(me), other)) return act({ body: { action: "accept", email: other } }, res, me, myName);
    await r.sadd(key.outbox(me), other);
    await r.sadd(key.inbox(other), me);
    return json(res, 200, { ok: true, status: "requested" });
  }
  if (action === "accept") {
    if (!(await r.sismember(key.inbox(me), other))) return json(res, 400, { error: "They haven't asked to be friends" });
    await r.srem(key.inbox(me), other);
    await r.srem(key.outbox(other), me);
    await r.sadd(key.friends(me), other);
    await r.sadd(key.friends(other), me);
    return json(res, 200, { ok: true, status: "friends" });
  }
  if (action === "decline") {
    await r.srem(key.inbox(me), other);
    await r.srem(key.outbox(other), me);
    return json(res, 200, { ok: true });
  }
  if (action === "remove") {
    await r.srem(key.friends(me), other);
    await r.srem(key.friends(other), me);
    await r.srem(key.outbox(me), other); // also takes back a request you sent
    await r.srem(key.inbox(other), me);
    return json(res, 200, { ok: true });
  }
  if (action === "message") {
    const body = typeof text === "string" ? text.trim().slice(0, 1000) : "";
    if (!body) return json(res, 400, { error: "Write something first" });
    if (!(await r.sismember(key.friends(me), other))) return json(res, 403, { error: "You can only message friends" });
    const at = new Date().toISOString();
    const dm = key.dm(me, other);
    await r.rpush(dm, { from: me, text: body, at });
    await r.ltrim(dm, -MAX_MESSAGES, -1);
    await r.hset(key.convos(me), { [other]: at });
    await r.hset(key.convos(other), { [me]: at });
    await r.hincrby(key.unread(other), me, 1);
    return json(res, 200, { ok: true, message: { from: "me", text: body, at } });
  }
  return json(res, 400, { error: "Unknown action" });
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Friends aren't set up on the server yet", missing });
  const session = sessionFrom(req);
  if (!session) return json(res, 401, { error: "Sign in with your UW account" });
  const me = session.email;
  // Keep your name up to date for your friends (sign-ins before this didn't save it).
  await rememberUser(session);

  if (req.method === "GET") {
    if (req.query.with) {
      const other = String(req.query.with).toLowerCase();
      if (!EMAIL.test(other)) return json(res, 400, { error: "Unknown person" });
      return conversation(res, me, other);
    }
    return overview(res, me);
  }
  if (req.method === "POST") return act(req, res, me, session.name);
  return json(res, 405, { error: "Use GET or POST" });
}
