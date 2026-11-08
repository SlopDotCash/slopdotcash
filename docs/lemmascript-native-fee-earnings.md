# Earned native-fee balance

This cohort starts at `ebf297a3b1c6f3f23e44ab3c5a857de2fa11249d` in an
isolated worktree. Current PRD sections 6 and 7 distinguish earned fee revenue,
native gas costs, contribution payments and other wallet funds. The existing
`D1ConversionStore.nativeFeeBalance` enforces that distinction before native
conversion. This change proves its credit, receipt and liability reductions.
It adds no payment or fee policy. No production defect is claimed.

## Complete reductions and reuse

Two functions are added to the existing `verified-native-liability.ts` module:

- `nativeFeeEarnings` computes the exact sum of matching direct credits and
  finalized claim outputs, less recorded conversion inputs. It returns the
  existing lexical first-receipt fold and whether a matching direct credit
  is present. No receipt is returned exactly when no credit receipt exists.
- `nativeFeeRemainder` calls the existing proved `nativeDailyLiability` with
  unsettled entries, then returns the positive part of earnings minus that
  complete liability total. Its proof establishes that these entries add
  no dated settled-spend term. The internal `unsettled` variant selects the
  maximum-per-bucket term here, even when its amount came from `actual_wei`;
  it does not change the persisted row's settlement state.

The existing maximum-per-bucket algorithm is reused unchanged. There is no
second implementation of that reduction. Its `PendingMaximum` contract
establishes both an upper bound and attainment by an input maximum, or zero.
The new composition therefore subtracts one largest amount per actual
attempt bucket, then floors the available result at zero.

The credit input carries actual kinds, amounts, receipt timestamps and
normalized direct-recipient strings. The function compares recipient and
wallet strings itself; it receives no `authorized` Boolean. Native direct
fee validation still runs before the projection. This proof does not
establish that a direct receipt or claim represents a real finalized payment.

## Production adapter and preserved behavior

The same three SQL reads remain in the same order: eligible live conversion
rows, completed direct-payment receipts, and then the applicable native gas
rows. Before building a direct entry, the original code still:

1. Validates the fee amount.
2. Skips the exact string `"0"` before inspecting recipient or transfer data.
3. Requires the immutable transfer amount to equal the fee and a recipient
   to be present.
4. Checks the recipient against the fee wallet, using exact Solana equality
   or the existing native EVM lowercasing.
5. Parses the amount with the same BigInt conversion.

Claim amount validation and conversion amount parsing retain their order.
The local arithmetic and receipt comparisons run in the proved fold after
those reads. The rows are ordinary persisted strings, so moving local,
nonthrowing arithmetic past validation does not change observable errors.
The comparison driver also retains accepted legacy coercion cases; no new
amount validator was added.

The first-receipt branch is unchanged. Without a credit receipt the method
returns zero before reading gas, even if arbitrary conversion-only input
could produce a positive signed subtotal. With only vault credits, gas is
queried from the first receipt timestamp. With any direct credit, all
recorded non-abandoned gas expenses are included, preserving the existing
protection against independent page/worker clocks classifying a gas top-up
as earned revenue. Zero-valued finalized vault claims still establish the
same receipt boundary as before.

The gas adapter preserves `actual_wei ?? maximum_wei`, including a recorded
actual zero. It parses that selected string before deriving its bucket.
EVM attempts use the exact existing `String(row.nonce)` key; Solana attempts
use the reservation `row.id`, so two Solana transactions with the same nonce
remain separate costs. Dense indices are assigned by the native Map. The
proof does not claim that Map itself is compiled or that different keys are
financially equivalent.

Each projected maximum is `max(selectedAmount, 0)`, preserving the original
Map's initial zero and strict-greater update even for a negative direct-call
fixture. The actual gas table constrains persisted amounts to digit text.
No monetary value is converted through a floating-point Number. Summing
bucket maxima in dense-index order is exact BigInt arithmetic.

## Contract boundaries

