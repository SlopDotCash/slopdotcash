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

Every accepted merge begins as a provisional work unit: micro when merged
before 2026-10-01T00:00:00Z, small from then on (PRD SCR-05). A Claude review
agent may propose another tier,
but only an immutable maintainer-authored `slop-score` record bound to the
pull-request node ID and exact head SHA can ratify it, including micro for
trivial work. Related or artificially split PRs share one `workUnitId`; confirmed
duplicates, valueless changes, and split-only work may be excluded by a public
human decision. XL, exceptional, security-sensitive, and related-party cases
require a second maintainer.

## Shared merge credit

Approved by the repository owner on 2026-10-08 in response to issue #506
(PRD SCR-04). The merge credit of a pull request into the repository's
integration branch is shared among its pull-request author and every distinct
non-bot GitHub user that GitHub links as a commit author. Unlinked commit
emails, `[bot]` app logins, the vendor coding-agent accounts `claude`, `codex`,
and `cursoragent` (pinned by node ID), and `Co-authored-by` trailers do not
count. A commit SHA gives credit
only in the earliest merged pull request that lists it, so a consolidation or
promotion pull request cannot score it again. Collect every commit page before
scoring. Above GitHub's 250-commit pull-request listing limit, paginate the
immutable base/head comparison and reconcile its total and known SHAs.
Incomplete evidence must fail snapshot collection. A pull request into another
branch keeps author-only credit.

The work unit's score thirds are split equally. The author is first and the
other actors follow in actor-ID order; the first actors receive the remainder.
Each actor keeps at least one third. The author's event keeps the
`<pull-request-node-id>:merged` ID and the only evidence bonus; each other
actor's event is `<pull-request-node-id>:merged:<actor-node-id>`. A formal
review, a `slop-review` record, or a `slop-score` ratification by any credit
actor of the same pull request is a self-review and earns no review credit.

## Review credit

Review is paid from the same project pool: triage 1/3, standard 1, deep
reproduction 3, and specialist review 8. A separate maintainer ratification
earns 1/3 unless that actor already received review credit on the artifact.
Self-review, post-merge review, duplicate review, and bot activity do not score.

Before 2026-10-01T00:00:00Z, every reviewer's first qualifying pre-merge
`APPROVED` or `CHANGES_REQUESTED` formal review scores standard credit. From
that instant (PRD SCR-05), an ordinary formal review scores only when it
changed the accepted outcome: a `CHANGES_REQUESTED` review of a commit that is
not the merged head. One merged pull request gives at most one ordinary review
award, triage credit, to the latest such review. Approvals, requests the merge
ignored, and reviews without a recorded commit publish `unchanged-outcome`;
other qualifying reviews publish `pull-request-review-awarded`. Higher review
tiers still come only from maintainer-ratified review records or evaluated
contributions.

