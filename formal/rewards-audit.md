# Money, Points and settlement state review

## Authoritative target and policy

This review started from `origin/development` commit `e3d7dea64` in the separate
`slopdotcash-quint` worktree. It does not use the old application's 1% fee,
14-day public allocation review, compulsory receipt or operator-free signer
assumptions. The current PRD permits narrowly scoped attester and fee-service
keys, optional receipts, the 2% rounded-up ordinary fee, the 75/25 private
bounty split, monthly freeze 72 hours after close and immediate destination
binding. Referrals remain off pending separate approval. No live key, network
mode, contract or operator setting was changed by this review.

## State families implemented

The money and assigned operational review currently contains 77 finite model families and 285 named
scenarios. Each model includes explicit `@source` links. These links identify the source
of the modeled contract; they do not assert that every method in a linked file
has been proved to refine that model.

| Model | Reviewed transitions | Principal properties and finite scope |
| --- | --- | --- |
| `escrow_balances` | Deposit, reserve, pay, unused withdrawal, fee claim | Conserves deposited base units across free/reserved/paid/withdrawn/fee balances; reserve cannot be withdrawn; one-unit ordinary award can be all fee; native rent stays separate. One award, six deposited units, gross 1–4. |
| `monthly_reserve` | Full-month admission, leaf materialization, payout, later opt-out/window close | Admission reserves the whole remaining month; leaf consumption is unique; funded leaves survive later opt-out; no second charge to free funds. Two leaves, four gross units. |
| `monthly_coordinator` | Read current project, cutoff, opt-out, pause/revision race, freeze, deposit, funding-time exclusion, obligation creation | Stale project/settings read cannot freeze; underfunding creates no obligations; later ban does not erase funded awards. One project/month and one representative award. |
| `monthly_release` | Inspect retained wrong-total reserve, authorize, owner release, reject partly materialized reserve | Requires current owner, fresh evidence, matching root, wrong total and untouched reserve; only the whole reserve returns to free balance. Four units. This is the service policy, stricter than the generic on-chain primitive. |
| `payment_binding` | Wallet consent, authenticated authority, versioned replacement, cancellation, current-binding payment | Old versions cannot pay; consent and authority are separate; a valid current production binding can pay immediately. Two wallets and three versions. Review-window/cancel-count policy is not fully modeled. |
| `payment_dispatch` | Acquire/reacquire expired lease, fenced preparation, uncertain submit, retry, conflicting late response, wallet change, finalization | Stable idempotency key; stale worker cannot create a second attempt; conflicting transaction cannot replace stored identity; paid requires evidence. Two workers, two retry generations and transaction representatives; a stale failure lookup cannot reopen a submitted successor. |
| `signed_send` | Sign/journal, send/resend, bounded replacement, original or replacement winner, finalized revert | Bytes must be journaled before broadcast; one nonce; original can still win; at most one canonical winner. Two replacements, bounded gas. |
| `native_budget` | Native reserve, durable signature, unsigned abandonment, midnight, finalized actual cost | Unknown liability remains held across midnight; only unsigned reservation can be abandoned without evidence; finalized cost replaces reserve and uses settlement day. One send, two days, budget four. |
| `fee_conversion` | Off/dry/live, network lease, quote/no route, journal, send, finality, lease expiry | Dry run never signs, expired lease cannot sign/send, proceeds remain in fee wallet, Robinhood cannot convert. One route/send. |
| `fee_lease_journal` | Lease takeover, gas-revision compare-and-swap, sign, atomic journal, broadcast, replacement, delayed receipt and next-day settlement | Two runs share one nonce group. A successor may recover unsigned reservations but preserves signed liabilities; same-nonce attempts reserve their maximum once; only the current lease settles canonical final cost. Two attempts, ticks 0–3, maximum 3 and daily budget 4. |
| `fee_nonce_reuse` | Expired swap, next intent on the still-free nonce, missing winner evidence, canonical late winner and group settlement | Up to three distinct intents; approvals/claims do not expire as swaps do; nonce advancement without receipt holds the send; only one canonical winner gets actual gas cost. |
| `fee_wallet_handoff` | Configure wallet/key, load signer, hold mismatched historical row, restore original configuration, recover receipt | Changing configuration cannot reinterpret the immutable recipient or close a send with missing evidence. Two wallet identities and one retained send. |
| `fee_quote_policy` | Quote evaluation and ready/pending/skipped outcomes | Run/day room, known price, dust, gas multiple, price impact and slippage all gate readiness. Exhaustive Boolean input representatives. |
| `solana_expiry` | Two-provider observations and release of uncertain native reserve | Both independent providers require expired blockhash, no full-history transaction/signature and retained history coverage. Missing/disagreeing evidence holds funds. |
| `referral_accrual` | Off/dry/live, acquire lease, classify/deduplicate payout, capped accrual, atomic monthly filing and wallet pin | Off cannot file; one payout counted once; held/ineligible payout has no accrual; cap respected. One month, three payout IDs, two-unit cap. Twelve-month date arithmetic and multi-month atomic sequencing remain implementation checks. |
| `referral_posting` | Prepare, journal, uncertain broadcast, same-byte retry, finality recheck, failed epoch retry, owner void and acknowledgement | No broadcast before durable bytes; one open post blocks the next; a voided epoch stays occupied, halts until acknowledgement and never rolls back a prior claim. Two signatures, periods and epochs. Gas arithmetic and activation policy are separate models. |
| `referral_distribution` | Post cumulative root, immediate claim, void before claim, pause/unpause | No duplicate cumulative claim; successful claim seals latest root; pause prevents claim; total token balance conserved. Two epochs, one claimant, four units. Merkle verification, spacing and rescue timer are external predicates/gaps. |
| `bounty_payment` | Approve, verify wallet, prepare, researcher and fee-leg finality, completion, prepayment successor | Partial evidence is not paid; no preparation after full payment. One intent, two legs; actual direct-payment cancellation and supersession nonces need further refinement. |
| `points_journal` | Earn, append debit/reversal, freeze award, payment-recognition credit | Monthly debit never makes accepted-work Points negative; recognition is separate; later debit cannot change funded award. Four journal revisions. |
| `monthly_allocation` | Integer floor allocation and largest-remainder distribution | Sum is exact and stable ties go to earlier actor. Two positive weights, total 0–5, weights 1–3. Zero-weight, many-actor and legacy allocation variants remain implementation checks. |
| `allocation_funding` | Pledge/verified funding observation and projected allocation | Pledge produces zero funded allocation, projection never exceeds committed amount or monthly cap. Five units and cap three. |
| `direct_payment_recovery` | Original payer, successor wallet consent, retained retirement evidence, lower-nonce ordering and generation compare-and-swap | No successor without finalized retirement; ambiguous absence cannot create a new payable request. Two generations. |
| `chain_evidence` | Network/asset identity, canonical receipt, success, exact deltas and finality | Acceptance requires every predicate independently; pending or incomplete evidence is not paid. Boolean boundary abstraction, not a proof of adapter cryptography. |
| `ordinary_fee` | Ordinary fee computation and splitting | ceil(gross/50), net never negative, splitting cannot lower aggregate fees, and floor/ceiling compatibility is distinguished. Inputs 1–100, total up to 200. |
| `contributor_allocation` | Pre-deadline wallet registration, replacement, batch close and sender-recorded transfer | Registration time survives replacement; closed unsent rows are unclaimed; Sent remains separate from on-chain verification. Four finite states. |
| `historical_reward` | Archived proposal, wallet replacement, held/minimum/lapsed review, finalization | A replacement clears the prior row approval and restarts review; lapsed/empty decisions cannot finalize. Historical protocol only. |
| `funding_routes` | Receiving-address interval replacement | Old intervals remain and cannot overlap current routing. Two addresses and four clock values. |
| `token_admission` | Classic SPL and Token-2022 mint/account eligibility | Classic authorities retain compatibility; Token-2022 admits only authority-free approved metadata extensions with matching mint. Byte layouts are abstract predicates. |
| `operator_keeper` | Coalesced ticks, Off/dry/execute, journal, restart and finality | Multiple requests cannot create a second journaled send; restart preserves pending native liabilities. One send, three requests. |
| `monthly_execution_recovery` | New execution generation, old/new attempt admission and late opt-out | Every retained attempt binds the same frozen root; admitted leaves survive opt-out. Two attempts. |
| `authority_rotation` | Propose, independent Solana confirm, wait, cancel, execute; journal/deliver/reconcile a binding across EVM authority replacement | Existing bindings and funded awards remain unchanged; old-key signed bytes can revert after rotation and require canonical finality before retirement. Solana needs confirmation and delay; EVM uses its actual zero-delay policy. Two keys and two binding versions. Upgrade authority has a separate root model. |
| `binding_cancellation` | Expired/superseded binding, EOA and gas checks, cancellation journal, original/cancel winner | Cancellation is a same-nonce zero-value empty-data self-send; original success and cancellation cannot both win. One nonce, two candidates. |
| `solana_owner_action` | Review deposit/commit/withdraw, confirm owner, sign, finalize | Deposit permission differs from owner actions; reviewed deployment/asset/funds must match before signing. One action and bounded amounts. |
| `vault_creation` | Inspect deterministic address, reuse matching deployment, sign/create, register finalized result | Conflicting accounts refuse; matching existing vault needs no new signature; registry cannot claim a pending create finalized. One target address. |
| `solana_route` | Load lookup/account evidence, check programs/signers/destination/bounds, sign, reconcile output | All review predicates must hold before signing; receipt is a separate exact-delta predicate. Boolean abstraction of byte-level validators. |
| `monthly_source_conflict` | Compare retained actor/gross/fee, qualify EVM/Solana funding | Same source digest cannot disguise different obligations; an existing EVM award and a full Solana month have distinct funding rules. One source and one award. |
| `payment_history` | Freeze page boundary, append later rows, page public history | Later inserts do not change the cursor boundary; private rows do not enter public history. Four rows and one fixed cursor. |
| `referral_claim_cache` | Activate, fetch verified root, refresh failure, serve stale/current state | Failed refresh preserves prior verified amount without calling it current; stale data cannot authorize a claim. One claimant/root. |
| `fee_schema_upgrade` | Rebuild five fee tables while preserving existing rows | Unknown signed bytes and finalized identity/amount remain unchanged; new kind defaults to conversion. Two representative rows and five schema versions. |
| `payment_worker_run` | Off/dry/execute, configuration/role gate, independent network runs, report | A failed first network cannot prevent the second network from completing; report waits for both outcomes. Two networks. |
| `source_import` | Read complete parts, validate, publish, disclose, compare immutable identity | Partial input cannot publish; disclosure is not chain verification; conflicting identity cannot be reimported. Two representative parts. |
| `chain_range_scan` | Read inclusive pages, fail, retry, publish completed range | Failure cannot advance the range or fabricate completion. Six blocks, three pages. |
| `bounty_terms` | Revise draft/pending/open/paused/closed program terms | Open prefunded programs require funding; after-approval programs may be pledges; revisions cannot remove existing program or rewrite frozen awards. One program/award. |
| `escrow_policy_history` | Set unfunded chain, deploy, upgrade, append prior implementation, change off-chain limit | Deployment prevents chain/removal change; fee remains fixed; each upgrade retains outgoing review. Three implementation representatives, at most two upgrades. |
| `solana_scan_checkpoint` | Discover backwards, process oldest first, capture two workers, verify, checkpoint, restart | Transaction cursor/page/revision move together; stale worker cannot rewind; later signatures remain outside the frozen interval. Four signatures, two pages, two workers. |
| `evm_scan_checkpoint` | Capture overlapping pages, verify, commit, fail/retry | Late old page completion cannot rewind finalized coverage; failed page does not advance it. Six blocks, two workers. |
| `legacy_score_caps` | Pre-August diminishing merge credit, category caps and actor/project/UTC-month bucket reset | First twelve exact merge awards, fixed category award representatives and at most twelve considered outcomes. Real snapshot conformance covers seven merges and newest five material-test awards across four independent buckets and reordered input. |
| `review_credit` | Ingest review sources in arbitrary order, deduplicate, select first five actors and highest bands | Repeated reviews do not add weight; source identity repeats refuse; sixth actor receives no share; minimum pool remains one third. Seven fixed reviews, six actors, assessed size 0–5. |
| `historical_disclosure` | Verify frozen source, reproduce observed rows, record wallet anomaly, validate aggregate publication | Legacy half-up rounding may explicitly disclose over-cap totals; duplicate signatures/actors and silent wallet changes refuse. No chain finality is asserted. Two rows, cap three base units. |
| `source_replay` | Pin input digests, replay seven times, compare result digest, report timing | Nondeterministic output fails; first warm-up is omitted from six measured samples. Seven replays, two digest representatives. |
| `earned_fee_history` | Receive, verify fee credit, replace public offer, retain historical asset, debit native cost | Topups are not income; EVM replacements debit maximum per nonce, Solana sends debit separately. Two gas entries and four fee units. |
| `effective_wallet_history` | Register successive wallet intents, authorize current claim, derive effective wallet | Unapproved replacements retain the prior authorized payout destination; historical authorizations stay present. Three claims in one actor/chain lineage. |
| `binding_consent_renewal` | Issue/store consent, expire, renew, select latest expiry, bind current version | Renewal appends evidence instead of overwriting an old row; expired or wrong-version consent cannot bind. Two versions, three clock ticks, expiry 1–5. |
| `referrer_attribution` | Resolve eligible referral, submit application, approve, reject later mutation | Signed-in/non-conflicted referrer is copied once; an absent referral cannot be added later; attribution alone is not paid. One application and two identity representatives. |
| `evm_owner_action` | Review account/free funds, reset/approve token allowance, reread allowance, send, check exact finalized transaction | Approval alone is never funding; a wallet change refuses sending; reserved funds cannot be withdrawn. Gross two, two allowance values. |
| `reward_metadata` | Identify chain, read token decimals, classify temporary failure, keep optional symbol, publish | Wrong chain cannot supply verified metadata; unavailable RPC asks for retry; native metadata needs no RPC. Two attempts and three symbol states. |
| `transaction_balance_proof` | Read per-transaction witness, reconstruct token state, verify exact payer/recipient changes | Whole-block balances cannot replace transaction evidence; every token read must be covered; native debit includes gas. One payment, amount two, gas one. |
| `referral_claim_review` | Read current claim/root/account/code, simulate, recheck before send, handle missing hash | Stale root, changed amount or changed wallet refuses sending; unknown sends do not retry automatically. Two roots, one claim. |
| `staging_attester_release` | Check all secret names, pin config bytes, deploy and verify each source, attach Pages bindings | No deployment before every inventory matches; a partial or mismatched release attaches no bindings. Two services. |
| `fresh_stack_admission` | Validate isolated test names/account, inspect absence, admit | Existing service or ambiguous provider response cannot authorize a fresh deployment. Three names. |
| `inactive_attester` | Exercise generated disabled signing routes and accidental cron | Refuses all seven routes and cron without any signer/RPC read or outbound request. |
| `test_balance_observation` | Validate test network, verify identity, read exact finalized balance, report | Zero is a valid observation; wrong identity or imprecise numbers refuse. No signing authority. |
| `local_security_checks` | Start at most two local checks, continue after failure, report after all finish | No failed child is masked and no unfinished task is treated as passed. Three representative tasks. |
| `test_contract_deployment` | Check test chain and roles, build/deploy, verify Solana ELF bytes, emit outcome | Solana requires clean reviewed source and exact dump prefix; the EVM script emits without an independent byte comparison. |
| `contract_build_profile` | Select default/local test feature, build pinned profile | Pinned dependencies, compiler and overflow checks remain selected; local delay feature is distinguished from default output. |
| `unsafe_destination_history` | Verify signed report, hold original destination, append/carry historical evidence | Report alone cannot hold; accepted history and zero approval remain fixed across later cycles. Archived protocol only. |
| `prior_cycle_carry` | Select as-of approved/proposal history, classify unpaid shared-pool carry | Future approval is not current evidence; approved payouts stay in their original cycle; lapsed/unsafe history survives. Archived protocol only. |
| `source_correction_preview` | Validate immutable inputs/new source, recover known actor review, create-only preview | Fixed pool conservation, no replay, no active-preparation change or payment authority; published cycles refuse the CLI. |
| `payout_readiness` | Compare signer pins/registry DB, inspect reviewed execution setting, probe network, require readiness | Configured URL is distinct from proof; an enforced network needs an exact finalized head and matching chain. |
| `evaluated_award_import` | Validate bounded reviewed award and unique ID/work/content | No duplicated source credit; score is not payment authority. Two representative awards, up to eight Points each. |
| `artifact_transport` | Follow bounded trusted redirects, scope credentials, retry transient result, preserve terminal verdict | CDN receives no GitHub bearer; incomplete documents refuse; a partial media observation has no full-content digest. Parser correctness is outside this model. |
| `git_file_recovery` | Verify immutable two-parent merge, unique base, matching raw changes, complete streamed numstat | No source checkout or execution; partial/duplicate files cannot publish a complete recovery. Two paths. |
| `readme_proof_binding` | Match exact actor-keyed prior proof or legacy pin | A reused login or changed wallet bytes cannot create authority. Two actor/proof representatives. |
| `solana_receipt_confirmation` | Poll exact receipt, check blockheight, reread before expiry, abort | A late receipt wins the expiry race; a failed transaction still has a confirmed receipt; caller abort never authorizes a resend. Test-support connection only. |
| `solana_fixture_config` | Construct genesis metadata, initialize or reuse Config, confirm and reread roles | Program executable and ProgramData non-executable flags are distinct; existing wrong fixture roles refuse. Public fixture keys only. |
| `solana_preload_cases` | Build and write legacy, expired-month, short-vault and Token-2022 byte fixtures | Deliberately unreachable states remain explicitly synthetic; fixture generation does not establish production reachability. |
| `native_fee_fixture` | Initialize local project, deposit, withdraw to accrue fees, let converter claim | Fee claim preserves remaining principal; fixture network labels do not prove mainnet execution. Gross 100, two fee units. |

