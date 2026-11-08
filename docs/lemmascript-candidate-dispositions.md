# LemmaScript candidate disposition reconciliation

Audit snapshot: `f37c44ac7ffbd4dd1fc58b2206c2a24902795ee1`, 8 November 2026.
This reconciles the master [implementation report](lemmascript-research.md),
the original [backend table](lemmascript-backend-research.md), and the
[tooling table](lemmascript-tooling-research.md). Those reports retain their
research dates; an old “candidate” row is not evidence that its later kernel
is still missing. Conversely, an implemented helper does not close every
function in its original family.

The current manifest contains **71 selected runtime contracts in 20 modules**.
The inventory records 9,591 JavaScript/TypeScript function bodies, including
callbacks, and marks 9,520 unselected bodies unproved. These are inventory
counts, not capability counts or a proof-coverage percentage. This audit
re-read the named remaining candidates; it is not a manual correctness
review of every inventoried body. Exact-head compiler receipts establish
verification results; this docs-only reconciliation does not rerun or replace
them.

**Substantial high-value pure work remains.** The categories below describe
what the source actually implements and what a future proof would have to
establish. They do not relabel unfinished algorithms as effectful merely to
claim completion.

## Implemented complete pure contracts

“Complete” here means the stated kernel contract over its documented input
domain, not its surrounding workflow. These grouped rows account for all
71 selected targets.

| Implemented family | Selected targets | Complete pure result and boundary |
| --- | ---: | --- |
| Money, complete allocation, decimal parsing, selection, aggregation, reviewer grouping and monthly replacement | 22 | Exact fees and integer operations; complete largest-remainder allocation and stable numerical order; signed bucket totals/debits; first distinct reviewers and first maximum source; complete frozen award records and ordered replacements. Native ID maps, date/locale order, schemas, JSON/hash output and authority remain caller boundaries. |
| Frontend decisions | 7 | Exact allocation-state, cache-age, transient-status, draft-retention, reminder, polling and amount-display decisions. Browser effects and provider state are not proved. |
| Fee-converter arithmetic, scalar budgets, native liability and retained expiry comparison | 16 | Exact directional arithmetic, positive budget/cap decisions, today's actual cost plus one maximum per unresolved wallet/nonce, and complete retained-history agreement. SQL ownership, finality and evidence completeness remain external. |
| Slopbot/scanner/referral scalar policy | 4 | Closure admission from supplied facts, published debit values, specialist requirement and bounded referral accrual. It does not establish the truth of membership, recorded runs, scanner coverage or funding. |
| Evidence chunk partition | 2 | Exact contiguous part counts/sizes and complete total. R2 persistence, hashes and access are external. |
| Activity delivery, intake qualification/recovery and original clean-scan reuse | 10 | Complete decisions over supplied destination/preferences, explicit intake states/clocks, and cached/original identity and reuse evidence. Current actor/role checks, provider calls, SQL flag coverage, Unicode normalization and data authenticity remain external. |
| Token-2022 TLV/metadata and base58 | 9 | Complete extension/cursor/metadata traversal; exact base58 radix, alphabet and roundtrip properties within the stated representation. Token program identity, account ownership, native-view behavior and chain truth are separate. |
| Work-unit claim partition | 1 | Every distinct available claim appears exactly once in a nonempty unit; unknown, duplicate and omitted references refuse. Exact source-ID mapping and whether GitHub accepted the source remain separate. |

The completed original candidates include first-five reviewer selection,
score/Points bucket accounting, evidence chunking, the native daily maximum
calculation, private intake gates, clean-scan reuse, complete TokenMetadata
validation, monthly record/replacement transformations and claim partition.
The individual reports document their exact preconditions and actual callers.

## Partially covered families: do not mark the whole row complete

