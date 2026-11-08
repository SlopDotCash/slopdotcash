# LemmaScript integration research and implementation

## Target and decision

This work implements the owner's 7 November 2026 request to research the entire
frontend and backend, select the strongest LemmaScript candidates, implement
those contracts, and integrate them with the concurrent Quint work.

The initial implementation started from `origin/development`, commit
`e3d7dea64f1171f5761033069b98de4fd5cc1e77`, in a separate worktree. The original
checkout had a materially different application and economic policy. It was
preserved; its source and policy were not used as the integration baseline.
Current rules include 2% ordinary payouts, historical fee-rounding compatibility,
25% private-bounty fees, optional contribution receipts, and the existing narrow
signer permissions. This change does not expand those permissions.

The accepted scope is executable contracts for real production computations,
a deterministic source inventory, reproducible proof checks, and a confirmed
gas-price correctness fix. The contracts support the existing PRD sections 4–8
and section 11. They add no product feature or interface change. The concurrent
Quint work owns transition-model coverage and source-to-model conformance.

## Research coverage

Three parallel research tracks examined frontend/shared domains,
backend/workers, and tooling/financial/release systems. Their detailed reports:

- [Frontend and UI journeys](lemmascript-frontend-research.md)
- [Backend and Worker boundaries](lemmascript-backend-research.md)
- [Tooling, money, publication, Slopbot, vetting and referrals](lemmascript-tooling-research.md)
- [Exact score/Points aggregation](lemmascript-aggregation-research.md)
- [Global leaderboard, archive and payout selection](lemmascript-global-joins.md)
- [Complete reviewer selection](lemmascript-reviewer-selection.md)
- [Activity notification consent](lemmascript-notification-prototype.md)
- [Token-2022 byte parser](lemmascript-token-extensions-research.md)
- [Monthly frozen award records](lemmascript-monthly-research.md)
- [Private-intake gates](lemmascript-private-intake.md)
- [Monthly award replacement](lemmascript-monthly-replacement-research.md)
- [Original clean-scan reuse](lemmascript-scan-reuse.md)
- [Jupiter decoder research](lemmascript-jupiter-research.md)
- [Jupiter account and quote policy](lemmascript-jupiter-policy.md)
- [Finalized route token reconciliation](lemmascript-route-credit.md)
- [Native liability and retained expiry agreement](lemmascript-native-liability.md)
- [Earned native-fee accounting](lemmascript-native-fee-earnings.md)
- [Complete Solana expiry traversal step](lemmascript-expiry-traversal.md)
- [Complete accepted-work claim partition](lemmascript-work-unit-partition.md)
- [Complete base58 conversion](lemmascript-base58-research.md)
- [Payment evidence agreement and counters](lemmascript-payment-evidence.md)
- [EVM direct-payment recovery](lemmascript-direct-recovery.md)
- [Review grouping and JSON string sizing](lemmascript-review-batching.md)
- [Complete restriction and appeal folds](lemmascript-enforcement-research.md)
- [Complete enforcement action planning](lemmascript-enforcement-plans.md)
- [Complete text byte partitioning](lemmascript-text-parts.md)
- [Accepted source selection and ownership operations](lemmascript-source-ownership.md)
- [Complete retained history graph coverage](lemmascript-history-coverage.md)
- [Signed Solana wire parser](lemmascript-solana-wire-research.md)
- [Retained-copy ancestry and unique hunk bindings](lemmascript-retained-binding.md)
- [Repository access and setup decisions](lemmascript-setup-research.md)
- [Final candidate dispositions and remaining active algorithms](lemmascript-candidate-dispositions.md)
- [Deterministic source/function inventory](lemmascript-inventory.json)

