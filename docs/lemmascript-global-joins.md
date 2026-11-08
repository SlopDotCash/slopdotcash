# Global leaderboard and archived payout joins

Research and implementation snapshot: 8 November 2026. Base:
`6c6ff9df203ec449062eb6e7885f65cc0818c5bf`. This closes the selected collection
portion of the original frontend global-leader/archive-source candidate. It does
not prove all leaderboard arithmetic, all profile behavior, or settlement truth.

## Production scope

`src/lib/global-leaderboard.ts` previously performed actor grouping, actor-source
replacement, archive exclusion and distinct project/month membership through
native Map/Set loops. `src/lib/payout-points.ts` selected paid recipients through
nested loops after validating the complete cycle index. The previously proved
score and allocation kernels did not cover these joins.

The new `src/lib/verified-global-joins.ts` contains three production algorithms
and two private array-initialization helpers. The wrappers call these bodies:

| Caller | Proved operation |
| --- | --- |
| `createGlobalLeaders` | Complete ordered actor links, actor metadata source and distinct membership counts |
| `openMonthScores` | Original-order anti-join of score events and penalties against closed project/month keys |
| `payoutPointAwards` | Original-order recipient selection from actual cycle and contributor states |

`ProfilePage.tsx` consumes both global functions. `scripts/generate-points.ts`
consumes the payout selector before appending permanent Points history. No UI,
score policy, money policy, payout authority or persistence transition changes.

## Exact grouping contract

The adapter visits closed contributors, open events, deductions and current
project-view leaders in the same order as before. One native actor-ID Map assigns
ordinals in first insertion order. The kernel returns the first row and next row
for each actor. Every next row is either absent or a strictly later in-range row;
the exact first/next definitions select the first matching occurrence, so following
the links includes every row for that actor once and retains its original order.
Negative actor ordinals are ignored. This preserves the original behavior for a
deduction whose actor has not yet appeared, even if a view later creates the actor.

The kernel consumes actual `cycle`, `event`, `deduction` and `view` source kinds.
The first non-deduction supplies metadata. A later cycle does not replace it;
every later event or view does. The returned source index points to that original
row, and the wrapper returns its original actor object. Current-snapshot actor
lookup for archived rows remains in the wrapper, including native Map
last-duplicate behavior and the existing archived-actor fallback construction.

Project and cycle membership use separate dense identity tables. Each table is
nested by actor and then the original project ID or exact project/NUL/month key.
Thus a membership ordinal cannot belong to two actors. The kernel counts only the
first occurrence of each nonnegative membership ordinal. A separate set-based
specification proves the returned count equals the cardinality of all that
actor's distinct membership keys, not only a bound on the count. Excluded archived
rows contribute membership under exactly the original score/state condition;
events always contribute membership; deductions and views do not.

The arithmetic remains in the wrapper. Its linked traversal retains each actor's
original sequence of `+=` and `-=` operations, including the separation of cycle,
event, deduction and view operations. It does not replace this with an algebraic
sum or reorder IEEE Number additions. BigInt paid/projected amounts remain
BigInt. The original output filter and native score/actor sort remain unchanged.

## Archive and paid-source contracts

The archive adapter assigns ordinals to the same exact project/NUL/month strings
as the prior Set. Registry resolution and native `Date.parse` comparisons remain
outside the proof; `afterStart` is precisely their boolean result. The kernel
returns every index with `afterStart` and an unmarked archive scope, in input
order. Events and penalties are selected separately before the existing
`penaltyDeductions` call, so a later penalty cannot change a frozen closed cycle.
The wrapper returns original source objects without cloning them.

The payout kernel consumes actual cycle kind, cycle state, settled timestamp,
settlement artifact path, contributor state and BigInt paid amount. Its complete
predicate selects exactly monthly-pool, paid cycles with a nonempty settled time
and settlement path, paid contributors and a positive amount. The full index
validator still runs first. On this validated domain, nonempty artifact paths
correspond exactly to the original truthy settlement reference; absent optional
strings normalize to the empty string. The wrapper retains the original lazy
BigInt conversion condition. Selected rows retain their original cycle and
contributor references, order, source ID, key, timestamp, source URL and 25-point
award. The kernel makes no claim that a cycle's public evidence actually proves
a payment: that authority remains with the existing cycle/settlement path.

## Proof and caller boundary

The pinned toolchain is Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny
4.11.0. All five runtime functions are compiled and checked together; there are
no imported axioms, opaque obligations, admitted lemmas or hand-written changes
to generated executable bodies. The companion adds defined recursive/set specs,
proved lemmas and proof-only assertion blocks.

