# Monthly root authorization journal

PRD section 6 ("Service signer boundaries") and the owner decision of 24
October 2026 let the escrow identity attester sign each funded project's
monthly allocation root. The contract limits that commitment to the owner's
monthly cap, the owner's opt-out and one commitment per period; anyone may
submit the signed commitment after the cutoff. One instance is the
attester's journal for one project, period and vault network. It records the
first authorization, every signed attempt, the finalized chain view each
attempt used, and the admission and completion the scanner reports.

Source anchors are development `backend/payments/README.md` monthly step 5,
`backend/payments/monthly-attestation.ts`, `monthly-publication.ts`,
`monthly_payment_authorizations`, `monthly_payment_authorization_attempts`
and `monthly_payment_execution`. Legacy models `monthly_reserve`,
`monthly_execution_recovery` and `monthly_commit_cursor` map here. The
[escrow](./escrow.md) unit owns the contract-side admission, leaves and
release. The frozen allocation and its funded obligations come from
[monthly allocations](./monthly.md) as a typed `FundedMonth` record; the
finalized chain view comes from the payments scanner as a typed
`ChainView` read at one finalized EVM block or Solana slot. The signature
itself is an external effect of the attester shell.

## Story: Sign the frozen allocation without changing it

### A journal begins with no authorization

```quint
import money as M from "./money"
type ChainFamily = EvmV2 | SolanaV3
type Leaf = { source: str, actor: int, gross: M::Amount }
type FundedMonth = { project: str, period: int, snapshotDigest: str, wholeGross: M::Amount, leaves: List[Leaf], cap: M::Amount }
type ChainView = { height: int, time: int, sourceSequence: int, authority: str, monthlyEnabled: bool, cap: M::Amount,
  consumed: List[str], otherMonthSources: List[str], admittedRoot: str, remaining: M::Amount }
type Attempt = { id: int, height: int, sourceSequence: int, root: str, remainingGross: M::Amount,
  leafCount: int, frozenAt: int, signer: str, publishedAt: int }
type CommitPhase = NoIntent | Authorized | Admitted | Completed | Refused
type RefusalReason = NoRefusal | CapExceeded | SourceConsumedBeforeSigning | SourceInOtherMonth | WindowClosedUnadmitted
type Commitment = { family: ChainFamily, phase: CommitPhase, refusal: RefusalReason, month: FundedMonth,
  view: ChainView, attempts: List[Attempt], admittedRoot: str, frozenAt: int, clock: int, opensAt: int, closesAt: int }
pure val emptyMonth: FundedMonth = { project: "", period: 0, snapshotDigest: "", wholeGross: M::zero, leaves: List(), cap: M::zero }
pure val emptyView: ChainView = { height: 0, time: 0, sourceSequence: 0, authority: "attester", monthlyEnabled: true, cap: M::zero,
  consumed: List(), otherMonthSources: List(), admittedRoot: "", remaining: M::zero }
pure val initial: Commitment = { family: EvmV2, phase: NoIntent, refusal: NoRefusal, month: emptyMonth, view: emptyView,
  attempts: List(), admittedRoot: "", frozenAt: 0, clock: 1796342400, opensAt: 1796342400, closesAt: 1799020800 }
pure def leafTotal(leaves: List[Leaf]): M::Amount = leaves.foldl(M::zero, (sum, l) => M::addAmounts(sum, l.gross))
pure def validLeaves(leaves: List[Leaf]): bool = leaves.every(l => l.source != "" and l.actor > 0
  and M::validAmount(l.gross) and M::positiveAmount(l.gross) and leaves.select(o => o.source == l.source).length() == 1)
```

### The first authorization records the frozen funded allocation once

The coordinator supplies a frozen, funded month whose obligations it created.
Its digest, whole gross and leaves are fixed for the life of the journal. A
whole gross above the owner's monthly cap is refused; the period stays
unauthorized and the owner can still pay awards one at a time. Funding-time
exclusions are already omitted from the leaves.

