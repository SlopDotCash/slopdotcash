# Monthly allocation and frozen award research

This follow-up starts from `cc54e73b9d44e4b607ffa2c16a9695157b5706f1`
in the isolated `codex/lemmascript-monthly-awards` branch. It addresses the
monthly allocation candidate in the original frontend report. It does not
change payment policy, the owner interface, storage or state transitions.

## Requirement and selected scope

PRD section 6 requires the current monthly allocations to freeze once, within
the monthly amount, before they become payment obligations. The recorded
legacy-fee rule also preserves the exact terms of an already frozen month.
The current repository no longer contains `docs/slop-mvp-plan.md`; the
canonical current PRD and contribution rules were read.

The relevant production path is:

1. `backend/payments/monthly.ts:loadBase` loads the proposal and refuses a
   partial row set. `loadChanges` loads its private change history.
2. `currentAllocations` keeps the last base row for each recipient, applies
   changes in stable ascending sequence order, and returns recipient-sorted
   rows. `assertAllocationChange` rejects malformed amounts, self changes,
   excluded positive allocations, absent recipients and an excessive total,
   in that order.
3. `freezeMonthlyPeriod` calls `buildExecutionSnapshot`, then stores the exact
   text and digest using the existing conditional insert.
4. `backend/payments/monthly-attestation.ts:prepareMonthlyAttestation`
   validates each frozen award, reconstructs the snapshot and requires exact
   text equality. It accepts the historical floor-fee reconstruction as well
   as the current ceiling-fee reconstruction.
5. The coordinator creates obligations only after the existing funding and
   eligibility checks; the snapshot remains immutable.

The previous proved helpers covered the exact numeric sum and individual
fee. They did not prove that the complete output contains exactly the
nonzero input records in their original order, with their original recipient
and source strings. The selected kernel proves this whole transformation.
This is a formal assurance improvement; no additional runtime defect was
found or claimed.

## Production implementation and theorem

`src/lib/verified-money.ts:freezeMonthlyAmounts` now takes parsed amount rows
and returns the complete frozen award rows and their exact total. It is
called directly by `buildExecutionSnapshot`.

The kernel is in the existing money module so it calls the existing
`ordinaryFeeAmount` body in the same generated proof. An initial separate
module caused LemmaScript to emit an imported `{:axiom}` declaration. That
approach was discarded; the final proof has no imported axiom and does not
duplicate the ordinary-fee formula.

For every finite input sequence, with **no input precondition**, the theorem
proves:

- Output equality with the recursively specified ordered nonzero-row
  transformation. This copies each emitted row's exact `githubUserId`,
  `login`, `sourceDigest` and gross amount. It neither merges equal recipients
  nor changes their order.
- The output length equals the exact number of nonzero input rows. Each
  nonzero row appears once; zero rows produce no award.
- The current branch uses the existing ceiling ordinary fee. The historical
  branch uses JavaScript BigInt division by 50, including its signed
  truncation semantics.
- Each award conserves its gross amount as fee plus net. For positive gross
  amounts, fee and net are nonnegative and fee does not exceed gross.
- The output gross total equals the sum of every input gross amount and the
  aggregate output net plus fee.

The proof keeps signed behavior because the old exported snapshot function
also computes on directly supplied signed BigInt-compatible strings. The
production schema supplies nonnegative amounts; preserving the broader
helper behavior avoids silently narrowing its prior accepted values.

`FrozenRows` specifies the complete records, rather than merely their sums.
`RowTotal`, `AwardTotal`, `AwardNetTotal`, `AwardFeeTotal` and `NonzeroRows`
are terminating recursive definitions. The generated runtime body is
unchanged in the proof file; proof additions inside it are `assert ... by`
blocks. The module's existing mathematical fee proofs remain intact.

## Caller and representation boundaries

`buildExecutionSnapshot` still controls the exact public JSON property order,
outer metadata, cap refusal message and SHA-256 calculation. It converts each
gross string using native `BigInt`, calls the proved kernel, and converts the
three output integers using native decimal `toString`. This preserves its
previous canonicalization, including leading-zero inputs accepted by some
retained database rows.

