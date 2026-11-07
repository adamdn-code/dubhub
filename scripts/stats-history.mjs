// Rebuilds api/_stats-history.js: DubHub's numbers at every commit from before the Stats page
// started saving a snapshot at each deploy (scripts/record-stats.mjs), worked out from the git
// history. Run from the repo:  node scripts/stats-history.mjs
//
// A commit that only changed scraped data counts as a scrape; anything else is a change.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { siteStats } from "../src/eventGroups.js";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const DATA_FILE = /^(public\/(events|clubs|applications)\.json|public\/ig\/.*|scraper\/[^/]+\.json)$/;

function fileAt(sha, path, key) {
  try {
    return JSON.parse(git("show", `${sha}:${path}`))[key] ?? [];
  } catch {
    return []; // not there yet at that commit
  }
}

const history = [];
for (const line of git("log", "--reverse", "--format=%H%x09%cI%x09%an%x09%s").trim().split("\n")) {
  const [sha, at, author, message] = line.split("\t");
  const events = fileAt(sha, "public/events.json", "events");
  const clubs = fileAt(sha, "public/clubs.json", "clubs");
  if (!events.length && !clubs.length) continue; // before DubHub had any data
  const files = git("show", "--name-only", "--format=", sha).trim().split("\n").filter(Boolean);
  const today = new Date(at).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  history.push({
    sha,
    at: new Date(at).toISOString(),
    kind: files.length && files.every((f) => DATA_FILE.test(f)) ? "scrape" : "change",
    message: message.slice(0, 200),
    author,
    ...siteStats(events, clubs, today),
  });
}

writeFileSync(
  new URL("../api/_stats-history.js", import.meta.url),
  "// DubHub's numbers at each commit before snapshots were saved at every deploy, for the Stats page.\n" +
    "// Made by scripts/stats-history.mjs from the git history; don't edit by hand.\n" +
    `export default [\n${history.map((s) => `  ${JSON.stringify(s)},`).join("\n")}\n];\n`
);
console.log(`${history.length} commits: ${history.filter((s) => s.kind === "scrape").length} scrapes, ${history.filter((s) => s.kind === "change").length} changes`);
