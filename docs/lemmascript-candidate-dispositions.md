# LemmaScript candidate dispositions — interim reconciliation

**Interim snapshot: 8 November 2026, `6aeeba78b069860d55757db00b3305971e8926d9`.** This replaces the older
71-target snapshot. It reconciles the original
[frontend](lemmascript-frontend-research.md),
[backend](lemmascript-backend-research.md) and
[tooling](lemmascript-tooling-research.md) research with the actual selected
modules and remaining source. The [main report](lemmascript-research.md) links
the detailed implementation reports. This ledger must be refreshed after
active cohorts and final integration checks; it is not a completion receipt.

The committed inventory records **124 selected runtime contracts in 30
modules**, **9,687** JavaScript/TypeScript function bodies and **9,563**
unselected, unproved bodies. These are accounting counts, not capability
counts or a proof-coverage percentage. They include callbacks and helpers.
Selected bodies still require the corresponding successful exact-source
compiler/prover receipt; the count alone proves nothing. This reconciliation
re-read the named candidates, not every inventoried function body.

**Useful pure work remains.** An implemented kernel closes its stated contract
and input domain, not every algorithm in its original file or family. Pure
algorithms below are not relabeled as effects to make the ledger look complete.

## Implemented selected kernels

These rows account for all 124 targets. The individual reports identify
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
| EVM direct recovery: `verified-direct-recovery` | 2 | Complete unpaid lowest-consumed-nonce selection, first tie, researcher fallback and lower-unspent blocking; original nonce text and payer-review behavior retained. Typed nonce constructors, native parsing and RPC/consent/write boundaries remain external. |
| Signed Solana wire parsing: `verified-solana-wire` | 6 | Full compact-prefix/legacy/v0/instruction/lookup parse, all spans, static program and global account-index bounds, full consumption and refusal order. No signature, RPC, table authority or deployed-program claim. |
| Accepted source selection, ownership and retained-hunk binding: `verified-source-ownership`, `verified-retained-binding` | 10 | Complete accepted-commit order and per-record retire/remove/set plan; captured-parent reachability, proper ordered hunk subset and unique attribution per omitted hunk. Native graph/Map adapters, patch parsing, source capture and final history traversal remain separate. |

The originally ranked whole-list allocation, score/Points accounting,
first-five reviewer grouping, monthly frozen/replacement records, evidence
chunking, TLV metadata, base58, review/text partition, restriction/appeal folds,
accepted-source ownership, native earned-fee reduction, local expiry step,
enforcement action/flag-scan decisions, Jupiter account/amount policy and
EVM recovery-leg selection now have production-used contracts. Their original
dated tables must not be read as a current list of missing implementations.

## Active or assigned cohorts — outside the 124-target snapshot

| Cohort | Current status at this interim update | Required completion evidence |
| --- | --- | --- |
| Full Jupiter typed Borsh decoder | Active in `slopdotcash-lemma-jupiter`; proposed 35 runtime readers/dispatcher over four layouts and all 239 enum constructors. Runtime and native-view differentials pass. Balanced runtime dispatch and independently range-partitioned defined semantics have been reviewed. Earlier filtered/interrupted/linear-spec runs do not count as full proof. | Successful **unfiltered** current-source proof, generated-source/semantics freshness, strict integrity, bounded exact-module gate configuration, actual caller tests and final integration. No full-parser closure is claimed here. |

The native earned-fee, EVM direct-recovery, Jupiter route-policy and complete
enforcement-planning cohorts are **already integrated**, not pending at this
snapshot. The corresponding [native-fee](lemmascript-native-fee-earnings.md),
[direct-recovery](lemmascript-direct-recovery.md),
[Jupiter-policy](lemmascript-jupiter-policy.md) and
[enforcement-plan](lemmascript-enforcement-plans.md) reports give their precise
contracts, accepted input domains, peer reviews and local workflow receipts.

