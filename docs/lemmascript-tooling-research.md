# LemmaScript research: money, workers, ingestion, and publication

Research date: 7 November 2026. Target: current `origin/development`, in the
`codex/lemmascript-current` worktree. This replaces research of the older dirty
checkout, whose economics and architecture differ. In particular, current
ordinary payout fees round up at 2%; the old checkout's 1% rule does not apply.

## Scope and authority

This work supports the owner's request to add verification to existing
application behavior. It adds no product journey and authorizes no payment,
key use, fee-service activation, or deployment. The current PRD sections 6, 7,
8 and 11 govern money, Points, private awards and delivery. The PRD defines no
current MVP work-package identifiers; this report uses those section numbers.

Quint describes state transitions and interleavings. LemmaScript adds function
contracts to the actual TypeScript the application executes. They address
different obligations. Neither establishes RPC honesty, GitHub authority,
cryptographic security, operating-system behavior, or deployment availability.

The strongest initial targets are exact integer arithmetic and deterministic
admission decisions. Extract a small runtime kernel only when direct
verification of the original module is blocked by unsupported effects, types,
or constants. Existing callers must execute that kernel. A copied mathematical
implementation does not verify the production function.

## Ranked candidate inventory

| Priority | Current implementation | Required property | Limits and integration decision |
| --- | --- | --- | --- |
| 1 | `src/lib/payments/contracts.ts:payoutFee`, `ordinaryFee`, `acceptsPayoutFee` | Ordinary fee is `ceil(gross / 50)`; zero projection has zero fee; fee lies between zero and gross; splitting cannot lower total fees; security bounty is an exact one-quarter fee | Preserve valid-gross range, policy refusal, historical floor-fee compatibility and error messages. Verify the actual BigInt calculation. PRD sections 6 and 8. |
| 1 | `src/lib/project-view.ts:allocateIntegerTotal`; `src/lib/scoring-policy.ts:allocateReviewCredit` | Every unit is allocated; nonnegative shares; each share is floor or floor plus one; stable ties | Prove allocation, not just division. Actor IDs, unique recipients, sorting, weights and tie order need explicit assumptions. Keep financial and reviewer ordering semantics unchanged. PRD sections 6 and 7. |
| 1 | `src/lib/base-units.mjs:decimalBaseUnits`, `formatBaseUnits`; `src/lib/payments/vault-amount.ts:parseVaultAmount` | Exact decimal scaling; no floating-point loss; bounded decimal precision; correct positive uint128 input | Preserve string grammar, decimal limits 0–36, malformed-input refusal and base-unit range. Built-in regex and string-to-BigInt behavior are separate parser obligations. |
| 1 | `workers/fee-converter/core.ts:slippageWithin`, `impactWithin`; `workers/fee-converter/solana.ts:signedMinimumOutput` | Accepted minimum output is between the exact slippage floor and the quoted output; configured limits control acceptance | Verify pure math after configuration validation. Do not claim route safety or signing safety from the scalar predicate. Preserve the live-mode and network activation gates. PRD section 6. |
| 1 | `workers/fee-converter/native-gas.ts:validateNativeLimits`, `NativeGasJournal.reserve`; `workers/referral-accrual/gas.ts:validateGasLimits`, `validateGasCost`; `scripts/payment-keeper/budget.ts:reserve` | Positive transaction budget fits daily budget; actual cost cannot exceed reserved maximum; outstanding same-nonce attempts reserve their maximum, not their sum | Scalar limits can be proved. SQL revision fences, leases, nonce grouping, uncertain attempts and durable recovery also require Quint and database evidence. Do not activate deferred referrals. |
| 1 | `contracts/solana/native.ts:nativeLamportDeltas`; `contracts/evm/native-cost.ts:evmReceiptNativeCost`; `workers/fee-converter/solana.ts:solanaNativeCost` | Exact native fee calculation; payer fee normalization; principal and rent stay distinct; cost never drops below witnessed fee | TypeScript adapter calculations are candidates. RPC identity, finalized evidence, unique account keys, token balances and operator fees remain required independent checks. Native Rust/Solidity source is outside LemmaScript. |
| 2 | `src/lib/score-penalties.ts:penaltyDeductions`; `src/lib/points.ts:pointsForScore`, `awardForScore`, `reconcilePointPenalties` | Debit never makes the relevant actor/project/month negative; one accepted outcome is not credited twice; penalties reverse once | Verify arithmetic and selection predicates with explicit bucket identity. Immutable journal links and source authority require integration evidence. PRD section 7. |
| 2 | `src/lib/scoring-policy.ts:reviewCreditPoolThirds`, `allocatePullRequestReviewCredit` | Pool is capped by assessed size with the published minimum; first five distinct reviewers; highest band per reviewer; deterministic order | Preserve complete chronological and identity policy. General sorting and Unicode comparisons need review. |
| 2 | `src/lib/payments/monthly-allocation.ts:monthlyCutoff`, `currentAllocations`, `assertAllocationChange`, `buildExecutionSnapshot`; `backend/payments/monthly.ts` | UTC cutoff is 72 hours after month end; allocations fit funded amount; disabled or underfunded months create no obligation; frozen snapshot identity is stable | Date parsing, D1 state, owner authority, reserve creation, root publication and payment execution are separate obligations. PRD section 6. |
| 2 | `src/lib/payments/contracts.ts:reservedGross`; `backend/payments/vault-snapshots.ts`; `contracts/vault-totals.ts` | Preserve null/unavailable counters; combine reserve principal and fee exactly; never add unrelated assets | Missing data differs from zero. Chain snapshots must remain tied to one finalized observation. |
| 2 | `workers/referral-accrual/core.ts:totalsOf`, `judge`; `workers/referral-accrual/merkle.ts` | Accrual bounded by project and total caps; cumulative amount never decreases; proof ordering is deterministic | The scalar cap is implemented in `cappedReferralAccrual`. Aggregation, hashes, root authority and publishing remain unproved. Program activation is unchanged. PRD section 11. |
| 2 | `scripts/select-pages-deployment.mjs:selectSuccessfulProductionDeployment`; `src/lib/deployment.ts` | Candidate is a clean successful exact-SHA deployment from the required branch after the boundary | Read current release branch policy from current source. Provider parsing, URL checks and latest-candidate choice remain separate. |
| 2 | `scripts/generate-leaderboard.ts`, `generate-points.ts`, `prepare-pr-ledger.ts`, `prepare-points-import.ts` | Complete input coverage, immutable identity deduplication, deterministic score conversion and publication | Pagination, GitHub churn, journal writing and failed ingestion need model and integration evidence. A helper proof does not prove the importer. |
| 3 | `contracts/solana/token-extensions.ts:extensionRecords`, `readTokenMint`, `readTokenAccount`; `workers/fee-converter/jupiter-wire.ts:decodeJupiterRoute` | Exact bounds before byte reads; only allowed extensions; no trailing or ambiguous data | Deeper parser targets. Preserve native-token identities and metadata-only Token-2022 policy. Cryptographic and on-chain semantics remain separate. |
| 3 | `src/lib/install-command.ts`; `scripts/dist-manifest.mjs`, `prepare-site.mjs`, `prepare-publication.mjs`, `evidence-contract.mjs` | Canonical paths, exact bytes, immutable authority, correct evidence mode, atomic activation | Generated shell/Python, filesystem effects, URLs and cryptography prevent whole-function TypeScript proofs. Retain real installation and publication workflow evidence. |

