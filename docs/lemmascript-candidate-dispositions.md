# LemmaScript candidate dispositions

**Application-source checkpoint: 8 November 2026, `bd4d58ef66b326a4e85b1728b972e9bf6e56fd65`.** This replaces the older
71-target snapshot. It reconciles the original
[frontend](lemmascript-frontend-research.md),
[backend](lemmascript-backend-research.md) and
[tooling](lemmascript-tooling-research.md) research with the actual selected
modules and remaining source. The [main report](lemmascript-research.md) links
the detailed implementation reports. This ledger must be refreshed after
final integration checks; it is not a combined verification receipt.

At that checkpoint, the inventory records **168 selected runtime contracts in 33
modules**. It covers **681** files and **9,793** JavaScript/TypeScript function
bodies, including **9,625** unselected, unproved bodies. These are accounting
counts, not capability counts or a proof-coverage percentage. They include callbacks and helpers.
The integrated cohorts pass a complete local and hosted compiler/prover run
with 23,995 obligations; the count alone proves nothing. The
[validation record](lemmascript-validation.md) gives the exact receipts,
browser corrections and remaining final-branch gates. The parallel Quint inventory contains 302
models mapped to 836 sources; those model counts are not implementation proofs.
This reconciliation re-read the named candidates, not every inventoried function body.

After rebasing onto development `5d8b2402e070ec6cc6adf069e5e4f68ce41fcd96`,
the regenerated inventory contains **683 files, 9,813 function bodies and 9,645
unproved bodies**, with the same **168 contracts in 33 modules**. The state
inventory contains **308 models mapped to 838 sources**. These are current
scope counts; the completed proof and browser results above retain their
recorded checkpoint and do not certify the rebased tree.

**Useful pure work remains.** An implemented kernel closes its stated contract
and input domain, not every algorithm in its original file or family. Pure
algorithms below are not relabeled as effects to make the ledger look complete.

## Implemented selected kernels

These rows account for all 168 targets. The individual reports identify
actual callers, assumptions, proof results, differential/workflow evidence
and native adapter costs. Final combined-head checks remain separate.

