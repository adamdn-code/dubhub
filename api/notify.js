// GET /api/notify: run every hour (by .github/workflows/notify.yml, since Vercel's free plan only
// allows daily jobs). Sends two kinds of email to people who turned them on in their profile:
//   - "New event from <club>": a club they joined posted an event the scrapers just found.
//   - "Starting soon": an event in their My Events starts within the next 90 minutes.
import {
  SITE_URL,
  SUBSCRIBERS,
  db,
  emailLayout,
  getReminders,
  isHostedBy,
  json,
  makeToken,
  missingConfig,
  seattleDate,
  seattleMinutes,
  sendMail,
  setReminders,
  siteEvents,
  time,
} from "./_lib.js";

const SOON_MINUTES = 90; // runs are hourly and GitHub can start them late, so look a bit past an hour

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function newClubEventsEmail(r, events, unsubscribeUrl) {
  const hosts = [...new Set(events.map((e) => e.clubName))];
  const from = hosts.length === 1 ? hosts[0] : `${hosts.length} of your clubs`;
  return {
    subject: events.length === 1 ? `New event from ${from}: ${events[0].title}` : `${events.length} new events from ${from}`,
    ...emailLayout({
      greeting: `Hi ${(r.name || "there").split(" ")[0]}, ${from} just posted:`,
      events,
      showDate: true,
      footer: "You're getting this because you turned on new club event emails in your DubHub profile.",
      unsubscribeUrl,
    }),
  };
}

function soonEmail(r, events, unsubscribeUrl) {
  return {
    subject: events.length === 1
      ? `Starting soon: ${events[0].title} at ${time(events[0].start)}`
      : `${events.length} of your events start soon`,
    ...emailLayout({
      greeting: `Hi ${(r.name || "there").split(" ")[0]}, ${events.length === 1 ? "this starts" : "these start"} soon:`,
      events,
      showDate: false,
      footer: "You're getting this because you turned on starting-soon emails in your DubHub profile.",
      unsubscribeUrl,
    }),
  };
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: "Not allowed" });
  }
  const missing = missingConfig();
  if (missing.length) return json(res, 503, { error: "Not set up", missing });

  let site;
  try {
    site = await siteEvents();
  } catch (e) {
    return json(res, 502, { error: `Couldn't load ${SITE_URL}/events.json (${e.message})` });
  }

  const today = seattleDate(0);
  const now = seattleMinutes();
  const emails = (await db().smembers(SUBSCRIBERS)) || [];
  const results = { today, subscribers: emails.length, newClubEmails: 0, soonEmails: 0, failed: 0 };

  for (const email of emails) {
    const r = await getReminders(email);
    const clubs = r.clubs || [];
    const unsubscribe = `${SITE_URL}/api/unsubscribe?t=${makeToken({ kind: "unsubscribe", email }, 365)}`;
    const changes = {};

    // Upcoming events from their clubs, each tagged with which club it came from.
    const clubEvents = site
      .filter((e) => e.date >= today)
      .map((e) => ({ ...e, clubName: clubs.find((c) => isHostedBy(e, c))?.name }))
      .filter((e) => e.clubName);

    try {
      if (r.newClubEvents) {
        const ids = clubEvents.map((e) => e.id);
        // The first run after turning this on just remembers what's already there, so nobody
        // gets an email about every existing event at once.
        if (r.seenClubEvents) {
          const fresh = clubEvents.filter((e) => !r.seenClubEvents.includes(e.id));
          if (fresh.length) {
            await sendMail({ to: email, ...newClubEventsEmail(r, fresh, unsubscribe) });
            results.newClubEmails++;
          }
        }
        changes.seenClubEvents = ids;
      }

      if (r.hourBefore) {
        // Their saved My Events plus any club event the site found since they last visited.
        const mine = [...(r.events || []), ...clubEvents];
        const sent = r.soonSent || [];
        const soon = [...new Map(mine.map((e) => [e.id, e])).values()].filter((e) => {
          if (e.date !== today || !e.start || sent.includes(e.id)) return false;
          const until = minutes(e.start) - now;
          return until > 0 && until <= SOON_MINUTES;
        });
        if (soon.length) {
          soon.sort((a, b) => a.start.localeCompare(b.start));
          await sendMail({ to: email, ...soonEmail(r, soon, unsubscribe) });
          results.soonEmails++;
          // Only today's ids are worth remembering; tomorrow they can't match anyway.
          changes.soonSent = [...sent, ...soon.map((e) => e.id)].slice(-50);
        }
      }
    } catch (e) {
      console.error(`Notification to ${email} failed:`, e.message);
      results.failed++;
    }
    if (Object.keys(changes).length) await setReminders(email, changes);
  }
  console.log("Notifications:", results);
  return json(res, 200, results);
}