Strict verification passes **508 obligations, zero errors**:

```text
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions src/lib/verified-global-joins.ts
```

The source/proof integrity gate also passes. The native wrappers establish all
index/range premises through actual array lengths and Map-assigned integer
ordinals. Every actor ordinal is created only by a non-deduction row, supplying a
valid metadata source. Membership ordinals are unique across actors by the
nested adapter construction. These native identity mappings are reviewed and
compared against baseline; they are not themselves a separately compiled Map
refinement theorem.

There is no arbitrary safe-integer precondition on scores and no new overflow
refusal. Number score/token arithmetic, registry lookup, Date parsing, native
sort, schema validation, actor fallback URL encoding and final JSON field
construction remain outside the proof. The index arithmetic uses actual bounded
JavaScript arrays and integer Map sizes; no untrusted numeric index is admitted.
The proof does not establish exact mathematical Number sums or absence of all
application errors.

The equivalence boundary is stable plain records from validated snapshots,
cycle indices and typed project views. As with the other collection adapters,
projecting input rows eagerly can change getters/proxies and malformed-object
exception order. In particular, archive scope projection calls `occurredAt.slice`
even when the Date comparison is false; a valid timestamp is already a string.
No new coercion guard or policy restriction was added to claim equivalence for
arbitrary JavaScript objects outside that production domain.

## Validation

All captured scripts, logs and receipts are ignored under
`evidence/global-joins/`; none are committed.

- **2,435 actual old/new wrapper comparisons:** 2,423 matching successes and 12
  matching refusals, including exact error names/messages. The corpus covers
  interleaved actors/projects/months, duplicate membership, first-cycle versus
  last-event/view metadata, current actor lookup, unknown repository refusals,
  missing/invalid projections and large IEEE magnitudes without claiming exact
  arithmetic. It includes **8,994 original actor-reference checks**.
- Five real scoring/project/archive workflows run the actual snapshot builder,
  project-view builder and global functions. A validated later closed ASI month
  excludes the earlier score events and penalties from the open-month result.
- Four hundred schema-valid payout cases pass through `assertCycleIndex`, the
  actual payout wrapper, permanent journal append, replay and member totals;
  they include 1,976 selected recipients. Additional validated review,
  payment-ready, settlement-planned, wound-up, closed-no-awards and external
  cycles correctly emit no payout awards.
- **21 existing workflow tests, 147 assertions** pass across Points import and
  summary, cycle review exclusions, retained historical registry behavior,
  leaderboard locale behavior and profile repository transfers.
- Independent peer review passes **600 wrapper comparisons and 4,603 object
  identity assertions**, with no substantive issue. It confirms the concrete
  Map adapters, metadata precedence, arithmetic ordering, archive selection and
  full paid-cycle predicate.
- Application typecheck and scoped Biome pass. New proof imports use explicit
  `.ts` extensions. Native Node 24 directly imports and executes the new module.
- The actual Node `prepare-publication.mjs` entrypoint passes in an isolated
  fixture checkout, including Bun Points generation through this payout wrapper:
  830 contributors, 29,931 historical revisions and 16 published Points shards.
  The frozen fixture ledger/registry are explicit test inputs, not live data.

The real browser profile lane remains part of the parent integration's frozen
head validation. These local results are not a claim of browser, hosted CI,
deployment, provider or settlement acceptance.

## Cost and alternatives

A direct per-actor rescan would make grouping quadratic. A mutable native Map
inside the proof would require an unsupported Map refinement or an assumed
contract. The selected plan computes links and membership counts in one indexed
scan, then visits every retained row once for the original arithmetic. It adds
intermediate row/index arrays, membership maps and link/flag arrays compared with
the original loop. That allocation cost is explicit, not a speedup claim.

A bounded benchmark measures the complete `createGlobalLeaders` caller with 64
actors, 15 interleaved warmups and nine alternating rounds. Median milliseconds
per call were:

| Open event rows | Before | After | Observed before range | Observed after range |
| --- | ---: | ---: | ---: | ---: |
| 100 | 0.252 | 0.187 | 0.147–1.994 | 0.160–0.997 |
| 1,000 | 2.753 | 2.761 | 0.815–6.195 | 1.709–5.111 |
| 10,000 | 18.290 | 19.280 | 7.397–30.591 | 12.855–33.408 |

Other proof/workflow processes were active and GC variability is large. This run
shows roughly 0.99 ms additional median cost at 10,000 events (about 5.4%), with
no evidence here of a persistent material regression. It does not establish a
speedup, an application latency bound or performance on larger retained inputs.
