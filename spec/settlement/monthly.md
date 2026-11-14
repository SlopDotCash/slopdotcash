# Monthly allocations

PRD sections 6 and 7 fix the calendar UTC month, starting with 2026-11, and a
cutoff 72 hours after the month ends. One instance is one project's month:
its proposal, private owner adjustments, freeze, funding-time exclusions and
obligations. Source anchors are development `backend/payments/README.md`
("Monthly allocations" steps 1–5), `backend/payments/monthly.ts`,
`scripts/prepare-monthly-rewards.ts`, `src/lib/payments/monthly-allocation.ts`
and migrations `0062`, `0071` (`monthly_reward_bases`,
`monthly_reward_base_rows`, `monthly_allocation_changes`,
`monthly_payment_settings`, `monthly_payment_runs`,
`monthly_payment_obligations`, `monthly_payment_exclusions`). Legacy models
`monthly_coordinator`, `monthly_cutoff_queue`, `monthly_allocation`,
`monthly_owner_completion` and `monthly_source_conflict` map here.

Typed inputs and their owners: the accepted-work snapshot and payout
exclusions ([reward weights](./payoutExclusions.md), from Points and the D1
revision), the project's eligibility and effective revision (registry and
security enforcement), the authority of the acting account (GitHub authority
and moderator bans, checked again at the write boundary), the project-level
automatic setting ([monthly settings](./monthlySettings.md)), the finalized
vault observation (`vault_snapshots`, [escrow](./escrow.md) counters) and
finalized award facts (escrow events and the payment ledger). The pool,
weights and recipient amounts use arbitrary-length limbs. There is no
recipient count, monetary-size or per-account Points cap. Historical cycles
retain their original windows and terms.

## Story: Propose one month once from accepted work

### A month opens with no proposal, pool amount or obligation

```quint
import allocation as A from "./allocation"
import money as M from "./money"
import payoutExclusions as X from "./payoutExclusions"
type Role = ProjectOwner | Steward | RepositoryAdmin | Writer | NoRole
type AuthorityFact = { actor: int, role: Role, banned: bool, revision: int }
type Eligibility = { revision: int, active: bool, verifiedPool: bool, paused: bool, restricted: bool, retired: bool,
  vaultRegistered: bool, networkServed: bool }
type RevisionFact = { number: int, effectivePeriod: int, monthlyAmount: M::Amount, maximum: M::Amount }
type MonthlyPhase = Unopened | Collecting | NoProposal | Proposed | Frozen | Funded | Completed
type SkipReason = NoSkip | Unfunded | NotEligible | WindowPassed
type Trigger = NoTrigger | OwnerTrigger | AutomaticTrigger
type ObligationState = Created | Reserved | Paid
type SourceKey = { project: str, period: int, actor: int }
type Obligation = { actor: int, amount: M::Amount, source: SourceKey, progress: ObligationState }
type BanExclusion = { actor: int, ban: int }
type Monthly = { project: str, period: int, phase: MonthlyPhase, skip: SkipReason, now: int, automatic: bool, settingsSequence: int,
  eligibility: Eligibility, revision: RevisionFact, cap: M::Amount, snapshotDigest: str, exclusions: List[X::Exclusion],
  shares: List[A::Share], total: M::Amount, sequence: int, trigger: Trigger, frozenSequence: int,
  obligations: List[Obligation], banned: List[BanExclusion], underfundedNotice: bool, coordinatorRetries: int }
pure val noRevision: RevisionFact = { number: 0, effectivePeriod: 0, monthlyAmount: M::zero, maximum: M::zero }
pure val noEligibility: Eligibility = { revision: 0, active: false, verifiedPool: false, paused: false, restricted: false,
  retired: false, vaultRegistered: false, networkServed: false }
pure val initial: Monthly = { project: "eliza", period: 0, phase: Unopened, skip: NoSkip, now: 1793491200, automatic: true,
  settingsSequence: 0, eligibility: noEligibility, revision: noRevision, cap: M::zero, snapshotDigest: "", exclusions: List(),
  shares: List(), total: M::zero, sequence: 0, trigger: NoTrigger, frozenSequence: 0, obligations: List(), banned: List(),
  underfundedNotice: false, coordinatorRetries: 0 }
pure val firstAutomaticPeriod = 202611
pure val cutoffSeconds = 259200
pure val proposalWindowSeconds = 259200
pure val freshnessSeconds = 1800
pure def hasActor(shares: List[A::Share], actor: int): bool = shares.some(s => s.actor == actor)
pure def amountFor(shares: List[A::Share], actor: int): M::Amount =
  shares.foldl(M::zero, (total, share) => M::addAmounts(total, if (share.actor == actor) share.amount else M::zero))
pure def validPeriod(period: int): bool = period >= 200001 and period <= 999912 and period % 100 >= 1 and period % 100 <= 12
pure def nextPeriod(period: int): int = if (period % 100 == 12) (period / 100 + 1) * 100 + 1 else period + 1
pure def monthStart(period: int): int =
  val month = period % 100
  val year = period / 100 - (if (month <= 2) 1 else 0)
  val era = year / 400
  val yearOfEra = year - era * 400
  val dayOfYear = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5
  (era * 146097 + yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear - 719468) * 86400
pure def monthEnd(period: int): int = monthStart(nextPeriod(period))
pure def cutoff(m: Monthly): int = monthEnd(m.period) + cutoffSeconds
pure def canOpenMonth(m: Monthly, period: int): bool = m.phase == Unopened and validPeriod(period)
pure def openMonth(m: Monthly, period: int): Monthly = { ...m, phase: Collecting, period: period }
pure def canObserveClock(m: Monthly, now: int): bool = m.phase != Unopened and now > m.now
pure def observeClock(m: Monthly, now: int): Monthly = { ...m, now: now }
pure def canObserveEligibility(m: Monthly, eligibility: Eligibility): bool =
  m.phase != Unopened and eligibility.revision >= m.eligibility.revision
pure def observeEligibility(m: Monthly, eligibility: Eligibility): Monthly = { ...m, eligibility: eligibility }
pure def canObserveSettings(m: Monthly, automatic: bool, settingsSequence: int): bool =
  m.phase != Unopened and settingsSequence > m.settingsSequence
pure def observeSettings(m: Monthly, automatic: bool, settingsSequence: int): Monthly =
  { ...m, automatic: automatic, settingsSequence: settingsSequence }
```

