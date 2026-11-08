# Solana expiry history traversal decision

This cohort extends the existing retained-history agreement proof. PRD
section 8 and the 26 October 2026 decision for issue #905 require two
independent finalized histories before an expired native reservation can
be released. The production path is `proveSolanaExpiry` in
`workers/fee-converter/solana-expiry.ts`. This change adds no release rule,
provider, signing permission or new validation policy.

## Executable contract

`verified-expiry.ts` now contains two additional runtime functions:

| Function | Proved result |
| --- | --- |
| `containsExpirySignature` | True exactly when the supplied signature array contains the transaction ID. |
| `expiryTraversalStep` | The complete refusal, completion or next-cursor decision for one schema-checked history block. |

Refusal is equivalent to one of the existing conditions: the observed hash
differs from the expected hash; the cursor precedes the signed anchor; the
transaction appears in the signatures; the anchor has the wrong blockhash;
or a non-anchor parent is not strictly earlier and at least the anchor slot.
An accepted anchor completes the scan. An accepted non-anchor block yields
its exact parent slot and previous hash. The new cursor is bounded below by
the anchor and strictly below the current cursor. Every accepted step excludes
the transaction from the complete supplied signature list.

The real asynchronous loop consumes this decision. It still checks the block
schema first, appends the same evidence, hashes the same bytes, increments the
same counters, limits each page to 32 blocks, persists its existing revision,
and resumes from the same stored cursor. Completion leaves the existing cursor
and expected hash in place. The final comparison of both retained histories
continues to use `matchingExpiryCoverage`.

The proof covers the complete pure step, not the asynchronous traversal as a
whole. It does not establish that a provider returned all signatures, that
a blockhash is authentic, or that the two endpoints are independent. Hashing,
RPC responses, retained-store compare-and-swap and native JSON remain external
boundaries. The new functions use actual supplied fields and signatures,
not a Boolean claiming that the history is valid.

## Input and implementation boundaries

The anchor and first horizon come from the existing safe-slot checks. Each
block's parent slot and signature array pass `completeBlock`. On resumption,
`nextSlot` comes from the prior producer's retained `ExpiryCoverage` record.
The store interface and current JSON readers preserve that typed-record
invariant; they do not revalidate every cursor field or prove database
integrity. Arbitrary forged retained objects are outside the mathematical
integer input domain. No new guard was added to change existing behavior.

The functions compare integers and strings without arithmetic that could
overflow. The caller's counters, native hash and JSON encoding, and resource
limits are not proved by this step. Typed plain records are assumed; accessor
side effects, concurrent mutation and malformed JavaScript objects are not
part of the equivalence claim.

The generated implementation and headers are unchanged by proof editing.
There are no added axioms, assumptions, bodyless functions, externs or filtered
verification obligations. The existing module now has three selected
functions and passes **123 isolated Dafny obligations**, with zero errors or
warnings, using LemmaScript 0.6.6 and Dafny 4.11.0. The prior agreement function
is verified together with the new membership and step implementations.

## Validation and cost

- 3,175 direct step cases cover hash, anchor, signature and parent boundaries.
- 349 comparisons execute the actual old and new `proveSolanaExpiry` functions.
  They compare complete results, ordered RPC calls, stored page bytes and
  resumed revisions. Inputs include 1–70 blocks, 32-block page boundaries,
  both provider positions, missing or malformed blocks, transaction presence,
  chain discontinuities and invalid initial observations.
- The existing migrated SQLite/native-gas workflow suite passes 30 tests and
  138 assertions, including atomic retained expiry and zero-cost resolution.
- Type checking, scoped formatting/lint and the source/proof integrity gate
  pass. A separate read-only review found no behavior difference in the
  schema gate, error order, cursor updates or evidence persistence.

The runtime adds a small decision record for each accepted or refused step
and replaces native array membership with a checked linear scan. RPC count,
page size, signature-scan complexity and stored evidence are unchanged.
Alternating in-process and separate-process measurements of complete
70-block traversals showed substantial host/GC variance in both directions;
they do not support a latency improvement or stable regression estimate.
All samples are retained, including unfavorable ones. The justification is
the exact refusal and cursor proof, not a performance claim.

Run the focused checks with the pinned tools:

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/fee-converter/verified-expiry.ts
bun test --timeout 30000 workers/fee-converter/native-gas.test.ts
bun run typecheck
```

Ignored `evidence/expiry-traversal/` holds the exact baseline, differential
driver, all measurements, proof output and workflow logs. These local checks
do not establish merge, deployment, live provider availability or mainnet
settlement.