| Family and selected modules | Targets | Complete result and explicit limit |
| --- | ---: | --- |
| Money, allocation, decimals, numerical selection, signed aggregation, reviewers and monthly replacement: `verified-money`, `verified-allocation`, `verified-decimal`, `verified-selection`, `verified-aggregation`, `verified-reviewers`, `verified-monthly-replacement` | 22 | Exact fees, sums and complete largest-remainder allocation; signed bucket consumption; first occurrence/highest-band reviewer selection; full frozen award records and ordered replacements. Native identity maps, chronology/locale sorting, JSON/hash output and authority remain boundaries. |
| Frontend decisions: `verified-frontend` | 7 | Exact allocation state, cache age, transient status, draft retention, reminder, polling and amount-display decisions. Browser effects, storage, source identity and provider state are not proved. |
| Fee-converter arithmetic, budgets, native earnings/liability and expiry: `verified-arithmetic`, `verified-budget`, `verified-native-liability`, `verified-expiry` | 20 | Exact amount/cap arithmetic; complete daily maximum-per-bucket liability; complete earned native-fee credit/debit and remainder; retained expiry agreement and full local traversal step. Actual SQL selection, native key mapping, RPC completeness and finality remain separate. |
| Slopbot/scanner/referral scalar policy: `workers/verified-policy` | 4 | Complete closure/debit/specialist/cap decisions from supplied fields. This does not prove the membership, run, scanner or funding evidence that supplies them. |
| Evidence chunk partition: `verified-partition` | 2 | Complete contiguous chunk count, offsets and final size. Content hashes, R2 storage and access control remain external. |
| Notification, intake and original scan reuse: `verified-delivery`, `verified-intake`, `verified-reuse` | 10 | Complete dispatch/qualification/recovery and retained source/evidence decisions. Current participants, native Unicode/date processing, SQL revisions, provider acceptance and evidence authenticity remain outside these contracts. |
| Token-2022 TLV/metadata and base58: `verified-token-extensions`, `verified-base58` | 9 | Complete bounded extension/metadata traversal; radix/alphabet/leading-zero and roundtrip composition. Native views and wrappers are reviewed/differentially checked; cryptographic and account/program authority are not proved. |
| Work-unit claim partition: `verified-work-unit` | 1 | All available distinct claims occur exactly once in nonempty units; unknown, duplicate or omitted references refuse. Native source-ID mapping and GitHub acceptance remain separate. |
| Payment evidence and cumulative counters: `verified-evidence` | 6 | Complete normalized fact/asset/obligation agreement, paid-replay precedence, older-block/asset decision and first decreased counter. Native JSON/coercion, receipt observation and transactional uniqueness remain separate. |
| Review batches and text partition: `verified-review-batches`, `verified-text-parts` | 5 | Exact quoted-string byte cost, longest alias prefix, complete greedy spans/group indices and complete newline/continuation byte cuts. Native object serialization, UTF-8 conversion, source order and provider review quality remain external. |
| Restrictions, appeals and setup: `verified-enforcement`, `verified-setup` | 16 | Complete restriction/active-ban/appeal folds, six-action refusal/result planning and flag-only scan decision; access-header and setup/flagger state/message. Native revision schema validation, original lazy identity comparison, authority acquisition and persistence remain external. |
| Jupiter route policy: `verified-jupiter-policy` | 4 | Complete first invalid role/privilege, last-name binding, first account-binding refusal and amount/slippage/fee agreement. Canonical nonempty key/header domains come from existing parser/account checks; native ATA/signature/RPC semantics remain external. |
| Full Jupiter typed Borsh decoder: `verified-jupiter-wire` | 35 | Complete four-layout decoding, all 239 enum constructors, typed values, cursor/node/depth limits, ordered collection prefixes and malformed-input refusals. Native byte-view materialization, generator/compiler translation and deployed-program/crypto/RPC truth remain separate. |
| EVM direct recovery: `verified-direct-recovery` | 2 | Complete unpaid lowest-consumed-nonce selection, first tie, researcher fallback and lower-unspent blocking; original nonce text and payer-review behavior retained. Typed nonce constructors, native parsing and RPC/consent/write boundaries remain external. |
| Signed Solana wire parsing: `verified-solana-wire` | 6 | Full compact-prefix/legacy/v0/instruction/lookup parse, all spans, static program and global account-index bounds, full consumption and refusal order. No signature, RPC, table authority or deployed-program claim. |
| Accepted source selection, ownership and retained-hunk binding: `verified-source-ownership`, `verified-retained-binding` | 10 | Complete accepted-commit order and per-record retire/remove/set plan; captured-parent reachability, proper ordered hunk subset and unique attribution per omitted hunk. The same reachability kernel now checks final local work-unit history coverage. Native graph/Map adapters, returned-flag interpretation, patch parsing, source capture and page/hash/schema validation remain separate. |
| Finalized Solana route balance joins: `verified-route-credit` | 4 | Complete account-index first match, token identity/presence/delta, ordered source/destination debit/minimum-credit check and first unrelated holding debit. Native exact identity mapping, receipt acquisition, signatures, ATA derivation and native rent/fee observations remain separate. |
| Global leaderboard and payout sources: `verified-global-joins` | 5 | Complete ordered actor links, first-cycle/last-event-or-view metadata, distinct project/month membership, archive anti-join and full paid-recipient selection. Native IDs, dates, schema, output sort and original Number arithmetic remain separate. |

