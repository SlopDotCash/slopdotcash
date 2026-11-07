# LemmaScript research: backend and workers

Research date: 7 November 2026. Target: current `origin/development` in the
isolated `slopdotcash-lemmascript` checkout. This report supersedes research of
the older, unrelated working tree. Findings from that application are not
silently treated as findings about this revision.

## Result

The best immediate proof targets are exact monetary calculations that several
backend and worker paths already execute. This integration extracts ten such
functions into `workers/fee-converter/verified-arithmetic.ts`, then imports the
same functions from the live EVM adapter, Solana adapter, and conversion
coordinator. Generated Dafny checks their arithmetic postconditions. It does
not verify a second implementation that the product never calls.

This work also corrects a confirmed conversion defect. `usdMicro` accepted
negative-exponent notation, then returned zero for every such input. Thus
`20000009e-7` dollars, a little more than two dollars, became zero gas cost.
The conversion coordinator could proceed past its required ten-times-gas gate.
The parser now keeps the exact decimal value, including conservative upward
rounding of positive sub-micro costs. A workflow regression runs the real quote
adapter and coordinator against persisted SQLite records and confirms that the
conversion remains pending before transaction preparation.

## Research scope and method

The source inventory contains 87 backend, three Pages Function, and 172 worker
JavaScript/TypeScript source files under this report's filter. The filter omits
filenames containing `.test.` or `.integration.` and paths containing a
`fixtures` component; it includes workflow and qualification source. These are
inventory counts, not proof coverage. The repository-wide generated inventory
is the reproducible source of individual paths and declarations.

Research followed the HTTP, scheduled, and queue entry points into their
authorization, pure calculations, provider calls, storage, publication, and
recovery paths. It reviewed the current PRD, source contracts, and existing
test workflows. High-priority review focused on fee conversion and native gas,
payment reconciliation, immutable award identity, private-report intake,
project access, notifications, Slopbot accepted-work evidence, vetting reuse,
and referral allocation. The ranked table below records feasible next proof
families and the boundaries that remain outside this integration.

The relevant current requirements are PRD sections 2 (authority and records),
3 (accounts), 5 (Slopbot), 6 (funds and payments), 7 (Points and discovery),
8 (private security), and 11 (delivery and acceptance). No product policy, fee,
signing authority, supported network, or production release setting changes.

## Tool choice and supported claim