## Slopbot, vetting, and deferred referral follow-up

The following candidates come from a separate read of current worker source.
They remain research candidates unless the final proof ledger names them.
They are not implicitly covered by the money or browser helper contracts.

| Order | Source and exact function | Contract to prove | Remaining boundary |
| --- | --- | --- | --- |
| 1 | `workers/slopbot/closure-eligibility.ts:closureEligibility` | Eligible exactly when this is a pull request, maintainer exemption is explicitly absent, membership is verified and the author's matching run exists; unknown exemption refuses | The database/GitHub readers establish those inputs. The verdict and project closure consent are separate. Preserve each refusal reason. |
| 2 | `workers/slopbot/penalties.ts:penaltyFor` | Exact published category-to-action/debit mapping; `none` has no penalty; label-only category never carries debit | Table correctness is policy review. `recordPenalty` and `reversePenalty` have transactional and replay requirements beyond this function. |
| 3 | `backend/vetting/evidence-chunks.ts:chunkLayout` | Contiguous zero-based chunk indexes; every part except the last is 8 MiB; final part is positive and bounded; parts sum to total size | Hashes, R2 reads and permanent content identity are separate. Keep the approved absence of a total evidence-size cap. |
| 4 | `workers/vetting/review-plan.ts:callTimeoutMs`, `batchParts`, `planReview` | Timeout cap, positive part lengths, complete ordered inventory coverage, bounded per-call serialized size and deterministic batch order | UTF-8 byte count differs from JavaScript string length; JSON escaping and framing need exact modeling. Never convert the per-call bound into a repository-size refusal. |
| 5 | `backend/vetting/scan-result.ts:specialistRequired`, `scanProblems` | High/ambiguous risk, flagged threats and unreleased artifacts trigger specialist review; no clean disposition with incomplete coverage, open high/critical findings, missing reviewer completion or unmatched input digest | Real model output, scanner coverage truth and private evidence are not proven by a decision predicate. Existing provider qualification rules remain. |
| 6 | `backend/vetting/reuse.ts:reusableCleanScan` | Reuse only the original clean assessment for the same project, repository, input inventory, policy, template and scan; a restriction boundary cannot be bypassed | Current flag coverage, restriction history and case-insensitive repository identity require trustworthy input validation. Do not infer clearance from absent records. |
| 7 | `workers/slopbot/value-binary.ts:needsAddedBinaryProof`, `sameAddedBinary`; `workers/slopbot/value-merge-resolution.ts:mergeResolutionMatches` | Missing textual/comparison evidence demands binary proof; source, parent, path and digest identities match exactly | TextDecoder, base64, Git object hash and retained blob acquisition are separate. A digest-match predicate does not prove human-visible video content or contribution value. |
| 8 | `workers/referral-accrual/core.ts:judge` arithmetic region and `add`, `totalsOf` | Accrual is at most computed award, nonnegative project capacity and nonnegative pool capacity; running totals reflect the accepted amount once | Hold/ban/asset/window checks, row identity and transaction publication remain effectful. Extract only a production-used scalar kernel if selected. |
| 9 | `workers/referral-accrual/merkle.ts:buildTree`, `verifyProof` | Address order, duplicate refusal, correct sibling path, odd-node promotion and logarithmic termination | Keccak and ABI encoding require explicit trusted primitives or separate crypto verification. Do not disguise their assumptions as an implementation proof. |
| 10 | `workers/slopbot/value-budget.ts:reserveValueBudget`, `reconcileValueBudget`; `workers/slopbot/value-work-unit-consumption.ts:consumeWorkUnitHistory` | Budget does not overspend; one source work unit cannot be consumed twice | The core correctness is concurrent storage ownership, idempotence, rollback and recovery. Prioritize Quint plus actual D1 transactions; LemmaScript can verify extracted pure accounting only. |

