# Monthly allocation replacement and validation

This isolated follow-up starts at
`1aee851fa6522e7817d41d5213343d82abcf59c4`, after the complete frozen-award
transformation. It addresses the remaining `currentAllocations` and
`assertAllocationChange` candidate from the frontend research. PRD section 6
permits private owner changes before the monthly freeze and requires those
allocations to stay within the month's amount. No policy or state transition
is changed. No new runtime defect is claimed.

## Selected implementation

`src/lib/verified-monthly-replacement.ts` contains two directly consumed
functions, with no imported proof contracts:

- `replaceMonthlyAllocations` applies an ordered sequence of indexed gross
  replacements to complete allocation records. It returns the first unknown
  recipient's change position, or success.
- `monthlyChangePolicy` gives the exact self-change and positive-exclusion
  refusal decision. Its contracts cover all three results with equivalences.

`MonthlyBaseRow` and `MonthlyAllocation` moved into that module. The original
public module re-exports those types, so callers keep their existing imports.
The types have the same fields and introduce no runtime representation change.

### Current allocations

The caller uses one native ID-to-index Map and an ordered base array. A new ID
gets the next index. A duplicate replaces the complete row at its original
index. Therefore the last duplicate's login, source and proposed amount win,
while the first insertion determines its pre-sort position, just as before.
Rows are cloned from the input before replacement.

The native ascending sequence comparator is unchanged. Equal sequence values
keep their native stable order. The caller converts each sorted ID to its
known index or `-1`, then invokes the proved replacement scan. An unknown
recipient produces the same Error and message. The final recipient
`localeCompare` sort is unchanged.

The proof replaces neither native sorting nor native Map semantics. It proves
what the actual production scan does with the supplied indices and order.
The implementation performs a linear base pass and linear indexed update
pass around the existing sorts. It does not search all recipients for each
change or introduce a quadratic replacement loop.

### Validation and cap composition

The validation caller keeps this order:

1. Validate recipient and amount syntax; otherwise return the same whole-unit
   error.
2. Parse the requested amount, then apply the proved policy decision. Self
   change precedes exclusion. The native exclusion lookup is still skipped
   for a self change or zero amount.
3. Collect all matching recipient indices. No match produces the same
   missing-allocation error before any existing row or cap is parsed.
4. Apply the same proved replacement scan to form the prospective records.
   All matching rows are changed, preserving the previous direct-call
   behavior even if a supplied array contains duplicate recipients.
5. Parse the prospective gross strings, sum with the existing proved
   `sumAmounts`, and perform the existing strict greater-than cap check with
   its original message.

This consumes the complete replacement result; there is no unused shadow
model. A target row's old malformed gross string remains overwritten before
parsing, as in the old conditional map. An unrelated malformed row still
fails before the cap parse. Zero remains valid, excluded recipients may be
set to zero, and equal-to-cap totals remain permitted. No amount or collection
cap is added.

## What the proof establishes

For every supplied record sequence and ordered change sequence in its index
domain, `replaceMonthlyAllocations` proves:

- The number and positions of records are unchanged.
- Every record retains its exact recipient ID, login, source digest and
  original proposed gross string.
- Every gross string equals the final write to its index in the processed
  prefix, or its original gross string if that prefix has no matching write.
  The terminating `LatestGross` definition selects the last such write.
- Success occurs if and only if every change index is known.
- Failure identifies the first unknown change. All earlier changes are
  known, and the returned records contain exactly that earlier prefix's
  replacements. The caller then throws, so partial records do not escape.

The JavaScript implementation clones the array and uses object spread for
each changed row. It does not mutate an input array or its record objects.
Spread also retains any extra plain-record properties present in a direct
call; the theorem names the five declared allocation fields.

The policy function proves the full decision partition: result 1 exactly for
self change; result 2 exactly for a different actor's positive excluded
allocation; result 0 exactly for the remaining cases. It has no input
precondition.

The full new module passes **85 isolated Dafny obligations, 0 errors**. Its
only replacement precondition is that every change index is `-1` or a valid
row position. `currentAllocations` establishes this with Map lookup and the
unknown sentinel; validation establishes it by enumerating the actual array.
Index zero remains valid (`?? -1`, not a truthiness fallback). Indices are
exact integers supplied by native array enumeration. There is no arbitrary
safe-amount bound: gross values are copied as strings, and the later total
uses exact BigInt.

