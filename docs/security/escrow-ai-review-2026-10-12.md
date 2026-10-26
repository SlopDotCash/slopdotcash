# Slop escrow contracts: AI-assisted security review

**Status:** internal, AI-assisted review. Not an independent audit.
**Date:** 12 October 2026
**Fix status (updated 14 October 2026):** checked against `development` at commit `776681c`, after the fixes in [#673](https://github.com/SlopDotCash/slopdotcash/pull/673) (M-1, M-2, L-1, L-2 in part, L-3 in part, L-4, L-5, I-7) and [#675](https://github.com/SlopDotCash/slopdotcash/pull/675) (H-1) merged. Each finding below has a **Status** line. The repository owner approved publication of this report after those fixes merged. Section 4 describes the behavior of `bbcc87b`; the Status lines describe `development`.
**Policy status (25 October 2026):** the owner waived the independent smart-contract audit and the signer/attester legal review on 24 October 2026; both are waived, not completed (PRD section 9 "Mainnet" row and section 11 "External reviews" row). The current withdrawal-fee requirement is 2%, `ceil(gross / 50)`, equal to the award fee (PRD section 6). The 10% figure in section 3 describes the contracts reviewed on 12 October. The [deployment guide](../../contracts/DEPLOY-MAINNET.md) records mainnet source `bce5b0df` and pending upgrades, including rounded-up fees; this policy update does not verify those upgrades. Explicit per-network activation remains required. The later [AI red-team review](red-team-2026-10-24.md) is also not an independent audit. Other finding statuses below retain their stated review dates.
**Commissioned and reconciled by:** Drew Pierson (Operator, Slop Cash S.P.), using Claude Fable 5.1 as lead reviewer. Drew is not independent of the project and is not a security engineer. The contract author (Shaw Walters) did not take part in the review.
**Code reviewed:** SlopDotCash/slopdotcash `main` at commit `bbcc87b91c3ef952313eb5669112865fc311be4a` (12 Oct 2026 16:56Z)
**Paths:** file paths, line numbers and PRD section numbers refer to the reviewed commit. Some files, for example `docs/payouts-mvp.md`, were removed later and stay in Git history.

- `contracts/evm/src/ProjectEscrow.sol` (contracts `ProjectEscrow` and `EscrowFactory`), 295 lines, Solidity 0.8.30, plus `contracts/evm/script/DeployBase.s.sol` and `DeployBaseSepolia.s.sol`
- `contracts/solana/programs/slop-escrow/src/lib.rs`, 585 lines, Anchor 0.32.1, classic SPL Token only

**Deployment state at review time:** no mainnet deployment on either chain, no public testnet deployment recorded, every project manifest has payments disabled. No funds are at risk today.

## 1. Headline

No reviewer found a way for an unprivileged party to take or lock funds, choose a payment amount or destination, pay an award twice, or touch reserved funds. On the EVM contract, fee arithmetic, reserve tracking and the README conservation identities held under every tested sequence, including an invariant campaign of 512 runs of 60 random calls (Reviewer A, section 2). On Solana the same properties were checked by reading the source only. No Solana validator ran for this review, so this report is not runtime evidence for Solana and does not supply the same-scenario test evidence on both chains that MVP-07 requires.

The findings are design-level and concentrated in one area: the wallet-binding lifecycle (identity authority, binding delay, owner cancel). The review recommended that H-1, M-1, M-2 and L-1 be fixed before any mainnet deployment; #673 and #675 have since fixed them. These launch gates remain open before any mainnet escrow:

- **L-3 (Solana):** the identity authority and the fee recipient of a Solana project are chosen by the owner. Neither the program nor the manifest policy pins them to a canonical Slop key. This report first rated L-3 Low; it is re-rated Medium and is an authority-conformance blocker (see L-3).
- **Withdrawal fee:** the trust model in section 3 uses the 10% withdrawal fee that the contracts enforce. The PRD records that fee as an unresolved commercial decision that needs owner approval (`docs/slop-product-requirements.md`, section 18 and the section 22 "Withdrawal fee" row). This review does not approve it.
  **Status: decided.** The owner set the withdrawal fee to 2%, `ceil(gross / 50)`, equal to the award fee (PRD section 6; `docs/payouts-mvp.md`).
- **Independent audit** of the contracts as changed by #673 and #675 (section 6).
  **Status: waived.** The owner waived the independent audit on 24 October 2026, not completed (PRD section 11 "External reviews").

| Severity | Count | Summary |
|---|---|---|
| Critical | 0 | |
| High | 1 | The identity authority key has no recovery path. A lost key permanently strands unpaid awards for actors without an active binding; a compromised key turns into a perpetual 48-hour race. |
| Medium | 3 | The binding delay is measured from the binding, not from the award, so a binding placed before any award exists matures unnoticed and pays instantly later. The owner can cancel or veto bindings without bound, so a committed award can be blocked forever. Solana parameters are set by the owner with no on-chain pinning (L-3, re-rated from Low after publication review; it keeps its ID). |
| Low | 4 | Unbounded delay parameter; Solana fee leg inside `pay`; three EVM input checks missing on Solana; EVM cancel re-emits events. |
| Informational | 7 | Event completeness, documentation drift, dead constraints, a registrar foot-gun. |

Two items outside the contracts are recorded in section 6 because they bear on how this review may be described: who holds the identity authority key, and the Solana program upgrade authority.

## 2. Method

Five independent reviews were run against the same commit, each with a distinct brief, by three different Claude model families, and then reconciled by a lead model with every claim re-checked against the source:

| Reviewer | Scope | Provider and model | Evidence produced |
|---|---|---|---|
| A | EVM contract, factory, deploy scripts | Anthropic, Claude Opus | 19 Foundry tests: 9 scenario tests, 5 token-behavior tests, and 1 invariant contract (`OpusInvariantTest`) with 5 invariant functions, run at 512 runs x 60 calls (`FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=60`) |
| B | EVM contract, factory, deploy scripts | Anthropic, Claude Fable | 17 Foundry tests including a 256-run withdrawal-split fuzz |
| C | Solana program | Anthropic, Claude Opus | Reasoning against the program and the locked Anchor 0.32.1 and spl-token 8.0.0 sources |
| D | Solana program, role by role | Anthropic, Claude Fable | Reasoning against the program and the generated Anchor constraint code |
| E | Fee arithmetic, conservation identities, EVM vs Solana parity, events, docs | Anthropic, Claude Sonnet | 11 Foundry tests including a 256-run split fuzz with identities asserted after every step. All 11 tests use only the EVM contract; the Solana side was reasoned from source |
| Lead | Reconciliation | Anthropic, Claude Fable 5.1, Claude Code client | This report |

Attribution limits: the run records for reviewers A to E name only the model family. The exact model version, the agent client and the request count of each reviewer run, and the request count of the reconciliation, were not recorded at run time and cannot be recovered. This report states them as not recorded and does not assume values.

The 47 Foundry tests all passed on `bbcc87b` (`forge test`, Foundry 1.7.1, solc 0.8.30). The invariant campaign on that commit is Reviewer A's 512 x 60 run above. The repository's own EVM integration suite (`bun contracts/evm/adapter.integration.ts`, real Anvil deployment) also passes. `cargo check --locked` is clean for the Anchor program. No Solana validator was run for this review; the repository's CI runs the Anchor end-to-end suite and section 7 lists what that suite does not cover.

Current regression evidence: #673 and #675 adopted the review tests into `contracts/evm/test/` and changed each finding test to assert the fixed behavior. On `development` at `776681c`, `forge test --root contracts/evm` runs 68 tests in 8 test contracts, and all pass. The same invariant contract now runs at the profile pinned in `contracts/evm/foundry.toml`: 256 runs x 500 calls for each invariant function. The `Escrow accounting and recovery` CI workflow (`.github/workflows/escrow-tests.yml`) runs `forge fmt --check`, `forge build` and `forge test` on every pull request that changes `contracts/` or another payment path. That later run is separate from Reviewer A's evidence, and it runs on the fixed code, not on `bbcc87b`.

Reconciliation rules: a finding appears below only if the lead could reproduce the reasoning against the code or a passing test demonstrates it. One reviewer claim was rejected: that the EVM `uint64(block.timestamp) + bindingDelay` wraps silently. Solidity 0.8 checked arithmetic reverts instead, which two other reviewers' tests confirmed. Where reviewers disagreed on severity the lead's choice and the reason are stated.

Out of scope: the off-chain adapters, the payment executor and scanner workers, the identity attestation service, key custody, deployment procedures, the Squads 2-of-3 project vault, and every other part of the Slop codebase. Those are a larger surface than the contracts and have not been reviewed by anyone.

## 3. Trust model used

| Role | Documented power | Must not be able to |
|---|---|---|
| Project owner (sponsor) | Deposit; commit awards (reserving gross); withdraw free funds (10% fee on cumulative gross withdrawn); pay a Slopbot invoice from free funds; cancel or veto a binding while it is pending | Take back, reduce or redirect a committed award; reach reserved funds |
| Identity authority | Bind a numeric GitHub actor id to a wallet, versioned, subject to the delay | Change amounts; touch free funds or paid awards |
| Payer or relayer (anyone) | Trigger payment of a committed award to the active binding | Choose amount or destination |
| Fee recipient | Receive fees | Block payouts or refunds |
| Factory registrar (EVM) | Create one vault per project id | Move money |
| Upgrade authority (Solana) | Replace the program | Exist on mainnet (must be `null`) |

Documented and accepted, so not reported: the owner can commit an award to an account it controls and exit at the 2% payout fee instead of the 10% withdrawal fee; direct token transfers to a vault are unrecoverable; there is no award cancellation and no rescue; a blocklisted contributor destination reverts that one payment.

## 4. Findings

### H-1. The identity authority key has no recovery path (both chains)

Reviewers: A (Medium), B (High), C, D. Lead rating: High, because the brief's rule is that a permanent lock of funds is High even without theft, and the authority will be a hot service key.

The only way an actor becomes payable is a binding signed by the identity authority. On EVM that key is an immutable set once per factory (`ProjectEscrow.sol:38`, `EscrowFactory` constructor); on Solana it is set once per project at `initialize` (`lib.rs:28`). There is no rotation, no multi-party recovery, no award cancellation and no reserve rescue on either chain.

- **Key lost:** every award committed to an actor that has no active binding at that moment can never be paid. Its gross stays reserved forever and the owner cannot withdraw it (`withdrawUnused` and `chargeService` only reach `freeBalance`). On EVM this is factory-wide.
- **Key compromised:** the attacker can bind any actor to itself. The owner can cancel each rogue binding during the delay, but only the compromised key can make an honest binding, so the attacker rotates again. The owner must win every 48-hour window forever; one missed window is theft. The attacker can also rotate away an active honest binding, which destroys it (see M-2).

Evidence on `bbcc87b`: `test_F1_lostAuthorityStrandsUnpaidAwards` (B) and `test_F3_compromisedAuthorityConvertsToLockOrTheft` (A), both passing.

**Status: fixed by #675. The repository owner approved the design on 14 October 2026 (PAY-05).** A binding now needs the destination wallet's own signature as well as the identity authority's signature (EIP-712 on Base, a second signer on Solana). A stolen authority key alone cannot bind an actor to an attacker wallet. A public timelocked rotation replaces the authority, and the authority cannot block it: on Base the factory registrar proposes and anyone executes after 7 days; on Solana the owner proposes, the fee recipient confirms, and anyone executes after the project's rotation delay. Existing bindings stay valid across a rotation. Both READMEs have a key recovery runbook. Regression tests: `BoundedAttester.t.sol` (15 tests, including `test_H1_stolenAuthorityCannotTakeAnAward`, `test_rotationProposeCancelExecute`, `test_oldAuthorityCannotBindAfterRotation` and `test_existingBindingsRemainValidAcrossRotation`) and `FableEscrow.t.sol` `test_F1_unboundAwardStaysReserved`. Residual risk: if the registrar key (Base), or the owner and fee-recipient keys (Solana), are lost together with the authority key, no rotation path remains. The runbook covers this case. **Follow-up (20 October 2026):** an outside report found that the runbook's cover assumed no earlier cancel on the actor; see [`external-cancel-cap-rotation-2026-10-20.md`](external-cancel-cap-rotation-2026-10-20.md).

Recommendation: add a constrained rotation that gives no single party a new money power, for example a two-step authority replacement proposed by the owner and confirmed by a second fixed party, itself subject to the binding delay and vetoable by the current authority. Alternatively let the owner re-point an unpaid award's actor only after that actor has had no active binding for a long fixed period, under the same delay and with an event. At minimum, state the no-recovery property in both READMEs next to the redirect risk, and make a documented key ceremony and operational recovery plan a hard launch gate. The EVM README already lists "operational signer recovery" as a launch gate; it does not say what the consequence of failure is.

### M-1. The binding delay protects awards that exist at bind time, not awards committed later (both chains)

Reviewers: A, D (independently). Lead rating: Medium.

`pay` requires only `now >= activatesAt` (`ProjectEscrow.sol:191`; `lib.rs:157-160`), and the owner's cancel is allowed only while `now < activatesAt` (`ProjectEscrow.sol:180`; `lib.rs:138-141`). Nothing ties either to when an award is committed. A binding for an actor with no award puts nothing at risk while pending, so no owner has a reason to look at it. After 48 hours it is final and covers every future award to that actor.

Scenario: a compromised authority binds future contributors to the attacker's wallet. Forty-eight hours pass. Weeks later the owner commits an award to one of those actors. In the same block, any relayer's `pay` sends the net amount to the attacker. The owner's cancel reverts because the binding is active. On Solana, because bindings are shared across every project with the same authority and network (`lib.rs:384`), one pre-placed binding exposes every future award to that actor in every project. The intended product flow (`docs/payouts-mvp.md:15`) has contributors register wallets before they have awards, so a malicious early binding looks like a normal one.

Evidence on `bbcc87b`: `test_F1_preArmedBindingPaysInstantlyAfterCommit` (A), passing. The Solana end-to-end suite always binds after committing, so this ordering is untested there.

**Status: fixed by #673 on both chains.** Each award stores its commit time. `pay` requires the commit delay to pass, and the owner can cancel or veto the latest binding while an unpaid award to that actor is inside its commit delay. Regression tests: `OpusFindings.t.sol` `test_F1_preArmedBindingWaitsForCommitDelay`; `BindingLifecycle.t.sol` `test_preArmedBindingWaitsForCommitDelayAndOwnerCanCancel`, `test_commitWindowClosesWhenPayOpens` and `test_laterAwardWaitsButPaidBindingIsNotCancellable`; the Solana end-to-end test "commit delay, rotation freezes the earlier wallet, veto cap, ..." in `contracts/solana/integration/escrow.e2e.mjs`.

Recommendation: record the commit time on each award. Require `now >= max(activatesAt, committedAt + bindingDelay)` in `pay`, and allow the owner's cancel or veto until that same moment. This gives the owner a window measured from the moment money is attached to the binding. The off-chain alternative is to have the owner (or the executor acting for it) read the current binding before every commit and refuse to commit against a binding it has not reviewed; if that is chosen, document it as a required operating procedure.

### M-2. The owner can block a committed award indefinitely; rotation strips an active binding (both chains)

Reviewers: A, B, C, D, E (all five). Lead rating: Medium. One reviewer rated Low on the ground that it is the documented power applied repeatedly; the lead kept Medium because the README's wording ("delay", "an active binding is final") is weaker than the code.

Cancel (`ProjectEscrow.sol:178-185`) and veto (`lib.rs:132-148`) are one per binding version, but versions are unbounded. Each honest rebind by the authority opens a new window the owner can cancel again. The reserved funds stay locked; the owner cannot withdraw them either. This is mutual loss, not theft, but on chain it has no bound.

Separately, a rotation overwrites the single stored binding, even a rotation to the same destination. The previously active version becomes unpayable at once, because `pay` requires the current version. If the owner then cancels the replacement, the actor has no payable binding at all although it had a final one minutes earlier. The README sentence "An active binding is final and cannot be cancelled" is therefore not true under rotation plus cancel.

Evidence on `bbcc87b`: `test_F2_ownerCanBlockCommittedAwardIndefinitely` (A, 25 rounds), `test_F2_activeBindingLostAfterRotateAndCancel` (B, 10 versions), `test_repeatedCancelBlocksForever` and `test_activeBindingSupersededThenCancelled` (E), all passing.

**Status: fixed by #673 on both chains, with a different rotation rule than the recommendation.** The owner can cancel or veto at most 3 times for an actor between payments (EVM `MAX_CANCELS_BEFORE_ACTIVE`, Solana `MAX_VETOES_BETWEEN_PAYMENTS`), so the owner's block has a bound. #673 chose that a rotation stops payment to the earlier wallet until the new binding activates, instead of keeping the earlier wallet payable. Thus a rotation away from a lost or compromised wallet takes effect at once. The README sentence "An active binding is final" is removed, and both READMEs state the exact owner power. Regression tests: `OpusFindings.t.sol` `test_F2_ownerCancelIsCappedBeforeFirstPayment`; `FableEscrow.t.sol` `test_F2_paidBindingIsFinalAndRotationFreezesPayment`; `SonnetParity.t.sol` `test_repeatedCancelIsCapped` and `test_rotationAndCancelFreezePreviousDestination`; `BindingLifecycle.t.sol` `test_rotationFreezesPaymentToPreviousWallet`, `test_cancelledRotationDoesNotPayPreviousWallet`, `test_cancelCapAppliesBetweenPayments` and `test_cancelCapBeforeFirstPayment`. **Follow-up (20 October 2026):** the cap is waived while an authority rotation is pending, because a spent cap shortened the H-1 cover; see [`external-cancel-cap-rotation-2026-10-20.md`](external-cancel-cap-rotation-2026-10-20.md).

Recommendation: keep the previous active binding payable while a replacement is pending (store the active destination separately from the pending one and promote on activation), so a rotation can only move the destination after the delay and a cancel only drops the pending change. If the unbounded block is intended policy, say so in the README and the PRD and drop the "final" sentence. A cap on cancels per actor per project is the smallest code change.

### L-1. The binding delay has no on-chain bounds (both chains)

Reviewers: A, B, C, D, E. Both constructors accept any delay. On EVM a delay near `uint64` max makes every `bindDestination` in every vault of the factory revert, and a delay of exactly `2^64 - 1 - now` creates a binding whose `activatesAt` equals the cancel sentinel, so it can never pay. A delay of zero makes cancel unreachable. On Solana `i64::MAX` makes `pay` and `veto_binding` fail with `Arithmetic` forever, and a merely large value never activates. The 48-hour production minimum exists only off chain (`src/lib/escrow-policy.mjs:30`), and both deploy scripts hard-code 48 hours. Evidence on `bbcc87b`: `test_F4_hugeDelayBricksBinding`, `test_F3b_sentinelCollision`, `test_F4_zeroDelayMakesCancelUnreachable`, passing. Recommendation: require a minimum and a maximum in both constructors, and replace the EVM sentinel with an explicit cancelled flag.

**Status: fixed by #673 on both chains.** The delay must be between 1 hour and 30 days on both chains, and EVM uses an explicit `cancelled` flag. The Solana end-to-end build lowers the floor with the `short-delay-for-tests` Cargo feature; `contracts/solana/integration/production-delay.e2e.mjs` checks that the deployable build rejects a delay below one hour. Regression tests: `OpusFindings.t.sol` `test_F4_delayIsBounded`, `FableEscrow.t.sol` `test_F3_delayIsBoundedAndCancelIsAFlag` and `BindingLifecycle.t.sol` `test_delayBounds`.

### L-2. On Solana the fee leg runs inside `pay`, so a frozen fee token account stalls executor-built payouts (Solana)

Reviewers: C, E (D rated it sound). `pay` always sends two transfers, including a zero-amount fee transfer, to a `fee_account` that need only be owned by the fee recipient (`lib.rs:178-186, 414`). SPL Token rejects a frozen destination before it looks at the amount. If the fee recipient's associated token account is frozen, every `pay` built by the executor fails across every project sharing that fee recipient, including zero-fee awards, because the executor uses the ATA (`workers/payment-executor/solana.ts:548`). Anyone can create a fresh token account owned by the fee recipient and pass it, so this is a liveness issue, not a lock; the EVM side avoids it by accruing fees and claiming them separately. Recommendation: skip the fee transfer when the fee is zero, and make the executor able to fall back to another fee-recipient-owned account; or accrue fees on Solana as on EVM.

**Status: partly fixed by #673; part remains open.** `pay` now skips a zero fee leg, so a frozen fee account cannot stop a zero-fee payout (Solana end-to-end test, L-2 step). A payout with a nonzero fee still sends the fee leg inside `pay`, and the executor has no fallback fee account. Thus a frozen fee-recipient ATA still stops executor-built payouts that have a fee. That part remained open until the red-team review of 24 October 2026: Solana fees now accrue in the vault and the permissionless `claim_fees` moves them, so a frozen fee account stops only `claim_fees` ([`red-team-2026-10-24.md`](red-team-2026-10-24.md), F-2).

### L-3. Solana `initialize` is permissionless and every security parameter is chosen by the owner (Solana)

Reviewers: C, D, E. Rating revised after publication review: Medium, and an authority-conformance blocker for mainnet (first published as Low). The owner picks the identity authority, fee recipient, delay, network and mint; the only checks are non-default keys, authority not equal to owner, and delay non-negative (`lib.rs:17-23`). An owner could name a second key it holds as authority, bind each actor to its own wallet and take committed awards back at 2%; or set the fee recipient to itself. Today the adapter refuses any project whose stored values differ from the reviewed manifest (`contracts/solana/adapter.ts:131-206`), so the guarantee rests on manifest review. The EVM factory pins token, fee recipient, authority and delay in code and gates creation behind the registrar. Recommendation: add `fee_recipient != owner`, a delay maximum and `fee_recipient != project PDA` on chain, and consider a one-time global config written before the upgrade authority is burned so the authority and fee recipient are pinned on chain as on EVM. Document the manifest check as the gate until then.

Why the first Low rating was too low: the manifest policy (`assertEscrowPolicy` in `src/lib/escrow-policy.mjs`) accepts any syntactically valid `identityAuthority` and requires only that it is different from the owner and the vault. Different keys do not prove separate control. An owner can name an alias key that it holds as the authority and send committed awards to itself. That breaks the trust model in section 3 (the owner must not redirect a committed award) and the PAY-05 rule that only the approved attester co-signs bindings. Also, `fee_recipient != owner` does not prevent common control of both keys.

**Status: partly fixed by #673; the pinning remains open.** `initialize` now requires `fee_recipient != owner`, `fee_recipient != project PDA` and the delay bounds. #675 requires the destination wallet to sign each binding, but an owner that controls an alias authority and the destination wallet can give both signatures, so #675 does not close this finding. Neither the program nor the manifest policy pins the identity authority or the fee recipient to a canonical Slop key. Until one of them does, the Solana escrow must not be activated on mainnet, and each Solana manifest review must verify that the authority is the approved Slop attester and the fee recipient is the Slop fee address.

### L-4. Three EVM binding checks are missing on Solana (Solana)

Reviewers: C, D, E. `bind_wallet` accepts a zero `claim_digest`, a destination equal to the project or vault PDA, and has no submission expiry (`lib.rs:104-107`); EVM rejects all three (`ProjectEscrow.sol:164-167`). A destination equal to the project or vault PDA passes `pay`'s check (which only excludes the vault address itself, `lib.rs:412`) and strands the principal in an associated token account the program can never sign for. A bind transaction signed with a durable nonce stays valid until the version changes. Only the authority can trigger these, but they convert a redirect into an unrecoverable burn. Recommendation: add the three checks.

**Status: fixed by #673.** `bind_wallet` rejects a zero claim digest, the project and vault PDAs as destination, and an expired submission (`expires_at`). After #675 the destination must also sign, and a PDA cannot sign. Regression test: Solana end-to-end test, L-4 step.

### L-5. EVM `cancelBinding` is idempotent on a cancelled binding and re-emits the event (EVM)

Reviewers: A, B. After a cancel, `activatesAt` is the sentinel, so the "already active" guard never fires and the owner can cancel the same version again at any later time, emitting duplicate `BindingCancelled` events (`ProjectEscrow.sol:180`). State is unchanged. Evidence on `bbcc87b`: `test_F5_cancelIsRepeatable`, `test_F4_cancelIsIdempotentAndReemits`, passing. Recommendation: revert when the binding is already cancelled.

**Status: fixed by #673.** `cancelBinding` reverts on a cancelled, missing or already-paid binding. Regression tests: `OpusFindings.t.sol` `test_F5_cancelIsNotRepeatable`, `FableEscrow.t.sol` `test_F4_cancelIsNotIdempotent` and `BindingLifecycle.t.sol` `test_cancelOnCancelledOrMissingBindingReverts`.

### Informational

Status on `development` at `776681c`: I-7 is fixed by #673 (Solana bindings are now scoped per project, with seeds `wallet`, project and actor). I-1, I-2, I-3, I-4, I-5 and I-6 remain open. For I-5, the EVM README fee section and the "Contracts enforce obligations, fees ..." sentence in `docs/payouts-mvp.md` are unchanged.

- **I-1. Solana events are thinner than EVM events.** No deposit or initialize event; `AwardPaid` lacks the actor id and the token accounts; `UnusedWithdrawn` lacks the destination; `WalletBound` lacks the claim digest and authority. The adapter reconciles from instructions, not logs, so nothing breaks today; third-party indexers get less. On EVM, `Paid.fee`, `UnusedWithdrawn.fee` and `ServiceCharged.amount` are accruals; tokens move only at `FeesClaimed`.
- **I-2. The Solana award id has no cluster domain.** The same program, owner and project id on devnet and mainnet give identical award ids. Not replayable on chain; an off-chain store keyed on award id alone could mix clusters. EVM includes the chain id.
- **I-3. `chargeService` digest uniqueness is a client-side property.** The digest is not tied to the amount or to a signed invoice, and there is no cap. All of it goes to the fee recipient, so it is not an attacker drain, but the contract cannot enforce any invoice policy.
- **I-4. The EVM registrar can create a dead vault.** The constructor does not reject `owner == address(this)` (the CREATE2 address is predictable), and a consumed project id cannot be retired in that factory. No funds at risk unless someone sends tokens to the dead vault.
- **I-5. Documentation drift.** "Splitting cannot reduce fees" is true for withdrawals only; per-award flooring means three 49-unit awards pay zero fee where one 147-unit award pays 2 (under one micro-unit per award, uneconomic). A single withdrawal step can be 100% fee (gross 1 after cumulative 9 returns 0). The EVM README's third conservation identity cannot be checked on chain (no claimed-fees counter). The Solana README's identity is a tautology because `free()` is defined as the remainder; the real invariant is `vault.amount = free + reserved + unsolicited`, which holds. `EscrowFactory` reuses `DuplicateAward` for a duplicate project id. `expiresAt` is neither stored nor emitted. `docs/payouts-mvp.md:17` says "Contracts enforce ... fees", which on Solana is only true via the manifest (L-3).
- **I-6. Issuer freeze of the vault itself.** If the token issuer freezes a vault's token account, reserved and free funds are locked with no recovery path on either chain. Outside the program's control; neither README mentions it.
- **I-7. Shared bindings on Solana.** One legitimate rotation reopens the veto window in every project with the same authority and network and resets expected versions everywhere. Each project must veto separately. Documented in the README; recorded here because M-1 and M-2 compound across projects on Solana only.

## 5. Checked and found sound

Each item was examined by at least two reviewers and re-read by the lead.

- **Reentrancy (EVM):** one guard across every money path; state is fully updated before any transfer in `pay` and `withdrawUnused`; commit, bind and cancel make no external calls. A reentry during `pay` is blocked (`test_reentryDuringPayIsBlocked`). Solana token CPIs cannot call back into the program.
- **Exact transfers (EVM):** `deposit` checks the vault delta; `sendExact` checks vault and recipient deltas; destination can never be the vault, so the two reads are on distinct addresses. Fee-on-transfer and rebasing tokens revert cleanly with no counter drift. `callToken` accepts empty return data and a 32-byte `true`, rejects `false` and 64-byte returns.
- **Binding lifecycle:** cancel and pay windows meet exactly with no overlap; a cancelled or vetoed version never pays; a version that does not exist yet cannot be pre-cancelled or pre-vetoed on either chain; a stale `pay` with an old version fails after rotation.
- **Veto account tamper (Solana):** the veto PDA can gain data or a non-system owner only through this program's `veto_binding`; sending lamports to the address leaves `pay` passing; Anchor's `init` handles pre-funded addresses, so dusting cannot block veto, commit, initialize or a first bind.
- **Account validation (Solana):** every account a transfer touches is pinned by PDA derivation or `has_one` back to the project; the program signs only with the project PDA over its own vault; Token-2022 accounts and mints are rejected everywhere; `init_if_needed` on the binding cannot re-initialize because a created account always ends at version 1 or higher and there is no close instruction; PDA seed prefixes are pairwise non-prefix and every seed component is fixed width.
- **Replay and duplicates:** `paid` flags are permanent on both chains; no close instruction exists on Solana so account recreation is impossible; award ids are bound to chain and vault (EVM) or project PDA (Solana); the EVM factory rejects a duplicate project id and there is no `selfdestruct`, so CREATE2 redeploy is impossible.
- **Reserves and conservation:** both README identities hold after every tested sequence including `chargeService`; the owner cannot reach reserved funds by any instruction; a blocked contributor destination leaves the reserve intact and the award unpaid.
- **Fee arithmetic:** `gross/50` never exceeds gross and net is always at least 1; the withdrawal fee is path independent, never negative, never exceeds the step's gross; results are identical on both chains for every worked example.
- **Integer bounds:** every counter is bounded by total deposits, which cannot exceed `2^64 - 1` micro-USDC; timestamps cannot truncate; all Solana arithmetic is checked.
- **Role powers:** the authority cannot touch amounts or funds; the permissionless payer selects neither amount nor destination; a fee-recipient blocklist blocks only `claimFees` on EVM; an owner of a different Solana project with the same authority can veto only its own project and reserve only its own funds.
- **Deploy scripts:** chain id pinned (8453 and 84532), no private key material, Base mainnet USDC and the fee recipient constants match `src/lib/fresh-cycle-policy.mjs` and the PRD.

## 6. Items outside the contracts that affect how this review may be described

- **Who holds the identity authority.** `bindDestination` and `bind_wallet` accept any destination from the authority alone; no wallet proof is checked on chain. The payouts MVP describes this as a Slop-run attester. The product requirements (section 22, merged as #557) say no Slop-held key may originate, route or redirect a payment. These conflict. The decision is Shaw's and must be settled before any deployment; until then, public copy should not describe the escrow as non-custodial without qualification, and this review should not be cited as having resolved it.
  **Status: decided.** The repository owner approved the bounded-attester design of #675 on 14 October 2026 (PAY-05, `docs/payouts-mvp.md`). Slop holds the attester key, but the key can only co-sign a binding that the destination wallet signed, and a timelocked rotation replaces it. This review did not examine that design; the independent audit must examine it.
  **Policy status (25 October 2026):** the current PRD sections 6 and 11 supersede that delay and scope. Wallet bindings and identity-authority rotations have no waiting period. The attester also signs monthly allocation roots within the owner's cap and opt-out. The owner accepts the compromised-attester risk recorded in [the later red-team review](red-team-2026-10-24.md). The independent review was waived, not completed.
- **Solana upgrade authority.** A retained upgrade key can replace the program and empty every vault. The README and the adapter require `null` on mainnet. That is a launch gate, not a finding, and this review did not verify any deployment.
  **Status: superseded.** The owner retains the Solana upgrade authority in production without a timelock, and the EVM deployment authority may upgrade factories and vaults without a timelock; both are recorded as accepted risks (PRD section 11 "Solana upgrade authority", "EVM upgrade authority" and "Upgrade key custody"; `red-team-2026-10-24.md`).
- **Independent audit.** This review was produced by models under the direction of a non-independent operator. It is a pre-audit. An independent review before any mainnet escrow remains the plan.
  **Status: waived.** On 24 October 2026 the owner waived the independent audit and the signer/attester legal review; they are waived, not completed (PRD section 11). This report and `red-team-2026-10-24.md` are internal reviews. The separate [external finding](external-cancel-cap-rotation-2026-10-20.md) is also not an independent contract audit.

## 7. Test coverage gaps in the repository's own suites

The Solana end-to-end suite (`contracts/solana/integration/escrow.e2e.mjs`) does not exercise: commit after a binding is already active (the M-1 ordering); a second veto on the next version; two projects sharing the authority with different delays; `pay` with a non-ATA fee account owned by the fee recipient, or with a frozen fee account; a veto for a version that does not exist yet; lamport dust at the veto, obligation and origin addresses before creation; `withdraw` to a non-owner token account; `deposit` by a non-owner; `initialize` with authority equal to owner, a negative delay, a Token-2022 or non-six-decimal mint; an off-curve destination; a zero-fee award under 50 units; a zero claim digest; two `pay` instructions in one transaction; the exact activation instant.

The EVM integration suite does not exercise the M-1 ordering, repeated cancel, rotation of an active binding, or extreme delay values. The 47 review tests cover all of these for EVM and can be adopted into `contracts/evm/test/`.

**Status:** #673 and #675 adopted the review tests into `contracts/evm/test/`, and CI runs them (section 2). #673 added a Solana end-to-end test that covers commit after an active binding (the M-1 ordering), more than one veto and the veto cap, the bind checks of L-4, a zero-fee award under 50 units, and the delay bounds. The other Solana items in the first paragraph were not checked again and remain open.

## 8. Recommended order of work

1. Decide the identity-authority holder and recovery design (H-1, section 6). This is a product and legal decision before it is a code change. **Done:** #675, approved 14 October 2026.
2. Land the three binding-lifecycle fixes together on both chains: delay measured from commit as well as bind (M-1), active binding survives a pending rotation (M-2), bounded delay with an explicit cancelled flag (L-1). **Done:** #673, with the M-2 rotation rule stated under M-2.
3. Land the small Solana hardening: zero-digest, destination and expiry checks (L-4); `fee_recipient != owner` and delay maximum at `initialize` (L-3); skip the zero fee transfer (L-2). **Done:** #673. **Open:** pinning of the Solana authority and fee recipient (L-3), and a fallback for a frozen fee account on payouts that have a fee (L-2).
4. Update both READMEs (M-2 wording, no-recovery property, I-5 items) and `docs/payouts-mvp.md:17`. **Partly done:** #673 and #675 changed the M-2 wording and added the recovery runbook; the I-5 items are open.
5. Adopt the review tests and close the end-to-end gaps in section 7. **Partly done:** the tests are adopted and CI runs them; some Solana end-to-end gaps remain (section 7).
6. Decide the 10% withdrawal fee (PRD section 18 and the section 22 "Withdrawal fee" row). **Done:** 2%, `ceil(gross / 50)`, equal to the award fee (PRD section 6).
7. Independent audit before any mainnet deployment. **Waived:** owner decision of 24 October 2026, not completed (PRD section 11 "External reviews"); mainnet contracts deployed, activation still explicit per network.

## Appendix: reviewer reports and tests

Raw reviewer reports: [five files at commit `4e5fe12b`](https://github.com/SlopDotCash/slopdotcash/tree/4e5fe12b2ac7e0fbee8f5d60581f54aa465c68c7/docs/security/escrow-ai-review-2026-10-12) (`evm-fable.md`, `evm-opus.md`, `solana-fable.md`, `solana-opus.md`, `parity-sonnet.md`). They are the unedited run records on `bbcc87b`. The repository no longer keeps them; this summary records every finding and its status. Their `scratchpad/...` test paths and test names are historical: the scratch copies were not kept, and #673 and #675 adopted the six test files into `contracts/evm/test/` and renamed each finding test when they changed it to assert the fixed behavior.

Foundry tests on `development`: `contracts/evm/test/` (eight files, 68 tests). Run with `forge test --root contracts/evm` from the repository root. `contracts/evm/foundry.toml` pins the fuzz and invariant profile. The `Escrow accounting and recovery` CI workflow (`.github/workflows/escrow-tests.yml`) runs `forge test` on every pull request that changes `contracts/` or another payment path.