No read-only finding above authorizes changes to the penalty table, closure
consent, security disposition, fee limits, or referral activation. The most
valuable next proofs combine a small deterministic contract with a real caller
that already relies on that property. Pure functions that merely restate a
constant add less evidence than allocation, chunk conservation or fail-closed
admission.

### Implemented worker checkpoint

`workers/verified-policy.ts` now supplies four production-used contracts:
`closureAllowed`, `penaltyDebit`, `scanNeedsSpecialist` and
`cappedReferralAccrual`. The existing Slopbot closure wrapper keeps its refusal
messages. The existing penalty table keeps its actions and public meaning.
The scan parser still establishes complete input records. Referral accrual
still applies its existing asset, hold, ban, window and activation rules.

The generated worker policy artifact verifies five Dafny declarations without
assumptions or handwritten executable changes. The current referral cap,
pool, window, hold, ban and asset workflow regression passes. Existing closure,
appeal, penalty-table and referral workflow tests also passed during the wider
run. That wider run was stopped during the expensive scanner suite so the root
verification could run it once; it is not reported as a completed suite.
The final integration report and exact-head checks supersede this checkpoint.

## Complete-source accounting

`scripts/lemmascript-inventory.mjs` records each first-party JavaScript and
TypeScript function body across `src`, `backend`, `workers`, `functions`,
`scripts`, `skills` and TypeScript contract adapters. It records source hashes,
names, lines, syntax limitations and explicitly selected runtime contracts.
Python, shell, Rust and Solidity files are recorded as outside this toolchain.
Tests, fixtures, generated declarations and build outputs are excluded.