```quint
pure def canAuthorize(c: Commitment, family: ChainFamily, month: FundedMonth): bool =
  c.phase == NoIntent and month.project != "" and month.snapshotDigest != "" and month.period >= 202611
    and validLeaves(month.leaves) and month.leaves.length() > 0 and M::validAmount(month.wholeGross)
    and M::equalAmounts(leafTotal(month.leaves), month.wholeGross) and M::validAmount(month.cap)
pure def authorize(c: Commitment, family: ChainFamily, month: FundedMonth): Commitment =
  if (M::compareAmounts(month.wholeGross, month.cap) > 0) { ...c, family: family, month: month, phase: Refused, refusal: CapExceeded }
  else { ...c, family: family, month: month, phase: Authorized }
```

### The journal reads the chain only at a newer finalized height

The view names the current identity authority, the owner's monthly setting
and cap, the ordinary source sequence, every consumed source, and any root
already admitted for the period. A newer view never erases a signed attempt.

```quint
pure def canObserve(c: Commitment, view: ChainView): bool =
  view.height > c.view.height and view.time >= c.view.time and view.authority != "" and M::validAmount(view.cap)
    and M::validAmount(view.remaining) and view.sourceSequence >= c.view.sourceSequence
    and c.view.consumed.every(s => view.consumed.includes(s)) and (c.view.admittedRoot == "" or view.admittedRoot == c.view.admittedRoot)
pure def observe(c: Commitment, view: ChainView): Commitment = { ...c, view: view, clock: if (view.time > c.clock) view.time else c.clock }
```

### EVM signs the remaining sources at one finalized block; a source change makes a new attempt

An EVM V2 attempt covers the leaves whose sources are not yet consumed at its
block, their remaining gross and the source sequence of that block. If a
manual award changes the sequence before admission, the attempt can no
longer be admitted and the next attempt is appended with a fresh identity.
Earlier attempts and their signatures are retained unchanged.

```quint
pure def remainingLeaves(c: Commitment): List[Leaf] = c.month.leaves.select(l => not(c.view.consumed.includes(l.source)))
pure def latestAttempt(c: Commitment): Attempt = c.attempts.nthOr(c.attempts.length() - 1,
  { id: 0, height: 0, sourceSequence: -1, root: "", remainingGross: M::zero, leafCount: 0, frozenAt: 0, signer: "", publishedAt: 0 })
pure def stale(c: Commitment): bool = c.attempts.length() == 0 or latestAttempt(c).sourceSequence != c.view.sourceSequence
  or latestAttempt(c).signer != c.view.authority
pure def canSignEvm(c: Commitment, attemptId: int, root: str, by: str): bool =
  c.family == EvmV2 and c.phase == Authorized and c.view.admittedRoot == "" and by == c.view.authority
    and c.view.height > 0 and c.clock < c.closesAt and stale(c) and root != ""
    and attemptId > 0 and not(c.attempts.some(a => a.id == attemptId or a.root == root))
pure def signEvm(c: Commitment, attemptId: int, root: str, by: str): Commitment =
  val leaves = remainingLeaves(c)
  { ...c, attempts: c.attempts.append({ id: attemptId, height: c.view.height, sourceSequence: c.view.sourceSequence,
    root: root, remainingGross: leafTotal(leaves), leafCount: leaves.length(), frozenAt: 0, signer: by, publishedAt: c.clock }) }
```

### Solana signs one freeze time and refuses a month whose source is already consumed

Before it signs, the attester reads every included source at one finalized
slot. It refuses the month if any source was already consumed or appears in
another published month of the same vault. It signs that slot's block time as
`frozenAt` and keeps it, so an interrupted signer signs the same bytes again.

