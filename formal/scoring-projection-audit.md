# Scoring and published projection review

This extends the frontend audit for the current development worktree. Models
are finite, hand-reviewed abstractions. They do not prove that the complete
8,083-line `leaderboard.ts` implementation refines the model.

| Source | Reviewed state/input contracts | Model or exclusion |
| --- | --- | --- |
| `src/lib/leaderboard.ts` | Version boundary selection; full outcome versus detailed/review-only hydration; work-item claim and candidate exclusions; actor/project/month/work-unit deduplication; shared merge credit; bans; legacy caps; evidence/attribution joins; review exclusions; source-count, actor, total and queue reconciliation; payment-basis deltas and omission markers | `ui_score_selection`, `ui_score_ledger`, `ui_snapshot_contract`; bounded models cover named contracts, not every scoring branch |
| `src/lib/leaderboard-types.ts` | Types, literal enum arrays and imported type aliases; no mutation, I/O, lifecycle or retained runtime state | Reviewed stateless schema declarations |
| `src/lib/review-records.ts` | v1 compatibility normalization; exact v2 fields; immutable artifact/head, run/provider/model/client/trace join; recommendation remains advisory | `ui_review_admission` |
| `src/lib/evaluator-awards.ts` | Registered source/project; reviewed bounded manifests; regular files; canonical source/work/reviewer/external-content deduplication; admission before ledger generation | `ui_review_admission`; filesystem and full text grammar are predicate abstractions |
| `src/lib/model-outcomes.ts` | Canonical aliases, source/artifact joins restricted to event actor, unknown model exclusion, shared model/client point attribution, unique signed runs, read-only usage statistics | `ui_model_outcomes`; actual string normalization and medians remain pure transformations |
| `src/lib/global-leaderboard.ts` | Closed project/month records replace overlapping rolling events; project reward start filters; closed scores are not changed by later debits; exact minor-unit paid/projected totals remain separate | `ui_history_projection`; monetary arithmetic belongs to financial models |
| `src/lib/reviewer-leaders.ts` | Substantive-review filter, actor grouping, exact thirds and competition ranks; no payout mutation | `ui_history_projection`; tie-order helper remains in `leaderboard.ts` |
| `src/lib/who-builds.ts` | Pinned historical snapshot and hash; ledger counts per repository, registry labels, denominator and stable order | `ui_history_projection`; historical JSON is input, not a state machine |
| `src/lib/profiles.ts` | Unique actors/repositories/events; complete census totals; observation time order; close/reopen replay; explicit incomplete history; unavailable and archived rows; canonical rename replacement | `ui_profile_history` |
| `src/lib/profile-activity.ts` | Pure UTC day buckets and summed Points; no retained state or side effects | Reviewed stateless aggregation |
| `src/lib/cycle-index.ts` | Exact fields; registered immutable cycle files, state and times; wallet proof provenance; actor uniqueness; money/line reconciliation; canonical order; complete fetch validation | `ui_cycle_publication` and resource/financial models |

## Confirmed correction

The original cycle index validator accepted `state: settlement-planned` with a
settlement file and `settledAt`. With the ordinary archived paid fixture changed
only to that state, the real Cycle page displayed both “Approved, payment ready”
and “Paid Aug 16, 2026”. Settlement evidence now requires the `paid` state.
The same browser path now shows the existing recoverable data error. The
before and after run each cover desktop and mobile; the existing historical
cycle sync workflow is also checked. This is a malformed-public-input refusal,
not a claim that an incorrect payment was sent.

## Explicit limits and pending refinement

- The source review includes the large snapshot generator and validator, but
  the finite models do not yet encode the complete legacy score cap schedule,
  material-test and evidence rules, every attribution grammar, joint claim
  carrier and retained-copy branch, arbitrary review-pool actor/window compositions, all
  semantic URL aliases, or all payment-basis delta fields. Their source links
  must not be interpreted as proof of those branches.
- Existing owner/financial models cover other review and payment rules; the
  current UI models use their verified evidence as input predicates. No live
  GitHub, private upload, wallet signer, or chain result is established here.
- The profile model covers the close/reopen/hidden-history transition, not
  every date-string, repository migration, or actor-schema combination.
- There is no automatic TypeScript refinement proof. Generated trace adapters
  execute 100 seeded traces each for `ui_model_outcomes` and `ui_profile_history`
  against the production functions (2 tests, 2,960 assertions). The other
  functions do not have generated replay adapters. Browser regressions establish
  the corrected observed flows; TLC establishes only the bounded models.


## Review-pool and retained Points conformance

`ui_review_pool` complements the earlier `review_credit` model. It explicitly
computes the first qualifying review per actor, timestamp/node-ID tie order,
highest-band source, five-actor cap, integer floors and remainder ordering.
An optional later review separates a repeated actor from an actor with only an
out-of-allocation-window review. The latter takes no slot. A current-window
advance preserves the selected sources and pool, while positive shares whose
source dates became old move to retained credit.

The finite domain is seven possible reviews, six actors, bands of one or three,
assessed sizes zero/one/three/nine, two timestamp-order variants, a present or
absent repeated review, and two current-window starts. Absolute dates in the
runtime test use complete 35-day windows with the same acceptance-anchored
allocation window. This is a bounded check, not proof of every weight, date,
URL, actor identity, policy migration, bot/ban rule or signed assessment.

`scripts/quint-review-pool.test.ts` generates 100 Quint traces, compares
`allocatePullRequestReviewCredit` with the model under three input orders,
then executes `createLeaderboardSnapshot` and `applyPointsSnapshot`. It checks
that current sources receive the modeled shares and previously recorded
out-of-window sources keep their positive Points. Existing qualification and
receipt tests remain responsible for upstream admission and signatures. No
production scoring change was justified by this comparison.


Pinned conformance completed 100 traces with 1,568 assertions. It also seeds an
older award for an actor now wholly outside the allocation window: that actor
takes no current slot and the previous positive Points remain. Model types,
six named scenarios and 500 seeded traces of 60 steps passed. Finite TLC
explored 16,513 distinct states without a counterexample; a source-stability
receipt is repeated after the global model set freezes.
