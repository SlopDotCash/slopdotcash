# ReferralDistributor: AI-assisted internal review

**Status:** internal, AI-assisted review. Not an independent audit. The owner approved the referral program it serves on 25 October 2026 (PRD section 11, "Referral program"). The program token is not deployed, and live root posting needs the owner's explicit activation.
**Historical scope:** This report describes the seven-day-delay contract reviewed on 25 October. The immediate-claim revision proposed on 26 October removes that intervention window and requires its own source-bound review; the earlier findings are not acceptance of that revision.
**Date:** 25 October 2026
**Commissioned and reconciled by:** Drew Pierson (Operator, Slop Cash S.P.), using Claude Fable 5.1 as lead reviewer and author of the contract. Drew is not independent of the project and is not a security engineer. The repository owner (Shaw Walters) did not take part.
**Code reviewed:** `contracts/evm/src/ReferralDistributor.sol` as first written on branch `drew/referral-distributor-contract` (275 lines, Solidity 0.8.30, no proxy, no external library), with `contracts/evm/test/ReferralDistributor.t.sol` (15 tests at review time), `contracts/evm/integration/MockReferralToken.sol` and `contracts/evm/script/DeployReferralDistributorRobinhoodTestnet.s.sol`.
**Fix status:** every finding rated Medium or above, and most Low ones, were fixed in the same pull request before it opened. Section 5 says what changed and section 6 what the fixed code still does not protect against. The reviewers' proof-of-concept suites were re-run against the fixed contract: each test that demonstrated an attack now reverts at the new check, and each test that asserted the old pause or rescue behaviour now fails for the intended reason.

## 1. Headline

The contract as first written had one High design flaw that all three reviewers found independently: `postRoot(index, root, newTotal)` checked the cap and the funding against `newTotal`, a number the poster declares, while `claim()` never compared what it paid against that total. The Merkle root is opaque on chain, so a poster key alone (or a buggy accrual job) could post a one-leaf root for the entire balance with a declared growth of one base unit, wait seven days, and drain the contract. The declared bounds held for the number, not for the payout.

The second shared finding was the pause and void interplay: pausing blocked posts and claims but did not stop the seven-day objection window, so an owner who paused to investigate could lose the chance to void, and a rescue was allowed while paused, which let a paused contract reach the 365-day sweep without claimants ever getting a block to claim in.

Both are fixed. Claims are now bound in sum to the active root's declared total, the objection window freezes while paused, rescue is refused while paused or while a root is pending and counts from the last root going live or the last unpause, live posts have a minimum spacing, a total may shrink only to what was already claimed, and the cap is measured from the highest total ever posted. After the fixes the bound on a malicious root the owner does not void is the unclaimed part of the previous total plus one `epochCap` (section 6), and the off-chain watcher that rebuilds each root from the public accrual file is still a required control.

| Severity | Count (as written) | Fixed | Summary |
|---|---|---|---|
| Critical | 0 | | |
| High | 2 | 2 | Declared total not bound at claim time (A-1, B-01, C-1). A matured bad root cannot be contained by pause (B-03, with C-2 and A-4 as the same root cause). |
| Medium | 5 | 4 | Pause plus rescue removes the claim window (A-3); zero-growth repost redirects unclaimed amounts (B-02, design residual, documented); single owner role for the fast veto (B-04, deployment decision); total may not shrink below a dropped leaf (B-05); omitted leaf forfeits and wallet change double pays (B-06, B-07, off-chain job rules). |
| Low | 6 | 5 | Per-account decrease overpays (A-2, C-3); cap per post not per month (A-5); token assumptions (A-10, B-08); stale getters (A-7, B-09); rescue sweeps obligations (B-10, documented); index vs file numbering (B-11, documented). |
| Informational | 7 | | Voided posts restart the rescue clock (A-6, C-4, fixed); `liveRoot` gas over voided tails (A-8, B-12, C-5); sequencer effects (A-9); hygiene and NatSpec (A-11, B-13, B-14, B-15, C-6). |

## 2. Method

Three independent reviews ran against the same source, each with a distinct brief, then the lead re-checked every claim against the code and the reviewers' Foundry proofs:

| Reviewer | Brief | Provider and model | Evidence produced |
|---|---|---|---|
| A | Line-by-line contract security, state machine, Merkle construction, tests | Anthropic, Claude Opus (Claude Code subagent) | 9 Foundry tests (`ReviewAPoc`), all passing on the original |
| B | Economics and operations: key compromise, liveness, cumulative semantics, index semantics, deploy script, events, documentation | Anthropic, Claude Sonnet (Claude Code subagent) | 10 Foundry tests (`ReviewBPoc`), all passing on the original |
| C | Adversarial proof-of-concept campaign | Anthropic, Claude Opus (Claude Code subagent) | 22 Foundry tests (`ReviewCPoc`), all passing on the original (a pass meant the attack succeeded for C-series tests and that the contract refused it for A-series tests) |
| Lead | Reconciliation, fixes, regression tests | Anthropic, Claude Fable 5.1, Claude Code client | This report, the fixed contract, 19 regression tests |