### The trusted workflow proposes in the first three days for an active, funded, verified project

The proposal is stored once, during the first three UTC days after the month
ends, for an active verified monthly-pool project that has a registered vault,
whose escrow policy is effective for the month and whose monthly amount is
positive. The pool equals that revision's monthly amount: unallocated funds
never raise a later month. Weights come only from a complete accepted-work
snapshot minus payout exclusions. A month with no weighted contributor gets
an empty proposal that pays nothing. The shared allocator breaks equal
remainders by permanent actor ID. A paused project gets no proposal; a later
run inside the window proposes it once it is active again.

```quint
pure def proposalWindowOpen(m: Monthly): bool = m.now >= monthEnd(m.period) and m.now < monthEnd(m.period) + proposalWindowSeconds
pure def projectMayPropose(e: Eligibility, revision: RevisionFact): bool = e.revision == revision.number and e.revision > 0
  and e.active and e.verifiedPool and not(e.paused) and not(e.retired) and e.vaultRegistered
pure def canPropose(m: Monthly, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact): bool =
  val weights = X::rewardWeights(snapshot, exclusions)
  m.phase == Collecting and proposalWindowOpen(m) and projectMayPropose(m.eligibility, revision)
    and revision.effectivePeriod <= m.period and M::validAmount(revision.monthlyAmount) and M::positiveAmount(revision.monthlyAmount)
    and M::withinMaximum(revision.monthlyAmount, revision.maximum)
    and X::usableSnapshot(snapshot, m.project, m.period)
    and (weights.length() == 0 or A::canCommitAllocation(revision.monthlyAmount, weights))
pure def propose(m: Monthly, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact): Monthly =
  val weights = X::rewardWeights(snapshot, exclusions)
  val shares = if (weights.length() == 0) List() else A::allocateAmounts(revision.monthlyAmount, weights)
  { ...m, phase: Proposed, revision: revision, cap: revision.monthlyAmount, snapshotDigest: snapshot.digest,
    exclusions: exclusions, shares: shares, total: if (weights.length() == 0) M::zero else revision.monthlyAmount }
```

### A month that is not proposed in its window gets no proposal

```quint
pure def skipReason(m: Monthly): SkipReason =
  if (not(M::positiveAmount(m.revision.monthlyAmount)) and m.eligibility.active) Unfunded
  else if (not(m.eligibility.active) or m.eligibility.paused or not(m.eligibility.vaultRegistered)) NotEligible else WindowPassed
pure def canCloseProposalWindow(m: Monthly): bool = m.phase == Collecting and m.now >= monthEnd(m.period) + proposalWindowSeconds
pure def closeProposalWindow(m: Monthly): Monthly = { ...m, phase: NoProposal, skip: skipReason(m) }
```