Payment-only amendment for #683 (owner decision, 14 October 2026): ordinary
review payment eligibility changes at `2026-10-09T23:21:35.388Z`, the successful
production release of SCR-05, rather than October 1. See the
[PRD amendment](../docs/slop-product-requirements.md#7-scores-discovery-and-clear-pages)
for release evidence. Pre-release qualifying approvals and change requests
retain standard payment weight. Public Slop Score and Points keep the October
1 rule above. New snapshots publish `paymentReviewBasis` with policy
`scr-05-payments-production-v1`, its cutoff, and the separately validated
allocation ledger. October and later payment proposals require this basis;
missing evidence fails closed. Earlier closed cycles remain unchanged.

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
reviewer-cycle-cap, unchanged-outcome, and pull-request-review-awarded
exclusions auditable without publishing review bodies
in a second surface.

An existing evaluated-contribution review award remains authoritative for its
reviewer and pull request. The same review cannot also receive ordinary formal
review credit, and a second evaluator award for that reviewer/pull-request pair
fails closed. Historic awards whose closed-unmerged parent is outside the live
collection window remain governed by their validated evaluator manifest.

The `slop-review` proposal records effort, complexity, impact, review load,
split risk, confidence, exact provider/model/client, receipt, and finalized
private trace. Maintainers remain the sole scoring authority.

## External evaluated contributions

A project that sets `reward.externalEvaluations.enabled` may recognize useful
work outside its repository, such as a public explainer, a support answer, a
tutorial, or a video, through the same one-file evaluated-contribution award.
The award carries the one canonical public URL form for its platform, a
deterministic URL-bound source id, and archive evidence captured before review;
awards that name the same piece of work or archive the same content are
rejected together. It scores 1–8 points from the
shared pool under the existing newest-three cap, never carries a receipt or
evidence bonus, and never cites reach metrics. Absent opt-in, such awards fail
closed. See [`evaluations/README.md`](../evaluations/README.md).

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

## Owner-approved provisional valuation extension (SCR-06)

On 9 October 2026 the owner approved automatic provisional value assessments
for all active projects and a separate September/October reassessment. The
implementation and acceptance gates are in
[`slop-value-scoring-plan.md`](../docs/slop-value-scoring-plan.md). This
extension does not authorize payout, exclusions, penalties or closure powers.

An authenticated, complete, exact-revision value assessment replaces the flat
provisional merge default for its covered work unit. Maintainer ratification
still takes precedence. The old default is an unassessed state, not a claim
that all work has equal value. Missing evidence is unresolved. Demonstrated
absence of an independent retained outcome can have zero provisional value.

Assess related implementations, follow-up repairs and integrations together.
Conserve the assessed work-unit total across its credited contributors and
source PRs: adding another PR or actor must not create an extra minimum award.
Show the distinct implementation, validation and integration reasons. Neither
line count nor an unexplained merge or approval establishes that contribution.

Publish each revision with its source digest, head, policy/rubric version,
model provenance, rationale, predecessor and effective time. Retain the prior
published score. Do not rewrite a frozen cycle or change an approved, funded,
scheduled or paid obligation through this provisional extension. Review
activity keeps its actual source date; a later merge does not move an August
review into the September or October activity ledger.

## Current producer: slop-value-v1

PRD section 7 makes Slopbot's size and value assessment the normal score for
new work (SCR-06; MVP-09, MVP-05a). `src/lib/scoring-policy.ts` holds the one
versioned policy for new work. `bun run leaderboard:generate` and the release
workflow select it without an opt-in flag. The merge time of a pull request, or
the closure time of closed unmerged work, selects its policy. Work accepted
before the effective instant keeps the Score v2 and SCR-05 rules above, its
coverage row reads `legacy-policy`, and its awards are not reinterpreted.
Work accepted from that instant:

- takes its implementation score from the current exact-head value
  assessment. A valid maintainer `slop-score` record is the correction
  exception and takes precedence for the implementation score;
- keeps the one-third minimum while its assessment is missing, incomplete,
  stale or unresolved. This is an unassessed state, not an assessed tier;
- keeps the same one-third minimum when Slopbot assesses the accepted merge at
  zero. The maintainer's merge is the acceptance; an assessment can size it
  but cannot erase it. A joint work unit assessed at zero also keeps one third;
- earns review credit only from assessed, non-duplicate review value. A useful
  approval or comment qualifies; a request for changes is not required.

Review credit is one explicit allocation per pull request. Qualifying reviews
exclude implementation actors, bots, reviews after merge or closure, and
duplicate findings. They are grouped by immutable reviewer node ID. Reviewers
are ordered by their first qualifying review's submission time, then review
node ID. The first five share the pull request's review pool, weighted by each
reviewer's highest assessed band (triage 1, standard 3, deep 9, specialist 24
thirds). The pool is the sum of those five highest bands, capped at the pull
request's own assessed size in thirds, and never less than one third. Each
useful review thus earns its band until the reviews would outweigh the work,
and a small review never earns a large fixed pool. Shares are integer thirds
by largest remainder; equal remainders go to the earlier reviewer, and the
shares always sum to the pool. Each credited
reviewer has one ledger record, sourced from that reviewer's highest-band
review. Their other reviews publish `already-awarded-reviewer`; later reviewers
publish `review-credit-reviewer-limit`; a zero rounded share publishes
`review-credit-zero-share`. A joint work unit whose accepted members span the
effective instant is not applied, so legacy work is never scored twice; its
new member keeps the one-third minimum.

Owner decision D2 (24 October 2026) sets the effective instant to
`2026-11-01T00:00:00.000Z` (`VALUE_SCORING_POLICY_EFFECTIVE_AT`) and selects
the capped pool above. When the hosted value feed does not answer (a transport
failure, a timeout, HTTP 408, 429 or 5xx), generation writes nothing and exits
with status 75. The release retries once, then keeps the last published
snapshot, and the site labels a snapshot older than eight hours as possibly
outdated (PRD section 9). The next scheduled release retries. There is no
fallback to the legacy producer, and an outage does not stop the rest of the
release. Any other feed failure, such as a redirect or an invalid or changed
page, stops the release. Accepted-source identity, the earliest-merge commit rule and
separate payment authority are unchanged. A score is never a payment approval.
