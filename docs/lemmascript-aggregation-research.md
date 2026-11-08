# Exact score and Points bucket aggregation

This follow-up starts at `b76807343`. It addresses the remaining score/Points
aggregation candidate with actual runtime code. It does not change a scoring
rule, penalty amount, source identity, reversal rule, or public number schema.

## Confirmed defect

The journal validator accepts each award as a safe integer. That does not make
a sum of those awards safe. `pointMembers` checked its positive earned total,
but then added signed penalty adjustments with no corresponding check.

An executable reproduction uses `emptyPointsJournal`, `appendPointAwards`,
`assertPointsJournal`, and `pointMembers`. One earned point and two retained
debit awards of `-Number.MAX_SAFE_INTEGER` form a journal with valid source
keys, revision hashes, decisions, and penalty evidence. Validation succeeds.
The previous projection returns `-18014398509481980`, although the exact sum is
`-18014398509481981`. Its output is not a safe integer.

This is a constructed input accepted by the retained journal schema. It is not
evidence that the ordinary capped-penalty workflow naturally creates these
amounts. The useful correction is that this accepted input cannot silently
produce an inexact public total. The corrected projection throws the existing
`Points total overflow` error. It preserves exact safe totals and the existing
positive-earned overflow refusal, before negative adjustments are applied.

## Selected implementation and alternatives

`src/lib/verified-aggregation.ts` provides two directly used algorithms:

1. `sumBuckets(count, entries)` sums signed BigInt entries into indexed buckets.
   Each entry contributes exactly once to its own bucket. There is no bound on
   the number of entries or monetary/score magnitude in the mathematical
   contract. Nonnegative entries yield nonnegative bucket totals.
2. `consumeBuckets(initial, requests)` processes nonnegative requests in input
   order. Each request consumes the smaller of its amount and its bucket's
   remaining balance. Each bucket stays nonnegative and obeys exact
   conservation: initial balance equals remaining balance plus its applied
   requests. The contract specifies the applied amount of every individual
   request, not merely an upper bound or final total.

The production adapter retains string identity and presentation behavior:

- `penaltyDeductions` retains its NUL-separated actor/project/UTC-month keys,
  its `projectOf` resolver, its original timestamp/penalty-ID comparator and
  its Map insertion order. The adapter assigns each distinct key one dense
  integer bucket. After consumption, the same proved sum groups applied debits
  by actor. Only positive deductions create public Map entries, as before.
- `reconcilePointPenalties` retains source matching, candidate discovery,
  retained reversal verification, timestamp/work-unit order and append-only
  revision behavior. Reversed candidates request zero. Payout-recognition
  awards remain excluded from the available balance. Only the existing
  calculation of bucket balances and applied debits changes.
- `pointMembers` retains source deduplication, latest-revision selection,
  actor metadata, first-contribution time, awards, badges, sorting and month
  matching. Its positive total/monthly sums and its later signed adjustment
  sums use the exact bucket implementation. Public totals remain numbers.

Alternatives considered:

- A checked scalar subtraction alone leaves unsafe bucket and actor sums.
  It does not prove ordered distribution across requests.
- Converting public score/Points schemas to BigInt would be a broad interface
  and policy change. This implementation uses BigInt only inside calculations.
- Saturating a sum would silently discard earned value or debit history. No
  cap is introduced; unsafe public output is refused.
- Replacing Maps with repeated linear searches would make large input sets
  quadratic. The adapter retains Map lookup; the proved arithmetic scans
  arrays once with indexed updates. It adds linear temporary storage.
- Native sort proof axioms and assumed external contracts are not used. The
  existing comparator remains a reviewed adapter boundary.

## Exact proof obligations

For `sumBuckets`, the caller provides a nonnegative integer bucket count and an
integer index in `[0, count)` for each entry. The returned array has that exact
length. Its element at index `b` equals the mathematical sum of all entries
whose index is `b`. Signed sums are unbounded integers. The nonnegative result
property is conditional on nonnegative input entries.

For `consumeBuckets`, initial balances and request amounts are nonnegative and
every request index names an initial bucket. The returned arrays retain the
initial/request lengths. Each applied amount is nonnegative, no greater than
the request, and exactly the minimum of that request and the balance left by
earlier requests for the same bucket. Summing all applied requests for any
bucket plus its remainder recovers its initial balance.

