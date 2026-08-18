# Slop Score v2

Score v2 applies to accepted work from 2026-08-01 00:00:00 UTC. It replaces
account-level caps and diminishing merge credit with reviewed logical work
units. August is recalculated under this rule before its cycle closes.

## Contribution tiers

Scores are stored as integer thirds and rounded down only after an actor's
weighted monthly total is aggregated:

| Tier | Thirds | Points |
| --- | ---: | ---: |
| Micro | 1 | 1/3 |
| Small | 3 | 1 |
| Medium | 9 | 3 |
| Large | 24 | 8 |
| XL | 45 | 15 |
| Exceptional | 75 | 25 |

Every accepted merge begins as a provisional micro work unit. A Claude review
agent may propose a higher tier, but only an immutable maintainer-authored
`slop-score` record bound to the pull-request node ID and exact head SHA can
ratify it. Related or artificially split PRs share one `workUnitId`; confirmed
duplicates, valueless changes, and split-only work may be excluded by a public
human decision. XL, exceptional, security-sensitive, and related-party cases
require a second maintainer.

## Review credit

Review is paid from the same project pool: triage 1/3, standard 1, deep
reproduction 3, and specialist review 8. A separate maintainer ratification
earns 1/3 unless that actor already received review credit on the artifact.
Self-review, post-merge review, duplicate review, and bot activity do not score.

The `slop-review` proposal records effort, complexity, impact, review load,
split risk, confidence, exact provider/model/client, receipt, and finalized
private trace. Maintainers remain the sole scoring authority.

## Evidence bonuses

A valid signed receipt with an outcome-matched finalized private trace adds a
fixed 15% weight. Outcome-matched exact or bounded usage adds 10%. The combined
bonus is capped at 25%; raw tokens, cost, lines, commits, and account count
never increase it. Missing pre-activation August traces do not reduce base
credit. Runs after a project's receipt cutover must satisfy its active receipt
policy or remain held.

## August migration

All August merges are retained. Unratified work receives provisional micro
credit, machine-reviewed work is queued for maintainer ratification, and public
successor records capture higher tiers, holds, exclusions, and work-unit
grouping. The frozen August snapshot binds this rule version and then enters
the ordinary 14-day public allocation review.

No KYC is required. Abuse resistance comes from immutable GitHub actor and
artifact IDs, work-unit grouping, exact-head decisions, public human authority,
and append-only corrections—not identity documents.
