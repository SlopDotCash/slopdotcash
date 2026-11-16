# Who builds on Slop, 2026-09-17 snapshot

`snapshot.json` in this directory is the aggregate-only dataset behind the
"Who builds on Slop." section on `/sponsors`. It is committed here so the page
cites a fixed artifact rather than a third-party deployment. The site does not
recompute it; `src/lib/who-builds.ts` imports this file directly and carries
its SHA-256, and a unit test fails if the file and the hash ever disagree.

SHA-256: `edc05b350e371c50e0b5f72d01c92ea626ed03e23474febd5ddaf0f85c7df306`

A rendered view of the same file is at https://who-builds-on-slop.vercel.app.
The collection and aggregation scripts live in that page's repository
(`scripts/collect.py`, `scripts/enrich.py`, `scripts/aggregate.py`); nothing
in this repository runs them. To refresh: run them, commit the new
`snapshot.json` under a new dated directory here with this note, then point
the import and the hash in `src/lib/who-builds.ts` at it.

## What was measured

- Input: `https://slop.cash/data/leaderboard.json` generated
  2026-09-17T21:00:31.710Z under `slop-score-v2`, 35-day window
  2026-08-13 to 2026-09-17, 84 leaders. The live
  leaderboard has moved since; the 84 is the count on that date only.
- For each login, from the public GitHub API only: every merged pull request
  the login authored since 1 January 2026 in repositories outside the Slop
  projects and the slop.cash repositories (up to 300 per login); the login's
  own non-fork public repositories pushed in 2026; profile bio and company.
- Each external repository was assigned one primary focus area from its name,
  description and topics using a priority-ordered keyword list, with AI agents
  and LLM tooling taking priority when several matched. A repository with no
  match on metadata falls back to its pull request titles.
- A contributor's primary focus is the dominant category across their 2026
  external and own repositories. A contributor is "classifiable" when at least
  one of those repositories was assigned a category.

## Headline figures quoted on the page

| Cohort | Size | Classifiable | AI agents or LLM tooling primary | Merged at least one PR into an outside AI repo in 2026 |
|---|---|---|---|---|
| All on the 2026-09-17 leaderboard | 84 | 56 | 43 (77% of classifiable, 51% of all) | 32 (38% of all) |
| Active, score above zero | 65 | 40 | 30 (75% of classifiable, 46% of all) | 22 (34% of all) |
| Top 50 | 50 | 35 | 25 (71% of classifiable, 50% of all) | 19 (38% of all) |
| Top 20 | 20 | 16 | 14 (88% of classifiable, 70% of all) | 12 (60% of all) |

Repository-level figures: 3770 merged pull requests across
451 outside repositories; the median outside AI
repository has 12 stars and 48% have fewer than ten.

## Caveats

- Public data only. Private repositories and organizations are invisible.
  10 contributors had no public 2026 footprint at all and
  28 had nothing classifiable, so the primary-focus share is
  of the 56 classifiable and both denominators are shown.
- Keyword classifier. Individual tail assignments will be wrong. A crypto
  agent wallet counts as AI.
- Accounts with merged pull requests into 100 or more outside repositories
  are excluded from every repository-level figure as mass pull-request
  accounts. None qualified on this leaderboard.
- Merged pull request counts include very small pull requests. Treat them as
  activity, not weight.
- No per-person rows are published. The snapshot holds cohort counts,
  focus-area totals and top repositories only.