| Original family | What is covered | What is still outside those contracts |
| --- | --- | --- |
| Payment fee and allocation lifecycle | Fees, exact allocation, frozen records and ordered amount replacements | Full event/obligation agreement, canonical receipt identity, reserve/payment transitions, owner decisions and concurrent writes |
| `NativeGasJournal` and native fee balance | Scalar limits and `reserve`'s complete daily aggregation; final expiry-history comparison | Nonce ownership, signed-attempt persistence, winner-only settlement, historical import, and the different credit/liability reduction in `D1ConversionStore.nativeFeeBalance` |
| Solana conversion | Amount math, base58, token layouts and metadata | The signed Solana transaction wire parser, account resolution, complete route validation, signature/program checks and final receipt binding |
| Monthly payment family | `freezeMonthlyAmounts`, `replaceMonthlyAllocations`, `monthlyChangePolicy` | Native recipient indexing and ordering, cutoff/date interpretation, funding/exclusion reads, consent, conditional freeze and settlement |
| Project authority/admission | Small closure/reuse decisions from supplied facts | Permission parsing and setup decisions, restriction/appeal folds, immutable registry transitions and live GitHub authority |
| Slopbot accepted work | Complete claim partition; closure/debit policy | Accepted-commit selection, exact source/merge/copy agreement, current source ownership and predecessor history, assessment quality and publication |
| Vetting review | Specialist decision, byte partitions, timeout cap and clean reuse | Complete batch construction with exact serialized byte charging, evidence acquisition and model-result consistency |
| Notification and private intake | Dispatch/qualification/recovery policy kernels | Email verification/unsubscribe lifecycle, private object access, current participants, revision compare-and-swap, provider acceptance and arrival |
| Referral program | Scalar cap intersection and shared arithmetic helpers | Referral-specific totals, recipient metadata, windows, epoch ordering and Merkle construction; activation remains deferred |
| Ingestion and release | Selected totals/order helpers and first eligible deployment maximum | Complete pagination/deduplication, complete input snapshots, runtime release authority, deployed-byte verification and publication effects |

## Remaining feasible high-value pure algorithms

These are genuine candidates, not reported defects. They require actual
production callers and complete record/sequence contracts; a new detached
model or a Boolean named `authorized` would not satisfy them.