Attribution limits: the exact model versions and request counts of the three reviewer runs were not recorded and are stated as not recorded. Each reviewer wrote its proofs as a temporary file under `contracts/evm/test/`, ran `forge test --root contracts/evm` (Foundry 1.7.1, solc 0.8.30, cancun), and deleted the file; the sources are kept in the reviewers' reports, which are not committed. The lead re-ran reviewers A's and C's suites unchanged (apart from the new constructor argument) against the fixed contract: of A's 9 tests, 6 now fail and 3 pass; of C's 22, 9 now fail and 13 pass. Every failure is at the new `TotalExceeded`, `IsPaused`, `RootPending` or `RescueTooEarly(uint64)` check, or is a test asserting that shrinking or a rescue while paused is accepted, which is the fixed behaviour.

Reconciliation rules: a finding appears below only when the lead reproduced the reasoning against the source or a passing proof demonstrates it. Where reviewers disagreed on severity the lead's choice is stated. Three reviewer claims were rejected or narrowed: C's suggestion that `postRoot` run while paused (posting while paused would let a replacement root mature with claims frozen, but it also lets a compromised poster keep posting during an incident; the freeze of the objection window is the chosen fix); B's suggestion to let the owner revoke a live root (that would let the owner change a live root, which the trust model forbids); and A-9's one-hour sequencer timestamp drift, which is real but immaterial against a seven-day window and is noted, not rated.

Out of scope: the accrual job (`workers/referral-accrual`, a separate pull request), the poster Worker (a later pull request), key custody, the program token's own behaviour, and the question of who should hold the owner and poster keys at launch (an owner decision).

## 3. Trust model used

| Role | Documented power | Must not be able to |
|---|---|---|
| Poster (hot key) | Post one root per epoch when none is pending, at least `postSpacing` after the last live post, with a declared total not below what was claimed and not above the high-water total plus `epochCap`, covered by balance plus claimed | Move tokens; pay more than the declared total; post two pending roots; bypass the delay |
| Owner | Void a pending root; pause (freezes the pending window; blocks posts, claims, rescue); change the poster; two-step ownership transfer; rescue the whole balance after `RESCUE_DELAY` with no root going live and no unpause | Take claimable funds before that expiry; change a live root; block one claimant selectively |
| Claimant | Pull `cumulative - claimed` against the active root after its window | Claim twice; claim another account's leaf; claim from a voided or pending root; push the sum of claims past the declared total |
| Anyone | Nothing else | Lock funds; grief epochs |

Documented and accepted: the owner can pause indefinitely, void every root, and after 365 idle days sweep unclaimed amounts (which ends the program); a token with a blocklist or pause would block claims and rescue alike; a referrer omitted from a later tree loses access to earlier unclaimed amounts, so the off-chain job must carry every account forward (section 6).

## 4. Findings (as written) and resolution

### H-1. The declared total did not bound what a root pays (A-1, B-01, C-1)

`postRoot` checked `newTotal - activeTotal <= epochCap` and `balance + totalClaimed >= newTotal`; `claim` verified the proof and paid `cumulative - claimed[msg.sender]` with no reference to `activeTotal`. Proofs: A's `test_A1_declaredTotalDoesNotBoundClaims`, B's `test_poc_capBypass`, C's `test_C1_declaredTotalUnboundPosterDrainsBalance` (a one-leaf root for the poster's own address, declared growth of one base unit, the whole 1,000,000-token balance claimed after seven days) and `test_C1b_underDeclaredTwoLeafTreeAccepted`. Rating: High by all three; the lead agrees. It would be Critical if the only monitor compared on-chain totals.

**Fixed:** `claim` reverts `TotalExceeded` when `totalClaimed + amount > activeTotal`, and `claimable()` returns zero in that case. Regression `test_R14_claimsNeverExceedTheDeclaredTotal`. The NatSpec trust model was rewritten to say what bounds the poster.

### H-2. A matured bad root could not be contained by pause (B-03, C-2, A-4) and pause plus rescue removed the claim window (A-3)