## Source and action inventory

`money-source-inventory.json` contains the selected financial source boundary:
267 production/configuration/migration/contributor/test-support files, 243 with partial model links,
24 reviewed stateless helpers and 0 pending source mappings.
The `*-stateless.json` review maps give a source-specific reason for each pure helper.
The source index also lists lexical function candidates and source digests to
navigate the remaining review. Those candidates are not an AST completeness
claim. Generated, vendor, compiled, ordinary test cases and declaration files are excluded;
the seven explicitly assigned executable Solana test-support files are listed separately.
The selected source index has no unmapped file; each mapping is still partial.
Separate contributor-tool findings are in `contributor-tools-audit.md`. Broader scoring sources, including the full leaderboard
producer, are outside this selected index and remain in the global census. The
index deliberately does not assign
an unrelated generic model to eliminate a pending count.

Partial links do not remove the following outstanding semantic-refinement work:

- Actual EVM/Solana byte-level instruction validation, signer recovery,
  account ownership/extension constraints, balance-delta reconciliation and
  native rent accounting in every chain adapter and client action constructor.
- Direct bounty transfer nonce ordering, partial fee-leg recovery, wallet
  replacement and cancellation/supersession under ambiguous submissions.
- EVM/Solana monthly legacy/V2/V3 compatibility, partial-leaf recovery, late
  source-sequence changes, reserve release and all multi-month interleavings.