| Priority and actual source | Useful complete contract still missing | Required boundary work |
| --- | --- | --- |
| **1. Payment evidence agreement:** `backend/payments/ledger.ts:evidenceFacts`, `indexPaymentEvent`; `chain-awards.ts:holdsAward` | Bind the complete event tuple, immutable obligation, actor, source, gross/net/fee and asset; preserve replay versus conflict and genuine historical fee compatibility | `evidenceFacts` compares JSON arrays of potentially legacy `unknown` fields. Missing/null/coercion behavior and destination absence must be preserved, or the adapter domain must be explicitly established before comparison. Keep the current validation/error order and provider/SQL operations outside the pure kernel. |
| **1. Vault counter transition:** `backend/payments/vault-snapshots.ts:storeVaultSnapshot`; `contracts/vault-totals.ts` | Complete parsed counter-vector monotonicity, asset identity and older/equal/new block decision, retaining null/unavailable current balances | The current function gives older-block refusal precedence, then checks asset and cumulative counters. A proof must preserve this ordering. Its SQL repeats monotonic guards at write time; a pure proof cannot replace that concurrency fence. |
| **1. Signed Solana wire parser:** `workers/fee-converter/solana.ts:compactLength`, `parseTransaction` | Complete legacy/v0 layout, short-vector lengths, signer header, every static key/instruction/lookup, account-index bounds, exact final cursor and refusal order | This is separate from Jupiter instruction decoding. It currently combines cursor closures, native slices, base58 conversion and throws. A tagged-result parser with reviewed native reconstruction is feasible; annotating only a length helper would not close the parser. |
| **1. Accepted-source ownership:** `workers/slopbot/value-work-unit.ts:acceptedWorkUnitCommits`, `prepareWorkUnitEvidence`; `value-work-unit-consumption.ts:readWorkUnitHistory` | Exact accepted-commit filter and complete metadata fold: source/carrier claims, current ownership, predecessor coverage, no forks, no omitted current claim and deterministic earliest credit source | Claim partition does not prove these. The history function currently combines page loading/hash checks with a Map/Set ownership fold; the fold is a substantial pure candidate after preserving exact sequence and complete records. GitHub acceptance, hash authentication and complete page acquisition remain external. |
| **1. Complete review batching:** `workers/vetting/review-plan.ts:batchParts`, `planReview`, `synthesisCall` | Every inventory item and split part appears in deterministic order, no loss/duplication, exact per-call framing and UTF-8/JSON byte bounds | `Buffer.byteLength`, string splitting/escaping and serialized framing must be modeled faithfully. Do not turn a per-call bound into a repository-size rejection. The proved timeout is not a batching proof. |
| **1. Project restriction/appeal decisions:** `backend/projects/enforcement.ts:projectRestriction`, `activeAccountBans`, `planEnforcement`, `planScanReinstatement` | Complete ordered restriction/account fold and exact permitted/refused action with independent-moderator and appeal requirements, preserving immutable history and output fields | These functions contain substantial pure policy, despite their effectful callers. Preserve record order, account versus project appeals, standing-rule distinctions and first error. The current registry and moderator identity still come from external authority. |
| **2. Native earned-fee balance:** `workers/fee-converter/store.ts:nativeFeeBalance` | Complete exact credit/debit calculation, pinned direct-fee recipient, conservative time boundary and one maximum per correct attempt key, floored at zero | EVM groups by nonce; Solana groups by reservation ID. This differs from the proved daily-budget algorithm and must not be substituted blindly. SQL determines included credits and gas rows. |
| **2. Merge/copy/binary evidence matching:** `value-evidence.ts:valueEvidenceMatchesRepository`; `value-merge-resolution.ts:mergeResolutionMatches`; `value-binary.ts:needsAddedBinaryProof`, `sameAddedBinary` | Complete repository-policy equality, parent/source/path binding, unique relocation/commit lists and exact retained proof agreement | Preserve Unicode/native name handling and schema/error order. Field equality does not prove Git reconstruction, hash truth, human-visible media or contribution value. |
| **2. Direct-payment recovery choices:** `backend/security/direct-payments.ts:verifyDirectPayment`, `recoverDirectIntent`; `security/payments.ts:prepareSecuritySettlement`; `workers/payment-executor/binding-recovery.ts:reconcileBindingWinner` | Complete typed transfer/leg agreement and recovery plan preserving paid legs, original payer, successor consent, nonce/asset/destination and exact retained limits | The functions mix real pure decisions with async observations. Extract complete record decisions after validating evidence, not an “is valid” summary. Cancellation/expiry, wallet control and atomic recovery remain effectful. |
| **2. Solana expiry traversal plan:** `workers/fee-converter/solana-expiry.ts:completeBlock`, `proveSolanaExpiry` | Complete pure step over supplied history records: expected hash, decreasing parent slot, anchor, absence of target signature, fixed horizon, bounded page and exact next cursor | The final comparison is proved; the traversal is not. Hash computation and truthful/complete finalized RPC history cannot be inferred from the result of a local step. |
| **2. Setup decisions:** `backend/projects/setup.ts:parseRepositoryAccess`, `setupAuthority`, `flaggerAuthority`, `repositoryIdentityMatches` | Complete parsed state and identity decision with retry/missing/suspended/installed distinctions and exact immutable fields | `setupAuthority` is pure even though permission acquisition is not. Native URL/regex/Unicode conversion must retain a documented boundary. The result does not authenticate a GitHub response. |

This ordering reflects the active financial and accepted-work paths, not a
promise that every item is a small change. Payment agreement/counters,
accepted-source folds, batching and project folds are the next coordinated
cohorts. Their assignment or research does not count as implementation.