Pause blocked `postRoot` and `claim` but the objection window kept running (`voidRoot` compared `block.timestamp` with `postedAt + CLAIM_DELAY` regardless of `paused`), so an owner who paused to investigate on day six lost the void on day seven, and on unpause the bad root paid in the same block before any corrected root could mature (C's `test_C2_pauseCannotBeCombinedWithCorrection`, A's `test_A3_pendingRootMaturesWhilePaused`, B's `test_poc_missedWindowRecovery`). Separately, `rescue` was not pause-gated and counted from `lastPostedAt`, which could not move while paused, so a paused contract reached the 365-day sweep with claimants never having a block to claim in (A's `test_A4_pauseThenRescueLeavesNoClaimWindow`). Rating: B High, C Medium, A Medium plus Low; the lead rates the pair High because together they turn an incident response into a loss.

**Fixed:** `pause()` records `pausedAt`; while paused, a window that was open at the pause extends by the time paused so far (`windowEnd`), and `unpause()` bakes the extension into `postedAt` and emits the new claimable time, so a pending root keeps exactly the time it had left and `voidRoot` works during a pause of any length. `rescue` is `whenNotPaused`, refuses while a root is pending, and counts `RESCUE_DELAY` from the later of the active root going live and the last unpause (`rescueAvailableAt()`), so claimants always have the full delay on an unpaused contract. Regressions `test_R8_pauseBlocksPostsAndClaimsAndFreezesTheWindow` and `test_R9_rescueOnlyAfterExpiry`. The incident order in the runbook is: pause, rotate the poster, void, unpause.

### M-1. A zero-growth repost can redirect unclaimed amounts (B-02)

After H-1, a malicious root can still name an attacker for every unclaimed unit of the previous total plus one `epochCap`, since the contract cannot see inside a root. This is the inherent residual of a Merkle distributor with an opaque root. **Not a code fix.** Mitigations in the fixed code: the sum of claims is bound to the declared total; `postSpacing` (27 days proposed) limits how often the cap can be added; the seven-day window with a frozen clock under pause gives the owner time. The required control is off chain: a watcher that rebuilds each root from the public accrual file after every `RootPosted` and alerts a human to void before day five (runbook).

### M-2. One owner role holds the fast veto and the slow powers (B-04)

A decision market or a slow multisig cannot reliably act inside seven days; a fast hot key as owner exposes `setPoster`, `pause` and `rescue`. **Not a code fix in this revision.** The runbook now says the launch owner must be able to act within five days and that a separate guardian role (void and pause only) is the recommended change if the owner is a decision market. Who holds the keys is the owner's decision.

### M-3. The total could never shrink, so a dropped leaf made the honest root unpostable (B-05) and a per-account decrease overpaid the total (A-2, C-3)

`newTotal < activeTotal` reverted, so when the off-chain tree lost a leaf (a wallet dropped), the poster had to pad the total; and a later tree that lowered one account below what it had claimed let the contract pay more than the posted total (A's `test_A2_perLeafDecreaseOverpays`, C's `test_C3_downwardCorrectionBreaksCoverage`). **Fixed:** the total may shrink down to `totalClaimed` (`BelowClaimed` otherwise), the cap is measured from `highWaterTotal` so shrinking buys no extra room, and with H-1 a per-account decrease fails closed at `TotalExceeded` instead of overpaying. Regression `test_R15_totalMayShrinkOnlyToWhatWasClaimed`. The off-chain rule stands: a live cumulative must never decrease, and a wallet once included stays included (section 6).

### M-4. An omitted leaf forfeits and a wallet change pays twice (B-06, B-07)

