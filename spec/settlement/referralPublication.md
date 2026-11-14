# Referral root publication and claims

PRD section 11 requires a separately activated poster, complete filed accruals,
pinned recipient wallets and finalized evidence. This machine owns root
publication, uncertain attempts, native reservations and claims. It consumes
the activation model and complete accrual ledger; those services must provide
their current authenticated records, never caller-asserted substitutes. The
[distributor contract](./referralDistributor.md) owns on-chain authority,
funding, sequential epochs, spacing, pause and rescue behavior; successful
observations here must reconcile that exact contract state.

## Story: Publish one complete cumulative root

### The next immutable filed tree supplies every root entry

The accrual service freezes wallet pins and exact tree entries in each filed
period, including dry-run files. The poster consumes the oldest nonempty file
that has not occupied a chain epoch. It never rerenders an old file from newer
wallets or later totals. A referrer with no authorized wallet remains in the
accrual ledger and enters a later file when a wallet is available. When new actors share an address, the lowest immutable actor ID keeps the
leaf; the others remain walletless in that tree. An address already pinned to
another actor is withheld. Those actors keep their accruals and can resolve
the current-wallet conflict.
Existing pins are retained independently of current-wallet changes. All projects contribute to the same
lifetime cap. Each actor appears once with its cumulative amount. The positive `id` is an off-chain journal identity; `epoch` is separately the
contract's zero-based next index. Preparation and signing both recheck the
authenticated distributor snapshot through its `canPostRoot` rule. The Merkle
encoder must verify the committed digest against these exact entries and total; its byte-level correctness
requires the future adapter's independent tests.