- Points source merges, coauthor credit and commit deduplication, highest-band
  review sharing, pre-window reviewers, history revisions, bans/reversals and
  historical frozen monetary input. Slopbot assessment policy is also covered
  by the root's separate bot review; a model of Points arithmetic is not that
  policy's proof.
- Fee route accounts, Jupiter lookup tables, approval transactions, native-wrap
  routes, receipt/recovery record compatibility, multiple simultaneous sends
  and all byte/rent constraints. The native-budget model has one send only.
- Referral multi-project and multi-period cap competition, shared-wallet pins,
  claim-cache refresh, poster root watch, owner rescue and ownership handover.
- Contract UUPS upgrade authority, implementation initialization, factory
  deterministic creation, caller access matrices and token failures/reentrancy.

The scan checkpoint models refine the concurrent cursor contracts beyond the
single-reader range model. The review-credit model is a fixed adversarial fixture,
not an enumeration of every possible reviewer band or timestamp. It tests seven
reviews in 100 generated ingestion orders against `allocatePullRequestReviewCredit`.
Caller exclusion of bots, self-review and post-merge evidence remains the separate
leaderboard producer's responsibility. No score grants payment authority.

## Implementation and local-chain evidence

The generated-trace bridge in `backend/payments/dispatch.test.ts` executes the
pinned Quint model, loads its `ambiguousRetryTest` ITF trace, then compares it to
actual `dispatchPayment` and `indexPaymentEvent` state transitions in the full
migrated SQLite schema. An ambiguous first submit preserves the attempt ID;
the retry reuses it and the obligation becomes paid only after the finalized
adapter event is indexed. The adapter result is controlled test evidence;
this test does not establish live chain or provider truth.