The originally ranked whole-list allocation, score/Points accounting,
first-five reviewer grouping, monthly frozen/replacement records, evidence
chunking, TLV metadata, base58, review/text partition, restriction/appeal folds,
accepted-source ownership, native earned-fee reduction, local expiry step,
enforcement action/flag-scan decisions, full Jupiter typed decoding,
Jupiter account/amount policy, EVM recovery-leg selection, finalized token-balance
joins and global leader/payout source selection now have production-used contracts. The final
local work-unit ancestry check also reuses the already proved traversal. Their
original dated tables must not be read as a current list of missing
implementations.

## Selected cohorts complete; final integration pending

No selected implementation cohort remains active at this snapshot. The full
33-module run passes all 168 selected functions and 23,995 obligations. Before
that combined run, the standalone Jupiter decoder passed an **unfiltered
15,551-obligation check with zero errors**
in **1,135.748 seconds**, covering all 35 selected production functions and their
defined helpers. Runtime, generated semantics and proof input hashes remained
unchanged. Earlier interrupted or filtered runs are historical evidence only.

The integrated checker runs generator freshness inside its captured source
snapshot, including `.gitignore` and `biome.json`. The exact Jupiter generated
module alone receives a 3,600-second aggregate command cap; other modules retain
180 seconds. Every module retains the 30-second per-obligation limit, unfiltered
assertions and source/proof integrity checks. The CI job allows 80 minutes for
the complete set and setup. Valid-generation and stale-generation smoke checks
pass and fail closed respectively. Neither the standalone parser result nor
the combined computation proof replaces a complete repository `verify`,
browser evidence, or checks on a later rebased source head.

The native earned-fee, EVM direct-recovery, Jupiter route-policy, complete
enforcement-planning, full Jupiter decoder, finalized route-credit, global-join
and local history-coverage cohorts are **already integrated**, not pending at this
snapshot. The corresponding [native-fee](lemmascript-native-fee-earnings.md),
[direct-recovery](lemmascript-direct-recovery.md),
[Jupiter-policy](lemmascript-jupiter-policy.md),
[Jupiter-decoder](lemmascript-jupiter-research.md),
[enforcement-plan](lemmascript-enforcement-plans.md),
[route-credit](lemmascript-route-credit.md), [global-join](lemmascript-global-joins.md)
and [history-coverage](lemmascript-history-coverage.md) reports give their precise
contracts, accepted input domains, peer reviews and local workflow receipts.

`nativeFeeEarnings` and `nativeFeeRemainder` reuse the existing liability
algorithm; EVM nonce buckets and Solana reservation-ID buckets retain their
distinct meaning. `readWorkUnitHistory` now calls `retainedAncestors` for its
final local coverage check. Known digests retain their dense indices; unknown
nonempty predecessors remain explicit vertices so a reachable missing ancestor
cannot become shorter successful history. This reuses the existing proved
algorithm and adds no target. Native digest mapping, returned-flag error
interpretation, schema, paging and hash observations remain outside its theorem.

## Remaining substantive pure candidates

These are genuine remaining algorithms, not reported defects or automatic
feature approval. Select a coherent production-used contract and preserve
accepted inputs, ordering, refusal precedence and source identity. A detached
model, a scalar restatement or an untrusted Boolean called `authorized` would
not close them.

