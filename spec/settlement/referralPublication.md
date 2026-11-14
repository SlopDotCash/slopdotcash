# Referral root publication and claims

PRD section 11 requires a separately activated poster, complete filed accruals,
pinned recipient wallets and finalized evidence. This machine owns root
publication, uncertain attempts, native reservations and claims. It consumes
the activation model and complete accrual ledger; those services must provide
their current authenticated records, never caller-asserted substitutes.

## Story: Publish one complete cumulative root

### Only filed accruals and authorized wallets enter a root

A referrer with no authorized wallet remains in the accrual ledger and enters
a later root when a wallet is available. All projects contribute to the same
lifetime cap. Each actor appears once with its cumulative amount. The Merkle
encoder must commit these exact entries and total; its byte-level correctness
requires the future adapter's independent tests.

```quint
import money as M from "./money"
import referrals as R from "./referrals"
import referralAccrual as A from "./referralAccrual"
type Wallet = { actor: int, wallet: str, authorized: bool }
type RootEntry = { actor: int, wallet: str, amount: M::Amount }
type Root = { id: int, period: int, sourceDigest: str, entries: List[RootEntry], total: M::Amount,
  height: int, voided: bool, sealed: bool }
type Claim = { actor: int, cumulative: M::Amount }
type PostingPhase = Idle | Prepared | Journaled | Submitted | Uncertain
type Attempt = { id: int, root: int, day: int, reservedGas: int }
type Publication = { phase: PostingPhase, prepared: Root, roots: List[Root], attempts: List[Attempt],
  claims: List[Claim], receipts: List[int], tokenUnit: M::Amount, currentAttempt: int,
  day: int, nativeSpent: int, nativeHold: int, paused: bool, cacheFresh: bool }
pure val emptyRoot: Root = { id: 0, period: 0, sourceDigest: "", entries: List(), total: M::zero,
  height: 0, voided: false, sealed: false }
pure val initial: Publication = { phase: Idle, prepared: emptyRoot, roots: List(), attempts: List(),
  claims: List(), receipts: List(), tokenUnit: M::zero, currentAttempt: 0,
  day: 1, nativeSpent: 0, nativeHold: 0, paused: false, cacheFresh: false }
pure def walletFor(wallets: List[Wallet], actor: int): str = wallets.foldl("",
  (found, w) => if (w.actor == actor and w.authorized) w.wallet else found)
pure def actors(a: A::Accrual): List[int] = a.attributions.foldl(List(),
  (found, entry) => if (entry.referrer > 0 and not(found.includes(entry.referrer))) found.append(entry.referrer) else found)
pure def entriesFor(a: A::Accrual, wallets: List[Wallet]): List[RootEntry] =
  actors(a).select(actor => walletFor(wallets, actor) != "" and M::positiveAmount(A::actorAccrued(a, actor)))
    .listMap(actor => { actor: actor, wallet: walletFor(wallets, actor), amount: A::actorAccrued(a, actor) })
pure def entryTotal(entries: List[RootEntry]): M::Amount = entries.foldl(M::zero, (total, e) => M::addAmounts(total, e.amount))
pure def claimedFor(p: Publication, actor: int): M::Amount = p.claims.foldl(M::zero,
  (found, claim) => if (claim.actor == actor) claim.cumulative else found)
pure def totalClaimed(p: Publication): M::Amount = p.claims.foldl(M::zero,
  (total, claim) => M::addAmounts(total, claim.cumulative))
pure def activeRoot(p: Publication): Root = p.roots.foldl(emptyRoot,
  (found, root) => if (not(root.voided)) root else found)
pure def canPrepare(p: Publication, control: R::Referral, a: A::Accrual, wallets: List[Wallet], rootId: int): bool =
  p.phase == Idle and not(p.paused) and control.mode == R::Posting and R::alwaysActivationReady(control)
    and a.phase == A::Ready and a.configured and a.filings.length() > 0
    and A::alwaysCaps(a) and A::alwaysUnitValid(a) and A::alwaysUniqueAttribution(a) and A::alwaysCompleteFilings(a)
    and rootId > 0 and p.roots.every(root => root.id < rootId
      and root.period <= a.filings.nthOr(a.filings.length() - 1, { period: 0, sourceDigest: "", sourceCount: 0, recordCount: 0 }).period)
    and (p.roots.length() == 0 or p.tokenUnit == a.tokenUnit)
    and wallets.every(w => w.actor > 0 and wallets.select(other => other.actor == w.actor).length() == 1)
    and entriesFor(a, wallets).length() > 0
    and M::compareAmounts(entryTotal(entriesFor(a, wallets)), A::poolCap(a)) <= 0
    and M::compareAmounts(entryTotal(entriesFor(a, wallets)), totalClaimed(p)) >= 0
    and entriesFor(a, wallets).every(e => M::compareAmounts(e.amount, claimedFor(p, e.actor)) >= 0)
pure def prepare(p: Publication, control: R::Referral, a: A::Accrual, wallets: List[Wallet], rootId: int): Publication =
  val filing = a.filings.nthOr(a.filings.length() - 1, { period: 0, sourceDigest: "", sourceCount: 0, recordCount: 0 })
  val entries = entriesFor(a, wallets)
  { ...p, phase: Prepared, tokenUnit: a.tokenUnit, prepared: { id: rootId, period: filing.period,
    sourceDigest: filing.sourceDigest, entries: entries, total: entryTotal(entries), height: 0, voided: false, sealed: false } }
```

