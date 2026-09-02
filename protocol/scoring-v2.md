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

Formal review collection is independent of the reviewed pull-request author's
full-detail hydration cap. Before detail hydration, the generator performs a
bounded scalar census across the complete merged-outcome window. Every pull
request with at least one formal review enters complete review hydration even
when it is older than the author's five newest merges. The generator preflights
two full census passes plus the detail cost against its fixed GitHub budget,
retains each pull request's review count and update timestamp, and repeats the
census immediately before assembly. It aborts without a snapshot if any
requested node, count, timestamp, review page, or inline-comment page is missing
or inconsistent. Review-only hydration never enables author-detail bonuses.

Each collected formal review that does not score appears in the public
`reviewExclusions` array with immutable pull-request and review node IDs, its
canonical public URL and repository, and one closed reason enum. This makes
self-review, bot, post-merge, duplicate-reviewer, non-decision, insufficient-
substance, pre-existing evaluated-contribution awards, external-prize-policy,
and reviewer-cycle-cap exclusions auditable without publishing review bodies
in a second surface.

An existing evaluated-contribution review award remains authoritative for its
reviewer and pull request. The same review cannot also receive ordinary formal
review credit, and a second evaluator award for that reviewer/pull-request pair
fails closed. Historic awards whose closed-unmerged parent is outside the live
collection window remain governed by their validated evaluator manifest.

The `slop-review` proposal records effort, complexity, impact, review load,
split risk, confidence, exact provider/model/client, receipt, and finalized
private trace. Maintainers remain the sole scoring authority.

## Evidence bonuses

A valid signed receipt with an outcome-matched finalized private trace adds a
fixed 15% weight. This applies equally to an ordinary qualifying formal review
when its exact review source carries the same actor's valid receipt and the
receipt is bound to the reviewed repository. A missing or invalid receipt
removes only the bonus; it does not remove otherwise valid base review credit.
Usage evidence remains diagnostic: token volume, confidence,
cost, lines, commits, and account count never change score, rank, reward share,
or payment. Missing pre-activation August traces do not reduce base credit. Runs
after a project's receipt cutover must satisfy its active receipt policy or
remain held.

## August migration

All August merges are retained. Unratified work receives provisional micro
credit, machine-reviewed work is queued for maintainer ratification, and public
successor records capture higher tiers, holds, exclusions, and work-unit
grouping. The frozen August snapshot binds this rule version and then enters
the ordinary 14-day public allocation review.

Usage-derived bonuses shown in provisional snapshots before the
2026-08-19 00:00:00 UTC cutover are void when August is frozen for settlement;
the underlying accepted outcome and any finalized private-trace bonus remain.

No KYC is required. Abuse resistance comes from immutable GitHub actor and
artifact IDs, work-unit grouping, exact-head decisions, public human authority,
and append-only corrections—not identity documents.