The numeric model covers exact BigInt amounts. Bucket and array indices
come from actual collection sizes. The caller supplies in-range buckets,
nonnegative projected maxima and entries tagged as unsettled; the new
remainder discharges the existing algorithm's corresponding preconditions.

Receipt ordering remains native JavaScript string ordering. The theorem
proves equality with that exact lexical fold; it does not reinterpret stored
timestamps as dates or change the SQL timestamp comparison. The direct
recipient and wallet strings are ordinary D1/configuration strings.
Repeated lowercasing is a reviewed native adapter operation, with no promise
for getters, proxies or overridden methods in arbitrary JavaScript calls.

The projection does not establish wallet control, provider finality,
authenticity of a persisted receipt, database completeness or atomicity.
Those facts remain in the existing payment verification, SQL and Quint
workflows. The separate daily spending-cap theorem is still separate from
this earned-revenue calculation.

## Evidence

Pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.

```sh
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions \
  workers/fee-converter/verified-native-liability.ts
lsc check --backend=dafny --time-limit=30 workers/fee-converter/verified-native-liability.ts
bun test --timeout 30000 workers/fee-converter/fee-converter.test.ts \
  workers/fee-converter/native-gas.test.ts \
  workers/fee-converter/solana-route-prepare.test.ts \
  backend/security/direct-payments.test.ts
bun run typecheck
```

The expanded three-function module passes **256 isolated obligations** and
**16 default-grouped verifier results**, with zero errors. The prior module
had 150 isolated obligations; it remains part of the full check. The new
proof additions are defined mathematical functions, a checked no-settled-
spend lemma and assertion blocks. Generated executable bodies and headers
are unchanged. Integrity and source-obligation checks pass. There are no
axioms, assumptions, externs or skipped obligations.

The final source passes **107 existing tests and 626 assertions** covering
fee conversion, native reservations/recovery, Solana route preparation and
the direct-payment API. Type checking and scoped formatting/linting pass.
These are controlled provider and storage workflows, not live wallet or
network acceptance.

A saved exact-baseline comparison passes **6,016 checks**:

- 1,992 full `nativeFeeBalance` method calls compare returns or exact errors,
  SQL text, query order and bound values. They include 192 targeted cases for
  direct/zero/other-wallet credits, both network identity rules, first receipt,
  all-history gas, zero actuals and replacement keys.
- 4,000 parsed credit/remainder cases compare complete returned state and
  exact integer totals, including negative intermediate subtotals.
- 24 migrated SQLite cases exercise the actual joins and gas filters with
  direct receipts, claims, conversions, duplicate nonces and different
  reservation IDs. The read leaves their serialized database unchanged.

A seven-sample alternating local benchmark compares complete method calls
with scripted query rows. Each input has the indicated number of conversion
rows and gas rows, plus one direct receipt:

| Rows in each list | Before median (ms) | After median (ms) |
| --- | ---: | ---: |
| 10 | 0.0026 | 0.0039 |
| 100 | 0.0094 | 0.0194 |
| 1,000 | 0.0715 | 0.8244 |

The projections add temporary arrays and local work. These measurements
record that cost; they are not a speedup claim or a live SQL latency bound.
The algorithm remains linear in rows and buckets. Captured logs, versions,
source hashes, comparisons and the commit receipt remain under ignored
`evidence/native-fees/`.

## Direct-recovery follow-up

The source review also identified a substantive subsequent pure candidate:
`direct-payments.ts:evmRecoveryState` selects an unpaid leg from consumed
nonces, then computes whether a lower unspent nonce blocks cancellation.
That selection can use actual paid indices, transaction nonce values,
optional finalized nonce and wallet IDs. It must preserve fallback and
parsing order rather than accept supplied `consumed`/`authorized` flags.

The surrounding recovery action remains effectful: original-payer lookup,
fresh recipient consent, retained Solana messages and signatures, two-provider
expiry/receipt evidence, nonce reservation and conditional immutable writes
cannot be discharged by a local Boolean. This cohort does not claim those
workflows or the recovery planner are proved.