The actual nonnegative production domain comes from the decimal-only D1
constraints for proposal/change rows in migrations 0062 and 0081. The
attestation reconstruction additionally calls `isBaseUnits`, rejects zero,
enforces the chain range and duplicate-recipient/source checks before calling
the builder. The proof itself needs none of these amount restrictions.

String fields use the repository's pinned `javascript-utf16` model. The
kernel only copies and compares complete record values; it does not decode,
sort, truncate or normalize strings. JavaScript array indexes are exact
integers bounded by native array lengths. No floating-point amount arithmetic
or Number conversion is added.

The adapter operates on the plain records returned by JSON/D1 or created by
the attestation map. Its initial parse map reads metadata before `BigInt`
conversion, unlike the prior per-row loop. Native getters/proxies with
observable side effects are not supplied by these callers and are not part
of this refinement claim. On plain input records, the first invalid numeric
string and error type/message are preserved.

The theorem does **not** prove JSON serialization, SHA-256 collision
resistance, database integrity, complete registry reads, owner authority,
the conditional freeze insert, funding availability, attester behavior,
wallet control, chain finality or network availability. Those remain the
existing caller and Quint boundaries. Outer snapshot metadata is preserved
by unchanged production construction and differential workflow evidence;
it is not part of the numeric-record kernel theorem.

## Remaining replacement scope

`currentAllocations` and `assertAllocationChange` are unchanged. Their
native Map identity, stable sequence sort, recipient locale sort, duplicate
base-row handling, self-change rule and exclusion rule were reviewed and
exercised, but this new theorem does not prove them. A subsequent full
replacement proof must preserve the last base row's metadata, the last
stable-ordered change for its recipient, all untouched rows, unknown-recipient
error precedence and the same sorted output. Replacing that Map with a naive
quadratic scan would not be a justified improvement.

This follow-up therefore closes the **complete emitted frozen award
transformation**, not the entire monthly allocation family or its storage
state machine.

## Validation and reproducibility

Tools: Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0. Dependencies
and Dafny are read-only symlinks to the existing pinned installations; no
install or shared checkout edit was made.

Commands run from the isolated worktree:

```sh
lsc check --backend=dafny --time-limit=30 \
  --extra-flags=--isolate-assertions src/lib/verified-money.ts
bun test ./backend/payments/monthly.test.ts
bun run typecheck
```

The complete money module passed **256 strict Dafny obligations, 0 errors**.
`requireProofIntegrity` and `requireProofObligations` passed, including all
eight runtime functions in this module. There are no unchecked generated
runtime-body edits, axioms, assumptions or bodyless declarations.

The existing monthly workflow suite passed on both the frozen baseline and
the changed source: **62 tests, 502 assertions, 0 failures** each. These are
real SQLite migrations, stored proposal/change/snapshot/obligation rows and
the production owner/coordinator/attestation callers. They cover owner
adjustments and self refusal, cap limits, exclusions before/after funding,
single freeze, 18-decimal values, funding refusal, exact snapshot recovery,
legacy fee compatibility and forged frozen payloads. Their GitHub authority
and chain observations are controlled test inputs, not live authority or
mainnet acceptance.

A saved deterministic comparison ran the original and changed public
functions in the same pinned runtime: **1,606 snapshot/text/SHA comparisons**
and **3,200 change-validation comparisons**, all equal. The 800 generated
sequences cover repeated recipients, equal/out-of-order change sequences,
zero rows, fee boundaries, 128-bit values, exact cap refusal and both fee
modes. Additional direct-call cases cover signed and larger integers,
UTF-16 metadata and malformed numeric strings without claiming that those
values pass the production schema. Full `tsc -b` passed.

The comparison scripts, before/after logs and strict integrity receipt are
saved under ignored `evidence/monthly/` in the worktree. Captured artifacts
are not committed. No live signing, transaction, publication, merge or push
is part of this isolated follow-up.
