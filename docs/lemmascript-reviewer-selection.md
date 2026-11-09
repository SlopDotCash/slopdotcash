# Verified reviewer selection

Base: `fb661e2d19dc30b191c824140e4bac233a709949`. This implements the remaining
reviewer-grouping candidate for PRD section 7: credit the first five distinct
qualifying reviewers, using each reviewer's highest band once. It changes no
eligibility, scoring, pool, fee, or payment policy.

## Result

`allocatePullRequestReviewCredit` now calls the production implementation in
`src/lib/verified-reviewers.ts`. The kernel performs one linear scan of indexed
reviews. Its contract proves:

- Every encountered actor appears exactly once, in first-occurrence order.
- The selected source belongs to that actor and has the highest supplied band.
- Equal highest bands retain the first source in the ordered input.
- The credited count is exactly the smaller of the limit and actor count.
- The caller therefore selects the first five distinct qualifying actors,
  without allowing repeated reviews to create another credited actor.

The prior proof covered the maximum within one group and subsequent allocation
arithmetic. It did not cover the grouping or first-five selection itself.
This proof checks the actual new loop, not an independent executable model.

## Source and adapter contract

The kernel accepts an actor-slot count, a finite sequence of
`{ actor, thirds }` records, and a credit limit. Its explicit preconditions are:

- Actor-slot count is a nonnegative integer within the JavaScript array bound.
- Every actor ordinal is an integer in the actor-slot range.
- Bands are positive safe integers; the limit is a nonnegative safe integer.

The real caller establishes these facts using the existing band checks and an
immutable-actor-ID-to-dense-ordinal Map. JavaScript Map identity, Date parsing,
the sorting implementation, upstream eligibility, and review-ID authenticity
remain adapter obligations; the proof does not model them as trusted extern
functions. The kernel itself uses no Map, Set, sort, Date, or external call.

The adapter keeps the old validation order for each supplied review: reject a
duplicate review ID, then an invalid submission time, then an invalid band.
It parses each validated time once and sorts by numeric time followed by the
same review-ID comparison as before.

Sorting all records by that comparator preserves the earlier group behavior:
each actor's records have their original within-group order, and their first
records determine actor order. The old final actor-ID tie-break cannot be
reached: duplicate review IDs are refused, so different actors cannot have
equal first records under the time/review-ID comparator.

The chosen source is the same original review object, and the credited actor
object comes from that source. This preserves actor metadata when multiple
records have the same immutable actor ID. Repeated review IDs remain sorted
within each actor, excluding only the selected source object. Beyond-limit IDs
remain grouped by actor order, then by each actor's review order; they are not
flattened in global timestamp order.

Empty input still returns an empty allocation without validating a pool size
that is not used. Nonempty input still runs the existing pool and largest-
remainder allocation routines after selection. These routines and their
existing proof contracts remain unchanged.

## Proof evidence

The generated Dafny method and signatures are unchanged. Added proof material
contains checked assertion blocks and fully defined ghost predicates/functions
for actor presence and first-occurrence order. The ghost facts also prove
coverage and uniqueness of that order. There are no axioms, assumed externs,
admitted obligations, or verification-disable attributes.

```sh
lsc check --backend=dafny --time-limit=30 src/lib/verified-reviewers.ts
dafny verify --isolate-assertions --verification-time-limit 30 \
  --unicode-char:false --allow-deprecation \
  formal/lemmascript/src/lib/verified-reviewers.dfy
```

Default verification: **6 verified, 0 errors**. Isolated-assertion verification:
**164 verified, 0 errors**. These are different verifier counting modes, not
counts of application functions or runtime cases. There is one new runtime
function. Source-obligation and generated-body-integrity checks pass.

## Workflow and comparison evidence

Existing tests exercise the production allocation caller and snapshot paths:

```sh
bun test ./scripts/quint-review-pool.test.ts ./scripts/quint-money.test.ts \
  ./scripts/value-review-eligibility.test.ts \
  ./scripts/score-bearing-review.test.ts ./scripts/value-self-review.test.ts \
  ./scripts/joint-value-scoring.test.ts --timeout 30000
bun run typecheck
```

Result: **15 passed, 0 failed, 2,793 assertions**; typecheck passed. These
include first-review order, highest-band ties, five-reviewer limits, equal
allocation remainders, window continuity, self-review, bot/post-merge exclusion,
missing assessment refusal, mismatched heads, and evaluated-work deduplication.
The deterministic fixtures test source processing; they do not prove live
GitHub authenticity or model assessment quality.

An additional local comparison calls both the exact baseline allocation source
and the new production caller. It checks **1,018 cases** including reversed
inputs, tied times and bands, changed actor metadata, beyond-limit grouping,
invalid-input error classes/messages, empty input, and maximum-safe bands. All
outputs and refusals match, and inputs remain unchanged. Only baseline import
paths are redirected so both callers use identical unchanged dependencies.

The same comparison script measures the complete caller after two warmups,
using the median of seven timed runs per input shape. Parsing each timestamp
once avoids repeated Date parsing during sorting. Representative local results:

| Reviews / actors | Baseline median | New median |
| --- | ---: | ---: |
| 100 / 64 | 0.118 ms | 0.040 ms |
| 1,000 / 64 | 0.968 ms | 0.368 ms |
| 10,000 / 64 | 17.371 ms | 4.327 ms |
| 10,000 / 10,000 | 35.060 ms | 6.412 ms |

These are synthetic local measurements, not a production latency guarantee.
The sequence scan is linear after sorting; the complete caller retains its
sorting cost. No performance claim is made from test or line counts.

## Integration and limitations

Evidence is kept uncommitted under `evidence/reviewer-selection/`: the exact
baseline source, comparison script/results, proof and workflow logs, integrity
result, and a receipt containing the tested commit and file hashes. Toolchain:
Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6, Dafny 4.11.0.

The final integration should add the source to `LemmaScript-files.txt` and
refresh source/proof inventories after review. Those shared files are not part
of this prototype. Re-run current-head checks after upstream integration.

The proof is about supplied finite indexed records. It does not prove the
identity Map, the timestamp/review-ID sort, caller-side eligibility, external
GitHub state, source-to-Dafny translation, or all application state behavior.
Quint and the existing real workflow checks retain their separate roles.