```quint
import money as M from "./money"
import referrals as R from "./referrals"
import referralAccrual as A from "./referralAccrual"
import referralDistributor as D from "./referralDistributor"
type EntryComparison = { index: int, matches: bool }
pure val emptyEntryComparison: EntryComparison = { index: 0, matches: true }
pure val emptyEntry: A::RootEntry = { actor: 0, wallet: "", amount: M::zero }
pure def sameEntry(leftEntry: A::RootEntry, rightEntry: A::RootEntry): bool =
  leftEntry.actor == rightEntry.actor and leftEntry.wallet == rightEntry.wallet
    and M::validAmount(leftEntry.amount) and M::validAmount(rightEntry.amount)
    and M::equalAmounts(leftEntry.amount, rightEntry.amount)
pure def sameEntries(leftEntries: List[A::RootEntry], rightEntries: List[A::RootEntry]): bool =
  val comparison = leftEntries.foldl(emptyEntryComparison, (acc, entry) =>
    { index: acc.index + 1, matches: acc.matches and sameEntry(entry, rightEntries.nthOr(acc.index, emptyEntry)) })
  leftEntries.length() == rightEntries.length() and comparison.matches
type Root = { id: int, epoch: int, merkleRoot: str, period: int, sourceDigest: str, entries: List[A::RootEntry], total: M::Amount,
  height: int, voided: bool, sealed: bool, voidAcknowledged: bool }
type RootReceipt = { attempt: int, rootId: int, epoch: int, merkleRoot: str, entries: List[A::RootEntry],
  total: M::Amount, receipt: int, height: int, actualGas: int, settledDay: int, finalized: bool, succeeded: bool }
type ClaimReceipt = { actor: int, wallet: str, cumulative: M::Amount, rootId: int,
  transferred: M::Amount, receipt: int, height: int, finalized: bool }
type Claim = { actor: int, cumulative: M::Amount }
type PostingPhase = Idle | Prepared | Journaled | Submitted | Uncertain
type GasSettlement = { attempt: int, actual: int, day: int }
type Attempt = { id: int, root: int, epoch: int, day: int, reservedGas: int }
type Publication = { phase: PostingPhase, prepared: Root, roots: List[Root], attempts: List[Attempt],
  claims: List[Claim], pins: List[A::Wallet], receipts: List[int], token: str, tokenUnit: M::Amount, currentAttempt: int,
  day: int, settledGas: List[GasSettlement], nativeHold: int, postingPaused: bool, distributorPaused: bool, cacheFresh: bool }
pure val emptyRoot: Root = { id: 0, epoch: -1, merkleRoot: "", period: 0, sourceDigest: "", entries: List(), total: M::zero,
  height: 0, voided: false, sealed: false, voidAcknowledged: false }
pure val initial: Publication = { phase: Idle, prepared: emptyRoot, roots: List(), attempts: List(),
  claims: List(), pins: List(), receipts: List(), token: "", tokenUnit: M::zero, currentAttempt: 0,
  day: 1, settledGas: List(), nativeHold: 0, postingPaused: false, distributorPaused: false, cacheFresh: false }
pure def spentGas(p: Publication): int = p.settledGas.foldl(0,
  (total, settlement) => total + (if (settlement.day == p.day) settlement.actual else 0))
pure def claimedFor(p: Publication, actor: int): M::Amount = p.claims.foldl(M::zero,
  (found, claim) => if (claim.actor == actor) claim.cumulative else found)
pure def totalClaimed(p: Publication): M::Amount = p.claims.foldl(M::zero,
  (total, claim) => M::addAmounts(total, claim.cumulative))
pure def activeRoot(p: Publication): Root = p.roots.foldl(emptyRoot,
  (found, root) => if (not(root.voided)) root else found)
pure def nextFiling(p: Publication, a: A::Accrual): A::Filing =
  a.filings.select(file => file.entries.length() > 0 and p.roots.every(root => root.period < file.period)).nthOr(0, A::emptyFiling)
pure def priorFinalizedTotal(p: Publication): M::Amount = p.roots.foldl(M::zero,
  (highest, root) => if (not(root.voided) and M::compareAmounts(root.total, highest) > 0) root.total else highest)
pure def canPrepare(p: Publication, control: R::Referral, a: A::Accrual, rootId: int,
  chain: D::Distributor, merkleRoot: str, rootVerified: bool, signer: str): bool =
  p.phase == Idle and not(p.postingPaused) and control.mode == R::Posting and R::alwaysActivationReady(control)
    and a.configured and nextFiling(p, a).entries.length() > 0
    and A::alwaysUnitValid(a) and A::alwaysCompleteFilings(a) and A::alwaysFileTotals(a) and A::alwaysPinsUnique(a) and A::alwaysFileWalletPinned(a)
    and p.pins.every(pin => a.pins.includes(pin))
    and rootId > 0 and p.roots.every(root => root.id < rootId)
    and (p.roots.length() == 0 or M::equalAmounts(p.tokenUnit, a.tokenUnit))
    and M::equalAmounts(chain.tokenUnit, a.tokenUnit) and rootVerified and chain.epochs.length() == p.roots.length()
    and (p.token == "" or chain.token == p.token)
    and p.roots.every(root => not(root.voided) or root.voidAcknowledged)
    and D::canPostRoot(chain, chain.epochs.length(), merkleRoot, nextFiling(p, a).total, signer)
    and M::compareAmounts(nextFiling(p, a).total, priorFinalizedTotal(p)) >= 0
    and M::compareAmounts(nextFiling(p, a).total, A::poolCap(a)) <= 0
    and M::compareAmounts(nextFiling(p, a).total, totalClaimed(p)) >= 0
    and nextFiling(p, a).entries.every(e => M::compareAmounts(e.amount, claimedFor(p, e.actor)) >= 0)
pure def prepare(p: Publication, control: R::Referral, a: A::Accrual, rootId: int,
  chain: D::Distributor, merkleRoot: str, rootVerified: bool, signer: str): Publication =
  val filing = nextFiling(p, a)
  { ...p, phase: Prepared, token: chain.token, tokenUnit: a.tokenUnit, pins: a.pins,
    prepared: { id: rootId, epoch: chain.epochs.length(), merkleRoot: merkleRoot, period: filing.period,
      sourceDigest: filing.sourceDigest, entries: filing.entries, total: filing.total,
      height: 0, voided: false, sealed: false, voidAcknowledged: false } }

```

### Every signed root reserves gas and journals its exact identity first