The current application already contains extensive workflow regressions. An
initial targeted run passed 191 tests across dispatch, monthly coordination,
fee conversion, native gas and referral filing/posting, using production code
and migrated SQLite where the suites specify it. The new generated-trace test
then passed with the two existing dispatcher concurrency tests. Additional bridges
in `scripts/quint-money.test.ts` replay 100 seeded allocation traces against
`allocateIntegerTotal` in both input orders, 100 shuffled review traces against
`allocatePullRequestReviewCredit`, and a legacy-disclosure trace against
`verifyDisclosure`. The three bridge tests passed with 1,208 assertions.
TypeScript checking passed after these changes. The local EVM contract campaign completed successfully (exit 0):
`forge test --root contracts/evm --fuzz-runs 64 --no-match-contract Fork -q`.
The checked Foundry invariant profile remained 256 runs at depth 500. This
executed local contracts, not mainnet deployments.

Two financial boundary defects were reproduced and fixed in this current target:
the Solana token reader accepted initialized mint bytes from an RPC on another
cluster, and the real project-creation API published them as mainnet metadata
(HTTP 201). It now checks the selected mainnet genesis hash before reading the
mint. The regression uses actual registry routing and migrated SQLite: a wrong
cluster refuses publication, temporary HTTP failure remains retryable, and a
correct cluster stores the metadata. The expected identity comes from the
existing canonical network definition. Solana documents `getGenesisHash` as
the connected cluster's identity in its [RPC method reference](https://solana.com/docs/rpc/http).
This test uses controlled RPC replies; it does not change or verify a live mint.

