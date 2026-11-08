# Review batching and JSON string sizing

This cohort starts from `11e8cf06992c594f8f847e936fed17950a11fb2a` and serves
PRD section 8's complete repository review. It adds no repository-size limit,
model policy, provider, or permission. The actual `planReview` path consumes
all three new functions in `workers/vetting/verified-review-batches.ts`.

## Exact production connection

The existing single-call decision, UTF-8 inventory parsing, large-item
splitting, SHA-based first-copy selection, risk-tier ordering, final JSON
serialization and synthesis remain in their current callers. After that
ordering, the new complete grouping algorithm returns contiguous spans and a
group index for every item. The caller builds its actual batches from those
spans and binds any aliases outside a batch to that item's returned group.
There is no separate unused reference implementation in the product.

`fittedAliasCount` scans the actual alias strings in order. It returns the
largest fitting prefix using the existing measured base envelope, including
one comma between aliases. It stops at the first nonfitting alias. It does
not serialize every later alias or create a complete array of their costs.
`jsonStringBytes` supplies the exact quoted-string UTF-8 cost: quotes,
backslashes, short and Unicode control escapes, ASCII, two/three-byte
characters, four-byte surrogate pairs and escaped lone surrogates. This is
ordinary runtime code used by the prefix scan.

`layoutReviewBatches` retains the original greedy conditions. A source with
aliases that cannot all fit gets its own batch. Other sources stay in the
current batch until another source would cross the byte estimate or item
count, then start the next batch. The source ordering is unchanged.

## Proved contracts

The pinned Dafny run proves 229 isolated obligations with zero errors across
three runtime functions. The generated executable declarations and bodies
are unchanged. Added definitions and proof blocks establish:

- The JSON string counter equals the defined UTF-16-to-quoted-UTF-8 cost and
  lies between 2 and `6 * text.length + 2`.
- Every admitted alias prefix fits its measured envelope; the next prefix,
  if present, exceeds the limit. This includes an already oversized base.
- Group spans are positive, contiguous, nonoverlapping and cover every
  ordered source once. Every group has at most the requested item count.
- Every source maps to exactly the group containing it. Overflow aliases
  force a singleton. Multi-item groups contain no such forced source and
  stay within the byte estimate.
- A group boundary occurs only because an adjacent source requires its own
  batch, the previous group reached the item count, or adding the next source
  would exceed the byte estimate. No source is sampled or dropped.

The group contract deliberately permits a singleton whose *estimate* exceeds
its limit. This preserves the existing plan: the earlier exact one-item
serialization check splits anything that actually exceeds the limit, while
`ITEM_OVERHEAD_BYTES` and `BATCH_OVERHEAD_BYTES` are conservative estimates.
Changing this into a new refusal would reject some valid inputs. The proof
does not silently assume that every conservative estimate fits.

## Explicit boundaries

The theorem is over the actual supplied integer counts and byte estimates.
The production limit is at most 1 MiB and the item limit is 1,024. Native
string/buffer lengths and each bounded running total stay in the exact
JavaScript integer range. The abstract number theorem does not establish
NaN, Infinity or arbitrary IEEE rounding behavior.

The JSON cost definition describes string encoding, not every JavaScript
`JSON.stringify` feature. Inputs here are primitive strings from the
constructed inventory, not objects with `toJSON`, getters or proxies. Native
object serialization and the measured base envelope remain reviewed runtime
boundaries. The full final serialized batch size is checked by the existing
real workflow tests; this is not a compiled theorem about the whole native
serializer or the SHA implementation.

Native identity maps, risk classification/sort, large-item UTF-8 splitting,
source acquisition, provider tokenization, model review quality, cache and
publication remain separate contracts. The code preserves them; this cohort
does not call them proved merely because they feed the grouping algorithm.
No claim of complete scan-service correctness or production provider
availability follows from these pure proofs.

## Evidence and cost

Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
Proofs use JavaScript UTF-16 strings and the local Dafny library profile.
The source/proof integrity checks reject assumed or bodyless functions,
changed executable code, changed generated headers and disabled verification.

The existing review workflow suite passes 15 tests and 1,388 assertions with
zero failures. It covers full oversized repositories, alias spillover, real
serialized batch sizes, retry/cache behavior and incomplete calls. Provider
responses are controlled; no live model-quality claim is made. Type checking
passes. Differential evidence includes:

- all 65,536 single UTF-16 code units and all 1,048,576 surrogate pairs against
  `Buffer.byteLength(JSON.stringify(text))`;
- 2,000 fitting-prefix decisions and 2,000 complete ordered layouts;
- 350 complete original/new `planReview` outputs, including exact JSON,
  digests, risk order, duplicate copies, large items and long spilled aliases.

Three warmups and ten alternating pairs per fixture measured the complete
public caller. Median milliseconds on this host were:

| Fixture | Before | After |
| --- | ---: | ---: |
| 100 distinct items | 0.207 | 0.231 |
| 3,000 distinct items | 4.646 | 5.535 |
| 3,000 identical items | 4.038 | 2.934 |
| 3,000 identical items with long path aliases | 99.343 | 69.598 |

The extra prepared entries and group-index array cost memory and time for
distinct items. The allocation-free string counter helps alias-heavy cases.
These are bounded host measurements, not a general speedup or production
latency claim. Raw comparisons, logs and timings remain ignored under
`evidence/review-batches/`.

Reproduce with the pinned tools:

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/vetting/verified-review-batches.ts
bun test --timeout 30000 workers/vetting/review-plan.test.ts
bun run typecheck
```
