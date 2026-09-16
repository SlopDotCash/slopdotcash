# Who builds on Slop, 8 September 2026 snapshot

`snapshot.json` in this directory is the aggregate-only dataset behind the
"Outside Slop" paragraph on `/sponsors`. It is committed here so the page
cites a fixed artifact rather than a third-party deployment. The site does not
recompute it; `src/lib/who-builds.ts` carries the SHA-256 of this file and a
unit test fails if the file and the figures the page quotes ever disagree.

SHA-256: `540df0156b3b7ac5ba8e283d795ef93bcd4642cff889953b4af8a97af2eb4c47`

A rendered view of the same file is at https://who-builds-on-slop.vercel.app.
The collection scripts live in that page's repository; nothing in this
repository runs them.

## What was measured

- Input: `https://slop.cash/data/leaderboard.json` generated 2026-09-06T19:02:58Z
  under `slop-score-v2`, 35-day window 2 August to 6 September 2026, 119
  leaders. The live leaderboard has moved since; the 119 is the count on that
  date only.
- For each login, from the public GitHub API only: every merged pull request
  the login authored since 1 January 2026 in repositories outside the four Slop
  projects and the slop.cash repositories (up to 300 per login); the login's
  own non-fork public repositories pushed in 2026; profile bio and company.
- Each external repository was assigned one primary focus area from its name,
  description and topics using a priority-ordered keyword list, with AI agents
  and LLM tooling taking priority when several matched.
- A contributor's primary focus is the dominant category across their 2026
  external and own repositories. A contributor is "classifiable" when at least
  one of those repositories carried a description or topics.

## Headline figures quoted on the page

| Cohort | Size | Classifiable | AI agents or LLM tooling primary | Merged at least one PR into an outside AI repo in 2026 |
|---|---|---|---|---|
| All on the 8 Sep leaderboard | 119 | 86 | 64 (74% of classifiable, 54% of all) | 50 (42% of all) |
| Active, score above zero | 90 | 61 | 43 | 36 |
| Top 50 | 50 | 36 | 28 | 22 |
| Top 20 | 20 | 16 | 13 | 11 |

## Caveats

- Public data only. Private repositories and organizations are invisible.
  10 contributors had no public 2026 footprint at all and 33 had nothing
  classifiable, so the 74% is of the 86 classifiable and both denominators
  are shown.
- Keyword classifier. Spot-checked against the 60 highest-volume repositories;
  individual tail assignments will be wrong. A crypto agent wallet counts as AI.
- Two mass pull-request accounts, `octo-patch` (802 merged PRs across 243
  repositories) and `latent-9` (188 across 172), are excluded from every
  repository-level figure. Both hold a Slop score of 0 or 1.
- Merged pull request counts include very small pull requests. Treat them as
  activity, not weight.
- No per-person rows are published. The snapshot holds cohort counts,
  focus-area totals and top repositories only.