## Story: Owners adjust privately before the freeze

### Only a current owner, steward or repository administrator changes another recipient's amount

Each change replaces one existing recipient's amount and carries the
sequence it read, so a concurrent change refuses. Write or maintain
permission can read the month but not change it. A banned account cannot
change allocations. Nobody changes their own allocation. A payout-excluded
actor cannot receive a positive amount. The total never exceeds the month's
pool and every amount fits the vault network's integer range. While the
automatic default is on, nothing changes after the cutoff. The change
journal is private.

```quint
pure def manages(fact: AuthorityFact, m: Monthly): bool =
  (fact.role == ProjectOwner or fact.role == Steward or fact.role == RepositoryAdmin) and not(fact.banned)
    and fact.revision == m.eligibility.revision and fact.actor > 0
pure def replaceShare(shares: List[A::Share], actor: int, amount: M::Amount): List[A::Share] =
  shares.listMap(s => if (s.actor == actor) { ...s, amount: amount } else s)
pure def canAdjust(m: Monthly, actor: int, amount: M::Amount, expectedSequence: int, fact: AuthorityFact): bool =
  m.phase == Proposed and manages(fact, m) and expectedSequence == m.sequence and actor != fact.actor
    and hasActor(m.shares, actor) and M::validAmount(amount) and M::withinMaximum(amount, m.revision.maximum)
    and not(M::positiveAmount(amount) and X::excludedIn(m.exclusions, actor, m.period))
    and M::compareAmounts(A::allocatedTotal(replaceShare(m.shares, actor, amount)), m.cap) <= 0
    and not(m.automatic and m.now >= cutoff(m))
pure def adjust(m: Monthly, actor: int, amount: M::Amount, expectedSequence: int, fact: AuthorityFact): Monthly =
  val shares = replaceShare(m.shares, actor, amount)
  { ...m, shares: shares, total: A::allocatedTotal(shares), sequence: m.sequence + 1 }
```

## Story: Freeze exactly one execution snapshot

### The owner may finalize early; the coordinator freezes at the cutoff unless the default is off

The owner path needs the same authority and current sequence. The automatic
path needs the cutoff, the automatic default, a month from 2026-11 on, and a
project that is not paused or restricted and whose vault network is served.
Either path writes the single run record with its trigger and the sequence
it froze. The automatic worker is weakly fair while its guard holds; a
persistent outage violates that assumption and is surfaced operationally.

```quint
pure def canFinalize(m: Monthly, expectedSequence: int, fact: AuthorityFact): bool =
  m.phase == Proposed and manages(fact, m) and expectedSequence == m.sequence
pure def finalize(m: Monthly, expectedSequence: int, fact: AuthorityFact): Monthly =
  { ...m, phase: Frozen, trigger: OwnerTrigger, frozenSequence: m.sequence }
pure def automaticMayFreeze(m: Monthly): bool = m.automatic and m.now >= cutoff(m) and m.period >= firstAutomaticPeriod
  and not(m.eligibility.paused) and not(m.eligibility.restricted) and m.eligibility.networkServed
pure def canAutoFreeze(m: Monthly): bool = m.phase == Proposed and automaticMayFreeze(m)
pure def autoFreeze(m: Monthly): Monthly = { ...m, phase: Frozen, trigger: AutomaticTrigger, frozenSequence: m.sequence }
pure val fair_autoFreeze = "weak"
pure def leadsToCutoffFrozen(m: Monthly, later: Monthly): bool =
  canAutoFreeze(m) implies (later.phase != Proposed or not(automaticMayFreeze(later)))
```

## Story: Create obligations only when the whole month is covered

### Fresh finalized free funds must cover this month and every earlier unreserved obligation

The coordinator reads a finalized vault snapshot no older than 30 minutes.
Before it creates obligations it excludes accounts with an active moderator
ban and records the exact ban; excluded amounts do not delay other
recipients and never become their extra awards. An empty or all-zero month
completes with no obligation. An underfunded month creates nothing and
records one Inbox exception however often the coordinator retries.