The payout-readiness probe also accepted an empty EVM block object as a finalized
head. The local HTTP reproduction returned `finalized` for `{}`. It now requires
the returned block number and hash, and accepts a Solana slot only when it is a
positive safe integer. The real HTTP regression passed six invalid/valid network
responses; no live endpoint or release setting changed.

The old-checkout findings were intentionally not applied here. Modeling found
and corrected abstractions that were too strong: funding-time exclusion is not
an ability to prohibit a later account ban, and a replacement does not imply
that the original transaction can no longer win. These are model corrections,
not application fixes.

The dispatcher review also corrected two model constraints: a retained original
attempt may finish after a later authorized wallet replacement, and a stale
conflicting response cannot change a newer completed outbox. A generated trace
now crosses the actual dispatch and finalized ledger for the first case. A
separate 25-trace bridge crosses registration, actual wallet challenge signatures,
effective-wallet selection and dispatch, including unsigned successor histories.

## Verification limits

All models are bounded safety specifications with reachable and refused-path
scenarios. Optional stuttering means they make no unqualified progress/liveness
claim. They abstract signatures, hashes, receipts, policy identities and external
RPC truth. Matching source names and passing simulations are not semantic
refinement proofs. Generated dispatcher, integer-allocation, review-selection and
historical-disclosure traces now have model-to-implementation bridges. Required full model checks, chain suites and
pending financial source/action review must remain visible until completed.