```quint
pure def canSignSolana(c: Commitment, attemptId: int, root: str, by: str): bool =
  c.family == SolanaV3 and c.phase == Authorized and c.attempts.length() == 0 and c.view.admittedRoot == ""
    and by == c.view.authority and c.view.height > 0 and c.view.time >= c.opensAt and c.clock < c.closesAt
    and root != "" and attemptId > 0
pure def signSolana(c: Commitment, attemptId: int, root: str, by: str): Commitment =
  if (c.month.leaves.some(l => c.view.consumed.includes(l.source))) { ...c, phase: Refused, refusal: SourceConsumedBeforeSigning }
  else if (c.month.leaves.some(l => c.view.otherMonthSources.includes(l.source))) { ...c, phase: Refused, refusal: SourceInOtherMonth }
  else { ...c, frozenAt: c.view.time, attempts: c.attempts.append({ id: attemptId, height: c.view.height,
    sourceSequence: c.view.sourceSequence, root: root, remainingGross: c.month.wholeGross,
    leafCount: c.month.leaves.length(), frozenAt: c.view.time, signer: by, publishedAt: c.clock }) }
```

## Story: Admission and completion come only from finalized contract state

### A finalized admitted root that matches a signed attempt admits the month

After admission no new attempt is signed. A root the journal never signed is
not this journal's admission; the scanner reports it for investigation.

```quint
pure def canAdmit(c: Commitment): bool =
  c.phase == Authorized and c.view.admittedRoot != "" and c.attempts.some(a => a.root == c.view.admittedRoot)
pure def admit(c: Commitment): Commitment = { ...c, phase: Admitted, admittedRoot: c.view.admittedRoot }
```

### An admitted month stays resumable after opt-out or the window closes

Only finalized evidence that no pool gross remains for the period retires
the month. Opt-out, a closed window and a rotated authority never retire it.

```quint
pure def canComplete(c: Commitment): bool =
  c.phase == Admitted and c.view.admittedRoot == c.admittedRoot and not(M::positiveAmount(c.view.remaining))
pure def complete(c: Commitment): Commitment = { ...c, phase: Completed }
```

### An unadmitted month whose window closes is refused and funds stay free

No attempt is admitted once the window closes. Nothing moved on chain, so the
owner keeps every funded obligation payable one award at a time.

```quint
pure def canCloseWindow(c: Commitment): bool = c.phase == Authorized and c.view.admittedRoot == "" and c.clock >= c.closesAt
pure def closeWindow(c: Commitment): Commitment = { ...c, phase: Refused, refusal: WindowClosedUnadmitted }
```

## Story: The journal keeps every signature and never widens the allocation

### The first authorization, signed attempts and freeze time are immutable

```quint
pure def stepFirstAuthorizationImmutable(before: Commitment, after: Commitment): bool =
  before.phase != NoIntent implies after.month == before.month and after.family == before.family
pure def stepAttemptsAppendOnly(before: Commitment, after: Commitment): bool =
  val added = after.attempts.nthOr(before.attempts.length(), latestAttempt(before))
  after.attempts == before.attempts or after.attempts == before.attempts.append(added)
pure def stepNoSignatureAfterAdmission(before: Commitment, after: Commitment): bool =
  (before.phase == Admitted or before.phase == Completed or before.phase == Refused or before.view.admittedRoot != "")
    implies after.attempts == before.attempts
pure def stepFrozenAtFixed(before: Commitment, after: Commitment): bool = before.frozenAt > 0 implies after.frozenAt == before.frozenAt
pure def stepAdmissionPermanent(before: Commitment, after: Commitment): bool =
  (before.phase == Admitted implies (after.phase == Admitted or after.phase == Completed) and after.admittedRoot == before.admittedRoot)
    and (before.phase == Completed implies after.phase == Completed) and (before.phase == Refused implies after.phase == Refused)
```

### Every attempt is within the frozen allocation and the cap

Each attempt was signed by the identity authority in force at its view,
covers at most the frozen leaves, and never signs more than the whole gross.
An admitted root is one of the journal's attempts.