| Source and candidate | Useful contract still absent | Boundary that must remain explicit |
| --- | --- | --- |
| `workers/slopbot/value-retained-copy.ts:sameAuthorReopen`, `retainedEditIdentity`, `changedHunks`, `alreadyAcceptedPromotion`; `value-manifest-identity.ts:exactJsonIdentity` | Complete ordered commit/file comparison, hunk parsing, duplicate-key/numeric-token-preserving JSON identity and exact promotion/reopen agreement | The retained-hunk graph/subset/binding result is proved; native regex/patch parsing and these other algorithms are not. A full JSON syntax/token contract is larger than a field-equality helper. Preserve byte/rename/binary/manifest cases and original source objects. |
| `workers/slopbot/value-merge-resolution.ts:mergeResolutionMatches`; `value-binary.ts:needsAddedBinaryProof`, `sameAddedBinary`; `value-evidence.ts:valueEvidenceMatchesRepository` | Complete parent/source/path and optional relocation comparison, duplicate-free ordered lists, exact binary proof fields and repository-policy matching | These comparisons remain pure candidates even though Git reconstruction, blob hashes, human media review and live GitHub authority are external. Preserve native regex/Unicode and missing-field semantics. |
| `workers/slopbot/value-work-unit.ts:prepareWorkUnitEvidence`; `value-work-unit-consumption.ts:consumeWorkUnitHistory` source collection/group preparation | Complete source/claim/carrier joins, imported path and commit identity selection, and assembly of accepted evidence records | Accepted-commit selection, claim partition, per-record ownership and the final local ancestry traversal are already covered. These other preparation joins remain native; preserve source objects, ordering, digest checks and provider boundaries. |
| `backend/security/direct-payments.ts:verifyDirectPayment`, `recoverDirectIntent`; `workers/payment-executor/binding-recovery.ts:reconcileBindingWinner`; `backend/security/payments.ts:prepareSecuritySettlement` | Complete typed transfer/leg/result agreement and recovery output, retaining immutable paid legs, original payer, exact asset/destination and budget | These mix pure decisions with observations and writes. They must not all be labeled effectful; a useful extraction would receive validated actual records, then leave signature/RPC/consent/atomicity checks in place. |
| `backend/payments/chain-awards.ts:holdsAward`, other payment/settlement joins; `scripts/generate-points.ts:pointsSummary` and `src/lib/points-summary.ts:isPointsSummary` | Complete remaining award/source/actor agreement, summary accumulation/validation and deterministic publication records | The global actor grouping, archived/open source selection and payout recipient selection are now covered. Existing amount proofs do not prove these different source relations or exact Number summary totals. Keep scored work, Points, payable money, held and paid states distinct; canonical chain evidence and SQL completeness remain external. |
| `workers/fee-converter/solana-accounts.ts:verifySolanaAccountProof`, `associatedAccountCreations`; `solana-route-accounts.ts:accountState`, `assertSolanaRouteSimulation`; direct recovery's remaining output construction | Full retained table/account agreement, associated-account instruction selection and simulation record constraints beyond the proved token-balance join | `finalizedRouteCredit` now uses complete token identity/presence/delta, exact input/minimum output and unrelated-holding contracts. These other pure comparison/record portions remain candidates. Cryptographic account truth, native ATA derivation, parsed nonce validation, RPC finality and consent are independent; a scalar equality wrapper would not close these larger relations. |
| `workers/vetting/review-plan.ts:batchParts`, synthesis assembly and coverage joins; scan/provenance result reducers | Complete split-item/alias/source-to-final-evidence relation and consistent result/coverage aggregation | The text cuts, byte cost, greedy groups and reuse decisions are proved. Full JSON framing, tier/source joins, synthesis contents and provider result consistency remain unproved. Do not introduce repository-size caps or conflate model success with coverage. |
| `workers/notify/handler.ts:parseNotice`, `encodeQuotedPrintable`, `buildNoticeMime`; `workers/vetting/assembly-manifest.ts:assemblyAssessment` | Complete typed notice/assessment parsing, MIME encoding and retained record assembly | Notification delivery decisions and global/archive/payout source selection are already covered. These parsers/encoders remain feasible lower-priority pure work; preserve native Unicode/Date behavior, exact headers, schema/refusal order and private-data boundaries. |

These are the next tier of genuine pure work, not a claim that all functions
or all policies are proved. The selected top contracts now address complete
algorithms on the highest-risk arithmetic, signed-byte parsing, moderation
planning, ownership, complete token-balance reconciliation and global source-join
paths. Remaining rows need larger native-parser,
record-join or acquisition-adapter arguments, or have lower marginal risk
than those completed contracts. They remain feasible work; priority is not
reclassified as an effect or tool impossibility.