## Additional runtime and migration review

The cancellation review added `binding_cancellation`: only expired or superseded
consent may produce the narrow journaled self-transfer, with zero value, empty
data, the same nonce and the approved gas envelope. Both the original and the
cancellation remain candidates until exact canonical finality proves one winner.
`solana_owner_action` separates reviewed native/token instructions, wallet signing
and finalized deltas. `vault_creation` admits an existing matching vault without
creating or signing again; conflicting derived accounts refuse. `solana_route`
requires complete lookup, account, program, signer, destination and native-budget
checks before signing, and a separate exact receipt after execution.

`monthly_source_conflict` treats another actor/gross/fee under the same source as
a conflict; a public digest alone grants no funding credit. `payment_history`
models the fixed append boundary and exclusion of private rows. `referral_claim_cache`
retains stale verified amounts after failure while refusing to label them current.
These models are partial specifications of their linked adapters, not full proofs
of every byte-level branch.

Money-related SQL source links identify specific state constraints and data moves,
not generic coverage of all migrations. In particular:

- 0011/0017/0021: immutable payment identities, outbox/attempt states and preservation
  of populated child references and exact base-unit amounts across chain/asset upgrades.
- 0012: durable Solana backward discovery and oldest-first atomic prefix checkpoints.
- 0014: separate direct-disclosure imports preserve exact transaction facts and cannot
  turn an external transfer record into a verified escrow payment.
- 0016/0100: append-only expiry renewal and effective wallet selection retain a prior
  authorized destination while a newer registered claim is still unsigned.
- 0055: project referral attribution is fixed at application submission and copied on
  approval; no retrospective referrer mutation follows a later revision.
- 0062/0071/0073/0081/0083: frozen monthly allocations, funding-time exclusions,
  permanent authorizations and later execution attempts with retained original history.
- 0022/0076/0078/0082/0087-fee/0088: fee conversion state, pending dust, expanded
  transaction byte capacity, claims, replacements and separate approval sends.
- 0090/0092/0094/0095/0096: native liabilities, cross-midnight recovery, Solana
  expiry evidence and retained account proofs. These guards do not authorize a signer.
- 0086-referral/0087-referral/0089: immutable accruals/files, posted roots and a
  separately refreshed claim cache. Program activation remains off.
- 0057/0108-private/0109/0112/0113: separate private payment ledger, individual
  transfer receipts, replay exclusion and preservation of already-paid legs during recovery.