```quint
type VaultObservation = { observedAt: int, free: M::Amount, earlierUnreserved: M::Amount }
pure def banFor(bans: List[BanExclusion], actor: int): bool = bans.some(b => b.actor == actor)
pure def payable(m: Monthly, bans: List[BanExclusion]): List[A::Share] =
  m.shares.select(s => M::positiveAmount(s.amount) and not(banFor(bans, s.actor)))
pure def payableTotal(shares: List[A::Share]): M::Amount = A::allocatedTotal(shares)
pure def fresh(m: Monthly, observation: VaultObservation): bool =
  observation.observedAt <= m.now and m.now - observation.observedAt <= freshnessSeconds
    and M::validAmount(observation.free) and M::validAmount(observation.earlierUnreserved)
pure def covered(m: Monthly, observation: VaultObservation, bans: List[BanExclusion]): bool =
  M::compareAmounts(observation.free, M::addAmounts(payableTotal(payable(m, bans)), observation.earlierUnreserved)) >= 0
pure def validBans(bans: List[BanExclusion]): bool = bans.every(b => b.actor > 0 and b.ban > 0 and bans.select(o => o.actor == b.actor).length() == 1)
pure def keyFor(m: Monthly, actor: int): SourceKey = { project: m.project, period: m.period, actor: actor }
pure def canCreateObligations(m: Monthly, observation: VaultObservation, bans: List[BanExclusion]): bool =
  m.phase == Frozen and fresh(m, observation) and validBans(bans) and covered(m, observation, bans)
pure def createObligations(m: Monthly, observation: VaultObservation, bans: List[BanExclusion]): Monthly =
  val created = payable(m, bans).listMap(s => { actor: s.actor, amount: s.amount, source: keyFor(m, s.actor), progress: Created })
  { ...m, phase: if (created.length() == 0) Completed else Funded, obligations: created,
    banned: bans.select(b => m.shares.some(s => s.actor == b.actor and M::positiveAmount(s.amount))) }
pure def canNoteUnderfunded(m: Monthly, observation: VaultObservation, bans: List[BanExclusion]): bool =
  m.phase == Frozen and fresh(m, observation) and validBans(bans) and not(covered(m, observation, bans))
pure def noteUnderfunded(m: Monthly, observation: VaultObservation, bans: List[BanExclusion]): Monthly =
  { ...m, underfundedNotice: true, coordinatorRetries: m.coordinatorRetries + 1 }
```

### A finalized award reserves an obligation and a ledger payment pays it

Each source key is fixed per project, month and actor and is independent of
the amount, so the contract refuses a second award for it whether it is
committed by hand or as a monthly leaf. A reserved obligation waits without
expiry until its contributor binds a wallet. A later ban or a project pause
never removes a funded obligation. The month completes when every obligation
is paid.

```quint
type AwardFact = { source: SourceKey, actor: int, gross: M::Amount, paid: bool }
pure def obligationFor(m: Monthly, actor: int): Obligation =
  m.obligations.select(o => o.actor == actor).nthOr(0, { actor: 0, amount: M::zero, source: keyFor(m, 0), progress: Created })
pure def canRecordReserved(m: Monthly, award: AwardFact): bool =
  val o = obligationFor(m, award.actor)
  m.phase == Funded and o.actor > 0 and o.progress == Created and award.source == o.source and M::equalAmounts(award.gross, o.amount)
pure def recordReserved(m: Monthly, award: AwardFact): Monthly =
  { ...m, obligations: m.obligations.listMap(o => if (o.actor == award.actor) { ...o, progress: Reserved } else o) }
pure def canRecordPaid(m: Monthly, award: AwardFact): bool =
  val o = obligationFor(m, award.actor)
  m.phase == Funded and o.actor > 0 and o.progress == Reserved and award.source == o.source and M::equalAmounts(award.gross, o.amount) and award.paid
pure def recordPaid(m: Monthly, award: AwardFact): Monthly =
  val obligations = m.obligations.listMap(o => if (o.actor == award.actor) { ...o, progress: Paid } else o)
  { ...m, obligations: obligations, phase: if (obligations.every(o => o.progress == Paid)) Completed else Funded }
```

## Story: Amounts, recipients and history stay exact

### The allocation is conserved within the month's pool

```quint
pure def alwaysAllocationConserved(m: Monthly): bool = M::validAmount(m.total) and M::validAmount(m.cap)
  and M::compareAmounts(m.total, m.cap) <= 0 and M::equalAmounts(A::allocatedTotal(m.shares), m.total)
  and m.shares.every(s => M::validAmount(s.amount) and s.actor > 0 and m.shares.select(o => o.actor == s.actor).length() == 1)
pure def proposedPhase(phase: MonthlyPhase): bool =
  phase == Proposed or phase == Frozen or phase == Funded or phase == Completed
pure def alwaysCapFromRevision(m: Monthly): bool = proposedPhase(m.phase) implies
  m.cap == m.revision.monthlyAmount and M::positiveAmount(m.cap) and m.revision.effectivePeriod <= m.period
pure def alwaysUnproposedEmpty(m: Monthly): bool = not(proposedPhase(m.phase)) implies
  m.shares.length() == 0 and M::equalAmounts(m.total, M::zero) and m.obligations.length() == 0 and m.sequence == 0
```