The generated runtime bodies are unchanged by handwritten proof additions.
Proof-only recursive definitions state bucket sums; proof-only assertions
unfold a prefix by one entry and establish conservation. The implementation
uses no assumptions, imports, native sorting, or opaque external methods.
The existing strict proof-integrity and source-obligation checks accept it.
Dafny 4.11.0 with isolated assertions verifies **155 obligations**, zero errors.
There are two new runtime functions; 155 is not an application-function count.

## Caller obligations and limits

- Dense ordinal assignment uses actual Map size and unique string keys. JavaScript
  Maps and arrays supply integral indexes within the array range. The theorem
  does not independently prove the string-to-index adapter or runtime Map.
- Existing snapshot/journal validation establishes score/award sign and integer
  domains. `eventThirds` legacy Number multiplication/rounding remains outside
  this proof. The new implementation does not claim to accept NaN, Infinity or
  invalid fractional values that violate those source schemas.
- The score adapter checks each public applied amount and actor sum before
  converting them to the existing safe Number output. Points checks its earned
  total before negative adjustments, and both final total and monthly amount
  afterward. No unsafe public value is justified by a mathematical proof.
- Actor/project/month encoding, repository resolution, exclusion policy,
  canonical review URLs, duplicate-source filtering, native comparator behavior,
  and immutable revision publication remain separately reviewed/tested code.
- This proof does not establish that a source deserves credit or a penalty.
  It preserves the already selected sources and decisions.

## Validation evidence

Local evidence is retained under ignored `evidence/aggregation/`:

- `points-overflow.ts`, `points-overflow-before.json`, and
  `points-overflow-after.json`: actual constructor/validator/projection
  reproduction. Before: unsafe inexact number. After: existing overflow error.
- `lsc-check.log`, `dafny-proof.log`, and `strict-integrity.json`: exact-source
  proof output and source/artifact hashes. The manifest/inventory is not changed
  by this isolated prototype; integration must register the module and rerun the
  complete gate.
- `caller-equivalence.ts`, `comparison-preload.ts`, and
  `caller-equivalence.json`: 1,000 seeded actor/project/month bucket cases and
  40 real snapshot workflows against the original `b76807343` implementation.
  Workflows run snapshot creation, project/global projections, Points import,
  retained reversal, member projection and replay. All 1,320 comparisons match.
  The same frozen registry is supplied to both implementations; the production
  calculations are not mocked. This is differential evidence, not a theorem
  covering every adapter input.
- `workflow-tests.log`: 16 tests and 140 assertions pass in the existing Points
  import, review-deduplication and summary suites, including the new accepted
  retained-journal regression. Existing import tests apply real migrations and
  read the Points API. They preserve different project/month scopes, payout
  recognition, immutable prefixes, capped batches and idempotent replay.
- `typecheck.log`: the repository typecheck passes.

Commands use Bun 1.3.14 and Node 24.15.0. No provider, live GitHub, on-chain,
signer or production database behavior was exercised by this prototype.

## Next candidate: first-five reviewer grouping

The current code proves the capped pool, first maximum and numerical allocation.
`allocatePullRequestReviewCredit` still groups reviews and selects the first
five actors using native Maps, source timestamps and sorting.

A concrete next algorithm can accept reviews in the current timestamp/review-ID
order, assign actor ordinals using the existing identity adapter, and scan once
with arrays for first source, highest source and group membership. Prefix
invariants should establish:

1. Every qualifying review belongs to exactly one actor group.
2. The group's first review is its earliest ordered source.
3. The group's selected source has the highest band; equal bands retain the
   earliest source, preserving current tie behavior.
4. Only the first five distinct groups receive credit; every remaining review
   appears in the beyond-limit output exactly once.
5. Repeated review IDs still fail before grouping; self/bot/post-merge eligibility
   remains the upstream caller's responsibility.

This should be an executed grouping implementation, not a detached shadow
model. The timestamp parser and identity/order adapter need corresponding
workflow comparisons and source obligations. Proving this grouping is still
outstanding; this aggregation prototype does not mark it complete.