This table intentionally retains pure work in files with async or storage
callers. It does not assert that every named large function is directly
extractable unchanged, or that completing its local decision proves its full
workflow.

## Rejected unsound extraction: repository identity coercion

`backend/projects/setup.ts:repositoryIdentityMatches` remains byte-for-byte
native. Eagerly computing its `String(...)`/lowercase projections was shown to
change behavior on ordinary JSON: an already mismatching repository ID with
an owner-login object containing a non-callable `toString` returns false in
the original short-circuit expression, but throws in the eager projection.
The attempted equality kernel was removed before integration. The
[setup report](lemmascript-setup-research.md) records the counterexample.

A sound future extraction needs a faithful native coercion/exception model
and short-circuit sequencing, or an independently justified input restriction.
It must not add defensive guards, silently narrow supported data, or call a
six-field equality wrapper proof of this expression. Native URL, regex and
Unicode behavior are likewise not proved by relabeling their output.

## Lower-priority or dormant pure work

| Source family | Honest disposition |
| --- | --- |
| Referral `totalsOf`/`add`, `periodBounds`/`nextPeriod`/`windowEnd`, recipient/epoch metadata | Exact grouped totals, last-login retention, date-window interpretation and ordered claim selection remain technically feasible. The scalar cap proof does not close them. The program's deferred activation remains unchanged. |
| Referral `merkle.ts:buildTree`/`verifyProof` | Sorted leaf identity, duplicate refusal, odd-node promotion and complete proof-path structure are useful structural contracts. Keccak/ABI semantics and on-chain root authority remain external; no full Merkle proof is claimed. |
| Decimal/Intl formatting, URI/command builders, HTTP/header classifications | Pure portions remain unproved and can be selected for a concrete guarantee. Decimal/base58 input proofs do not prove every formatter, redirect policy or rendered shell command. |
| Installer/publication `canonicalPath`, manifest comparison and pagination/deduplication | Exact canonical-path and inventory algorithms remain feasible. Whole installation, immutable symlink activation, release authority, filesystem durability, deployed bytes and DNS/TLS need separate execution/effect evidence. |
| Source/profile/activity ordering, asset/network and funding selection | Existing arithmetic proves amounts, not every recipient/currency/record selection. Preserve native identity and ordering rather than replacing them with assumed membership flags. |
| Anonymous wrappers/callbacks and presentation helpers | Their unproved inventory entries are not automatically independent proof projects. Prioritize real required behavior rather than reducing the numerical inventory count. |

## Inherently external/effectful boundaries

This category applies to the named operation, not every helper in its file:

- Canonical chain observation, signature/hash truth, complete finalized RPC
  history, actual wallet control, signing and broadcast.
- D1/R2/KV writes and transaction isolation, current lease/revision fences,
  uniqueness, crash recovery and permanent private-object retention.
- Live GitHub installation/permission/actor/repository acquisition and human
  moderation. The setup and enforcement *decisions* remain pure and have the
  distinct coverage described above.
- Provider inference and qualification, notification delivery, browser/storage
  execution, operating-system publication and deployed-byte observation.
- Rust/Solidity contracts and generated shell/Python execution, which are
  outside this TypeScript toolchain even where other formal tools apply.

The 168 selected contracts, passing local workflows and Quint models do not
establish all of these facts or verify every application execution.

## Validation and refresh rule

This is a scope ledger. Its validation checks the named
current symbols, the committed manifest/inventory counts, the detailed
reports and local links, plus `git diff --check`. Application tests do not
exercise this ledger. No runtime, policy, schema, selected-source manifest or
proof inventory is changed here.

Before final acceptance, refresh the snapshot SHA and counts after new commits,
record each cohort's actual proof/workflow receipt, and retain remaining pure
algorithms and native limitations. Full combined-head verification, hosted
checks, browser evidence, merge and deployment are separate results. It would
be inaccurate to say either that only effects remain or that the whole
frontend/backend is formally verified.