Native amounts are integer wei. The 0.0002 ETH transaction ceiling and
0.002 ETH UTC-day ceiling are independent of fee conversion. Every retry has
an immutable attempt ID. An uncertain send retains its hold, across day changes,
until a finalized outcome proves the cost and its actual settlement UTC day.
Settled costs count only on that day; a late old-day receipt does not become
new-day spending. Every unresolved maximum remains reserved on every day. The poster cannot transfer tokens.

```quint
pure def canJournal(p: Publication, control: R::Referral, attempt: int, gas: int, chain: D::Distributor, signer: str): bool =
  p.phase == Prepared and not(p.postingPaused) and control.mode == R::Posting and R::alwaysActivationReady(control)
    and D::canPostRoot(chain, p.prepared.epoch, p.prepared.merkleRoot, p.prepared.total, signer)
    and M::equalAmounts(chain.tokenUnit, p.tokenUnit) and chain.token == p.token and chain.epochs.length() == p.roots.length()
    and p.roots.every(root => not(root.voided) or root.voidAcknowledged)
    and attempt > 0 and not(p.attempts.some(old => old.id == attempt)) and gas > 0
    and R::posterGasAllowed(gas, spentGas(p) + p.nativeHold + gas)
pure def journal(p: Publication, control: R::Referral, attempt: int, gas: int, chain: D::Distributor, signer: str): Publication =
  { ...p, phase: Journaled, currentAttempt: attempt, nativeHold: gas,
    attempts: p.attempts.append({ id: attempt, root: p.prepared.id, epoch: p.prepared.epoch, day: p.day, reservedGas: gas }) }
pure def canDiscardPrepared(p: Publication): bool = p.phase == Prepared and p.nativeHold == 0
pure def discardPrepared(p: Publication): Publication = { ...p, phase: Idle }
pure def canSubmit(p: Publication, control: R::Referral): bool = p.phase == Journaled and not(p.postingPaused)
  and control.mode == R::Posting and R::alwaysActivationReady(control)
pure def submit(p: Publication, control: R::Referral): Publication = { ...p, phase: Submitted }
pure def canLoseObservation(p: Publication): bool = p.phase == Submitted
pure def loseObservation(p: Publication): Publication = { ...p, phase: Uncertain }
pure def canRetransmit(p: Publication, control: R::Referral): bool = p.phase == Uncertain and not(p.postingPaused)
  and control.mode == R::Posting and R::alwaysActivationReady(control)
pure def retransmit(p: Publication, control: R::Referral): Publication = { ...p, phase: Submitted }
pure def canObserveDay(p: Publication, day: int): bool = day > p.day
pure def observeDay(p: Publication, day: int): Publication = { ...p, day: day }
pure def canSetPostingPaused(p: Publication, paused: bool, by: str): bool = by == "owner"
pure def setPostingPaused(p: Publication, paused: bool, by: str): Publication = { ...p, postingPaused: paused }
```

### Only exact finalized evidence makes a root claimable

Entry equality preserves list order and checks each exact actor and wallet,
while comparing monetary amounts by value. Trailing zero limbs do not change
an amount or invalidate otherwise identical finalized evidence. Verified
token-unit scales also compare by monetary value, independently of padding.
The chain adapter must verify the pinned distributor, network, token, Merkle
root and every retained entry before emitting this evidence. Missing or
conflicting evidence remains Uncertain. A finalized failed send permits a new
attempt and consumes its actual gas; it never adds a root.