The inventory enumerates first-party JavaScript and TypeScript function bodies
under `src`, `backend`, `workers`, `functions`, `scripts`, `skills`, and the
TypeScript contract adapters. It records file/function hashes, names, source
locations, selected contracts and syntax that needs further review. It also
accounts for Python, shell, Solidity and Rust files as outside the TypeScript
proof toolchain. Tests, fixtures, generated data, declarations and dependency
build trees are excluded. Anonymous callbacks are counted as bodies, not as
independent business capabilities. The exact counts come from the current
inventory; they do not measure proof completeness.

A syntax scan cannot determine purity, reachability, all indirect calls, or
implementation correctness. Every unselected function remains explicitly
unproved. Selected functions are marked `contract-target-unconfirmed` until a
successful exact-source run produces the corresponding evidence receipt.

## Technology findings and alternatives

The current [LemmaScript specification](https://docs.lemmascript.org/spec/),
[Dafny backend](https://docs.lemmascript.org/spec-dafny/),
[supported subset](https://docs.lemmascript.org/subset/), and
[brownfield guide](https://docs.lemmascript.org/getting-started/) support
verification annotations in ordinary TypeScript. We pin LemmaScript 0.6.6 and
Dafny 4.11.0 and prove the generated implementation, rather than maintaining a
separate executable model. Specification comments have no runtime cost.

Dafny is the selected backend because it supports the needed records, strings,
booleans and exact integer operations. BigInt matches the monetary domain.
JavaScript `number` is modeled mathematically; it does not establish IEEE 754,
NaN, Infinity, or precision behavior. Number callers and limits are documented
in the frontend report. Date, URL, regex, cryptography, external APIs, async
scheduling and storage remain separately tested boundaries.

Direct annotations are preferable for small independent modules. Large existing
modules cause transitive type and unsupported-expression extraction even with
selective verification. For those modules we extract a small **runtime-used**
function, then import it into the original workflow. This removes repeated
arithmetic and gives the proof a concrete implementation connection. We retain
all schema, identity, authority and time validation at the existing boundary.

Rejected alternatives were detached reference implementations, assumed extern
contracts, broad rewrites of handlers, and treating passing tests or finite
models as proof of the full application. Each would obscure the actual claim.
A full Lean stack is not needed for these contracts and would add another
maintenance surface without improving the selected acceptance result.

## Implemented priorities

| Area | Actual kernel and callers | Property established |
| --- | --- | --- |
| Ordinary payment policy | `verified-money`: `ordinaryFeeAmount`, `ordinaryFeeMatches`; `payments/contracts` | Upward 2% rounding, zero for nonpositive projections, exact historical floor compatibility and no third accepted fee |
| Private-bounty policy | `bountyFeeAmount`; `payments/contracts` | Exact 25/75 split after the existing positive, bounded and divisible-by-four checks |
| Allocation arithmetic | `weightedShare`; the actor-order adapter | Nonnegative bounded floor quota, remainder bounds, and exact quotient/remainder conservation per contributor |
| Complete allocation | `verified-allocation.allocateWeighted`; project, quality, funding-review, review-budget and review-credit callers | Exact conservation, bounded floor-or-ceiling shares and largest-remainder order for any finite nonnegative weight list; empty and all-zero lists produce zero amounts |
| Contributor allocations | `verified-frontend`: `allocationDisposition` | Recorded-transfer precedence, closure refusal, registered-wallet scheduling, and deadline-dependent unclaimed state |
| Private draft retention | `draftStillNeeded`; `intake-drafts` | Keep only unresolved locally submitted cases; recorded advisories and terminal refusals release the draft |
| Public-resource retention | `transientHttpStatus`; `use-public-resource` | Transient/server failures differ from 4xx authorization/refusal responses |
| Cache/time boundaries | `freshCacheAge`, `identityPollDelay`; `use-snapshot`, `identity-flow` | Half-open freshness interval and poll delay bounded by both allowed interval and remaining lifetime |
| Funding/display | `fundingReminderVisible`, `roundedUsdcCents` | Suppression for terminal/inapplicable funding states and exact half-up minor-unit display |
| Base58 conversion | `verified-base58`; browser/worker codec and Solana adapter | Exact radix value, digit range, leading zeros, alphabet inverse and roundtrip composition; original byte-carry bitwise loop retained, native adapters remain reviewed boundaries |
| Decimal amount input | `verified-decimal`; shared `base-units` entry point and vault/project/bounty callers | Exact ASCII decimal decoding, power-of-ten scaling and fractional range; proved uint128 whole-length refusal |
| Payment evidence and counters | `backend/payments/verified-evidence`; ledger and vault snapshot callers | Full normalized fact and immutable obligation agreement, legacy asset and paid-replay precedence, older block refusal, and first decreased cumulative counter; native JSON and D1/provider authority remain explicit |
| Direct-payment recovery | `backend/security/verified-direct-recovery`; actual EVM recovery state | Complete unpaid-leg selection, first minimum consumed nonce, actual researcher/recipient fallback and lower pending nonce blocking; constructor nonce parsing, provider truth and cancellation authority remain boundaries |
| Native receipt costs | `executionGasCost`, `nativeFeeTotal`, `normalizedNativeDelta`, `solanaNativeFee` | Exact execution/blob/data/operator totals; payer-only SOL normalization; native principal excluded before the final cost comparison |
| Fee-conversion arithmetic | `workers/fee-converter/verified-arithmetic` | Exact directional division, slippage floor, cap intersection, strict requote reduction, reserve/rent accounting, price-impact ceiling and replacement percentage rounding |
| Remainder ordering | `verified-allocation.sortRemainders`; project, quality, funding-review and review-budget allocation | Checked merge sort preserves every row and orders exact remainders with the supplied tie ordinal, for any finite list |
| Exact collection totals | `verified-allocation.sumAmounts`; project, review, quality and funding weights, monthly replacement/frozen totals, received-money validation | Exact sum for any finite BigInt array; nonnegative inputs remain nonnegative |
| Review pool and deployment selection | `verified-selection`; review credit and Pages deployment selection | Exact bounded sum without unsafe intermediate totals; first maximum preserves deployment tie behavior |
| Reviewer grouping | `verified-reviewers`; review-credit caller | Complete distinct first-occurrence order, first highest-band source per actor, and first-five count; validated date sorting and immutable actor-to-index mapping remain explicit adapter obligations |
| Review grouping | `verified-review-batches`; complete review planner | Exact JSON string byte size, longest fitting alias prefix, complete ordered greedy groups and outside-alias binding; native object serialization, hashing and source ordering remain boundaries |
| Restrictions and appeals | `backend/projects/verified-enforcement`; actual project restriction derivation | Complete chronological episode, exact active-ban pairs, pending project/account appeals and final status/appeal composition; source order and authority remain external |
| Enforcement actions | `backend/projects/verified-enforcement`; action and scan planners | Complete six-action acceptance/refusal, moderator/account independence, revision intent and flag-only scan reinstatement; native schema transitions and current authority remain separate |
| Repository setup | `backend/projects/verified-setup`; access parsing and setup/flagger callers | Complete header result/refusal partition and authority state/message; native shape/role syntax and live GitHub authority remain separate, original lazy identity comparison retained |
| Text byte partitioning | `verified-text-parts`; inventory and review splitting | Exact newline/continuation cut policy, increasing bounded ends and complete byte coverage; native UTF-8 conversion remains explicit |
| Source selection and ownership | `verified-source-ownership`; Slopbot discovery and history reads | Complete accepted-commit index order and exact per-record refusal/retire/remove/set operations; native maps, paging, hashes and final ancestry remain boundaries |
| Retained-copy bindings | `verified-retained-binding`; omitted-hunk evidence matching | Complete finite captured-parent reachability, ordered hunk subset and exactly one eligible attribution per missing hunk; captured Git identity, parsing and final native SHA ordering remain boundaries |
| Signed Solana transactions | `verified-solana-wire`; actual parseTransaction | Complete compact-prefix, legacy/v0, instruction/lookup parsing, spans, static program and global reference checks with preserved error order; crypto/RPC identity remain separate |
| Jupiter route policy | `verified-jupiter-policy`; actual route checker | First invalid privilege role, exact last-name binding and first binding refusal, complete input/quote/slippage/fee agreement; native account evidence, ATA and program truth remain separate |
| Jupiter byte decoding | `verified-jupiter-wire`; canonical typed decoder | Full four-layout Borsh decoding and refusal order over all 239 enum constructors, typed output and exact consumed bounds; native byte-view materialization and generator translation remain reviewed boundaries |
| Finalized route balances | `verified-route-credit`; actual receipt reconciliation | Complete account-index joins, exact owner/mint/program and debit/minimum-credit checks, first unrelated holding loss; raw receipt, signature, native SOL and provider evidence remain separate |
| Evidence partition | `verified-partition`; private evidence registration, reads and backup | Positive bounded parts, contiguous offsets, correct final part and complete total, without a total-size cap |
| Native daily liabilities | `verified-native-liability`; real gas reservation | Today's recorded costs plus the largest unresolved maximum per exact wallet/nonce bucket, including the proposed attempt; preserves liabilities across midnight |
| Earned native fees | `verified-native-liability`; conversion store | Complete direct/claim/conversion fold, earliest receipt, direct-credit status and zero-floored credit after one maximum per actual attempt bucket; SQL and normalized wallet identity remain boundaries |
| Retained expiry agreement | `verified-expiry`; Solana recovery and gas journal | Both histories complete and positive, with exact transaction, anchor, horizon, count and digest agreement; provider truth and completeness remain separate |
| Expiry traversal step | `verified-expiry`; actual retained-history loop | Complete hash, anchor, signature and parent-slot refusal decision with exact next cursor or completion; asynchronous acquisition, full-history truth and persistence remain separate |
| Native budgets and review timeout | `verified-budget`; fee converter, referral poster, payment keeper and vetting review plan | Exact existing positive/daily-budget acceptance and capped review-call timeout |
| Slopbot/scanner/referral policy | `workers/verified-policy` | Exact closure admission, published penalty debit, specialist escalation and referral cap arithmetic; external identity and evidence remain caller responsibilities |
| Activity mail consent | `workers/notify/verified-delivery`; real activity dispatch | Exact retry/suppress/send selection from missing, pilot or registered destination, essential notice, explicit preferences and pinned versions; optional mail requires matching consent and registered essential mail requires security consent |
| Score and Points buckets | `verified-aggregation`; score debits, Points reconciliation and displayed totals | Exact signed accumulation and ordered per-bucket debit conservation; safe conversion back to the public number schema, including negative-total overflow refusal |
| Global joins and payout selection | `verified-global-joins`; global leaders, open-month sources and payout Points | Complete stable actor grouping, metadata precedence, distinct memberships, archive exclusion and paid-recipient selection; native Number arithmetic, Date parsing, key mapping and final sort remain separate |
| Token-2022 extension parsing | `contracts/solana/verified-token-extensions`; mint and token-account readers | Complete header/payload and metadata field/vector traversal with bounded reads, allowed unique types, exact error precedence and zero-only trailing padding; preserves original bytes without copying |
| Monthly frozen records | `verified-money.freezeMonthlyAmounts`; monthly snapshot builder | Complete ordered nonzero award records, exact recipient/source strings, both fee modes and gross/net/fee total conservation; JSON/hash and authority remain caller responsibilities |
| Monthly replacements | `verified-monthly-replacement`; current allocation and change validation | Ordered last replacement, exact metadata preservation, first unknown recipient, self-change and excluded-positive refusals; native recipient mapping and sort remain explicit |
| Accepted-work partition | `workers/slopbot/verified-work-unit`; real review validation | Every distinct source claim appears exactly once in a nonempty unit; unknown, duplicate and omitted claims refuse. The caller retains exact immutable IDs and evidence authority. |
| Original scan reuse | `backend/vetting/verified-reuse`; lookup and intake | Exact cached/original identity, restriction freshness, explicit or legacy source inventory and complete retained-evidence matching; database flag coverage and Unicode normalization remain external |
| Private intake decisions | `backend/security/verified-intake`; actual qualification and recovery gates | Human-review precedence, explicit unknown/refused states, invalid-clock refusal and strictly expired running-screen recovery |

### Allocation claim boundary

`allocateWeighted` now proves the complete numerical allocation algorithm.
Its inputs are a nonnegative BigInt total and a finite list of nonnegative
BigInt weights. A positive weight sum allocates every unit of the total;
empty or all-zero weights allocate zero. Every output is nonnegative and
bounded by the total. For a positive weight sum, every amount is its floor
quota or one unit more, and rounded-up rows precede unrounded rows by exact
remainder and supplied input ordinal.

The implementation calls the proved sum and merge-sort functions in the same
source module. This avoids trusting imported method axioms. The generated
bodies, loop invariants, recursive proofs and proof-only additions all pass
the existing strict integrity gate. This replaces the earlier five-reviewer
prototype and the separate sum/sort modules; no list-size cap is added.

The project, quality, funding-review and review-budget allocators share an
adapter that groups equal remainders and retains their existing actor/locale
comparison. Review credit passes its already ordered weights directly and
keeps the existing maximum of five reviewers, safe-integer checks and errors.
It converts each bounded output back to a number within that validated range.

The numerical proof does not establish actor identity, duplicate exclusion,
review eligibility, source time, the adapter's grouping or ICU collation.
Those remain explicit source/caller obligations, covered by source review,
workflow regressions and Quint conformance checks. A complete algorithm
contract is stronger than a per-term proof, but is not whole-application
refinement.

### Confirmed defect: scientific gas-price rounding

`workers/fee-converter/evm.ts:usdMicro` accepted a negative exponent in its
regular expression but returned zero whenever the exponent was present.
For example, `20000009e-7` is 2.0000009 USD and must round upward to 2,000,001
micro-USD. Returning zero could allow a quote through the existing ten-times-gas
cost gate.

The fix scales decimal digits exactly and uses the verified directional-division
kernel when discarding digits. A positive sub-micro amount rounds upward to one,
including extremely large negative exponents. It is detected before calculating
a power of ten. Existing malformed-input refusal and supported grammar remain.

The existing Kyber quote-to-conversion test now passes this scientific-notation
gas amount through the real client and conversion gate and requires `pending`,
which prevents signing. This is workflow evidence with deterministic provider
responses; it does not claim a live Kyber request or on-chain execution. The
proof covers the arithmetic kernel, not the regex parser or whole handler.

### Confirmed defect: negative Points precision

A retained Points journal accepted by the existing constructor and validator
could contain individually safe integer debits whose combined negative total
was outside JavaScript's safe integer range. The old projection checked
positive-earned overflow but then added negative adjustments without the same
boundary. A constructed accepted journal produced
`-18014398509481980` where the exact total was `-18014398509481981`.

The corrected path sums signed values exactly, then applies the existing
`Points total overflow` refusal before returning an unsafe total or monthly
subtotal. Score-penalty totals use the same exact bucket core and a safe public
number boundary. The correction preserves source keys, penalty order,
reversals, immutable journal history and the public number schema. Actual
caller regressions cover both unsafe lifetime totals and an unsafe monthly
subtotal whose lifetime total remains safe. This demonstrates a schema-accepted
input defect; it does not claim ordinary bounded reconciliation produces that
history. The [aggregation report](lemmascript-aggregation-research.md) records
the reproduction and proof boundary.

## Reproducible verification

```sh
bun install --frozen-lockfile --ignore-scripts
bun run lemmascript:setup
bun run lemmascript:inventory
bun run lemmascript:check
bun run verify
bun run test:e2e
```

The setup script installs the checksum-pinned Dafny 4.11.0 release on macOS
arm64 and Linux x86-64. On another platform, install that official Dafny version
and place its executable on `PATH`, then run the checks without the automatic
setup command. LemmaScript is installed by the repository lockfile. Neither
tool is shipped in the browser or Worker runtime.

After reviewing a changed contract/caller, refresh the inventory with
`bun run lemmascript:inventory:update`. Regenerate proof artifacts with the
pinned `lsc` using `lemmascript.json`. Keep proof additions separate from
regenerated implementations. Do not refresh a source hash in place of reviewing
the change.

`LemmaScript-files.txt` is the explicit production target list. The check:

1. Requires exact tool versions, nonempty unique targets and generated
   postconditions for every selected top-level runtime function.
2. Regenerates from an isolated snapshot of current source and configuration.
3. Requires byte-identical generated baseline and unchanged verified artifacts.
4. Rejects rewritten generated declarations, executable changes, assumptions,
   unchecked includes, bodyless axioms and verifier-disabling attributes.
5. Requires positive completed Dafny verification results with zero errors.
   `--isolate-assertions` splits every assertion into a separate check; no
   assertion or function is filtered out.
   Unsupported syntax, missing tools, timeout and output overflow fail closed.
6. Records command, duration, exit result, source and artifact hashes under
   ignored `evidence/lemmascript/`, and rejects input drift during verification.

The independent CI workflow repeats these checks on pull requests and pushes
to `development` and `main`. The normal `verify` command also includes them.
The generated translation, TypeScript frontend, Dafny and SMT solver remain
trusted tools. The integrity gate verifies permitted proof edits; it does not
prove the translation itself sound.

## Boundaries and follow-on research

The runtime refactors have measured costs as well as proof benefits. The
allocation adapter adds work for distinct-remainder inputs. The complete
TokenMetadata reader showed about 25–28% overhead in two fixed-callsite cases,
with small absolute per-call costs and a faster many-pair case. The monthly
freeze refactor adds intermediate records and had variable tail latency in
paired runs. Reviewer selection improved in the measured cases. The detailed
reports retain input sizes, raw results and limits; none is a general production
latency claim. These tradeoffs must remain visible during review.

The selected pure contracts are deductive checks over their stated domains,
not finite simulations. They do not prove all frontend/backend functions,
all JavaScript semantics, crypto primitives, safe sandbox execution, live
provider behavior, database transactions, economic policy, deployment,
wallet control, or chain finality.

The detailed reports rank remaining sequence/collection and parser candidates.
Remaining work includes end-to-end identity/order refinement, upstream review
eligibility, the native identity mapping around monthly replacements, full Jupiter decoding, display formatting, and effectful intake/notification authority.
Those need larger loop/sequence proofs and explicit parser semantics. They are
recorded as unproved, not replaced with assumptions or marked complete merely
because the source appears in the inventory.

Native `Array.sort` remains a boundary for actor collation only. In pinned
LemmaScript 0.6.6, `tools/dist/dafny-emit.js` represents native sorting with a
trusted `SeqSortBy` axiom. Imported method contracts likewise emit axioms.
The integrity gate continues to reject those declarations. The numerical
sum, merge sort and complete allocation now reside in one checked source
module, so the proof contains their executable bodies. The adapter compares
actors only within equal-remainder groups and supplies those ordinals to the
proved allocator. Its identity mapping and native collation remain separate
from the numerical theorem.

Quint owns asynchronous/concurrent transition exploration; implementation tests
exercise real entry points. A model link, a source hash, a test pass, and a proof
of a helper are distinct evidence. The final validation record is maintained in
[the integration record](lemmascript-validation.md). Merge and deployment status
must be reported separately from local proof results.