## Pending Jupiter cohort

The full schema-generated Jupiter decoder is **not part of the 71-target
snapshot**. Its isolated implementation contains 35 proposed runtime
contracts: the raw unsigned reader, 29 field-shape readers, four layouts and
the dispatcher. It covers the current 239 enum constructors and preserves
the existing native byte-view adapter.

The reviewed prototype has broad baseline differentials, including all
constructors, malformed/truncated input, variable containers and nonzero
byte-offset views. The current balanced enum dispatch uses a checked tag
range followed by exact leaf selection; its specification keeps independent
exact-tag cases. Full unfiltered proof closure and exact-head integration
evidence are still pending in that cohort. Neither source generation nor a
passing differential substitutes for that proof. A later successful receipt
must update this status before calling the decoder verified.

## Inherently effectful or outside this toolchain

These boundaries remain necessary even after the pure algorithms above are
proved. This category applies to the named operation, not to every helper in
its file.

- Canonical finalized-chain observation, signature/hash verification, RPC
  history completeness, wallet possession, key custody and transaction
  broadcast. Local equality of supplied fields proves none of these.
- D1/R2/KV persistence, transaction isolation, lease execution-time fences,
  compare-and-swap revisions, replay uniqueness, crash recovery and permanent
  object retention. For example, `VALUE_PUBLICATION_FENCE_SQL` checks current
  owner/source leases and registry state in the insert itself.
- Live GitHub permission/installation reads and current repository/actor
  authority: `slopbotRepositoryAccess`, `readRepositoryAccess`,
  `repositoryControl`, `hasParticipationBan` and their writes. The pure setup
  and restriction decisions above are not moved into this category.
- Provider inference, human moderation, email acceptance/delivery, browser
  state, filesystem/network publication and deployed-byte observation.
- Solidity/Rust contracts and generated shell/Python installer execution are
  outside LemmaScript's TypeScript implementation model. Their transitions,
  operating-system behavior and cryptographic properties need their own
  verification and real workflow evidence.

## Lower, dormant and deferred items

| Item | Honest disposition |
| --- | --- |
| Referral `totalsOf`/`add`, window calculation and recipient history | Technically feasible exact grouped totals and ordered metadata retention remain. They are deferred in active-work priority; the existing scalar accrual proof does not close them or activate the program. |
| Referral Merkle tree | Tree topology, sorted leaves, duplicate refusal, odd promotion and proof-path scheduling are useful structural candidates. Keccak/ABI semantics and on-chain root authority remain separate; no full Merkle/cryptographic proof is claimed. |
| Decimal formatting, URI/command rendering and small HTTP/header classifications | Unproved pure portions remain, but generally lower priority than financial/source algorithms unless a concrete defect or required guarantee selects them. Input decimal/base58 proofs do not prove all formatters. |
| Installer/publication helpers | `canonicalPath` and manifest-shape comparisons are feasible pure pieces. Whole installation, immutable sibling activation, release authority, DNS/TLS and file durability are effectful; no small TypeScript proof closes them. |
| Anonymous wrappers and callbacks | Inventoried as bodies, not automatically independent proof projects. A proof should improve an actual required behavior, not merely reduce the unproved counter. |

## Reconciliation result

The master implemented table is consistent with substantial kernel coverage.
The dated backend/tooling candidate tables need this later disposition ledger
when read today: several original candidates have been implemented, several
have only scalar or comparison coverage, and the high-value algorithms above
are still real work. It would be inaccurate to say either “nothing remains
except effects” or “all frontend and backend functions are verified.”

This commit changes documentation only. No runtime, policy, schema, manifest,
proof inventory or selection worktree was modified. Validation consists of
source re-reading, checking the named current symbols and selected-target
count, local-link checks and `git diff --check`; application tests do not
exercise a docs-only disposition change.