```quint
pure def canFinalize(p: Publication, rootReceipt: RootReceipt): bool =
  (p.phase == Submitted or p.phase == Uncertain) and rootReceipt.attempt == p.currentAttempt
    and rootReceipt.rootId == p.prepared.id and rootReceipt.epoch == p.prepared.epoch
    and rootReceipt.merkleRoot == p.prepared.merkleRoot and sameEntries(rootReceipt.entries, p.prepared.entries)
    and M::equalAmounts(rootReceipt.total, p.prepared.total)
    and rootReceipt.receipt > 0 and not(p.receipts.includes(rootReceipt.receipt)) and rootReceipt.height > 0
    and rootReceipt.finalized and rootReceipt.succeeded
    and rootReceipt.actualGas >= 0 and rootReceipt.actualGas <= p.nativeHold
    and rootReceipt.settledDay > 0 and rootReceipt.settledDay <= p.day
pure def finalize(p: Publication, rootReceipt: RootReceipt): Publication =
  { ...p, phase: Idle, roots: p.roots.append({ ...p.prepared, height: rootReceipt.height }),
    receipts: p.receipts.append(rootReceipt.receipt),
    settledGas: p.settledGas.append({ attempt: rootReceipt.attempt, actual: rootReceipt.actualGas, day: rootReceipt.settledDay }),
    nativeHold: 0, cacheFresh: false }
pure def canFinalizeFailure(p: Publication, attempt: int, receipt: int, actualGas: int, settledDay: int, finalized: bool, succeeded: bool): bool =
  (p.phase == Submitted or p.phase == Uncertain) and attempt == p.currentAttempt
    and receipt > 0 and not(p.receipts.includes(receipt)) and finalized and not(succeeded) and actualGas >= 0 and actualGas <= p.nativeHold and settledDay > 0 and settledDay <= p.day
pure def finalizeFailure(p: Publication, attempt: int, receipt: int, actualGas: int, settledDay: int, finalized: bool, succeeded: bool): Publication =
  { ...p, phase: Prepared, receipts: p.receipts.append(receipt), settledGas: p.settledGas.append({ attempt: attempt, actual: actualGas, day: settledDay }), nativeHold: 0 }
```

## Story: Claim immediately without reissuing paid tokens

### A claim uses the active root's pinned wallet and cumulative amount