### Every signed root reserves gas and journals its exact identity first

Native amounts are integer wei. The 0.0002 ETH transaction ceiling and
0.002 ETH UTC-day ceiling are independent of fee conversion. Every retry has
an immutable attempt ID. An uncertain send retains its hold, across day changes,
until a finalized outcome proves the cost. The poster cannot transfer tokens.

```quint
pure def canJournal(p: Publication, control: R::Referral, attempt: int, gas: int): bool =
  p.phase == Prepared and not(p.paused) and control.mode == R::Posting and R::alwaysActivationReady(control)
    and attempt > 0 and not(p.attempts.some(old => old.id == attempt)) and gas > 0
    and R::posterGasAllowed(gas, p.nativeSpent + p.nativeHold + gas)
pure def journal(p: Publication, control: R::Referral, attempt: int, gas: int): Publication =
  { ...p, phase: Journaled, currentAttempt: attempt, nativeHold: gas,
    attempts: p.attempts.append({ id: attempt, root: p.prepared.id, day: p.day, reservedGas: gas }) }
pure def canSubmit(p: Publication, control: R::Referral): bool = p.phase == Journaled and not(p.paused)
  and control.mode == R::Posting and R::alwaysActivationReady(control)
pure def submit(p: Publication, control: R::Referral): Publication = { ...p, phase: Submitted }
pure def canLoseObservation(p: Publication): bool = p.phase == Submitted
pure def loseObservation(p: Publication): Publication = { ...p, phase: Uncertain }
pure def canRetransmit(p: Publication, control: R::Referral): bool = p.phase == Uncertain and not(p.paused)
  and control.mode == R::Posting and R::alwaysActivationReady(control)
pure def retransmit(p: Publication, control: R::Referral): Publication = { ...p, phase: Submitted }
pure def canObserveDay(p: Publication, day: int): bool = day > p.day
pure def observeDay(p: Publication, day: int): Publication = { ...p, day: day, nativeSpent: 0 }
pure def canSetPaused(p: Publication, paused: bool, by: str): bool = by == "owner"
pure def setPaused(p: Publication, paused: bool, by: str): Publication = { ...p, paused: paused, cacheFresh: false }
```

### Only exact finalized evidence makes a root claimable

The chain adapter must verify the pinned distributor, network, token, Merkle
root and every retained entry before emitting this evidence. Missing or
conflicting evidence remains Uncertain. A finalized failed send permits a new
attempt and consumes its actual gas; it never adds a root.