```quint
pure def alwaysAttemptsBounded(c: Commitment): bool = c.attempts.every(a => a.id > 0 and a.root != "" and a.signer != ""
  and M::validAmount(a.remainingGross) and M::compareAmounts(a.remainingGross, c.month.wholeGross) <= 0
  and a.leafCount <= c.month.leaves.length() and c.attempts.select(o => o.id == a.id).length() == 1)
pure def alwaysAuthorizedWithinCap(c: Commitment): bool =
  (c.phase == Authorized or c.phase == Admitted or c.phase == Completed) implies M::compareAmounts(c.month.wholeGross, c.month.cap) <= 0
pure def alwaysAdmittedRootSigned(c: Commitment): bool =
  (c.phase == Admitted or c.phase == Completed) implies c.admittedRoot != "" and c.attempts.some(a => a.root == c.admittedRoot)
pure def alwaysSolanaSingleAttempt(c: Commitment): bool = c.family == SolanaV3 implies c.attempts.length() <= 1
  and c.attempts.every(a => a.frozenAt == c.frozenAt and a.frozenAt > 0)
pure def alwaysNoIntentEmpty(c: Commitment): bool = c.phase == NoIntent implies c.attempts.length() == 0 and c.admittedRoot == ""
pure def sometimesReattested(c: Commitment): bool = c.phase == Admitted and c.attempts.length() >= 2
pure def sometimesCompletedAfterOptOut(c: Commitment): bool = c.phase == Completed and not(c.view.monthlyEnabled)
pure def sometimesAdmittedAfterRotation(c: Commitment): bool = c.phase == Admitted and c.view.authority != "attester"
pure def sometimesWindowRefused(c: Commitment): bool = c.refusal == WindowClosedUnadmitted and c.attempts.length() > 0
pure def sometimesSolanaRefused(c: Commitment): bool = c.refusal == SourceConsumedBeforeSigning
pure def sometimesCapRefused(c: Commitment): bool = c.refusal == CapExceeded
pure def sometimesSolanaAdmitted(c: Commitment): bool = c.family == SolanaV3 and c.phase == Completed
```

### Simulation samples

These input sets bound simulation only.

```quint
pure val familyValues = Set(EvmV2, SolanaV3)
pure val monthSample: FundedMonth = { project: "p", period: 202611, snapshotDigest: "d1", wholeGross: List(5),
  leaves: List({ source: "s1", actor: 1, gross: List(1) }, { source: "s2", actor: 2, gross: List(4) }), cap: List(8) }
pure val monthValues = Set(monthSample, { ...monthSample, cap: List(4) }, { ...monthSample, wholeGross: List(6) })
pure val viewValues = Set(
  { ...emptyView, height: 1, time: 1796342400, cap: List(8), remaining: List(0) },
  { ...emptyView, height: 2, time: 1796342500, sourceSequence: 1, cap: List(8), consumed: List("s1") },
  { ...emptyView, height: 3, time: 1796342600, sourceSequence: 1, cap: List(8), consumed: List("s1"), admittedRoot: "r2", remaining: List(4) },
  { ...emptyView, height: 3, time: 1796342600, cap: List(8), admittedRoot: "r1", remaining: List(5) },
  { ...emptyView, height: 4, time: 1796342700, cap: List(8), admittedRoot: "r1", remaining: List(0), monthlyEnabled: false },
  { ...emptyView, height: 4, time: 1796342700, sourceSequence: 1, cap: List(8), consumed: List("s1"), admittedRoot: "r2", remaining: List(0), authority: "next" },
  { ...emptyView, height: 5, time: 1799020800, cap: List(8) },
  { ...emptyView, height: 2, time: 1796342500, cap: List(8), authority: "next" })
pure val attemptIdValues = Set(1, 2)
pure val rootValues = Set("r1", "r2")
pure val byValues = Set("attester", "next", "anyone")
pure val weight_observe = 6
pure val weight_signEvm = 6
pure val weight_signSolana = 4
```
