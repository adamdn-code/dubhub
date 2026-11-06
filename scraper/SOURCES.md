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