`nativeFeeEarnings` and `nativeFeeRemainder` reuse the existing liability
algorithm; EVM nonce buckets and Solana reservation-ID buckets retain their
distinct meaning. A separate source-history follow-up is considering reuse
of the already proved ancestor traversal for the final history coverage
adapter. That has no new algorithm/count in this snapshot and is not yet
claimed complete here.

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
| `value-work-unit-consumption.ts:readWorkUnitHistory` final ancestor traversal; source collection/group preparation | Exact requested-source ancestry/coverage and complete source/claim/carrier joins | Per-record ownership is proved, not the final native graph walk or every accepted-source preparation algorithm. Paging, hash verification, schema and provider acquisition remain distinct. Reuse the captured-graph work only when actual identity adapters match. |
| `backend/security/direct-payments.ts:verifyDirectPayment`, `recoverDirectIntent`; `workers/payment-executor/binding-recovery.ts:reconcileBindingWinner`; `security/payments.ts:prepareSecuritySettlement` | Complete typed transfer/leg/result agreement and recovery output, retaining immutable paid legs, original payer, exact asset/destination and budget | These mix pure decisions with observations and writes. They must not all be labeled effectful; a useful extraction would receive validated actual records, then leave signature/RPC/consent/atomicity checks in place. |
| `backend/payments/chain-awards.ts:holdsAward`, payment/settlement joins; shared leader/Points views | Complete award/source/actor joins, no archived/open overlap and deterministic grouped output | Existing fee, allocation and bucket proofs do not prove which records belong in a join. Keep scored work, Points, payable money, held and paid states distinct. Canonical chain evidence and SQL completeness remain external. |
| `workers/fee-converter/solana-accounts.ts`, `solana-route-accounts.ts`, `solana-route-receipt.ts`; direct recovery's remaining output construction | Full loaded-account/source-destination observation joins and immutable transfer/receipt binding beyond the now-proved role/key/amount and recovery-selection policies | The pure comparison/record portions remain candidates; cryptographic account proofs, ATA derivation, parsed nonce validation, RPC finality and consent are independent. Higher risk lies at these trust boundaries, so another small equality wrapper would add less than complete record or observation-join contracts. |
| `workers/vetting/review-plan.ts:batchParts`, synthesis assembly and coverage joins; scan/provenance result reducers | Complete split-item/alias/source-to-final-evidence relation and consistent result/coverage aggregation | The text cuts, byte cost, greedy groups and reuse decisions are proved. Full JSON framing, tier/source joins, synthesis contents and provider result consistency remain unproved. Do not introduce repository-size caps or conflate model success with coverage. |
| `src/lib/global-leaderboard.ts:createGlobalLeaders`, `openMonthScores`; `payout-points.ts:payoutPointAwards`; notification/incomplete-assessment parsing | Complete identity grouping, record selection/pagination and preserved metadata/order | Monetary sums and frontend status helpers do not close whole record selection. Native dates, schema parsers, account identity and API response completeness remain explicit. These are feasible lower-priority pure work. |

These are the next tier of genuine pure work, not a claim that all functions
or all policies are proved. The selected top contracts now address complete
algorithms on the highest-risk arithmetic, signed-byte parsing, moderation
planning and ownership paths. Remaining rows need larger native-parser,
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

The 124 selected contracts, passing local workflows and Quint models do not
establish all of these facts or verify every application execution.

## Validation and refresh rule

This is a docs-only interim replacement. Validation is a check of the named
current symbols, the committed manifest/inventory counts, the detailed
reports and local links, plus `git diff --check`. Application tests do not
exercise this ledger. No runtime, policy, schema, selected-source manifest or
proof inventory is changed here.

Before final merge, refresh the snapshot SHA and counts after active commits,
record each cohort's actual proof/workflow receipt, and retain remaining pure
algorithms and native limitations. Full combined-head verification, hosted
checks, browser evidence, merge and deployment are separate results. It would
be inaccurate to say either that only effects remain or that the whole
frontend/backend is formally verified.
