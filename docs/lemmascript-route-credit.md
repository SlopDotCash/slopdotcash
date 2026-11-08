# Solana finalized-route token reconciliation

This cohort serves PRD section 11, including the required Solana received-fee
conversion route and its settlement evidence. It completes the pure token
balance reconciliation inside `finalizedRouteCredit`; it does not prove a
provider response, transaction signature, or the whole converter state machine.
The base is `6c6ff9df203ec449062eb6e7885f65cc0818c5bf`.

The prior source checked these balances with two native Maps and a local delta
closure. Those checks were necessary, but the earlier signed-transaction,
Jupiter role, native-delta and reservation proofs did not establish this
account-index join or the exclusion of debits from unrelated wallet holdings.
The production caller now uses four verified functions for those checks. There
is no parallel shadow implementation in production and no policy change.

## Complete contract

`verified-route-credit.ts` operates on actual balance records, after the
existing record-shape, duplicate-index and decimal-amount validation. Each
record retains its account index, owner, mint, program identity, and exact
integer amount. Identity values have a shared numeric representation, described
below. No input says that an account is authorized or that a receipt is valid.

| Function | Proved result |
| --- | --- |
| `balancePosition` | Exact first account-index match, or `-1` if and only if there is no match. No earlier matching record can be skipped. |
| `routeTokenChange` | Exact ordered identity/incomplete refusal, or the post-minus-pre delta. Success is equivalent to a post record with the requested wallet, mint and program and either the matching pre record or the caller's existing missing-pre policy. |
| `routeTokenCredit` | Source refusal precedes destination refusal, then the exact input debit and minimum output check. Success is equivalent to complete source and destination identities and amounts, with the exact output delta returned. |
| `firstDebitedHolding` | Exact first pre-existing, unrelated wallet holding that is missing afterward, has changed owner/mint/program, or has decreased. `-1` is equivalent to absence of any such holding. |

The missing-pre policy is unchanged: native input permits an absent source
observation; destination permits an absent pre-observation; both require a post
observation. A native input's token delta must be zero. A token input's debit
must equal `amountIn`. Destination credit must be at least `minimumOut`.
Neither the proof nor the adapter adds a new account-creation exception.

The independent specification gives complete success predicates and exact
ordered results. The search specifications also give absence and first-match
properties. All supporting functions and predicates have checked bodies; no
axioms, extern assumptions, or opaque authorization predicates are used.

## Adapter, domain and order

The existing `balances()` closure still rejects missing arrays, invalid or
out-of-range account indices, duplicate indices, and noncanonical decimal
amount strings, in the same pre-array then post-array order. Native Maps retain
that validation and insertion order. The new input sequences preserve their
records and order. Since indices are unique here, the proved first match is
exactly the previous Map lookup.

`Balance`'s TypeScript declarations do not validate its identity fields.
Malformed JSON can contain null, booleans, numbers, objects or missing fields.
The adapter therefore uses one shared `Map<unknown, number>` for both observed
arrays and expected identities. It preserves strict equality, type differences,
and object identity, rather than coercing or claiming these fields are strings.
NaN receives a fresh identity at each occurrence because JavaScript strict
equality is not reflexive for NaN, while Map uses SameValueZero. A non-string
owner still cannot equal the canonical wallet and remains outside the unrelated
wallet-holding scan. This representation is a reviewed native boundary, not a
proved Map implementation.

All amount conversions follow the existing canonical-decimal validation and
use `BigInt`; no amount passes through floating-point arithmetic. Projection
reads every retained identity and amount before the exchange call, including
irrelevant balances that the earlier lazy code might not convert. This changes
work, not refusal behavior, for captured plain records with validated decimal
strings. Arbitrary getters, proxies, concurrent object mutation and resource
exhaustion during BigInt allocation are outside that adapter domain.

Existing proof validation limits resolved keys to 256, and the balance validator
requires unique indices into those keys. Thus each projected array has at most
256 elements and the identity ordinal counter stays safely within Number's
exact integer range. The pure mathematical contracts do not need an amount cap.

The caller retains this order:

1. Retained transaction, slot, expectation, Jupiter, signature and loaded-account
   validation.
2. Pre/post balance validation and native ATA address derivation.
3. Proved source/destination identity, presence, exact debit and minimum credit.
4. Existing native-SOL fee/rent reconciliation and its errors.
5. Proved unrelated wallet-holding exclusion.

Signature verification, native ATA derivation and creation parsing, account-proof
acquisition, finalized RPC truth, native fee/rent observation, D1 state and
concurrent settlement remain their existing boundaries. Native-SOL errors still
precede unrelated-holding errors. The synchronous kernel does not decide whether
an RPC receipt is finalized or commit a conversion.

## Validation

The pinned tools are Bun 1.3.14, Node 24.15.0, LemmaScript 0.6.6 and Dafny 4.11.0.
The strict command is:

```text
lsc check --backend=dafny --time-limit=30 --extra-flags=--isolate-assertions workers/fee-converter/verified-route-credit.ts
```

It proves 332 obligations with zero errors. The default command without
`--extra-flags` proves 14 declarations with zero errors; these are different
counting modes, not two different coverage totals. The repository integrity
checker confirms complete generated signatures and executable bodies, with only
defined proof additions.

The existing actual converter, signed v0 Token-2022 route, retained-account proof,
D1 native-gas reservation, lease and recovery workflows pass: 104 tests and 620
assertions in `fee-converter.test.ts`, `solana-route-prepare.test.ts` and
`native-gas.test.ts`. Typecheck and scoped Biome also pass.

An independent driver compares the exact original function and new function
against one prepared, signed route and its retained D1 proof. All 1,223 full
receipt comparisons agree, including absent/duplicate/reordered balances,
malformed identity types, exact huge decimal values, debit/minimum boundaries,
unrelated holdings, loaded-account mismatch and early receipt refusals. These
exercise real signing, parsing and proof checks with a controlled RPC fixture;
they are not claims of a live network settlement.

A second driver compares the exact old and new post-validation caller tails.
All 3,243 cases agree, including native zero token change, absent source,
fee-adjusted native debit, missing native balances, native error precedence,
reordered account indices, NaN and shared malformed identity objects. The native
cases retain the real `nativeLamportDeltas` and `associatedAccountCreations`
functions; they do not independently acquire a live native route.

The captured drivers, logs, source hashes, result census and final receipt are
under ignored `evidence/route-credit/`. Captured logs are not committed.

## Cost

The verified first-match scan replaces native Map lookups. It makes the final
holding join quadratic in the number of observed records; the validated account
limit is 256. A complete post-validation caller-tail benchmark includes native
ATA derivation, balance validation, identity projection, conversion and both
checks. With 100 warmups and seven alternating rounds of 1,000 calls, observed
median milliseconds per call were:

| Unique pre/post records | Before | After |
| --- | ---: | ---: |
| 8 | 0.265 | 0.267 |
| 64 | 0.364 | 0.378 |
| 256 | 0.338 | 0.450 |

The machine was also running formal verification, so individual samples vary.
This supports a bounded added cost of roughly 0.11 ms at the largest allowed
receipt in this run, not a speedup or a general service latency claim. No new
limit or policy was introduced for the benchmark.
