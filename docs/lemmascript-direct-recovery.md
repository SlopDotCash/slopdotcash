# EVM direct-payment recovery selection

This isolated cohort starts at `b8d6cc7b8` and addresses the remaining pure
selection in `backend/security/direct-payments.ts:evmRecoveryState`.
Current PRD sections 6 and 8 require exact payment evidence and preservation
of already-paid transfers during private-award recovery. The existing
recovery rules select the unpaid leg that needs retirement and prevent a
higher nonce from bypassing an earlier pending leg. This change proves that
selection. It introduces no payment, cancellation or authority policy and
claims no production defect.

## Complete production-used planner

The existing caller now uses `planEvmRecovery` from
`backend/security/verified-direct-recovery.ts`. The other checked function,
`paidLeg`, performs exact membership in the actual paid-leg index list.
The planner receives concrete nonce records, the paid indices, a tagged
available/unavailable finalized nonce, the actual `researcherPaid` value,
and the original and current recipient record IDs. It receives no
precomputed `consumed`, `blocked` or `authorized` decision.

The complete result preserves four decisions:

1. Among unpaid transactions with a present, nonempty nonce smaller than
   the finalized nonce, select the first smallest nonce. The mathematical
   definition separately proves eligible-set existence, minimum value and
   first-index tie handling.
2. If that set is empty, select researcher leg zero only when
   `researcherPaid` is false and the current target ID differs from the
   original recipient ID. Otherwise there is no selected leg.
3. A selected leg is consumed exactly when it belongs to the above unpaid
   finalized-nonce set.
4. Another leg blocks it exactly when that leg is unpaid, has a nonempty
   lower nonce, and that lower nonce is not consumed by the known finalized
   nonce. An unavailable finalized nonce does not establish consumption.

The result includes the selected parsed nonce record. The public caller
retains the original nullable leg representation and fetches the returned
nonce text directly from the original transaction at the selected index.
Consequently decimal/hex spelling, a present empty string and an absent
nonce are not rewritten by the numeric comparison.

The old implementation sorted the spent candidates with a comparator that
returns 1 for equal nonce values. The new implementation keeps the first
strict minimum. The actual constructor produces distinct nonce reservations
for its one or two transfers. Independent differential cases also confirm
first-equal behavior in the pinned runtime, including equal decimal/hex
values and larger artificial arrays. The theorem does not claim a portable
specification for every native sort implementation using that non-zero
comparison on equal values.

## Nonce and evaluation boundaries

RPC and payer-code reads remain in the existing function, with the same
configuration lookup, parallel requests, catch and fail-closed
`payerReview` default. No external call is performed by the kernel. The
original `researcherPaid` field is passed explicitly instead of inferring
it again from membership of paid leg zero.

`evmDirectTransactions` validates supplied decimal/hex nonces and emits
canonical hexadecimal strings. Initial direct-payment preparation reserves
exact nonces; recovery replacements use the same constructor. The planner's
adapter uses BigInt on these retained strings. It does not introduce a
Number conversion, new validation or a default numeric success value.
The current database rows and protocol constructors, rather than the
mathematical theorem, establish this parseable-string input domain.

Paid legs remain outside numeric selection. The adapter retains a possible
fallback leg zero even if an artificial direct-call context gives
inconsistent paid/researcher state. If the finalized nonce is unavailable
and the actual researcher state/target IDs allow no fallback, the adapter
passes an empty candidate list and parses no transaction nonce. This
preserves the existing unused-nonce behavior after an RPC failure.

For candidates that require a numeric decision, projection can parse a
string earlier than the old `some` or comparator did. For example, a
malformed later nonce after an absent fallback leg, or a malformed paid leg
zero in an inconsistent direct-call context, can throw earlier. Those are
outside the constructor-produced nonce domain. The report does not claim
arbitrary malformed JSON, getter/proxy or mutation exception-order
compatibility. Valid missing and empty-string forms retain their observed
behavior; no speculative new guard is added.

The existing result consumer still decides consent, original payer,
legacy-manual review, nonce cancellation evidence, Solana expiry, immutable
successors and database concurrency. Nothing in this theorem authorizes
signing or cancellation, declares a payment absent, or proves RPC honesty,
wallet ownership or finalized receipt truth.

## Verification

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  backend/security/verified-direct-recovery.ts
lsc check --backend=dafny --time-limit=30 backend/security/verified-direct-recovery.ts
SLOP_DIRECT_TEST_PORT=29677 bun backend/security/direct-payments.integration.ts
bun run typecheck
```

Both runtime functions pass **207 isolated obligations**, or **8 default-grouped
verifier results**, including the
checked minimum/first-equal mathematical properties. The full generated
headers and executable bodies remain unchanged in the proof; additions
are defined functions/predicates and assertion proofs. Integrity and
source-obligation checks pass, with no axioms, assumptions, externs or
skipped obligations.

The complete existing Anvil/SQLite/private-API integration passes all five
asset scenarios: native, token, USDC, USDG and full-award native. It verifies
actual local transactions and receipts, wrong-recipient/replay refusals,
rotated recipient consent, partial paid-leg preservation, exact-nonce
successors, pending fee ordering, legacy-original-only behavior,
same-wallet spent-nonce recovery and delegated-payer cancellation refusal.
All funds and RPCs in this workflow are local fixtures; this is not live
mainnet acceptance. Type checking and scoped formatting/linting pass.

The saved before/after comparison has **6,060 matching executions**:
6,012 exact original/new post-RPC decisions and 48 full function executions
through a loopback JSON-RPC provider. The former cover paid/unpaid,
known/unavailable finalized nonce, minimum and ties, unchanged/changed
recipient IDs, independent researcher-paid state, missing/empty/zero/hex
nonce forms and exact returned nonce text. The full calls compare results
and the completed RPC request multiset after both parallel calls settle,
including provider failures and payer-code results. They do not assert an
order between the two deliberately parallel provider requests.

A separate seven-sample local benchmark measures only the post-RPC decision
for actual two-leg shapes. Medians were 0.31 microseconds before and 0.12
after for two consumed legs, and 0.17 before and 0.13 after for a rotated
researcher blocked by the lower fee nonce. These tiny local samples do not
establish a whole-workflow speedup or a provider latency bound.

A read-only peer review found no substantive issue and identified the same
constructor-domain limit on eager BigInt projection. Captured source,
comparison driver/results, proof logs, Anvil output, typecheck, tool versions,
benchmark and commit receipt remain under ignored `evidence/direct-recovery/`.
Shared inventories, state-model mappings, merge and push are separate.
