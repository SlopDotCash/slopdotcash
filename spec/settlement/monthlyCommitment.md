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
`ChainView` read at one finalized EVM block or Solana slot. The signing-time
facts (project active and unrestricted, vault served, the D1 automatic
setting and the frozen snapshot digest) come as a typed `SigningFacts` record
that the attester re-reads at the same finalized height immediately before
signing: project status and restriction from the project registry and
security enforcement, the automatic setting from
[monthly settings](./monthlySettings.md). A retained V1 authorization comes
from `monthly_payment_authorizations` as a typed `LegacyAuthorization`. The
signature itself is an external effect of the attester shell.

## Story: Sign the frozen allocation without changing it

### A journal begins with no authorization

```quint
import money as M from "./money"
type ChainFamily = EvmV2 | SolanaV3
type Leaf = { source: str, actor: int, gross: M::Amount }
type FundedMonth = { project: str, period: int, snapshotDigest: str, wholeGross: M::Amount, leaves: List[Leaf], cap: M::Amount }
type ChainView = { height: int, time: int, sourceSequence: int, authority: str, monthlyEnabled: bool, cap: M::Amount,
  consumed: List[str], otherMonthSources: List[str], admittedRoot: str, legacyRoot: bool, remaining: M::Amount }
type SigningFacts = { height: int, projectActive: bool, restricted: bool, vaultServed: bool, automaticOn: bool, snapshotDigest: str }
type LegacyAuthorization = { root: str, snapshotDigest: str, wholeGross: M::Amount, leafCount: int, signer: str }
type Attempt = { id: int, height: int, sourceSequence: int, root: str, remainingGross: M::Amount,
  leafCount: int, frozenAt: int, signer: str, publishedAt: int }
type CommitPhase = NoIntent | Authorized | Admitted | Completed | Refused | Investigating
type RefusalReason = NoRefusal | CapExceeded | SourceConsumedBeforeSigning | SourceInOtherMonth | WindowClosedUnadmitted
  | UnsignedRootObserved | WindowNotOpen | WindowClosed | ProjectRestricted | VaultNotServed | AutomaticOff
  | SnapshotChanged | ChainCapExceeded | FactsStale
type Commitment = { family: ChainFamily, phase: CommitPhase, refusal: RefusalReason, held: RefusalReason, month: FundedMonth,
  view: ChainView, facts: SigningFacts, legacy: LegacyAuthorization, attempts: List[Attempt], admittedRoot: str,
  admittedLegacy: bool, frozenAt: int, clock: int, opensAt: int, closesAt: int }
pure val emptyMonth: FundedMonth = { project: "", period: 0, snapshotDigest: "", wholeGross: M::zero, leaves: List(), cap: M::zero }
pure val emptyView: ChainView = { height: 0, time: 0, sourceSequence: 0, authority: "attester", monthlyEnabled: true, cap: M::zero,
  consumed: List(), otherMonthSources: List(), admittedRoot: "", legacyRoot: false, remaining: M::zero }
pure val noFacts: SigningFacts = { height: 0, projectActive: false, restricted: false, vaultServed: false, automaticOn: false, snapshotDigest: "" }
pure val noLegacy: LegacyAuthorization = { root: "", snapshotDigest: "", wholeGross: M::zero, leafCount: 0, signer: "" }
pure val initial: Commitment = { family: EvmV2, phase: NoIntent, refusal: NoRefusal, held: NoRefusal, month: emptyMonth, view: emptyView,
  facts: noFacts, legacy: noLegacy, attempts: List(), admittedRoot: "", admittedLegacy: false, frozenAt: 0, clock: 1796342400,
  opensAt: 0, closesAt: 0 }
pure def nextPeriod(period: int): int = if (period % 100 == 12) (period / 100 + 1) * 100 + 1 else period + 1
pure def monthStart(period: int): int =
  val month = period % 100
  val year = period / 100 - (if (month <= 2) 1 else 0)
  val era = year / 400
  val yearOfEra = year - era * 400
  val dayOfYear = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5
  (era * 146097 + yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear - 719468) * 86400
pure val cutoffSeconds = 259200
pure def windowOpensAt(period: int): int = monthStart(nextPeriod(period)) + cutoffSeconds
pure def windowClosesAt(period: int): int = monthStart(nextPeriod(nextPeriod(period))) + cutoffSeconds
pure def leafTotal(leaves: List[Leaf]): M::Amount = leaves.foldl(M::zero, (sum, l) => M::addAmounts(sum, l.gross))
pure def validLeaves(leaves: List[Leaf]): bool = leaves.every(l => l.source != "" and l.actor > 0
  and M::validAmount(l.gross) and M::positiveAmount(l.gross) and leaves.select(o => o.source == l.source).length() == 1)
```