Claims verify only against the latest live root, so an account absent from the next tree loses access to its earlier unclaimed amount; and `claimed` is per address, so a referrer who claimed at wallet W1 and is later filed under W2 with its full cumulative is paid twice (B's `test_poc_walletMigrationDoublePay`). **Off-chain fix, in the accrual job:** the wallet that first enters a tree for a referrer is pinned for that referrer in every later file, so a leaf never moves between addresses and never disappears; the job also asserts each cumulative is non-decreasing. This is implemented in the accrual job's pull request (`referral_claim_wallets`), not in the contract. The contract keeps per-address accounting by design: a referrer who loses the pinned wallet's key needs a manual case, not a contract path.

### L-1. The cap was per post, not per month (A-5)

Posts could follow every seven days, about 52 per year, so the on-chain growth bound was `epochCap` per week. **Fixed:** constructor `postSpacing` (seconds, at most `RESCUE_DELAY`); a post sooner than `postSpacing` after the last non-voided post reverts `TooSoon(earliest)`; a voided post neither consumes the spacing nor raises the high-water mark. The deploy script defaults it to 27 days. Regression `test_R16_postSpacing`.

### L-2. Voided posts restarted the rescue clock and a post could follow a void at once (A-6, C-4)

**Fixed** by H-2's change of the rescue clock to activation and unpause time (a voided post never goes live). A post may still follow a void at once, which is intended: the corrected file should post without waiting. `setPoster` still leaves the old poster's pending root in place; the runbook orders rotation before void so the rotated-out key cannot repost in between.

### L-3. Token and constructor assumptions (A-10, B-08)

`transfer` must return `bool`; a fee-on-transfer, rebasing, pausable or blocklisting token breaks the accounting or blocks claims and rescue; the constructor accepted any non-zero address as the token. **Partly fixed:** the constructor now refuses `owner == poster`, `setPoster` refuses the owner, `transferOwnership` refuses the poster, and `postSpacing` is bounded. The token checks are documented in NatSpec and the runbook (the program token is a plain 18-decimal ERC-20 the S.P. controls); a `code.length` check is a reasonable addition for the mainnet script.

### L-4. Public getters are lazy (A-7, B-09)

`activeRoot` and `activeTotal` change only inside `activate()`, called from `claim`, `postRoot` and `rescue`, so after a root's window passes and before the next transaction the getters show the previous root. **Fixed in part:** `currentRoot()` returns the root claims would verify against now, `claimableAt(index)` returns the window end including pause extensions, and `claimable()` already read the live root. The cached getters stay cached and are documented as such (`test_R17`).

### L-5. Rescue sweeps obligations (B-10) and the index diverges from the file numbering (B-11)

Rescue sweeping unclaimed amounts after a year of no live root is the documented wind-down; the fixed code additionally refuses it while paused or pending and counts from activation, so claimants always have 365 unpaused days. The on-chain index counts voided epochs and files with no leaves are not posted at all, so the index and the file epoch differ by design; the poster journal (later pull request) records `{period, index, root, transaction}` and the poster always reads `nextEpoch()`. Both documented, no contract change.

### Informational

- `liveRoot()` walks back over trailing voided epochs at about 2,000 gas each (A-8, B-12, C-5: 200 voided epochs cost 157k gas warm; roughly 14,000 consecutive owner voids would approach a block limit). Not exploitable, each void is an owner transaction, and the walk resets at the next live root. Left as is.
- Arbitrum Nitro sequencer timestamp drift (about one hour) and forced-inclusion delay (about 24 hours) shorten the practical void window; the runbook says to decide by day five (A-9).
- The deploy script's `ReferralDistributorDeployed` event is emitted by the script contract, so it appears in simulation logs only; evidence must come from `cast call` read-backs (B-14). The mock's open `mint` is for the testnet only.
- `RootActivated` is emitted lazily and can skip epochs; indexers derive the live root from `RootPosted` and `RootVoided` plus time, or call `currentRoot()` (B-13).
- `acceptOwnership` keeps the `address(0)` guard so a cancelled transfer (`transferOwnership(address(0))`) cannot be accepted (A-11, C-6).

## 5. What changed in the contract

- `claim`: `TotalExceeded` when `totalClaimed + amount > activeTotal`; `claimable()` mirrors it.
- `postRoot`: `BelowClaimed` when `newTotal < totalClaimed`; `CapExceeded` measured from `highWaterTotal`; `TooSoon(earliest)` when sooner than `postSpacing` after the last live post.
- `voidRoot`: restores `lastLivePostedAt` and `highWaterTotal` to the previous live post.
- `pause` and `unpause`: the pending root's window is frozen while paused and extended on unpause (`Unpaused(account, extendedEpoch, newClaimableAt)`).
- `rescue`: `whenNotPaused`, refuses while pending, counts from the later of the active root going live and the last unpause; `RescueTooEarly(earliest)` carries the time.
- Views: `currentRoot()`, `claimableAt(index)`, `rescueAvailableAt()`, `highWaterTotal`, `lastLivePostedAt`, `lastLiveAt`, `lastUnpausedAt`, `postSpacing`.
- Roles: owner and poster must differ at construction, in `setPoster` and in `transferOwnership`.
- Tests: 19 (from 15), adding R-14 to R-17 and extending R-5, R-7, R-8, R-9 and R-13.

## 6. Residual risks and required controls

- A malicious or buggy root the owner does not void inside its window can redirect up to the unclaimed part of the previous total plus one `epochCap`. An off-chain watcher must rebuild every posted root from the public accrual file and a human must decide to void by day five. The poster key is a hot key; treat its compromise as a drill the runbook rehearses.
- The owner can pause forever and, after 365 unpaused days with no live root, sweep unclaimed amounts. Say so on any public page.
- The accrual job must pin each referrer's claim wallet once it enters a tree, never lower a cumulative, and carry every account forward. A referrer who loses the pinned wallet's key has no contract path.
- The program token must be a plain ERC-20 with exact transfers and a `bool` return; a token with a pause or blocklist can block claims and rescue.
- This review did not cover the accrual job, the poster Worker, key custody, or deployment. No testnet or mainnet deployment exists. The owner waived independent audits for the escrow (PRD section 11); this contract has had no independent review of any kind and this report must not be described as an audit.