### Obligations follow the frozen shares exactly, excluding only banned accounts

```quint
pure def alwaysObligationsMatchShares(m: Monthly): bool = m.obligations.every(o => o.actor > 0
  and hasActor(m.shares, o.actor) and M::positiveAmount(o.amount) and o.source == keyFor(m, o.actor)
  and m.shares.some(s => s.actor == o.actor and s.amount == o.amount)
  and not(banFor(m.banned, o.actor)) and m.obligations.select(x => x.actor == o.actor).length() == 1)
pure def alwaysEveryPayableShareAccounted(m: Monthly): bool = (m.phase == Funded or m.phase == Completed) implies
  m.shares.every(s => not(M::positiveAmount(s.amount)) or banFor(m.banned, s.actor) or m.obligations.some(o => o.actor == s.actor))
pure def alwaysBannedHadShares(m: Monthly): bool = m.banned.every(b => m.shares.some(s => s.actor == b.actor and M::positiveAmount(s.amount)))
pure def alwaysNoObligationsBeforeFunding(m: Monthly): bool =
  (m.phase != Funded and m.phase != Completed) implies m.obligations.length() == 0 and m.banned.length() == 0
pure def alwaysCompletedPaid(m: Monthly): bool = m.phase == Completed implies m.obligations.every(o => o.progress == Paid)
pure def alwaysFrozenRecord(m: Monthly): bool =
  ((m.phase == Frozen or m.phase == Funded or m.phase == Completed) implies m.trigger != NoTrigger and m.frozenSequence == m.sequence)
    and (m.trigger == AutomaticTrigger implies m.period >= firstAutomaticPeriod)
    and ((m.phase == Unopened or m.phase == Collecting or m.phase == NoProposal or m.phase == Proposed) implies m.trigger == NoTrigger)
```

### Frozen amounts, recorded triggers and obligation progress never move backwards

```quint
pure def frozenPhase(phase: MonthlyPhase): bool = phase == Frozen or phase == Funded or phase == Completed
pure def stepFrozenStable(before: Monthly, after: Monthly): bool = frozenPhase(before.phase) implies
  frozenPhase(after.phase) and after.total == before.total and after.shares == before.shares and after.trigger == before.trigger
    and after.frozenSequence == before.frozenSequence and after.snapshotDigest == before.snapshotDigest and after.cap == before.cap
pure def rank(progress: ObligationState): int = if (progress == Created) 0 else if (progress == Reserved) 1 else 2
pure def stepObligationsMonotone(before: Monthly, after: Monthly): bool =
  (before.obligations.length() > 0 implies after.obligations.length() == before.obligations.length())
    and before.obligations.every(o => after.obligations.some(n => n.actor == o.actor and n.amount == o.amount
      and n.source == o.source and rank(n.progress) >= rank(o.progress)))
    and before.banned.every(b => after.banned.includes(b))
pure def stepSequenceCounts(before: Monthly, via: str, after: Monthly): bool =
  if (via == "adjust") after.sequence == before.sequence + 1 else after.sequence == before.sequence
pure def stepUnderfundedNoticeOnce(before: Monthly, after: Monthly): bool = before.underfundedNotice implies after.underfundedNotice
pure def stepPeriodFixed(before: Monthly, after: Monthly): bool = before.phase != Unopened implies after.period == before.period and after.project == before.project
```

### Proposals, adjustments, freezes, exclusions and payments are reachable