### The first authorization records the frozen funded allocation once

The coordinator supplies a frozen, funded month whose obligations it created.
Its digest, whole gross and leaves are fixed for the life of the journal. A
whole gross above the owner's monthly cap is refused; the period stays
unauthorized and the owner can still pay awards one at a time. Funding-time
exclusions are already omitted from the leaves. The commitment window is
derived from the period, exactly as the contract's `monthlyWindow`: it opens
72 hours after the month ends and closes 72 hours after the next month ends.

```quint
pure def canAuthorize(c: Commitment, family: ChainFamily, month: FundedMonth): bool =
  c.phase == NoIntent and month.project != "" and month.snapshotDigest != "" and month.period >= 202611
    and month.period % 100 >= 1 and month.period % 100 <= 12
    and validLeaves(month.leaves) and month.leaves.length() > 0 and M::validAmount(month.wholeGross)
    and M::equalAmounts(leafTotal(month.leaves), month.wholeGross) and M::validAmount(month.cap)
pure def authorize(c: Commitment, family: ChainFamily, month: FundedMonth): Commitment =
  val windowed = { ...c, family: family, month: month, opensAt: windowOpensAt(month.period), closesAt: windowClosesAt(month.period) }
  if (M::compareAmounts(month.wholeGross, month.cap) > 0) { ...windowed, phase: Refused, refusal: CapExceeded }
  else { ...windowed, phase: Authorized }
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

### The attester re-reads the signing facts at the same finalized height and refuses without signing

Immediately before it signs, the attester re-reads the project status and
restriction, whether its vault network is served, the D1 automatic setting
and the frozen snapshot digest at the view's height. Signing is refused, and
the refusal recorded, while the window has not opened or has closed, the
project is inactive or restricted, the vault is not served, the owner turned
automatic payment off, the snapshot changed, the facts are not from the
current view, or the remaining gross exceeds the cap the contract reports.
A refusal is not terminal: a later observation may allow signing inside the
window.

```quint
pure def canObserveFacts(c: Commitment, facts: SigningFacts): bool =
  c.phase == Authorized and facts.height == c.view.height and facts.height > 0
pure def observeFacts(c: Commitment, facts: SigningFacts): Commitment = { ...c, facts: facts }
pure def signingRefusal(c: Commitment): RefusalReason =
  if (c.clock < c.opensAt or c.view.time < c.opensAt) WindowNotOpen
  else if (c.clock >= c.closesAt) WindowClosed
  else if (c.facts.height != c.view.height or c.facts.height == 0) FactsStale
  else if (not(c.facts.projectActive) or c.facts.restricted) ProjectRestricted
  else if (not(c.facts.vaultServed)) VaultNotServed
  else if (not(c.facts.automaticOn)) AutomaticOff
  else if (c.facts.snapshotDigest != c.month.snapshotDigest) SnapshotChanged
  else if (M::compareAmounts(c.month.wholeGross, c.view.cap) > 0) ChainCapExceeded
  else NoRefusal
pure def canRefuseSigning(c: Commitment): bool =
  c.phase == Authorized and c.view.admittedRoot == "" and stale(c) and signingRefusal(c) != NoRefusal and c.held != signingRefusal(c)
    and (c.family == EvmV2 or c.attempts.length() == 0)
pure def refuseSigning(c: Commitment): Commitment = { ...c, held: signingRefusal(c) }
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
    and c.view.height > 0 and signingRefusal(c) == NoRefusal and stale(c) and root != "" and root != c.legacy.root
    and attemptId > 0 and not(c.attempts.some(a => a.id == attemptId or a.root == root))
pure def signEvm(c: Commitment, attemptId: int, root: str, by: str): Commitment =
  val leaves = remainingLeaves(c)
  { ...c, attempts: c.attempts.append({ id: attemptId, height: c.view.height, sourceSequence: c.view.sourceSequence,
    root: root, remainingGross: leafTotal(leaves), leafCount: leaves.length(), frozenAt: 0, signer: by, publishedAt: c.clock }),
    held: NoRefusal }
```

### Solana signs one freeze time and refuses a month whose source is already consumed

Before it signs, the attester reads every included source at one finalized
slot. It refuses the month if any source was already consumed or appears in
another published month of the same vault. It signs that slot's block time as
`frozenAt` and keeps it, so an interrupted signer signs the same bytes again.

```quint
pure def canSignSolana(c: Commitment, attemptId: int, root: str, by: str): bool =
  c.family == SolanaV3 and c.phase == Authorized and c.attempts.length() == 0 and c.view.admittedRoot == ""
    and by == c.view.authority and c.view.height > 0 and signingRefusal(c) == NoRefusal
    and root != "" and attemptId > 0