Every unselected function remains `unproved`. A selected contract remains
`contract-target-unconfirmed`: only successful current verification evidence
establishes its proof result. Syntax scanning is a review aid, not a purity
checker. Indirect effects, generated commands, provider assumptions and dynamic
dispatch still need source review.

## Toolchain decision

Use exact LemmaScript 0.6.6 and Dafny 4.11.0 development tools. Keep them out of
the browser bundle. Install the official Dafny archive locally after checking
its SHA-256. Use the Dafny backend, JavaScript UTF-16 strings and local helpers.
Pin dependencies and reject unexpected tool versions.

The primary documentation recommends small pure functions first. `number`
normally becomes a mathematical integer; genuine `await` is unsupported.
State integer and magnitude domains for JavaScript numbers; use BigInt for
money. `throw` becomes an unreachable point, so valid-input preconditions do
not prove all failure behavior. Retain production validation and refusal tests.

Selective `//@ verify` still extracts constants and types. Large modules may
fail translation even for simple selected helpers. Do not use trusted extern
declarations, assumptions, opaque stubs or duplicate implementations to pass.

## Required integrity and evidence

1. List actual production files in `LemmaScript-files.txt`. Reject empty lists,
   duplicate paths, missing targets and missing postconditions.
2. Regenerate from exact sources in an isolated directory. Fail when the
   generated baseline differs from its checked-in bytes.
3. Preserve generated executable bodies and declaration headers. Permit only
   checked proof additions, defined helpers and completed lemma bodies. Reject
   assumptions, bodyless axioms, verifier-disabling attributes, unchecked
   includes and executable edits hidden inside proof artifacts.
4. Require the pinned prover, positive verified-obligation counts and zero
   errors. Timeouts, unsupported syntax and skipped files fail the check.
5. Hash sources, configuration, baseline, proof, commands and results. Reject
   concurrent input changes. Keep logs and receipts under ignored `evidence/`;
   keep reproducible proof artifacts under source control.
6. Exercise affected workflows. Separate complete function contracts from small
   helpers whose unproved callers remain in scope.

Synchronize the Quint source map when a runtime kernel moves. It accounts for
state and concurrency; the LemmaScript ledger accounts for selected function
contracts. Neither count is whole-application proof.

## Alternatives and limits

Direct annotations minimize code movement but large-module dependencies can
block them. A shared verified runtime kernel avoids duplicated algorithms,
with a call-boundary review cost. Large rewrites add unnecessary risk. Detached
models can help research but do not count as production proofs.

The local OTC project provides a pinned-tool and artifact-integrity pattern.
It proves no Slop function. Slop checks its own exact sources, generated
definitions, proof obligations and tool versions. Unfinished parser, sorting,
allocation, native-contract and external-effect work remains explicit.

## Primary references

- [Supported TypeScript and semantics](https://docs.lemmascript.org/subset/)
- [Integration into an existing codebase](https://docs.lemmascript.org/getting-started/)
- [Toolchain design and trust boundary](https://docs.lemmascript.org/design/)
- [LemmaScript source and specifications](https://github.com/midspiral/LemmaScript)
- [Official Dafny 4.11.0 release](https://github.com/dafny-lang/dafny/releases/tag/v4.11.0)