Strings use the pinned JavaScript UTF-16 model. The kernel does not normalize,
truncate or interpret them. Generated executable bodies remain unchanged in
the proof file; additions are proved definitions and `assert ... by` blocks.
Strict integrity and function-obligation checks pass. There are no axioms,
assumptions or bodyless declarations.

## Explicit boundaries

The theorem does not establish that a native Map supplied the correct ID
index, that the native sort implemented the intended chronology, or that
the registry/database returned complete or authorized records. Those
adapter operations are reviewed and compared against the original caller.
Database uniqueness does hold for ordinary stored base rows, but the adapter
also preserves the original duplicate-input semantics rather than adding a
new rejection.

The full wrapper, native `BigInt` parsing, cap comparison and native Set
lookup are not a single formally compiled validation theorem. The proved
replacement result and already proved exact sum are composed by that
reviewed wrapper; actual error order and amount behavior are supported by
caller-level comparison and workflow evidence. This distinction is retained
rather than claiming that a source mapping proves the whole wrapper.

Inputs from the production callers are plain JSON/D1 records. Observable
getters, Proxies or concurrent mutation of input objects are not included in
the refinement claim. The batch conversion of ordered changes reads their
gross fields before the replacement scan, while the prior Map loop read
them when applying each known change. That distinction has no effect on the
plain records supplied by the actual callers.

These proofs do not establish authority, deadline or concurrency correctness,
funding, one-time freeze insertion, attestation, wallet ownership or chain
finality. The prior freeze theorem and its limits remain separate.

## Actual caller evidence

Pinned tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
The isolated worktree uses existing dependency/tool directories read-only.

The unchanged monthly workflow suite passed on the frozen baseline and new
source: **62 tests, 502 assertions, 0 failures** each. It uses actual SQLite
migrations and production owner, coordinator, freeze, funding and attestation
code. Controlled authority/chain observations are not live GitHub or mainnet
acceptance. The suite covers cap and self-change refusal, private change
serialization, cutoff races, excluded recipients, exact large-asset values,
single freeze, frozen metadata, legacy fees and forged snapshots.

Deterministic original/new public-caller comparisons passed:

- **1,600** full replacement outcomes, including 198 unknown-recipient
  refusals, duplicate base IDs, repeated changes and equal-sequence ties;
- **7,970** validation outcomes, including invalid amounts and rows,
  self/exclusion/missing-recipient precedence, lazy exclusion lookup,
  duplicate matching rows and cap equality/refusal;
- **2,804** exact frozen snapshot, JSON text and SHA results after the
  replacement path.

The comparison also checks that input arrays and records remain unchanged,
and that extra plain-record properties survive. `tsc -b` and the focused
formatter/linter checks pass. No new implementation-mirroring unit tests were
added. Scripts, logs and receipts remain ignored under
`evidence/monthly-replacement/`.

## Bounded cost check

An initial two-Map adapter had redundant work and was replaced by the one-Map
adapter above. The final bounded run uses five warmups and 20 alternating
before/after pairs per size on an Apple M4 Max with Bun 1.3.14. It compares
the actual callers with one change per input row; equal-sequence ties remain
present and complete outcomes are compared outside the timed span.

| Rows | `currentAllocations` median before → after | `assertAllocationChange` median before → after |
| --- | --- | --- |
| 100 | 0.030 → 0.032 ms | 0.020 → 0.048 ms |
| 1,000 | 0.139 → 0.148 ms | 0.041 → 0.065 ms |
| 10,000 | 1.200 → 1.290 ms | 0.314 → 0.430 ms |

These are measured costs, not a speedup claim. Current-allocation medians
rose about 5–8%; validation creates and consumes a prospective record array
and rose by 0.024–0.116 ms in these samples. Shared-host and unmeasured garbage
collection pauses affect tails: at 10,000 rows, current-allocation p90 was
40.36 → 35.81 ms, while validation p90 was 7.80 → 15.32 ms. No stable tail
latency guarantee follows from this bounded run. No further tuning or new
limits were introduced to hide the proof-integration allocation cost.