`fee_schema_upgrade` and `scripts/quint-money-migrations.test.ts` cover populated
fee-table rebuilds. Seven pre-0076 rows include unresolved signed bytes and finalized
outcomes. After every relevant rebuild, each original column is compared byte-for-byte;
terminal mutation, deletion and signed-byte replacement are refused. The test applies
all later migrations and checks foreign keys. Existing populated 0017 and 0021 tests
also passed. The current monthly test suite already includes a populated 0081 upgrade
that retains funded months, exclusions and authorization history. Empty-database
schema installation alone is not treated as this evidence.

Additional local runtime tests passed: 276 tests across Solana contracts, payment
backend, payment executor, fee converter and fee/referral APIs. They supplement the
191-test run above and overlap with it; counts must not be added as distinct tests.

The staging/mainnet publication wrapper suites passed 22 tests with 135 assertions.
The real generated inactive-attester bootstrap workflow passed all four network
configurations and their dry runs, HTTP route/cron refusals, source readback,
zero key/RPC accesses and zero outbound calls. It did not deploy any service.

After the parallel LemmaScript changes were integrated, the 25 new pure kernels
and their money callsites were reviewed together. Existing caller validation was
retained; the scientific-notation micro-dollar fix intentionally changed the
previous gas underestimate. Fee/native/allocation bridges passed 101 tests with
1,726 assertions, and referral/projection checks passed 18 tests with 3,096
assertions. These counts overlap earlier suites. The kernel proofs' preconditions
and supported numeric semantics remain separate from whole-application refinement.

The artifact transport bridge executes a generated redirect/retry trace against
the real verifier with controlled HTTP responses. It checks that the CDN receives
no bearer, the transient artifact alone restarts at its canonical authority, and
the terminal 404 sibling is fetched once. These checks do not claim media-parser
or archive-format proofs. Native Git merge recovery uses existing complete-object
workflow tests; the model abstracts the byte-level diff and numstat parsers.

Both native-D1 scanner workflows also passed independently:
`workers/payments/scanner-progress.workflow.mjs` exercised overlapping EVM pages,
failed-page retry and public finalized coverage; `solana-progress.workflow.mjs`
exercised actual scheduled worker restart, persisted prefix, a provider failure,
100-transaction run bound, and losing a concurrent revision fence. The Solana
workflow reached real dispatch with a controlled submission response. Neither
workflow claimed a synthetic RPC response was live finalized payment evidence.

An independent peer review corrected the root operational models: vault upgrades
use the factory's upgrade authority, not the vault owner; a completed acceptance
execution may wait for/recheck finality without signing or executing it again;
and permissionless Solana deposits can name a separate depositor. The five root
models remain bounded control-flow models; their source links do not prove every
low-level slot, byte, rent, or instruction branch. `release_label_epoch` models
metadata invalidation after a head change. Current immutable-template installation
does not consult that legacy candidate label, so the model does not claim it does.

A subsequent interaction review reproduced a stale reconciliation write in
`workers/payments/reconcile.ts`: two reconcilers read one old submitted attempt,
the first retires it, dispatch submits a successor, and the second reopened the
new outbox as `ready`. The actual migrated SQLite/dispatch workflow failed with
`ready` instead of `submitted`. The SQL update now requires that no prepared,
submitted or unknown attempt remains. Failure records stay immutable.
`payment_dispatch.staleFailurePreservesSubmittedSuccessorTest` supplies the
expected state for that workflow. The issue caused a redundant eligible retry;
the stable executor idempotency key already prevented a new competing payment.

The EVM binding workflow now also executes the generated
`authority_rotation.delayedOldAuthorityRevertsAndReconcilesTest` trace against
Anvil and the real signing core. A signed old-key binding is held across an
authority rotation, no longer rebroadcast by the service, and then delivered
late to the contract. The reverted finalized receipt retires its active journal
entry while retaining the original bytes and failure proof. Existing contract
scenarios separately show that bindings mined before rotation remain usable.

`referral_posting.canonicalVoidAfterFinalizedTest` is compared with the actual
poster client and migrated D1 store: a nonfinal void holds the run, a disappearing
void leaves the finalized record intact, and only a canonical finalized void
changes the record to `voided` and halts new posting pending acknowledgement.
The controlled RPC fixture is not live-chain evidence or referral activation.

A second peer review corrected operational abstraction boundaries: staging
qualification records cannot hide a release at the same revision; complete
census counts still require a terminal page; cleanup errors after atomic rename
do not undo publication; backup source readback differs from sandbox image/key
qualification; and local Git object export does not establish public repository
identity or acquisition-tool pinning. The formal toolchain and schedule-readback
models were checked against their actual scripts. These are scoped control
models, not complete proofs of the referenced scripts.