```quint
pure def canFinalize(p: Publication, attempt: int, rootId: int, entries: List[RootEntry],
  total: M::Amount, receipt: int, height: int, actualGas: int, finalized: bool, succeeded: bool): bool =
  (p.phase == Submitted or p.phase == Uncertain) and attempt == p.currentAttempt
    and rootId == p.prepared.id and entries == p.prepared.entries and M::equalAmounts(total, p.prepared.total)
    and receipt > 0 and not(p.receipts.includes(receipt)) and height > 0 and finalized and succeeded
    and actualGas >= 0 and actualGas <= p.nativeHold
pure def finalize(p: Publication, attempt: int, rootId: int, entries: List[RootEntry],
  total: M::Amount, receipt: int, height: int, actualGas: int, finalized: bool, succeeded: bool): Publication =
  { ...p, phase: Idle, roots: p.roots.append({ ...p.prepared, height: height }),
    receipts: p.receipts.append(receipt), nativeSpent: p.nativeSpent + actualGas, nativeHold: 0, cacheFresh: true }
pure def canFinalizeFailure(p: Publication, attempt: int, receipt: int, actualGas: int, finalized: bool, succeeded: bool): bool =
  (p.phase == Submitted or p.phase == Uncertain) and attempt == p.currentAttempt
    and receipt > 0 and not(p.receipts.includes(receipt)) and finalized and not(succeeded) and actualGas >= 0 and actualGas <= p.nativeHold
pure def finalizeFailure(p: Publication, attempt: int, receipt: int, actualGas: int, finalized: bool, succeeded: bool): Publication =
  { ...p, phase: Prepared, receipts: p.receipts.append(receipt), nativeSpent: p.nativeSpent + actualGas, nativeHold: 0 }
```

## Story: Claim immediately without reissuing paid tokens

### A claim uses the active root's pinned wallet and cumulative amount

Claims need no waiting period. A wallet change affects a future root only.
The finalized receipt pays only the increase above the actor's lifetime claimed
amount. A successful claim seals the active root. The owner may void only the
latest unsealed root, restoring the prior live root without rewriting history.
Neither pause, key rotation nor void can recover an earlier payment.

```quint
pure def canClaim(p: Publication, actor: int, wallet: str, cumulative: M::Amount,
  rootId: int, transferred: M::Amount, receipt: int, height: int, finalized: bool): bool = not(p.paused)
    and activeRoot(p).id == rootId and rootId > 0 and activeRoot(p).height > 0
    and activeRoot(p).entries.some(e => e.actor == actor and e.wallet == wallet and M::equalAmounts(e.amount, cumulative))
    and M::compareAmounts(cumulative, claimedFor(p, actor)) > 0
    and M::validAmount(transferred) and M::equalAmounts(transferred, M::subtractAmounts(cumulative, claimedFor(p, actor))) and receipt > 0
    and not(p.receipts.includes(receipt)) and height > 0 and finalized
pure def claim(p: Publication, actor: int, wallet: str, cumulative: M::Amount,
  rootId: int, transferred: M::Amount, receipt: int, height: int, finalized: bool): Publication =
  { ...p, claims: p.claims.select(c => c.actor != actor).append({ actor: actor, cumulative: cumulative }),
    receipts: p.receipts.append(receipt), roots: p.roots.listMap(root => if (root.id == rootId) { ...root, sealed: true } else root), cacheFresh: true }
pure def canVoidRoot(p: Publication, rootId: int, receipt: int, height: int, finalized: bool, by: str): bool =
  by == "owner" and p.roots.length() > 0 and p.roots.nthOr(p.roots.length() - 1, emptyRoot).id == rootId
    and not(p.roots.nthOr(p.roots.length() - 1, emptyRoot).sealed)
    and not(p.roots.nthOr(p.roots.length() - 1, emptyRoot).voided)
    and receipt > 0 and not(p.receipts.includes(receipt)) and height > 0 and finalized
pure def voidRoot(p: Publication, rootId: int, receipt: int, height: int, finalized: bool, by: str): Publication =
  { ...p, roots: p.roots.listMap(root => if (root.id == rootId) { ...root, voided: true } else root),
    receipts: p.receipts.append(receipt), cacheFresh: true }
pure def canInvalidateCache(p: Publication): bool = p.cacheFresh
pure def invalidateCache(p: Publication): Publication = { ...p, cacheFresh: false }
pure def canRefreshCache(p: Publication, finalized: bool): bool = finalized
pure def refreshCache(p: Publication, finalized: bool): Publication = { ...p, cacheFresh: true }
pure def claimableFor(p: Publication, actor: int): M::Amount =
  val entry = activeRoot(p).entries.foldl(M::zero, (amount, e) => if (e.actor == actor) e.amount else amount)
  if (p.cacheFresh and not(p.paused) and M::compareAmounts(entry, claimedFor(p, actor)) >= 0)
    M::subtractAmounts(entry, claimedFor(p, actor)) else M::zero
```