pure def signSolana(c: Commitment, attemptId: int, root: str, by: str): Commitment =
  if (c.month.leaves.some(l => c.view.consumed.includes(l.source))) { ...c, phase: Refused, refusal: SourceConsumedBeforeSigning }
  else if (c.month.leaves.some(l => c.view.otherMonthSources.includes(l.source))) { ...c, phase: Refused, refusal: SourceInOtherMonth }
  else { ...c, frozenAt: c.view.time, attempts: c.attempts.append({ id: attemptId, height: c.view.height,
    sourceSequence: c.view.sourceSequence, root: root, remainingGross: c.month.wholeGross,
    leafCount: c.month.leaves.length(), frozenAt: c.view.time, signer: by, publishedAt: c.clock }), held: NoRefusal }
```

## Story: Admission and completion come only from finalized contract state

### A finalized admitted root that matches a signed attempt admits the month

After admission no new attempt is signed. A V2 or V3 admission must equal
one of the journal's signed attempts.

```quint
pure def canAdmit(c: Commitment): bool =
  c.phase == Authorized and c.view.admittedRoot != "" and not(c.view.legacyRoot) and c.attempts.some(a => a.root == c.view.admittedRoot)
pure def admit(c: Commitment): Commitment = { ...c, phase: Admitted, admittedRoot: c.view.admittedRoot }
```

### A retained V1 authorization of the same frozen month may win on EVM

The legacy V1 `commitMonthly` is still callable on deployed EVM vaults. A V1
transaction signed before V2 publication may be finalized after it. The
journal retains the original V1 authorization only when it covers exactly
the frozen month (same snapshot, whole gross and leaf count) and was signed
by the identity authority; the executor checks its root and recovered signer
against the original message. A finalized V1 root equal to it admits the
month without any new signature; V1 commits every leaf in the same call, so
the escrow counts an identical existing award once.

```quint
pure def canRetainLegacy(c: Commitment, legacy: LegacyAuthorization): bool =
  c.family == EvmV2 and c.phase == Authorized and c.legacy.root == "" and legacy.root != "" and legacy.signer != ""
    and legacy.snapshotDigest == c.month.snapshotDigest and M::equalAmounts(legacy.wholeGross, c.month.wholeGross)
    and legacy.leafCount == c.month.leaves.length() and not(c.attempts.some(a => a.root == legacy.root))
pure def retainLegacy(c: Commitment, legacy: LegacyAuthorization): Commitment = { ...c, legacy: legacy }
pure def canAdmitLegacy(c: Commitment): bool =
  c.family == EvmV2 and c.phase == Authorized and c.view.legacyRoot and c.legacy.root != "" and c.view.admittedRoot == c.legacy.root
pure def admitLegacy(c: Commitment): Commitment = { ...c, phase: Admitted, admittedRoot: c.view.admittedRoot, admittedLegacy: true }
```

### A finalized root the journal never signed holds the month for investigation

A root admitted for the period that is neither a signed attempt nor the
retained V1 authorization means the journal and the chain disagree. The
journal stops signing and records the investigation; it never claims that
root as its own admission.

```quint
pure def unknownRoot(c: Commitment): bool = c.view.admittedRoot != "" and not(c.attempts.some(a => a.root == c.view.admittedRoot))
  and not(c.view.legacyRoot and c.legacy.root != "" and c.view.admittedRoot == c.legacy.root)
pure def canInvestigate(c: Commitment): bool = c.phase == Authorized and unknownRoot(c)
pure def investigate(c: Commitment): Commitment = { ...c, phase: Investigating, refusal: UnsignedRootObserved }
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
  (before.phase == Admitted or before.phase == Completed or before.phase == Refused or before.phase == Investigating
    or before.view.admittedRoot != "") implies after.attempts == before.attempts
pure def stepFrozenAtFixed(before: Commitment, after: Commitment): bool = before.frozenAt > 0 implies after.frozenAt == before.frozenAt
pure def stepAdmissionPermanent(before: Commitment, after: Commitment): bool =
  (before.phase == Admitted implies (after.phase == Admitted or after.phase == Completed) and after.admittedRoot == before.admittedRoot)
    and (before.phase == Completed implies after.phase == Completed) and (before.phase == Refused implies after.phase == Refused)
    and (before.phase == Investigating implies after.phase == Investigating)
