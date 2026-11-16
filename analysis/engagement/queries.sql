-- What gets a club's event post more engagement?
--
-- RSVPs are too sparse to model (few events have any), so the outcome is Instagram likes per post
-- promoting the event. Big clubs get more likes on everything, so each comparison is made inside a
-- club: a post's "lift" is its log-likes minus that club's average log-likes, for clubs with 2+
-- event posts. exp(average lift) - 1 is the typical % change in likes for one club.

-- 1. How much data there is
SELECT source, count(*) AS events, count(likes) AS with_likes, sum(rsvps > 0) AS with_rsvps,
       round(avg(likes), 1) AS avg_likes
FROM events GROUP BY source ORDER BY events DESC;

-- 2. Likes relative to the club's own average
DROP VIEW IF EXISTS lift;
CREATE VIEW lift AS
WITH ig AS (
  SELECT *, ln(likes + 1) AS ll,
         count(*) OVER (PARTITION BY host) AS club_posts,
         avg(ln(likes + 1)) OVER (PARTITION BY host) AS club_ll
  FROM events WHERE source = 'instagram' AND likes IS NOT NULL
)
SELECT *, ll - club_ll AS lift FROM ig WHERE club_posts >= 2;

-- 3. Within-club lift by feature (the main result)
WITH f AS (
  SELECT 'mentions food' AS feature, mentions_food AS has, lift FROM lift
  UNION ALL SELECT 'says free', says_free, lift FROM lift
  UNION ALL SELECT 'collab with another club', is_collab, lift FROM lift
  UNION ALL SELECT 'promoted in 2+ posts', posts >= 2, lift FROM lift
  UNION ALL SELECT 'weekend', weekday IN (0, 6), lift FROM lift
  UNION ALL SELECT 'starts 5pm or later', start_hour >= 17, lift FROM lift WHERE start_hour IS NOT NULL
  UNION ALL SELECT 'place on the map', on_map, lift FROM lift
)
SELECT feature,
       sum(has) AS posts_with, sum(1 - has) AS posts_without,
       round(100 * (exp(avg(CASE WHEN has THEN lift END) - avg(CASE WHEN NOT has THEN lift END)) - 1)) AS pct_more_likes
FROM f GROUP BY feature ORDER BY pct_more_likes DESC;

-- 4. By event type, within club
SELECT type, count(*) AS posts, round(100 * (exp(avg(lift)) - 1)) AS pct_vs_club_avg
FROM lift GROUP BY type HAVING count(*) >= 5 ORDER BY pct_vs_club_avg DESC;

-- 5. Raw (between-club) view, for contrast: why the within-club step matters
SELECT mentions_food, count(*) AS posts, round(avg(likes), 1) AS avg_likes,
       (SELECT round(avg(likes), 1) FROM events e2 WHERE e2.source = 'instagram' AND e2.likes IS NOT NULL) AS overall
FROM events WHERE source = 'instagram' AND likes IS NOT NULL GROUP BY mentions_food;

-- 6. Why the raw food gap appears: bigger clubs (more likes on everything) post about food more
WITH clubs AS (
  SELECT host, avg(likes) AS club_avg, avg(mentions_food) AS food_share, count(*) AS posts
  FROM events WHERE source = 'instagram' AND likes IS NOT NULL GROUP BY host
), ranked AS (SELECT *, ntile(2) OVER (ORDER BY club_avg) AS half FROM clubs)
SELECT CASE half WHEN 2 THEN 'bigger clubs (top half by likes)' ELSE 'smaller clubs' END AS clubs,
       count(*) AS n_clubs, round(avg(club_avg), 1) AS avg_likes,
       round(100.0 * sum(food_share * posts) / sum(posts)) AS pct_posts_mention_food
FROM ranked GROUP BY half ORDER BY half DESC;
