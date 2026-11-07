# Instagram scraper sources

`instagram_public_scraper.py` is DubHub's own scraper, modeled on two open-source projects
(both MIT licensed). This page credits them and records which others we compared (November 2026).

## What DubHub needs from Instagram

For each club account: the **event's picture**, the **account that posted it**, and the
**caption**. We also keep the post's **date** (to work out "this Friday"), its **link**,
the **text on the flyer** (from Instagram's description of the picture, since a flyer
often has the date or room the caption leaves out), the **like count** (for Trending), and
the club's **profile picture** (its logo on the Clubs page).

## Sources we used

| Project | What we took from it |
| --- | --- |
| [Instaloader](https://github.com/instaloader/instaloader) (MIT, ~13.8k stars, updated Nov 2026) | Its logged-out mode: a profile's public page has the profile and its 12 newest posts embedded as JSON (`InstaloaderContext.get_page_data`), so no login is needed. We call Instaloader for the page, then read the posts straight from it instead of looking each one up again: 1 request per club instead of 13. Needs Instaloader 4.16 or newer. |
| [instagram-media-scraper](https://github.com/ahmedrangel/instagram-media-scraper) by ahmedrangel (MIT, updated Jan 2025) | Its "GraphQL, no cookie" method: look up one post by its code without logging in, getting its full caption, pictures, owner and like count. We use Instaloader's maintained version of it (`Post.from_shortcode`) a few times per run, for the like counts of posts that announce events and to fill in posts the Google scraper only found as snippets. |

## Others we compared

| Project | Why not |
| --- | --- |
| [instagrapi](https://github.com/subzeroid/instagrapi) (~7k stars, active) | Logs in and pretends to be the phone app. Powerful, but every request is tied to an account Instagram can flag, which is what kept getting `dubhub.uw` blocked. License isn't marked clearly. |
| [instagram-private-api](https://github.com/dilame/instagram-private-api) (Node, ~6.5k stars) | Phone-app API with a login, like instagrapi; last updated Aug 2024. |
| [instagram_private_api](https://github.com/ping/instagram_private_api) (Python, ~3.3k stars) | Same approach; last updated May 2024. |
| [instagram-crawler](https://github.com/huaying/instagram-crawler) (~1.4k stars) | Drives a real browser (Selenium): slow and heavy for 200+ clubs; last updated May 2024. |
| [instagram-scraper](https://github.com/drawrowfly/instagram-scraper) (TypeScript, ~900 stars) | No license, last updated Mar 2023. |
| [Ultimate-Social-Scrapers](https://github.com/harismuneer/Ultimate-Social-Scrapers), [GramAddict](https://github.com/GramAddict/bot), [InstagramPrivSniffer](https://github.com/obitouka/InstagramPrivSniffer) and similar | A list of links, a follower-growth bot, and a tool for viewing private accounts: not for reading clubs' public posts (and the last isn't something DubHub should use). |

## How the two fit together in DubHub

1. `instagram_public_scraper.py` reads each club's public page (Instaloader's logged-out
   mode): club info, profile picture and 12 newest posts, in one request.
2. `events_common.py` finds the events in new posts (AI or keywords), using the caption and
   the flyer's text, then saves the event pictures in `public/ig/` for the site.
3. For posts that announce events, a single-post lookup (the instagram-media-scraper method)
   adds the like count, which the site's Trending row ranks by.


# Discord sources

`find_discord_servers.py` and `discord_events.py` are DubHub's own code, modeled on how the
projects below work (we compared them in November 2026; no code was copied).

## What DubHub needs from Discord

Which server is each club's (so the Clubs page can link it), and the events clubs post there:
the server's scheduled **Events** (name, time, place, description, cover picture, how many are
interested) and **announcement posts** that mention events or applications.

## How we combined them

| Project | What we took from it |
| --- | --- |
| Discord's public invite lookup (`GET /api/v10/invites/{code}?with_counts=true`), the endpoint invite checkers like [Discord Invite Parser](https://apify.com/rixin/discord-invite-parser) and [Discord Server Metadata Lookup](https://apify.com/devilscrapes/discord-server-scraper.md) wrap | Turning an invite link from a club's page into the server's name, icon and member count, with no login. `find_discord_servers.py` collects invites from clubs' HuskyLink details, Instagram bios, Linktree-style link pages and websites, and checks each one this way. |
| [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) (bot-token mode) and [discord-fetch](https://pypi.org/project/discord-fetch/) | Reading a server's channels with a **bot** token through Discord's API: list the channels, then each channel's recent messages. `discord_events.py` does this for announcement channels only, then hands the posts to the same AI event finder the Instagram scraper uses. |
| Discord's scheduled-events API (`GET /guilds/{id}/scheduled-events`), which any bot in a server can read ([example](https://www.rapidevelopers.com/api-automations/how-to-automate-discord-event-reminders-using-the-api)) | Events already have a name, time and place, so they go on the site without the AI. |

## What we don't do

Most Discord scrapers on GitHub log in with a person's account (a user token, a "self-bot") to
read any server that account is in. Discord's terms forbid self-bots and scraping, and it bans
accounts for it ([Discord: protecting your data](https://support.discord.com/hc/en-us/articles/360039598252)).
DubHub only reads servers whose admins added the DubHub bot.