pure def stepLegacyRetainedOnce(before: Commitment, after: Commitment): bool = before.legacy.root != "" implies after.legacy == before.legacy
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
  (c.phase == Admitted or c.phase == Completed) implies c.admittedRoot != ""
    and (if (c.admittedLegacy) c.admittedRoot == c.legacy.root and c.family == EvmV2 else c.attempts.some(a => a.root == c.admittedRoot))
pure def alwaysWindowFromPeriod(c: Commitment): bool = c.phase != NoIntent implies
  c.opensAt == windowOpensAt(c.month.period) and c.closesAt == windowClosesAt(c.month.period) and c.opensAt < c.closesAt
pure def alwaysAttemptsSignedInWindow(c: Commitment): bool = c.attempts.every(a => a.publishedAt >= c.opensAt and a.publishedAt < c.closesAt)
pure def alwaysInvestigationHasUnknownRoot(c: Commitment): bool = c.phase == Investigating implies c.refusal == UnsignedRootObserved
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
pure def sometimesLegacyAdmitted(c: Commitment): bool = c.phase == Admitted and c.admittedLegacy
pure def sometimesUnknownRoot(c: Commitment): bool = c.phase == Investigating
pure def sometimesAutomaticOffRefused(c: Commitment): bool = c.phase == Authorized and c.held == AutomaticOff
pure def sometimesRestrictedRefused(c: Commitment): bool = c.phase == Authorized and c.held == ProjectRestricted
pure def sometimesBeforeWindowRefused(c: Commitment): bool = c.phase == Authorized and c.held == WindowNotOpen
pure def sometimesChainCapRefused(c: Commitment): bool = c.phase == Authorized and c.held == ChainCapExceeded
```

### Simulation samples

These input sets bound simulation only.

```quint
pure val familyValues = Set(EvmV2, SolanaV3)
pure val monthSample: FundedMonth = { project: "p", period: 202611, snapshotDigest: "d1", wholeGross: List(5),
  leaves: List({ source: "s1", actor: 1, gross: List(1) }, { source: "s2", actor: 2, gross: List(4) }), cap: List(8) }
pure val monthValues = Set(monthSample, { ...monthSample, cap: List(4) }, { ...monthSample, wholeGross: List(6) },
  { ...monthSample, period: 202612 })
pure val viewValues = Set(
  { ...emptyView, height: 1, time: 1796342400, cap: List(8), remaining: List(0) },
  { ...emptyView, height: 2, time: 1796342500, sourceSequence: 1, cap: List(8), consumed: List("s1") },
  { ...emptyView, height: 3, time: 1796342600, sourceSequence: 1, cap: List(8), consumed: List("s1"), admittedRoot: "r2", remaining: List(4) },
  { ...emptyView, height: 3, time: 1796342600, cap: List(8), admittedRoot: "r1", remaining: List(5) },
  { ...emptyView, height: 4, time: 1796342700, cap: List(8), admittedRoot: "r1", remaining: List(0), monthlyEnabled: false },
  { ...emptyView, height: 4, time: 1796342700, sourceSequence: 1, cap: List(8), consumed: List("s1"), admittedRoot: "r2", remaining: List(0), authority: "next" },
  { ...emptyView, height: 5, time: 1799020800, cap: List(8) },
  { ...emptyView, height: 2, time: 1796342500, cap: List(8), authority: "next" },
  { ...emptyView, height: 2, time: 1796342500, cap: List(4) },
  { ...emptyView, height: 3, time: 1796342600, cap: List(8), admittedRoot: "v1", legacyRoot: true, remaining: List(0) },
  { ...emptyView, height: 3, time: 1796342600, cap: List(8), admittedRoot: "x", remaining: List(5) })
pure def factsAt(height: int): SigningFacts =
  { height: height, projectActive: true, restricted: false, vaultServed: true, automaticOn: true, snapshotDigest: "d1" }
pure val factsValues = Set(factsAt(1), factsAt(2), factsAt(3), factsAt(4)).union(Set({ ...factsAt(1), automaticOn: false },
  { ...factsAt(1), restricted: true }, { ...factsAt(2), snapshotDigest: "d2" }, { ...factsAt(2), vaultServed: false }))
pure val legacyValues = Set({ root: "v1", snapshotDigest: "d1", wholeGross: List(5), leafCount: 2, signer: "attester" },
  { root: "v1", snapshotDigest: "d0", wholeGross: List(5), leafCount: 2, signer: "attester" })
pure val attemptIdValues = Set(1, 2)
pure val rootValues = Set("r1", "r2")
pure val byValues = Set("attester", "next", "anyone")
pure val weight_observe = 6
pure val weight_observeFacts = 8
pure val weight_signEvm = 6
pure val weight_signSolana = 4
```