The final focused batch passed 54 payment/referral tests (311 assertions), the
four-phase migrated reconciliation workflow and the native binding workflow.
Exact-current-model TLC reports passed with unchanged input hashes for
`ingestion_retry` (60 states, including its termination property),
`authority_rotation` (504), `payment_dispatch` (686), `referral_posting` (1,582),
`staging_release_order` (14), `service_release_identity` (21), `github_census`
(33), `merge_evidence_acquisition` (704) and `formal_toolchain` (34).
These counts describe the finite models only. Quint 0.33.1 weak fairness already
uses `mustChange`; the explicit ingestion `advance` relation clarifies the
scheduling assumption and does not fix an earlier unsound fairness definition.

The composed fee review read `core.ts`, `store.ts`, `native-gas.ts` and both
chain adapters together. Existing tests already cover lease loss while awaiting
preparation, replacement status, replacement construction, the D1 append and the
post-append broadcast boundary. `fee_lease_journal` connects those boundaries to
gas-revision fencing, same-nonce liabilities, midnight and receipt settlement.
The native-gas workflow now replays its generated replacement/lease/day trace
through actual signed EIP-1559 bytes and migrated SQLite: the new lease settles
the original winner once, the replacement has zero actual cost, and a delayed old
lease cannot rewrite either record. No additional production defect was
reproduced in the initial lease/gas boundary review.

The composition model does not prove arbitrary gas arithmetic, raw-transaction
cryptography, provider truth or all possible deployment/key-rotation handoffs.
Those remain distinct source contracts and operational boundaries. Existing
implementation tests cover a new transaction reusing a failed expired swap's
nonce without releasing its historical native liability; that multi-intent
reuse is not a complete refinement of the two-attempt model.

The composed fee model passed 8 scenarios, 500 seeded traces of 60 steps and
TLC exploration of 83,224 states with unchanged input bytes. The two affected
fee/native suites passed 98 tests and 524 assertions using the repository's
30-second test timeout; typecheck passed. No production signer, RPC endpoint or
runtime policy was changed by this follow-up.

The requested follow-up on wallet changes and nonce reuse found two real
business-history errors. First, a new fee-wallet configuration made the EVM
receipt reader count an old wallet's successful transfer as zero, after which
the immutable row could not be corrected. The actual client/D1 regression
observed `finalized` with `amount_out=0` despite a 10,000,000-unit transfer.
Core reconciliation now holds rows whose retained fee wallet differs from the
configuration; restoring the original configuration recovers the exact amount.
Second, missing receipt/hash lookups plus a consumed nonce made a successful
swap permanently `failed`. The regression reproduced both finalized and
latest-but-not-finalized nonce advancement. Both now remain pending until the
canonical receipt is available. The guard does not create a new migration or
key-rotation permission.

`fee_nonce_reuse` covers three different intents on one still-unused nonce;
its generated trace is compared with real signatures, the native journal and
SQLite terminal guards. The existing actual `runOnce` workflow also verifies
that an expired swap can yield the same nonce to a later approval while both
liabilities remain. `fee_wallet_handoff` covers configuration mismatch and
missing-receipt holds, with real EVM client/D1 evidence and both EVM/Solana
negative signer-construction checks. This is bounded composition evidence,
not a proof for arbitrarily many intents or dishonest provider responses.

The separate nested npm audit is recorded in
[solana-dependency-audit.md](solana-dependency-audit.md). Its unresolved findings
are development/integration dependency risks; root Bun audit results do not
cover that separate lockfile. No forced SDK downgrade or lockfile change was
made.

Final handoff/nonce validation used Bun 1.3.14 and Node 24.15.0. The affected
fee/native suites passed 101 tests with 541 assertions; typecheck passed. Both
new models passed typechecking, named scenarios and 500 seeded 60-step traces.
TLC passed 199 states for `fee_nonce_reuse` and 93 for `fee_wallet_handoff`, with
stable model and linked source hashes recorded by the formal runner.

Historical scoring now has actual-snapshot conformance in
`scripts/quint-legacy-score.test.ts`. Four independent buckets vary the GitHub
actor, registered project and UTC month, with seven accepted merges each. Every
bucket produces 43 legacy merge points and 20 material-test points from its
newest five qualifying sources. Forward, reversed and shuffled source arrays
produce identical ledgers; an equal-time boundary uses the higher pull-request
number. The model's twelve-merge bound is not a production cap. Its issue,
evidence, review and evaluation branches model category accumulation under
representative qualifying events; this test does not prove those categories'
source qualification. No production discrepancy was found in this follow-up.