### History, native holds and cumulative claims remain bounded

A stale cache retains amounts and history, but does not advertise a currently
claimable amount. Accrued and pending amounts come from the accrual ledger;
claimed amounts come from finalized claim records. Missing cache evidence is
unknown, never evidence that the claim or balance is zero.

```quint
pure def alwaysNativeBounded(p: Publication): bool = p.nativeSpent >= 0 and p.nativeHold >= 0
  and p.nativeSpent + p.nativeHold <= 2000000000000000
pure def alwaysIdleUnreserved(p: Publication): bool = (p.phase == Idle or p.phase == Prepared) implies p.nativeHold == 0
pure def alwaysPreparedCap(p: Publication): bool = p.phase != Idle implies
  p.prepared.id > 0 and M::validAmount(p.prepared.total)
    and M::compareAmounts(p.prepared.total, M::multiplyAmounts(p.tokenUnit, M::smallAmount(2000000))) <= 0
pure def alwaysPendingHeld(p: Publication): bool =
  (p.phase == Journaled or p.phase == Submitted or p.phase == Uncertain) implies p.nativeHold > 0
pure def alwaysRootCap(p: Publication): bool = p.roots.every(root =>
  M::compareAmounts(root.total, M::multiplyAmounts(p.tokenUnit, M::smallAmount(2000000))) <= 0)
pure def alwaysUniqueClaims(p: Publication): bool = p.claims.every(c => p.claims.select(other => other.actor == c.actor).length() == 1)
pure def stepAttemptsRetained(before: Publication, after: Publication): bool = before.attempts.every(a => after.attempts.includes(a))
pure def stepClaimedNeverFalls(before: Publication, after: Publication): bool = before.claims.every(c =>
  M::compareAmounts(claimedFor(after, c.actor), c.cumulative) >= 0)
pure def sometimesUncertain(p: Publication): bool = p.phase == Uncertain
pure def sometimesClaimed(p: Publication): bool = p.claims.length() > 0
pure def sometimesVoided(p: Publication): bool = p.roots.some(root => root.voided)
```

### Simulation includes live control, capped accruals and conflicting receipts

```quint
pure val byValues = Set("owner", "wrong")
pure val actorValues = Set(3)
pure val walletValues = Set("wallet", "wrong")
pure val rootIdValues = Set(1, 2)
pure val attemptValues = Set(1, 2)
pure val receiptValues = Set(1, 2, 3)
pure val dayValues = Set(1, 2)
pure val gasValues = Set(1, 200000000000000, 200000000000001)
pure val actualGasValues = Set(0, 1)
pure val heightValues = Set(1, 2)
pure val cumulativeValues = Set(List(3))
pure val totalValues = Set(List(3))
pure val transferredValues = Set(List(0), List(3))
pure val entriesValues = Set(List({ actor: 3, wallet: "wallet", amount: List(3) }))
pure val walletsValues = Set(List({ actor: 3, wallet: "wallet", authorized: true }), List())
```

```quint
pure val reviewedControl = R::activate(R::startWatcher(R::recordFunding(R::dryRun(R::initial, "owner"), 2000000, true, true), true), "owner")
pure val configuredLedger = A::enableDryRun(A::configure(A::initial, List(1), true, "owner"), true, "owner")
pure val capturedLedger = A::capture(configuredLedger, 1, 1, 2, 3, true, false, false)
pure val sourcePayout: A::Payout = { id: 1, project: 1, period: A::firstPeriod, firstPaidPeriod: A::firstPeriod,
  gross: List(0, 0, 1), paid: true, stablecoin: true, team: false, banned: false, held: false }
pure val filedLedger = A::fileMonth(A::accrueNext(A::startMonth(capturedLedger, A::firstPeriod, List(sourcePayout), "source", true, true)))
pure val controlValues = Set(R::initial, reviewedControl)
pure val aValues = Set(A::initial, filedLedger)
```