Claims need no waiting period. First-use wallets remain pinned for this
distributor's entire lifetime, including in later roots and after a void.
Changing the account's current wallet never moves a cumulative leaf, because
the contract tracks claimed amounts per address. This lifetime rule comes from
[`workers/referral-accrual/core.ts:403–410`](https://github.com/SlopDotCash/slopdotcash/blob/6b3b9d0b979f0608d87941f1146056a98513ffcf/workers/referral-accrual/core.ts#L403-L410);
its lines 425–460 keep existing pins and choose the lowest actor ID when a new
address is shared.
The finalized receipt pays only the increase above the actor's lifetime claimed
amount. A successful claim seals the active root. The owner may void only the
latest unsealed root, restoring the prior live root without rewriting history.
Neither pause, key rotation nor void can recover an earlier payment.
A poster operational pause stops new publication sends only. It never blocks
recording a finalized claim. The deployed distributor has its own on-chain
pause, which blocks executing new claims, as recorded by its finalized cache;
this is distinct from stopping the poster. A pending claim can beat a pause. An observed owner void halts new posts until
an authenticated operator acknowledges it; that acknowledgement does not
restore the voided root or change any claim. Posted periods remain unique and
increasing, including voided epochs. This matches pinned
`workers/referral-accrual/core.ts:816–889`.

```quint
pure def canClaim(p: Publication, claimReceipt: ClaimReceipt): bool =
  activeRoot(p).id == claimReceipt.rootId and claimReceipt.rootId > 0 and activeRoot(p).height > 0
    and activeRoot(p).entries.some(e => e.actor == claimReceipt.actor and e.wallet == claimReceipt.wallet and M::equalAmounts(e.amount, claimReceipt.cumulative))
    and M::compareAmounts(claimReceipt.cumulative, claimedFor(p, claimReceipt.actor)) > 0
    and M::validAmount(claimReceipt.cumulative) and M::validAmount(claimReceipt.transferred)
    and M::compareAmounts(M::addAmounts(totalClaimed(p), claimReceipt.transferred), activeRoot(p).total) <= 0
    and M::equalAmounts(claimReceipt.transferred, M::subtractAmounts(claimReceipt.cumulative, claimedFor(p, claimReceipt.actor)))
    and claimReceipt.receipt > 0 and not(p.receipts.includes(claimReceipt.receipt))
    and claimReceipt.height > 0 and claimReceipt.finalized
pure def claim(p: Publication, claimReceipt: ClaimReceipt): Publication =
  { ...p, claims: p.claims.select(c => c.actor != claimReceipt.actor).append({ actor: claimReceipt.actor, cumulative: claimReceipt.cumulative }),
    receipts: p.receipts.append(claimReceipt.receipt),
    roots: p.roots.listMap(root => if (root.id == claimReceipt.rootId) { ...root, sealed: true } else root), cacheFresh: false }
pure def canVoidRoot(p: Publication, rootId: int, receipt: int, height: int, finalized: bool, by: str): bool =
  by == "owner" and p.roots.length() > 0 and p.roots.nthOr(p.roots.length() - 1, emptyRoot).id == rootId
    and not(p.roots.nthOr(p.roots.length() - 1, emptyRoot).sealed)
    and not(p.roots.nthOr(p.roots.length() - 1, emptyRoot).voided)
    and receipt > 0 and not(p.receipts.includes(receipt)) and height > 0 and finalized
pure def voidRoot(p: Publication, rootId: int, receipt: int, height: int, finalized: bool, by: str): Publication =
  { ...p, roots: p.roots.listMap(root => if (root.id == rootId) { ...root, voided: true, voidAcknowledged: false } else root),
    receipts: p.receipts.append(receipt), cacheFresh: false }
pure def canAcknowledgeVoid(p: Publication, rootId: int, by: str): bool = by == "operator"
  and p.roots.some(root => root.id == rootId and root.voided and not(root.voidAcknowledged))
pure def acknowledgeVoid(p: Publication, rootId: int, by: str): Publication =
  { ...p, roots: p.roots.listMap(root => if (root.id == rootId) { ...root, voidAcknowledged: true } else root) }
pure def canInvalidateCache(p: Publication): bool = p.cacheFresh
pure def invalidateCache(p: Publication): Publication = { ...p, cacheFresh: false }
pure def canRefreshCache(p: Publication, paused: bool, finalized: bool): bool = finalized
pure def refreshCache(p: Publication, paused: bool, finalized: bool): Publication =
  { ...p, distributorPaused: paused, cacheFresh: true }
type ClaimableView = { known: bool, amount: M::Amount }
pure def claimableFor(p: Publication, actor: int): ClaimableView =
  val entry = activeRoot(p).entries.foldl(M::zero, (amount, e) => if (e.actor == actor) e.amount else amount)
  { known: p.cacheFresh, amount:
    if (p.cacheFresh and not(p.distributorPaused) and M::compareAmounts(entry, claimedFor(p, actor)) >= 0)
      M::subtractAmounts(entry, claimedFor(p, actor)) else M::zero }
```

### History, native holds and cumulative claims remain bounded

Discovered by the proof: a structurally valid prepared record could otherwise
contain a wallet different from its retained pin. Preparation, signing and
reconciliation all retain the same pinned wallets.

A stale cache retains amounts and history, but does not advertise a currently
claimable amount. Accrued and pending amounts come from the accrual ledger;
claimed amounts come from finalized claim records. Missing cache evidence is
unknown, never evidence that the claim or balance is zero. `claimableFor`
returns `known: false` in that state; its amount field must not be displayed or
used. A confirmed distributor pause can establish a known current claimable
amount of zero without altering accrued or already-claimed amounts.

```quint
pure def alwaysNativeBounded(p: Publication): bool = spentGas(p) >= 0 and p.nativeHold >= 0
  and spentGas(p) + p.nativeHold <= 2000000000000000
pure def alwaysAttemptGasAccounted(p: Publication): bool = p.attempts.every(attempt =>
  p.settledGas.some(cost => cost.attempt == attempt.id) or
    ((p.phase == Journaled or p.phase == Submitted or p.phase == Uncertain) and attempt.id == p.currentAttempt and attempt.reservedGas == p.nativeHold))
pure def alwaysSettledGasValid(p: Publication): bool = p.day > 0 and p.settledGas.every(cost =>
  cost.actual >= 0 and cost.actual <= 200000000000000 and cost.day > 0 and cost.day <= p.day)
pure def alwaysHoldCeiling(p: Publication): bool = p.nativeHold >= 0 and p.nativeHold <= 200000000000000
pure def alwaysIdleUnreserved(p: Publication): bool = (p.phase == Idle or p.phase == Prepared) implies p.nativeHold == 0
pure def alwaysPreparedWalletsPinned(p: Publication): bool = p.phase != Idle implies
  p.prepared.entries.every(e => e.wallet == A::pinnedWallet(p.pins, e.actor))
pure def alwaysPreparedCap(p: Publication): bool = p.phase != Idle implies
  p.prepared.id > 0 and M::validAmount(p.prepared.total)
    and M::compareAmounts(p.prepared.total, M::multiplyAmounts(p.tokenUnit, M::smallAmount(2000000))) <= 0
pure def alwaysPendingHeld(p: Publication): bool =
  (p.phase == Journaled or p.phase == Submitted or p.phase == Uncertain) implies p.nativeHold > 0
pure def alwaysRootCap(p: Publication): bool = p.roots.every(root =>
  M::compareAmounts(root.total, M::multiplyAmounts(p.tokenUnit, M::smallAmount(2000000))) <= 0)
pure def alwaysUniqueClaims(p: Publication): bool = p.claims.every(c => p.claims.select(other => other.actor == c.actor).length() == 1)
pure def alwaysPinsUnique(p: Publication): bool = p.pins.every(pin => pin.wallet != "" and
  p.pins.select(other => other.actor == pin.actor).length() == 1 and
  p.pins.select(other => other.wallet == pin.wallet).length() == 1)
pure def alwaysRootWalletPinned(p: Publication): bool = p.roots.every(root =>
  root.entries.every(e => e.wallet == A::pinnedWallet(p.pins, e.actor)))
pure def stepTokenFixed(before: Publication, after: Publication): bool = before.token != "" implies after.token == before.token
pure def stepPinsRetained(before: Publication, after: Publication): bool = before.pins.every(pin => after.pins.includes(pin))
pure def stepAttemptsRetained(before: Publication, after: Publication): bool = before.attempts.every(a => after.attempts.includes(a))
pure def stepClaimedNeverFalls(before: Publication, after: Publication): bool = before.claims.every(c =>
  M::compareAmounts(claimedFor(after, c.actor), c.cumulative) >= 0)
pure def sometimesUncertain(p: Publication): bool = p.phase == Uncertain
pure def sometimesClaimed(p: Publication): bool = p.claims.length() > 0
pure def sometimesVoided(p: Publication): bool = p.roots.some(root => root.voided)
```

### Simulation includes live control, capped accruals and conflicting receipts

Receipt samples are coherent records with explicit conflicting variants.
The literal ledger and chain fixtures were compared as complete state values with the
same states built through their generated transitions. They avoid rebuilding
the full history on each simulator draw.

```quint
pure val byValues = Set("owner", "operator", "wrong")
pure val signerValues = Set("poster", "wrong")
pure val actorValues = Set(3)
pure val merkleRootValues = Set("merkle", "wrong", "")
pure val rootIdValues = Set(1, 2)
pure val attemptValues = Set(1, 2)
pure val receiptValues = Set(1, 2, 3)
pure val settledDayValues = Set(1, 2)
pure val dayValues = Set(1, 2)
pure val gasValues = Set(1, 200000000000000, 200000000000001)
pure val actualGasValues = Set(0, 1)
pure val heightValues = Set(1, 2)

```

```quint
pure val reviewedControl: R::Referral = { mode: R::Posting, reactivationApproved: true, tokenExists: true, fundingFinalized: true, watcherOperating: true }
pure val filedLedger: A::Accrual = { phase: A::Ready, configured: true, tokenUnit: List(0, 0, 1), attributions: List({ project: 1, applicant: 1, steward: 2, referrer: 3 }), rates: List({ fromPeriod: 24322, numerator: List(3, 0, 0), denominator: List(1) }), records: List({ payout: { id: 1, project: 1, period: 24322, paidAt: { year: 2026, month: 11, day: 1, millis: 0 }, firstPaidAt: { year: 2026, month: 11, day: 1, millis: 0 }, gross: List(0, 0, 1), paid: true, stablecoin: true, team: false, banned: false, held: false }, referrer: 3, eligible: true, rate: { fromPeriod: 24322, numerator: List(3, 0, 0), denominator: List(1) }, computed: List(0, 0, 3, 0, 0), amount: List(0, 0, 3, 0, 0), outcome: A::Accrued }), staged: List(), filings: List({ period: 24322, sourceDigest: "source", sourceCount: 1, recordCount: 1, entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0) }), pins: List({ actor: 3, wallet: "wallet", authorized: true }), nextPeriod: 24323, activePeriod: 24322, sourceDigest: "source", sourceCount: 1, leaseRun: "", pending: List() }
pure val fundedChain: D::Distributor = { configured: true, token: "token", tokenUnit: List(0, 0, 1), epochCap: List(0, 0, 0, 0, 2), postSpacing: 0, owner: "owner", pendingOwner: "", poster: "poster", paused: false, now: 1, deployedAt: 1, lastUnpausedAt: 1, epochs: List(), latestRootClaimed: false, claims: List(), balance: List(0, 0, 0, 0, 2), deposited: List(0, 0, 0, 0, 2), paid: List(0), rescued: List(0), depositReceipts: List(1) }
pure val controlValues = Set(R::initial, reviewedControl)
pure val aValues = Set(A::initial, filedLedger)
pure val chainValues = Set(D::initial, fundedChain)
pure val rootReceiptValues = Set({ attempt: 1, rootId: 1, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 1, rootId: 1, epoch: 0, merkleRoot: "wrong", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 2, rootId: 1, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 2, rootId: 1, epoch: 0, merkleRoot: "wrong", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 1, rootId: 2, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 1, rootId: 2, epoch: 0, merkleRoot: "wrong", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 2, rootId: 2, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 2, rootId: 2, epoch: 0, merkleRoot: "wrong", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 1, rootId: 1, epoch: 1, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 1, rootId: 1, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: false, succeeded: true },
  { attempt: 1, rootId: 1, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: false },
  { attempt: 1, rootId: 1, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wrong", amount: List(0, 0, 3, 0, 0) }), total: List(0, 0, 3, 0, 0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true },
  { attempt: 1, rootId: 1, epoch: 0, merkleRoot: "merkle", entries: List({ actor: 3, wallet: "wallet", amount: List(0, 0, 3, 0, 0) }), total: List(0), receipt: 1, height: 1, actualGas: 0, settledDay: 1, finalized: true, succeeded: true })
pure val claimReceiptValues = Set({ actor: 3, wallet: "wallet", cumulative: List(0, 0, 3, 0, 0), rootId: 1, transferred: List(0, 0, 3, 0, 0), receipt: 2, height: 2, finalized: true },
  { actor: 3, wallet: "wallet", cumulative: List(0, 0, 3, 0, 0), rootId: 2, transferred: List(0, 0, 3, 0, 0), receipt: 2, height: 2, finalized: true },
  { actor: 3, wallet: "wrong", cumulative: List(0, 0, 3, 0, 0), rootId: 1, transferred: List(0, 0, 3, 0, 0), receipt: 2, height: 2, finalized: true },
  { actor: 3, wallet: "wallet", cumulative: List(0, 0, 3, 0, 0), rootId: 1, transferred: List(0), receipt: 2, height: 2, finalized: true },
  { actor: 3, wallet: "wallet", cumulative: List(0, 0, 3, 0, 0), rootId: 1, transferred: List(0, 0, 3, 0, 0), receipt: 2, height: 2, finalized: false })
pure val weight_prepare = 30
pure val weight_journal = 30
pure val weight_submit = 30
pure val weight_finalize = 30
pure val weight_claim = 30
pure val weight_voidRoot = 20
pure val weight_loseObservation = 10
pure val weight_retransmit = 10
```
