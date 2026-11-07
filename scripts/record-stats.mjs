// Saves a snapshot of DubHub's numbers each time the site is built for production on Vercel, which
// happens on every push (a code change or a scrape), so the moderators' Stats page gets a new point
// each time (api/stats.js reads them). vite.config.js runs this after the build. It never fails
// the build: if the database can't be reached, the site deploys without a new point.
//
// Stored in Redis as the hash stats:snapshots = { commit id: snapshot }.
import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { scanKeys } from "../api/_lib.js";
import { siteStats } from "../src/eventGroups.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const pacificDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// Joins (people pressing Join, from api/going.js) and job applications (api/apply.js) right now.
export async function liveCounts(redis) {
  const going = await scanKeys(redis, "going:*");
  const pipe = redis.pipeline();
  for (const key of going) pipe.hlen(key);
  const perEvent = going.length ? await pipe.exec() : [];
  return {
    perEvent: going.map((key, i) => ({ id: key.slice("going:".length), count: perEvent[i] || 0 })),
    joins: perEvent.reduce((sum, n) => sum + (n || 0), 0),
    joiners: (await scanKeys(redis, "joined:*")).length,
    applications: await redis.llen("applications"),
  };
}

export async function recordStats(env = process.env) {
  try {
    const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
    const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return console.log("stats: no database settings, so no snapshot this time");
    const redis = new Redis({ url, token });

    const numbers = siteStats(read("public/events.json").events, read("public/clubs.json").clubs, pacificDate());
    const { joins, joiners, applications } = await liveCounts(redis);
    const message = (env.VERCEL_GIT_COMMIT_MESSAGE || "").split("\n")[0].slice(0, 200);
    const snapshot = {
      sha: env.VERCEL_GIT_COMMIT_SHA || `build-${Date.now()}`,
      at: new Date().toISOString(),
      kind: /^(scheduled )?scrape/i.test(message) ? "scrape" : "change",
      message,
      author: env.VERCEL_GIT_COMMIT_AUTHOR_NAME || env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || "",
      ...numbers,
      joins,
      joiners,
      applications,
    };
    // Only the first build of a commit counts (a redeploy of the same commit adds nothing new).
    const added = await redis.hsetnx("stats:snapshots", snapshot.sha, snapshot);
    console.log(
      added
        ? `stats: saved a snapshot (${numbers.upcoming} upcoming events, ${numbers.clubs} clubs)`
        : "stats: this commit already has a snapshot"
    );
  } catch (err) {
    console.log(`stats: couldn't save a snapshot (${err.message}); the site deploys anyway`);
  }
}