```quint
pure def sometimesWalletlessReserve(m: Monthly): bool = m.phase == Funded and m.obligations.some(o => o.progress == Reserved)
  and m.obligations.some(o => o.progress != Paid)
pure def sometimesCompleted(m: Monthly): bool = m.phase == Completed and M::positiveAmount(m.total) and m.obligations.length() > 0
pure def sometimesEmptyMonth(m: Monthly): bool = m.phase == Completed and m.shares.length() == 0
pure def sometimesBanExcluded(m: Monthly): bool = m.phase == Funded and m.banned.length() > 0
pure def sometimesUnderfundedThenFunded(m: Monthly): bool = m.phase == Funded and m.underfundedNotice
pure def sometimesAutomaticFreeze(m: Monthly): bool = m.trigger == AutomaticTrigger
pure def sometimesOwnerAdjustedAndFinalized(m: Monthly): bool = m.trigger == OwnerTrigger and m.sequence > 0
pure def sometimesAdjustAfterCutoffWithDefaultOff(m: Monthly): bool = m.phase == Proposed and m.sequence > 0 and not(m.automatic)
  and m.now >= cutoff(m)
pure def sometimesSkipped(m: Monthly): bool = m.phase == NoProposal and m.skip == NotEligible
pure def sometimesEarlierMonthNotAutomatic(m: Monthly): bool = m.period < firstAutomaticPeriod and m.phase == Proposed and m.now >= cutoff(m)
```

### Simulation samples

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules. November 2026 ends
at 1796083200; its cutoff is 1796342400.

```quint
pure val periodValues = Set(202611, 202610)
pure val nowValues = Set(1793491300, 1796083300, 1796342400, 1796342600, 1796343000)
pure val eligible: Eligibility = { revision: 1, active: true, verifiedPool: true, paused: false, restricted: false,
  retired: false, vaultRegistered: true, networkServed: true }
pure val eligibilityValues = Set(eligible, { ...eligible, paused: true }, { ...eligible, revision: 2 })
pure val revisionSample: RevisionFact = { number: 1, effectivePeriod: 202609, monthlyAmount: List(10), maximum: M::maxU128 }
pure val revisionValues = Set(revisionSample, { ...revisionSample, monthlyAmount: List(0) }, { ...revisionSample, effectivePeriod: 202612 })
pure val snapshotSample: X::WorkSnapshot = { project: "eliza", period: 202611, digest: "d", coverage: X::CompleteCoverage,
  rows: List({ actor: 1, acceptedWork: 10, participation: 30, recognition: 0 }, { actor: 2, acceptedWork: 30, participation: 0, recognition: 5 },
    { actor: 3, acceptedWork: 10, participation: 0, recognition: 0 }) }
pure val snapshotValues = Set(snapshotSample, { ...snapshotSample, rows: List() }, { ...snapshotSample, coverage: X::MissingSources },
  { ...snapshotSample, period: 202610 }, { ...snapshotSample, period: 202610, rows: List({ actor: 1, acceptedWork: 10, participation: 0, recognition: 0 }) })
pure val exclusionsValues = Set(List(), List({ actor: 3, relationship: X::RelatedParty, fromPeriod: 202610, untilPeriod: 0 }))
pure val actorValues = Set(1, 2, 3)
pure val amountValues = Set(List(0), List(2), List(5))
pure val expectedSequenceValues = Set(0, 1)
pure val factValues = Set({ actor: 9, role: ProjectOwner, banned: false, revision: 1 }, { actor: 2, role: Steward, banned: false, revision: 1 },
  { actor: 9, role: Writer, banned: false, revision: 1 }, { actor: 9, role: ProjectOwner, banned: true, revision: 1 })
pure val automaticValues = Set(true, false)
pure val settingsSequenceValues = Set(1, 2)
pure val observationValues = Set({ observedAt: 1796342400, free: List(20), earlierUnreserved: List(0) },
  { observedAt: 1796342400, free: List(5), earlierUnreserved: List(0) }, { observedAt: 1796340000, free: List(20), earlierUnreserved: List(0) },
  { observedAt: 1796342600, free: List(20), earlierUnreserved: List(0) })
pure val bansValues = Set(List(), List({ actor: 2, ban: 7 }))
pure def awardFact(actor: int, gross: M::Amount, paid: bool): AwardFact =
  { source: { project: "eliza", period: 202611, actor: actor }, actor: actor, gross: gross, paid: paid }
pure val awardValues = Set(awardFact(1, List(2), false)).union(Set(awardFact(1, List(2), true))).union(Set(awardFact(2, List(6), true)))
  .union(Set(awardFact(3, List(2), true))).union(Set(awardFact(1, List(3), true))).union(Set(awardFact(1, List(3), false)))
  .union(Set(awardFact(2, List(7), false))).union(Set(awardFact(2, List(7), true))).union(Set(awardFact(2, List(6), false)))
pure val weight_observeClock = 6
pure val weight_propose = 6
pure val weight_adjust = 4
pure val weight_createObligations = 6
pure val weight_recordReserved = 6
pure val weight_recordPaid = 6
```