[LemmaScript](https://github.com/midspiral/LemmaScript) is a technology-preview
TypeScript verification tool. Its [specification](https://github.com/midspiral/LemmaScript/blob/main/SPEC.md)
defines annotations and supported extraction, and its
[design documentation](https://docs.lemmascript.org/design/) describes the Dafny
and Lean backends. This integration uses pinned LemmaScript 0.6.6 with Dafny
4.11.0 and JavaScript UTF-16 string configuration.

Exact `bigint` arithmetic is a stronger fit than arbitrary JavaScript `number`
arithmetic. The proved functions do not depend on floating-point rounding,
locale parsing, regex semantics, async execution, mutation through aliases,
cryptographic primitives, provider APIs, or database behavior. Divisions are
specified with explicit nonnegative numerator and positive denominator domains,
matching JavaScript bigint truncation to mathematical floor. Contracts express
useful bounds, conservation, and branch behavior rather than only repeating an
implementation expression.

The generated executable Dafny bodies remain unchanged. Two proof-only helper
lemmas establish multiplication monotonicity and integer division bounds.
There are no assumptions, unchecked externs, admitted lemmas, or proof-disabling
attributes in this proof target. The extraction/compiler and prover are still
trusted tools; passing these proofs is not a general implementation-refinement
theorem for the complete application.

## Implemented proof families

| Runtime function | Live callers | Verified contract | Caller obligations |
| --- | --- | --- | --- |
| `roundedDivision` | EVM `usdMicro` | Nonnegative result; exact adjacent-integer floor or ceiling bounds for the selected direction. | Numerator is parsed unsigned digits; denominator is a positive power of ten. Parsing and exponent interpretation remain outside the proof. |
| `minimumOutput` | EVM quote, Solana `signedMinimumOutput`, `acceptableMinimum` | Result lies between zero and the quote; it is exactly the floor of the permitted slippage fraction. | Quote amount is nonnegative; basis points are integers from zero through 10,000. Configuration parsing bounds them; the Solana quote is checked before use. |
| `acceptableMinimum` | Coordinator `slippageWithin` | Acceptance requires a positive quote and a requested minimum between the proved floor and the quote. | Configured basis points are bounded. The short-circuit positive-quote check discharges the nested minimum's domain. |
| `remainingBudget` | Coordinator `convert` | Result is no larger than either remaining cap, and equals one of them, including exhausted/negative remaining values. | None beyond bigint inputs. This does not prove reservation isolation. |
| `rescaleInput` | Coordinator requote loop | Nonnegative result strictly below current input; exact floor of the 98-percent cap target. | Positive current input and remaining cap; quoted output exceeds the remaining cap. The loop condition supplies the latter two; positive candidate balances and prior successful rescale supply the first. |
| `spendableNative` | EVM balance, Solana balance, coordinator native-fee receipt allowance | Nonnegative amount no larger than balance; zero when balance is at/below reserve; otherwise amount plus reserve equals balance. | Nonnegative finalized balance and validated reserve. Chain/provider truth and receipt provenance are separate obligations. |
| `rentIncrease` | Solana `solanaNativeCost` | Returns zero for nonincreasing rent, or exactly the positive rent increase. | Existing receipt checks reject negative before/after rent balances. |
| `greaterAmount` | Solana `solanaNativeCost` | Result is an operand and no smaller than either one. | None. The caller's existing receipt validation establishes its meaning as cost. |
| `priceImpactCeiling` | EVM quote | Result is between zero and 10,000; no loss gives zero; loss is rounded upward with both adjacent-integer bounds. | Positive input value and nonnegative output value from `usdMicro`. The quote adapter checks input positivity. |
| `ceilPercent` | EVM replacement fee calculation | Nonnegative result and exact ceiling bounds on the requested percentage. | Nonnegative decoded fee values and fixed nonnegative percentages. Transaction parsing and signer validation remain separate. |

The proof has **28 successful Dafny verification results** for ten runtime
functions and two helper lemmas. The number 28 counts prover obligations,
not application functions, scenarios, or full workflows.

## Confirmed defect and correction

Before the change, `usdMicro` used an optional `e-...` regex group and returned
`0n` whenever that group existed. This contradicted the same function's promise
to round a positive gas cost upward. It affected both price-impact inputs and
the quote's EVM network-cost estimate.

The correction interprets the mantissa's unsigned digits and adjusts decimal
precision using the exponent. It then uses exact bigint multiplication or
`roundedDivision`. If every mantissa digit is below one micro-unit, it returns
one for upward rounding of a positive value and zero for downward rounding.
It handles enormous negative exponents with that direct result, before
constructing any power of ten. A large exponent therefore does not allocate
an enormous integer. The bounded exponent is a position/count value, not a
monetary float. Under the small-exponent branch it is exactly representable.

Examples checked in the existing worker suite:

| Input | Upward result | Downward result |
| --- | --- | --- |
| `1e-1` | 100,000 micro-units | 100,000 micro-units |
| numeric `1e-7` | 1 micro-unit | 0 micro-units |
| `20000009e-7` | 2,000,001 micro-units | 2,000,000 micro-units |
| zero with a very large negative exponent | 0 micro-units | 0 micro-units |
| positive value with a very large negative exponent | 1 micro-unit | 0 micro-units |

The workflow regression supplies `20000009e-7` as the real quote adapter's gas
price for a 20-dollar conversion. The stored result is `pending`, with reason
`below the gas-cost multiple`. No transaction is prepared or sent. The old
zero-cost branch would instead permit the normal `submitted` path.

This before/after difference was reproduced against the exact baseline worker
sources at `e3d7dea64f1171f5761033069b98de4fd5cc1e77`. An external temporary
fixture used the new regression tests and the baseline worker files. Both
regressions failed as expected: the coordinator stored `submitted`, and
`usdMicro("1e-1")` returned zero. The fixed source passes the same tests. The
captured log is an external evidence artifact, not a committed source file.

## Ranked remaining candidates

These are research candidates, not claims of completed verification. Extract a
candidate only when the same function can be called by the production path,
its input domain can be enforced at that callsite, and the generated semantics
do not silently assume the property being claimed.

| Priority and family | Specific source candidates | Valuable invariant and feasibility |
| --- | --- | --- |
| High: payment evidence | `backend/payments/ledger.ts`: `evidenceFacts`, `indexPaymentEvent`; `chain-awards.ts`: `holdsAward`; `vault-snapshots.ts`: `storeVaultSnapshot` | Exact actor/award/source/asset binding, net plus fee equals gross, monotonic cumulative counters, same-event idempotence. Pure comparisons and exact arithmetic are suitable. Canonical finalized-chain observations, SQL uniqueness, wallet authorization and transaction atomicity still require provider/database tests and Quint. |
| High: native-gas journal | `workers/fee-converter/native-gas.ts`: `validateNativeLimits`, `reserve`, `settle`, `resolveSolanaExpiry`; `solanaNativeCost` | Max liability per nonce, no refund for unknown signed sends, daily reserve including unsettled liabilities, and winner-only settlement. Arithmetic aggregation is a good future verified core; map grouping and the SQL lease/revision fence must be preserved and tested independently. Current proofs cover reserve subtraction and receipt cost selection only. |
| High: signed route parsing | `workers/fee-converter/jupiter-wire.ts`: `decodeJupiterRoute`; `solana.ts`: `parseTransaction`; `jupiter-route.ts`: `assertJupiterRoute`; `solana-route-receipt.ts`: `finalizedRouteCredit` | Every consumed byte is bounded; no trailing bytes; exact token, signer, destination, amount and minimum. A scalar/array parser core is valuable but substantially larger than simple arithmetic. Typed arrays, schema recursion, optional fields and crypto calls are explicit current limitations. |
| High: route expiry/recovery | `workers/fee-converter/solana-expiry.ts`: `matchingCompletedCoverage`, `completeBlock`, `proveSolanaExpiry`; `workers/payments/reconcile.ts`; `workers/payment-executor/binding-recovery.ts` | A missing transaction is not proof of expiry; retained complete histories agree; a replaced binding cannot replay. Pure evidence matching is feasible. Chain history completeness, finality, and concurrent durable transitions remain external/model obligations. |
| High: monthly payment lifecycle | `backend/payments/monthly.ts`, `monthly-attestation.ts`, `monthly-reserve-release.ts`; `workers/payment-executor/monthly*.ts` | Closed allocation, source identity, cap preservation, no duplicate reservation, correct withheld/released distinctions. Exact amount kernels can be proved. Full lifecycle needs the real database and contract entry points. Root integration separately covers shared payment fee/allocation arithmetic. |
| High: private report intake | `backend/security/report-intake.ts`: `intakeQualified`, `screeningRecoverable`, `checkRevision`, `actStoredIntake`; `backend/security/submissions.ts` | Only qualified reports advance; retry respects current revision; author/owner/approver/operator views stay separate. Discriminated pure state guards are feasible. Private object storage, signed access grants, human authority, and concurrent compare-and-swap cannot be replaced with booleans proved in isolation. |
| High: security payment recovery | `backend/security/direct-payments.ts`: nonce allocation, `verifyDirectPayment`, `directRecoveryConsent`, `recoverDirectIntent`; `payments.ts`: `prepareSecuritySettlement` | Paid legs remain immutable; old signable instructions expire or retire before replacement; renewed consent binds new destination; never double-pay settled value. Arithmetic and evidence predicates are suitable. Signing, mainnet finality, wallet possession and cancellation truth are not established by a local proof. |
| High: project admission and access | `backend/projects/setup.ts`, `repository-access.ts`, `enforcement.ts`, `account-bans.ts`, `cloudflare-persistence.ts` | Immutable GitHub identity, live repository permission, current manifest, exact scope and enforcement precedence. Pure policy decisions merit extraction. Provider calls, immutable revision writes and moderation transitions need current integration/Quint evidence. |
| High: clean-scan reuse | `backend/vetting/reuse.ts`: `reusableCleanScan`; `scan-result.ts`; `workers/vetting/provenance-report.ts`: `bindProvenanceSource` | Reuse only original clean evidence with identical manifest, source inventory, template, policy, run and report identity; fresh enough for every restriction. String/record matching is feasible, but the dynamic schemas and source-inventory digest provenance cannot be assumed away. |
| High: Slopbot accepted work | `workers/slopbot/value-work-unit.ts`: `validateWorkUnitPartition`, `acceptedWorkUnitCommits`; `value-evidence.ts`: `valueEvidenceMatchesRepository`; `value-work-unit-consumption.ts` | Accepted commits partition exactly once, correct repository identity, no duplicated source credit, exact retained proof. Sequence/set proof is valuable but requires substantial typed normalization. Live GitHub acceptance and durable source consumption remain separate. |
| High: Slopbot publication fencing | `workers/slopbot/value-publication.ts`, `value-work-unit-publication.ts`, `value-source-leases.ts`, `value-processing.ts` | A stale lease or changed head cannot publish, source ownership is unique, terminal evidence survives retries. Pure matching helpers are feasible; database and GitHub publication races remain Quint/integration targets. |
| Medium: Slopbot routing and retry | `workers/slopbot/routing.ts`: `route`; `appeals.ts`: `escalationFor`; `penalties.ts`: `penaltyFor`; `value-processing.ts`: `valueRetryDelayMs` | Deterministic model route/escalation, bounded monotonic retry, published penalty rules. Simple enum/boolean kernels fit. Never turn an advisory model output into human authority or invent new penalty policy. |
| High: referral caps | `workers/referral-accrual/core.ts`: `judge`, `totalsOf`, `add`; `config.ts`: `isPeriod` | Accrual is no larger than computed share, remaining project cap or remaining pool; exhausted caps give zero; prior credit cannot be counted twice. The scalar cap is implemented and proved by `cappedReferralAccrual`. Aggregation, candidate ordering, durable period publication and first-payment window dates require separate evidence. |
| Medium: referral Merkle evidence | `workers/referral-accrual/merkle.ts`: `buildTree`, `verifyProof`; `core.ts`: `buildFile`, `postNextRoot` | Stable leaf order, duplicate-free identities and proof path reconstruction. Hashes are opaque trusted primitives; proof of tree shape is not proof of collision resistance or chain-root publication. |
| Medium: notification eligibility | `backend/notifications/email.ts`, `email-destinations.ts`; `workers/notify/activity.ts`, `security.ts`, `handler.ts` | Verified destination and explicit preference before delivery, withdrawal stops new sends, partial delivery does not become success. Pure eligibility and MIME character guards are feasible. Provider acceptance, mailbox arrival, token HMAC and single-use database behavior remain boundaries. |
| Medium: authentication and HTTP | `backend/http.ts`: `isSameOriginJsonWrite`, `requireActor`; `backend/trace/auth.ts`; `workers/identity/handler.ts`, `rate-limit.ts`, `persistence.ts` | Same-origin writes, expected-actor binding, strict audience/time/role acceptance, one-time assertions, fixed-window admission. Boolean/string/time kernels fit after input normalization. Fetch, crypto, cookies and atomic rate counters are not proved by extraction. |
| Medium: Points and private/public projection | `backend/points/disputes.ts`, `handler.ts`, `x.ts`; `backend/notifications/incomplete-assessments.ts`; `backend/vetting/summary.ts` | Public accepted-work totals stay separate from private case details; disputes and assessment cursors cannot bypass authority. Safe projections and enum classification are candidates; joins, pagination completeness and current permission checks require real workflow tests. |
| Medium: vetting acquisition/sandbox | `workers/vetting/acquire.ts`: `resolveSymlinkTarget`, `verifyTrees`; `bounded-scan.ts`; `review-plan.ts`: `batchParts`, `planReview`; `workers/vetting-sandbox/merge.ts` | Bounded paths/bytes/calls, no escape, complete source inventory, deterministic plan partition. Pure path or partition functions may fit. Filesystem, process isolation, tar/git behavior and malicious-code containment require operating-system evidence. |
| Lower: wrappers and presentation | `functions/index.ts`, `functions/[[path]].ts`, `backend/pages.ts`, row mappers, scheduling/dispatch wrappers | Host/route classification, bounded serialization and stable projection are small candidates. These should follow money, evidence and access kernels; proving a wrapper while treating all important effects as externs adds little confidence. |

## Validation and limits

Local proof command:

```sh
lsc check --backend=dafny --time-limit=30 \
  workers/fee-converter/verified-arithmetic.ts
```

Result: 28 verified, zero errors. The first automatic attempt exposed difficult
nonlinear division obligations. Checked helper lemmas and assertions discharge
them; the function specifications were not weakened to hide those failures.

Affected workflow suite:

```sh
bun test ./workers/fee-converter --timeout 30000
```

Result: 101 passed, zero failed, 597 assertions across three files. It includes
real quote parsing, conversion decisions, SQLite persisted rows, native-gas
reservation concurrency, replacement liability, Solana receipt handling and
signed-route checks. Provider responses are deterministic fixtures, not live
provider or mainnet evidence. No signing secret, broadcast, deployment or
external payment was requested by these tests.

The report does not claim that all ranked candidates are implemented or that
all backend state is proved. Regex parsing and powers of ten in `usdMicro`,
whole native-cost accumulation, schema validation, provider data, database
transactions, code generation and current contract code remain explicit trust
or verification boundaries. Final exact-head repository checks, current
Quint models and browser results belong in the integrated verification record.
