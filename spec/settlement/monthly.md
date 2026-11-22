# Monthly allocations

PRD sections 6 and 7 fix the calendar UTC month, starting with 2026-11, and a
cutoff 72 hours after the month ends. One instance is one project's month:
its proposal, owner changes and public cuts, freeze, funding-time exclusions
and obligations. Source anchors are development `backend/payments/README.md`
("Monthly allocations" steps 1–5), `backend/payments/monthly.ts`,
`scripts/prepare-monthly-rewards.ts`, `src/lib/payments/monthly-allocation.ts`
and migrations `0062`, `0071`, `0126` (`monthly_reward_bases`,
`monthly_reward_base_rows`, `monthly_allocation_changes`,
`monthly_allocation_cut_reasons`,
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
import monthPledges as P from "./monthPledges"
import maintainerShare as S from "./maintainerShare"
import asiNovemberCloseout as C from "./asiNovemberCloseout"
type Role = ProjectOwner | Steward | RepositoryAdmin | Writer | NoRole
type AuthorityFact = { actor: int, role: Role, banned: bool, revision: int }
type Eligibility = { revision: int, active: bool, verifiedPool: bool, paused: bool, restricted: bool, retired: bool,
  vaultRegistered: bool, networkServed: bool, receiptPolicyActive: bool, monthlyPoolReward: bool }
type RevisionFact = { number: int, effectivePeriod: int, monthlyAmount: M::Amount, maximum: M::Amount, rewardStartAt: int,
  vault: str, asset: str, feePolicy: str, exclusions: List[X::Exclusion] }
type MonthlyPhase = Unopened | Collecting | NoProposal | Proposed | Frozen | Funded | Completed
type SkipReason = NoSkip | Unfunded | NotEligible | WindowPassed
type Trigger = NoTrigger | OwnerTrigger | AutomaticTrigger
type ObligationState = Created | Reserved | Paid | Conflicted
type SourceKey = { project: str, period: int, actor: int }
type Obligation = { actor: int, amount: M::Amount, source: SourceKey, progress: ObligationState }
type BanExclusion = { actor: int, ban: int }
type Change = { actor: int, by: int, amount: M::Amount, sequence: int, at: int, cut: bool }
type Cut = { actor: int, by: int, proposed: M::Amount, amount: M::Amount, reasonLength: int, at: int, sequence: int }
type CutNotice = { project: str, period: int, actor: int, sequence: int }
type Monthly = { project: str, period: int, phase: MonthlyPhase, skip: SkipReason, now: int, automatic: bool, settingsSequence: int,
  eligibility: Eligibility, revision: RevisionFact, currentRevision: RevisionFact, cap: M::Amount, snapshotDigest: str,
  exclusions: List[X::Exclusion], shares: List[A::Share], total: M::Amount, sequence: int, trigger: Trigger, frozenSequence: int, frozenBy: int,
  obligations: List[Obligation], banned: List[BanExclusion], underfundedNotice: bool, coordinatorRetries: int,
  proposedShares: List[A::Share], changes: List[Change], cuts: List[Cut], publicCuts: List[Cut], notices: List[CutNotice],
  latestCutAt: int, frozenAt: int, pledgedVault: str, earlyCloseAt: int }
pure val noRevision: RevisionFact = { number: 0, effectivePeriod: 0, monthlyAmount: M::zero, maximum: M::zero, rewardStartAt: 0,
  vault: "", asset: "", feePolicy: "", exclusions: List() }
pure val noEligibility: Eligibility = { revision: 0, active: false, verifiedPool: false, paused: false, restricted: false,
  retired: false, vaultRegistered: false, networkServed: false, receiptPolicyActive: false, monthlyPoolReward: false }
pure val initial: Monthly = { project: "eliza", period: 0, phase: Unopened, skip: NoSkip, now: 1793491200, automatic: true,
  settingsSequence: 0, eligibility: noEligibility, revision: noRevision, currentRevision: noRevision, cap: M::zero,
  snapshotDigest: "", exclusions: List(), shares: List(), total: M::zero, sequence: 0, trigger: NoTrigger, frozenSequence: 0,
  frozenBy: 0, obligations: List(), banned: List(),
  underfundedNotice: false, coordinatorRetries: 0, proposedShares: List(), changes: List(), cuts: List(), publicCuts: List(),
  notices: List(), latestCutAt: 0, frozenAt: 0, pledgedVault: "", earlyCloseAt: 0 }
pure val firstAutomaticPeriod = 202611
pure val cutoffSeconds = 259200
pure val proposalWindowSeconds = 259200
pure val freshnessSeconds = 1800
pure val cutNoticeSeconds = 86400
pure val cutReasonMin = 20
pure val cutReasonMax = 500
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
pure def canOpenMonth(m: Monthly, project: str, period: int): bool = m.phase == Unopened and project != "" and validPeriod(period)
pure def openMonth(m: Monthly, project: str, period: int): Monthly = { ...m, phase: Collecting, project: project, period: period }
pure def canObserveClock(m: Monthly, now: int): bool = m.phase != Unopened and now > m.now
pure def observeClock(m: Monthly, now: int): Monthly = { ...m, now: now }
pure def canObserveEligibility(m: Monthly, eligibility: Eligibility): bool =
  m.phase != Unopened and eligibility.revision >= m.eligibility.revision
pure def observeEligibility(m: Monthly, eligibility: Eligibility): Monthly = { ...m, eligibility: eligibility }
pure def canObserveRevision(m: Monthly, revision: RevisionFact): bool =
  m.phase != Unopened and revision.number > 0 and revision.number >= m.currentRevision.number and revision != m.currentRevision
pure def observeRevision(m: Monthly, revision: RevisionFact): Monthly = { ...m, currentRevision: revision }
```

### The trusted workflow proposes in the first three days for an active, funded, verified project

The proposal is stored once, during the first three UTC days after the month
ends, for an active verified monthly-pool project with an active receipt
policy, a reward start before the month ends and a registered vault, whose
escrow policy is effective for the month and whose monthly amount is
positive. The revision used is the current one the month observed. The pool
equals that revision's monthly amount: unallocated funds never raise a later
month. Apart from a published maintainer share, weights come only from a
complete accepted-work snapshot minus that revision's own payout exclusion
list; for the November 2026 exception
projects that list covers nobody in 2026-11. A month with no weighted contributor gets
an empty proposal that pays nothing. The shared allocator breaks equal
remainders by permanent actor ID. A paused project gets no proposal; a later
run inside the window proposes it once it is active again.

When the revision sets a [maintainer share](./maintainerShare.md) for the
month (`basisPoints` above zero, at most 30%), the proposal also needs the
month's complete decision record, and a month without a share takes none
(development `8660a6121`, `src/lib/payments/escrow-cycle.ts`
`buildEscrowCycle`, `scripts/prepare-monthly-rewards.ts`). The share comes
out of the monthly amount first: the rest is divided over the Points
weights and each maintainer's part of the share is added to that account's
amount, so an account has one share a month; a maintainer with no Points
weight is appended after the Points recipients with exactly its part.
Without a share nothing changes. A failed decision read proposes nothing
for that project and a later run of the same month proposes it.

```quint
pure val noShareRecord: S::DecisionRecord = S::noRecord
pure def shareRecordFits(m: Monthly, basisPoints: int, record: S::DecisionRecord): bool =
  basisPoints >= 0 and basisPoints <= S::maxShareBasisPoints
    and (if (basisPoints > 0) S::validRecord(record, m.period, record.repositories) and record.repositories.length() > 0
         else record == noShareRecord)
pure def maintainerPool(revision: RevisionFact, exclusions: List[X::Exclusion], basisPoints: int, record: S::DecisionRecord): M::Amount =
  S::sharePool(revision.monthlyAmount, basisPoints, S::shareWeights(record, exclusions))
pure def mergedShares(points: List[A::Share], maintainers: List[A::Share]): List[A::Share] =
  points.listMap(s => { ...s, amount: M::addAmounts(s.amount, amountFor(maintainers, s.actor)) })
    .concat(maintainers.select(x => not(hasActor(points, x.actor))))
pure def proposalShares(snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact, basisPoints: int,
  record: S::DecisionRecord): List[A::Share] =
  val weights = X::rewardWeights(snapshot, exclusions)
  val pool = maintainerPool(revision, exclusions, basisPoints, record)
  val points = if (weights.length() == 0) List() else A::allocateAmounts(M::subtractAmounts(revision.monthlyAmount, pool), weights)
  mergedShares(points, S::maintainerShares(pool, S::shareWeights(record, exclusions)))
pure def proposalWindowOpen(m: Monthly): bool = m.now >= monthEnd(m.period) and m.now < monthEnd(m.period) + proposalWindowSeconds
pure def projectMayPropose(e: Eligibility, revision: RevisionFact): bool = e.revision == revision.number and e.revision > 0
  and e.active and e.verifiedPool and not(e.paused) and not(e.retired) and e.vaultRegistered
  and e.receiptPolicyActive and e.monthlyPoolReward
pure def canPropose(m: Monthly, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact, basisPoints: int,
  record: S::DecisionRecord): bool =
  val weights = X::rewardWeights(snapshot, exclusions)
  val pool = maintainerPool(revision, exclusions, basisPoints, record)
  m.phase == Collecting and proposalWindowOpen(m) and revision == m.currentRevision and projectMayPropose(m.eligibility, revision)
    and revision.rewardStartAt < monthEnd(m.period) and exclusions == revision.exclusions
    and X::novemberException(m.project, exclusions) and revision.effectivePeriod <= m.period and M::validAmount(revision.monthlyAmount) and M::positiveAmount(revision.monthlyAmount)
    and M::withinMaximum(revision.monthlyAmount, revision.maximum)
    and X::usableSnapshot(snapshot, m.project, m.period)
    and shareRecordFits(m, basisPoints, record) and M::compareAmounts(revision.monthlyAmount, pool) >= 0
    and (weights.length() == 0 or A::canCommitAllocation(M::subtractAmounts(revision.monthlyAmount, pool), weights))
pure def propose(m: Monthly, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact, basisPoints: int,
  record: S::DecisionRecord): Monthly =
  val shares = proposalShares(snapshot, exclusions, revision, basisPoints, record)
  { ...m, phase: Proposed, revision: revision, cap: revision.monthlyAmount, snapshotDigest: snapshot.digest,
    exclusions: exclusions, shares: shares, proposedShares: shares, total: if (shares.length() == 0) M::zero else A::allocatedTotal(shares) }
pure def sometimesMaintainerWithoutPointsPaid(m: Monthly): bool = m.phase == Proposed and m.earlyCloseAt == 0
  and m.shares.some(s => s.actor == 4 and M::positiveAmount(s.amount))
```

### The reviewed ASI closeout proposes its month from the cutoff with its fixed pool and no change

The one historical exception of the [ASI November
closeout](./asiNovemberCloseout.md): ASI's 2026-11 month is proposed from
the reviewed import's stored base, from the cutoff 2026-11-19T00:00:00.000Z
on and before any ordinary proposal, for a project that may propose and is
not restricted, under the current revision and its own exclusions. Its pool
is the closeout's gross of 150,000,000 base units rather than the revision's
monthly amount, divided over the cutoff-specific Points weights by the
shared allocator with no maintainer share, and the month records its early
close time (`early_close_at`). The owner may finalize it from that time,
before the month ends; the automatic path keeps the ordinary cutoff. No
allocation change is accepted on it (409 `closeout_allocations_fixed`, and
the trigger of `migrations/0143_asi_november_closeout.sql`). Development
`backend/payments/monthly.ts` (`loadBase`, `freezeMonthlyPeriod`, the change
write).

```quint
pure def canProposeCloseout(m: Monthly, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact): bool =
  val weights = X::rewardWeights(snapshot, exclusions)
  m.phase == Collecting and C::closeoutMonth(m.project, m.period) and m.now >= C::closeoutCutoff
    and revision == m.currentRevision and projectMayPropose(m.eligibility, revision) and not(m.eligibility.restricted)
    and revision.rewardStartAt < monthEnd(m.period) and exclusions == revision.exclusions
    and X::novemberException(m.project, exclusions) and revision.effectivePeriod <= m.period
    and M::validAmount(revision.monthlyAmount) and M::positiveAmount(revision.monthlyAmount)
    and X::usableSnapshot(snapshot, m.project, m.period)
    and (weights.length() == 0 or A::canCommitAllocation(C::closeoutCap, weights))
pure def proposeCloseout(m: Monthly, snapshot: X::WorkSnapshot, exclusions: List[X::Exclusion], revision: RevisionFact): Monthly =
  val weights = X::rewardWeights(snapshot, exclusions)
  val shares = if (weights.length() == 0) List() else A::allocateAmounts(C::closeoutCap, weights)
  { ...m, phase: Proposed, revision: revision, cap: C::closeoutCap, snapshotDigest: snapshot.digest,
    exclusions: exclusions, shares: shares, proposedShares: shares,
    total: if (shares.length() == 0) M::zero else A::allocatedTotal(shares), earlyCloseAt: C::closeoutCutoff }
pure def alwaysCloseoutOnlyForTheReviewedMonth(m: Monthly): bool = m.earlyCloseAt > 0 implies
  (C::closeoutMonth(m.project, m.period) and m.earlyCloseAt == C::closeoutCutoff and proposedPhase(m.phase))
pure def alwaysCloseoutUnchanged(m: Monthly): bool = m.earlyCloseAt > 0 implies (m.changes.length() == 0 and m.cuts.length() == 0)
pure def sometimesCloseoutFinalizedEarly(m: Monthly): bool = m.earlyCloseAt > 0 and m.trigger == OwnerTrigger
  and m.frozenAt < monthEnd(m.period)
pure val weight_proposeCloseout = 3
```

### A month that is not proposed in its window gets no proposal

The reason comes from the current revision and eligibility the month
observed: an eligible project with no positive monthly amount is unfunded;
an inactive, paused or unregistered project is not eligible; an eligible
funded project whose proposal never ran in the window, for example because
its snapshot was incomplete, passed its window.

```quint
pure def skipReason(m: Monthly): SkipReason =
  if (not(m.eligibility.active) or m.eligibility.paused or not(m.eligibility.vaultRegistered) or m.currentRevision.number == 0) NotEligible
  else if (not(M::positiveAmount(m.currentRevision.monthlyAmount))) Unfunded else WindowPassed
pure def canCloseProposalWindow(m: Monthly): bool = m.phase == Collecting and m.now >= monthEnd(m.period) + proposalWindowSeconds
pure def closeProposalWindow(m: Monthly): Monthly = { ...m, phase: NoProposal, skip: skipReason(m) }
```

## Story: Owners change amounts before the freeze, and cuts are public

### Only a current owner, steward or repository administrator changes another recipient's amount

Each change replaces one existing recipient's amount and carries the
sequence it read, so a concurrent change refuses. Write or maintain
permission can read the month but not change it. A banned account cannot
change allocations; the ban is read again at the write, so a concurrent ban
refuses the whole write. A change under a stale project revision refuses.
Nobody changes their own allocation. A payout-excluded actor cannot receive
a positive amount. The total never exceeds the month's pool and every amount
fits the vault network's integer range. While the month freezes at the
cutoff without the owner, because the automatic default is on or because
its stored pledge in the vault that pays it keeps it (`freezesAtCutoff`,
`pledgeKeepsMonth`), nothing changes at or after the cutoff (409
`cutoff_passed`); a pledge in another vault of the project, or a retired
project's pledge, leaves changes open (development `8660a6121`,
`backend/payments/monthly.ts`, the change write). The reviewed closeout
month accepts no change at all (409 `closeout_allocations_fixed`). A change at or above the contributor's
proposed amount is private: it is kept in the change journal for disputes
and reconciliation and needs no reason.

```quint
pure def manages(fact: AuthorityFact, m: Monthly): bool =
  (fact.role == ProjectOwner or fact.role == Steward or fact.role == RepositoryAdmin) and not(fact.banned)
    and fact.revision == m.eligibility.revision and fact.actor > 0
pure def replaceShare(shares: List[A::Share], actor: int, amount: M::Amount): List[A::Share] =
  shares.listMap(s => if (s.actor == actor) { ...s, amount: amount } else s)
pure def belowProposal(m: Monthly, actor: int, amount: M::Amount): bool =
  m.proposedShares.some(p => p.actor == actor and M::compareAmounts(amount, p.amount) < 0)
pure def changeAllowed(m: Monthly, actor: int, amount: M::Amount, expectedSequence: int, fact: AuthorityFact): bool =
  m.phase == Proposed and manages(fact, m) and expectedSequence == m.sequence and actor != fact.actor
    and hasActor(m.shares, actor) and M::validAmount(amount) and M::withinMaximum(amount, m.revision.maximum)
    and not(M::positiveAmount(amount) and X::excludedIn(m.exclusions, actor, m.period))
    and M::compareAmounts(A::allocatedTotal(replaceShare(m.shares, actor, amount)), m.cap) <= 0
    and not(freezesAtCutoff(m) and m.now >= cutoff(m)) and m.earlyCloseAt == 0
pure def freezesAtCutoff(m: Monthly): bool = m.automatic or pledgeKeepsMonth(m)
pure def canAdjust(m: Monthly, actor: int, amount: M::Amount, expectedSequence: int, fact: AuthorityFact): bool =
  changeAllowed(m, actor, amount, expectedSequence, fact) and not(belowProposal(m, actor, amount))
pure def adjust(m: Monthly, actor: int, amount: M::Amount, expectedSequence: int, fact: AuthorityFact): Monthly =
  val shares = replaceShare(m.shares, actor, amount)
  { ...m, shares: shares, total: A::allocatedTotal(shares), sequence: m.sequence + 1,
    changes: m.changes.append({ actor: actor, by: fact.actor, amount: amount, sequence: m.sequence + 1, at: m.now, cut: false }),
    publicCuts: m.publicCuts.select(c => c.actor != actor) }
```

### A change below the proposed amount is a public cut with a reason and one Inbox notice

The operator decision of 15 November 2026 makes a cut public. The cut needs
a reason of 20 to 500 characters after trimming. In the same write it
appends the change, a retained cut record (acting account, proposed amount,
new amount, reason and time) and one Inbox notice for the contributor, keyed
by the month, the contributor and the change sequence. The public cut list
holds each contributor whose latest change is a cut, with that cut; a later
change back to or above the proposal removes the contributor from the list,
but every cut record stays. While the month freezes at the cutoff without
the owner (the automatic default on, or its stored pledge in the paying
vault keeping it), a cut is refused in the last 24 hours before the cutoff
(409 `cut_notice_window`), so the contributor has 24 hours of notice before
the month can lock; the notice text names that time whenever
`freezesAtCutoff` holds.

```quint
pure def proposedFor(m: Monthly, actor: int): M::Amount = amountFor(m.proposedShares, actor)
pure def cutWindowOpen(m: Monthly): bool = not(freezesAtCutoff(m) and m.now >= cutoff(m) - cutNoticeSeconds)
pure def canCut(m: Monthly, actor: int, amount: M::Amount, reasonLength: int, expectedSequence: int, fact: AuthorityFact): bool =
  changeAllowed(m, actor, amount, expectedSequence, fact) and belowProposal(m, actor, amount)
    and reasonLength >= cutReasonMin and reasonLength <= cutReasonMax and cutWindowOpen(m) and m.now > 0
pure def cut(m: Monthly, actor: int, amount: M::Amount, reasonLength: int, expectedSequence: int, fact: AuthorityFact): Monthly =
  val shares = replaceShare(m.shares, actor, amount)
  val record = { actor: actor, by: fact.actor, proposed: proposedFor(m, actor), amount: amount, reasonLength: reasonLength,
    at: m.now, sequence: m.sequence + 1 }
  { ...m, shares: shares, total: A::allocatedTotal(shares), sequence: m.sequence + 1,
    changes: m.changes.append({ actor: actor, by: fact.actor, amount: amount, sequence: m.sequence + 1, at: m.now, cut: true }),
    cuts: m.cuts.append(record), publicCuts: m.publicCuts.select(c => c.actor != actor).append(record),
    notices: m.notices.append({ project: m.project, period: m.period, actor: actor, sequence: m.sequence + 1 }),
    latestCutAt: m.now }
pure def stepNoCutInNoticeWindow(before: Monthly, via: str, after: Monthly): bool =
  via == "cut" implies not(freezesAtCutoff(before) and before.now >= cutoff(before) - cutNoticeSeconds)
```

### Turning the automatic default on never locks a cut with less than 24 hours of notice

The month observes each new `{automatic, sequence}` pair of the project
setting. Turning the default off is always accepted. Turning it on is
refused while an unfrozen month has a cut whose 24-hour notice ends after
the cutoff and has not yet ended; the owner can turn it on, or finalize,
once that notice ends. The settings write itself refuses first
(`cut_notice_window`, [monthly settings](./monthlySettings.md)
`lateCutNotice`, which the shell computes with `lateCutNoticeAt` from each
unfrozen month's latest cut, its cutoff and the time of the write); the
month's own refusal to observe stays as defence.

```quint
pure def lateCutNoticeAt(latestCutAt: int, monthCutoff: int, now: int): bool = latestCutAt > 0
  and latestCutAt + cutNoticeSeconds > monthCutoff and now < latestCutAt + cutNoticeSeconds
pure def cutNoticeOutlastsCutoff(m: Monthly): bool = m.phase == Proposed and lateCutNoticeAt(m.latestCutAt, cutoff(m), m.now)
pure def canObserveSettings(m: Monthly, automatic: bool, settingsSequence: int): bool =
  m.phase != Unopened and settingsSequence > m.settingsSequence and not(automatic and cutNoticeOutlastsCutoff(m))
pure def observeSettings(m: Monthly, automatic: bool, settingsSequence: int): Monthly =
  { ...m, automatic: automatic, settingsSequence: settingsSequence }
```

## Story: Freeze exactly one execution snapshot

### The owner may finalize early; the coordinator freezes at the cutoff unless the default is off

The owner path needs the same authority and current sequence and a month
that has ended (409 `month_open`), except the reviewed closeout month, which
it may finalize from its recorded early close time, and is refused until 24
hours after the latest cut (`cut_notice_pending`). The automatic
path needs the cutoff, a month from 2026-11 on and a served vault network,
and either the automatic default with a project that is not paused or
restricted, or the owner's on-chain pledge for the month in the vault that
pays it while the project is not retired (below), whatever the default, a
pause or a restriction says.
Either path writes the single run record with its trigger and the sequence
it froze; the owner path also records the acting account. Financial terms
apply prospectively: neither path freezes once the project's vault, asset or
fee policy differs from the revision that sized the proposal
(`financial_policy_changed`). The automatic worker is weakly fair while its guard holds; a
persistent outage violates that assumption and is surfaced operationally.

```quint
pure def financialTermsSame(proposed: RevisionFact, observed: RevisionFact): bool =
  proposed.vault == observed.vault and proposed.asset == observed.asset and proposed.feePolicy == observed.feePolicy
pure def cutNoticeElapsed(m: Monthly): bool = m.latestCutAt == 0 or m.now >= m.latestCutAt + cutNoticeSeconds
pure def canFinalize(m: Monthly, expectedSequence: int, fact: AuthorityFact): bool =
  m.phase == Proposed and manages(fact, m) and expectedSequence == m.sequence and financialTermsSame(m.revision, m.currentRevision)
    and cutNoticeElapsed(m) and (m.now >= monthEnd(m.period) or (m.earlyCloseAt > 0 and m.now >= m.earlyCloseAt))
pure def finalize(m: Monthly, expectedSequence: int, fact: AuthorityFact): Monthly =
  { ...m, phase: Frozen, trigger: OwnerTrigger, frozenSequence: m.sequence, frozenBy: fact.actor, frozenAt: m.now }
pure def automaticMayFreeze(m: Monthly): bool = m.now >= cutoff(m) and m.period >= firstAutomaticPeriod and m.eligibility.networkServed
  and ((m.automatic and not(m.eligibility.paused) and not(m.eligibility.restricted)) or pledgeKeepsMonth(m))
pure def canAutoFreeze(m: Monthly): bool = m.phase == Proposed and automaticMayFreeze(m) and financialTermsSame(m.revision, m.currentRevision)
pure def autoFreeze(m: Monthly): Monthly = { ...m, phase: Frozen, trigger: AutomaticTrigger, frozenSequence: m.sequence, frozenAt: m.now }
pure val fair_autoFreeze = "weak"
pure def leadsToCutoffFrozen(m: Monthly, later: Monthly): bool =
  canAutoFreeze(m) implies (later.phase != Proposed or not(canAutoFreeze(later)))
```

### A stored pledge in the vault that pays the month freezes it at the cutoff, never for a retired project

The month observes the vault in which the owner's stored on-chain pledge for
it (an amount above zero, open or since closed) was read, as
[month pledges](./monthPledges.md) `pledgedIn` finds it; only a pledge in
the vault the current revision pays the month from is taken, and a pledge
read never leaves the month unpledged again. A pledge read that failed keeps
what was stored, so a pledge not yet stored gives no consent. The pledge is
the owner's consent to reserve the month (operator decision, 15 November
2026; development `backend/payments/monthly.ts` `coordinateMonthlyPayments`
and `freezeMonthlyPeriod`, `month-pledges.ts` `pledgeKeepsMonth`, and
development's model `monthly_month_pledge`): the coordinator freezes it at
the cutoff with the automatic default off and while the project is paused
or restricted, but not once it is retired, and a pledge in another vault of
the project gives no consent. A pledged month freezes at the cutoff without
waiting after a cut (PRD: a pledged month freezes at the cutoff whatever the
automatic default says), so a cut made with the default off in the last 24
hours before the cutoff is frozen with a shorter notice; this is
development's decision (operator decision, 15 November 2026). The owner
path still waits 24 hours after the latest cut.

```quint
pure def canObservePledge(m: Monthly, pledgeVault: str): bool =
  m.phase != Unopened and pledgeVault != "" and pledgeVault == m.currentRevision.vault and pledgeVault != m.pledgedVault
pure def observePledge(m: Monthly, pledgeVault: str): Monthly = { ...m, pledgedVault: pledgeVault }
pure def pledgeKeepsMonth(m: Monthly): bool =
  P::pledgeConsents(m.pledgedVault != "" and m.pledgedVault == m.currentRevision.vault, m.eligibility.retired)
pure def stepPledgeKept(before: Monthly, after: Monthly): bool = before.pledgedVault != "" implies after.pledgedVault != ""
pure def sometimesPledgedMonthFrozen(m: Monthly): bool = m.trigger == AutomaticTrigger and m.pledgedVault != ""
  and m.eligibility.paused
pure val pledgeVaultValues = Set("vault", "replaced")
```

## Story: Create obligations only when the whole month is covered

### Fresh finalized free funds must cover this month and every earlier unreserved obligation

The coordinator reads a finalized vault snapshot no older than 30 minutes.
Before it creates obligations it excludes accounts with an active moderator
ban and records the exact ban; excluded amounts do not delay other
recipients and never become their extra awards. Every other month's open
pledge in the same vault is held back from the free balance, because the
contract never lets one month take another month's pledge
(`otherOpenPledges` of [month pledges](./monthPledges.md); zero for a vault
without pledge support). When nothing is needed the vault is not read for
funds. An empty or all-zero month
completes with no obligation. An underfunded month creates nothing and
records one Inbox exception however often the coordinator retries.

```quint
type VaultObservation = { observedAt: int, free: M::Amount, earlierUnreserved: M::Amount, otherOpenPledges: M::Amount }
pure def banFor(bans: List[BanExclusion], actor: int): bool = bans.some(b => b.actor == actor)
pure def payable(m: Monthly, bans: List[BanExclusion]): List[A::Share] =
  m.shares.select(s => M::positiveAmount(s.amount) and not(banFor(bans, s.actor)))
pure def payableTotal(shares: List[A::Share]): M::Amount = A::allocatedTotal(shares)
pure def fresh(m: Monthly, observation: VaultObservation): bool =
  observation.observedAt <= m.now and m.now - observation.observedAt <= freshnessSeconds
    and M::validAmount(observation.free) and M::validAmount(observation.earlierUnreserved)
    and M::validAmount(observation.otherOpenPledges)
pure def covered(m: Monthly, observation: VaultObservation, bans: List[BanExclusion]): bool =
  val needed = M::addAmounts(payableTotal(payable(m, bans)), observation.earlierUnreserved)
  not(M::positiveAmount(needed)) or M::compareAmounts(observation.free, M::addAmounts(needed, observation.otherOpenPledges)) >= 0
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
is paid. A finalized award under an obligation's source key with another
actor or gross (the owner can commit any source by hand on chain) makes the
obligation conflicted (`award_conflict`): it can never be reserved or paid
through this month, and the month cannot complete.

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
pure def obligationBySource(m: Monthly, source: SourceKey): Obligation =
  m.obligations.select(o => o.source == source).nthOr(0, { actor: 0, amount: M::zero, source: keyFor(m, 0), progress: Created })
pure def canRecordConflict(m: Monthly, award: AwardFact): bool =
  val o = obligationBySource(m, award.source)
  m.phase == Funded and o.actor > 0 and o.progress == Created and award.source == o.source
    and not(award.actor == o.actor and M::equalAmounts(award.gross, o.amount))
pure def recordConflict(m: Monthly, award: AwardFact): Monthly =
  { ...m, obligations: m.obligations.listMap(o => if (o.source == award.source) { ...o, progress: Conflicted } else o) }
pure def obligationActors(m: Monthly): List[int] = m.obligations.listMap(o => o.actor)
pure def obligationTotal(m: Monthly): M::Amount = m.obligations.foldl(M::zero, (sum, o) => M::addAmounts(sum, o.amount))
pure def createdTotal(m: Monthly): M::Amount =
  m.obligations.foldl(M::zero, (sum, o) => M::addAmounts(sum, if (o.progress == Created) o.amount else M::zero))
pure def createdCount(m: Monthly): int = m.obligations.select(o => o.progress == Created).length()
pure def allReserved(m: Monthly): bool = m.obligations.every(o => o.progress == Reserved)
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
  (if (m.earlyCloseAt > 0) m.cap == C::closeoutCap else m.cap == m.revision.monthlyAmount)
    and M::positiveAmount(m.cap) and m.revision.effectivePeriod <= m.period
pure def alwaysUnproposedEmpty(m: Monthly): bool = not(proposedPhase(m.phase)) implies
  m.shares.length() == 0 and M::equalAmounts(m.total, M::zero) and m.obligations.length() == 0 and m.sequence == 0
    and m.proposedShares.length() == 0 and m.changes.length() == 0 and m.cuts.length() == 0 and m.latestCutAt == 0
```

### Every cut keeps its reason bounds, its change and exactly one Inbox notice

```quint
pure def alwaysCutsRecorded(m: Monthly): bool = m.latestCutAt <= m.now and ((m.latestCutAt == 0) == (m.cuts.length() == 0))
  and m.cuts.every(c => c.reasonLength >= cutReasonMin and c.reasonLength <= cutReasonMax and M::compareAmounts(c.amount, c.proposed) < 0
    and c.at > 0 and c.at <= m.latestCutAt and c.sequence > 0 and c.sequence <= m.sequence
    and m.changes.some(x => x.sequence == c.sequence and x.actor == c.actor and x.cut and x.amount == c.amount))
  and m.notices.length() == m.cuts.length()
  and m.cuts.every(c => m.notices.includes({ project: m.project, period: m.period, actor: c.actor, sequence: c.sequence }))
  and m.changes.every(x => x.sequence > 0 and x.sequence <= m.sequence and m.changes.select(o => o.sequence == x.sequence).length() == 1)
```

### The public cut list is exactly each contributor's latest change when that change is a cut

```quint
pure def alwaysPublicCutsCurrent(m: Monthly): bool =
  m.publicCuts.every(c => m.cuts.includes(c) and m.publicCuts.select(o => o.actor == c.actor).length() == 1
    and m.shares.some(s => s.actor == c.actor and s.amount == c.amount)
    and m.changes.every(x => x.actor == c.actor implies x.sequence <= c.sequence))
  and m.shares.every(s => belowProposal(m, s.actor, s.amount) implies m.publicCuts.some(c => c.actor == s.actor))
```

### A month with a cut freezes no earlier than 24 hours after the latest cut, unless its pledge freezes it at the cutoff

Owner finalization waits for the notice directly. The automatic freeze
happens at the cutoff, which is at least 24 hours after any cut made while
the default was on, and a default turned on after a later cut waits for that
cut's notice to end. A month the owner's pledge freezes at the cutoff
freezes there even when a cut made with the default off is less than 24
hours old (development `coordinateMonthlyPayments` checks no cut notice).

```quint
pure def alwaysAutomaticHonoursCutNotice(m: Monthly): bool = (m.phase == Proposed and m.automatic and m.latestCutAt > 0) implies
  (m.latestCutAt + cutNoticeSeconds <= cutoff(m) or m.now >= m.latestCutAt + cutNoticeSeconds)
pure def alwaysFreezeAfterCutNotice(m: Monthly): bool = (frozenPhase(m.phase) and m.latestCutAt > 0) implies
  (m.frozenAt >= m.latestCutAt + cutNoticeSeconds
    or (m.trigger == AutomaticTrigger and m.pledgedVault != "" and m.frozenAt >= cutoff(m)))
pure def sometimesPledgedFrozenWithinCutNotice(m: Monthly): bool = m.trigger == AutomaticTrigger and m.pledgedVault != ""
  and m.latestCutAt > 0 and m.frozenAt < m.latestCutAt + cutNoticeSeconds
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
    and ((m.trigger == OwnerTrigger) == (m.frozenBy > 0))
pure def alwaysExclusionsFromRevision(m: Monthly): bool = proposedPhase(m.phase) implies
  m.exclusions == m.revision.exclusions and X::novemberException(m.project, m.exclusions)
    and m.revision.rewardStartAt < monthEnd(m.period)
```

### Frozen amounts, recorded triggers and obligation progress never move backwards

```quint
pure def frozenPhase(phase: MonthlyPhase): bool = phase == Frozen or phase == Funded or phase == Completed
pure def stepFrozenStable(before: Monthly, after: Monthly): bool = frozenPhase(before.phase) implies
  frozenPhase(after.phase) and after.total == before.total and after.shares == before.shares and after.trigger == before.trigger
    and after.frozenSequence == before.frozenSequence and after.snapshotDigest == before.snapshotDigest and after.cap == before.cap
pure def rank(progress: ObligationState): int = if (progress == Created) 0 else if (progress == Reserved or progress == Conflicted) 1 else 2
pure def stepObligationsMonotone(before: Monthly, after: Monthly): bool =
  (before.obligations.length() > 0 implies after.obligations.length() == before.obligations.length())
    and before.obligations.every(o => after.obligations.some(n => n.actor == o.actor and n.amount == o.amount
      and n.source == o.source and rank(n.progress) >= rank(o.progress)
      and ((o.progress == Conflicted) == (n.progress == Conflicted) or o.progress == Created)))
    and before.banned.every(b => after.banned.includes(b))
pure def stepSequenceCounts(before: Monthly, via: str, after: Monthly): bool =
  if (via == "adjust" or via == "cut") after.sequence == before.sequence + 1 else after.sequence == before.sequence
pure def stepChangesAndCutsRetained(before: Monthly, after: Monthly): bool =
  before.changes.every(x => after.changes.includes(x)) and before.cuts.every(c => after.cuts.includes(c))
    and before.notices.every(n => after.notices.includes(n)) and after.latestCutAt >= before.latestCutAt
pure def stepProposalWrittenOnce(before: Monthly, after: Monthly): bool = proposedPhase(before.phase) implies
  after.proposedShares == before.proposedShares and after.snapshotDigest == before.snapshotDigest
    and after.revision == before.revision and after.exclusions == before.exclusions and after.cap == before.cap
pure def stepUnderfundedNoticeOnce(before: Monthly, after: Monthly): bool = before.underfundedNotice implies after.underfundedNotice
pure def stepPeriodFixed(before: Monthly, after: Monthly): bool = before.phase != Unopened implies after.period == before.period and after.project == before.project
```

### Proposals, changes, cuts, freezes, exclusions and payments are reachable

In the samples November 2026 ends at 1796083200, its cuts close at
1796256000 while the default is on, and its cutoff is 1796342400; October
2026 ends at 1793491200 and its cutoff is 1793750400.

Discovered by simulation: with the earlier weights few sampled runs of 20
events ever proposed a month, because the clock usually passed the proposal
window before the month observed its eligibility and revision; the clock is therefore tried least often and the proposal most
often. Discovered by simulation: a withdrawal needs a cut and then a change of
that contributor back to the proposed amount before the month freezes, so
changes and cuts are tried more often than owner finalization; a month allows
only as many changes as there are sampled expected sequences, so this cannot
crowd out later events. Discovered by simulation: churn of the observed
revision before the proposal left the proposal's revision stale, so revisions
are observed no more often than other facts.

Discovered by simulation: every copy of an event picks all its parameters on
every step, so a run costs in proportion to the total weight. Weights about
six times as high for proposals, changes and cuts reached a withdrawn cut no
sooner and made each run about three and a half times as long, so every
event that is not favoured has weight 1 or 2, and the events after a freeze
keep their order relative to one another.

Discovered by simulation: a change back up can withdraw a cut only to the
proposed amount, and a sole contributor is proposed the whole pool, which no
sampled amount reached, so a sole contributor's cut could never be withdrawn;
a change to the whole pool is sampled too. Discovered by simulation: after
the first event of a November month most clock samples already closed its
proposal window, and every clock sample after the first closed an October
month's cut window; a second day of each month is sampled. Discovered by
simulation: once a month observes eligibility revision 2, which it never
leaves, every sampled authority fact was stale, so an owner and a steward
under revision 2 are sampled too. Discovered by simulation: no sampled
eligibility was restricted, so a restricted project is sampled too; it can
still be proposed, changed, cut and finalized by hand, but the automatic
cutoff freezes it only under its pledge.

Discovered by simulation: with the earlier weights and samples a search for a
withdrawn cut could outlast its hour on a loaded machine. With these, 200
runs of 20 events take about as long as before, and the search reached a
withdrawn cut within about a second and a half of processor time after
start-up for each of three seeds.

```quint
pure def sometimesWalletlessReserve(m: Monthly): bool = m.phase == Funded and m.obligations.some(o => o.progress == Reserved)
  and m.obligations.some(o => o.progress != Paid)
pure def sometimesCompleted(m: Monthly): bool = m.phase == Completed and M::positiveAmount(m.total) and m.obligations.length() > 0
pure def sometimesEmptyMonth(m: Monthly): bool = m.phase == Completed and m.shares.length() == 0
pure def sometimesBanExcluded(m: Monthly): bool = m.phase == Funded and m.banned.length() > 0
pure def sometimesConflicted(m: Monthly): bool = m.obligations.some(o => o.progress == Conflicted)
pure def sometimesUnderfundedThenFunded(m: Monthly): bool = m.phase == Funded and m.underfundedNotice
pure def sometimesAutomaticFreeze(m: Monthly): bool = m.trigger == AutomaticTrigger
pure def sometimesOwnerAdjustedAndFinalized(m: Monthly): bool = m.trigger == OwnerTrigger and m.sequence > 0
pure def sometimesAdjustAfterCutoffWithDefaultOff(m: Monthly): bool = m.phase == Proposed and m.sequence > 0 and not(m.automatic)
  and m.now >= cutoff(m)
pure def sometimesSkipped(m: Monthly): bool = m.phase == NoProposal and m.skip == NotEligible
pure def sometimesWindowPassed(m: Monthly): bool = m.phase == NoProposal and m.skip == WindowPassed
pure def sometimesUnfunded(m: Monthly): bool = m.phase == NoProposal and m.skip == Unfunded
pure def sometimesPolicyChangedBlocksFreeze(m: Monthly): bool = m.phase == Proposed and m.now >= cutoff(m) and m.automatic
  and not(financialTermsSame(m.revision, m.currentRevision))
pure def sometimesEarlierMonthNotAutomatic(m: Monthly): bool = m.period < firstAutomaticPeriod and m.phase == Proposed and m.now >= cutoff(m)
pure def sometimesAdjusted(m: Monthly): bool = m.changes.some(x => not(x.cut))
pure def sometimesCutPublic(m: Monthly): bool = m.phase == Proposed and m.publicCuts.length() > 0
pure def sometimesCutWithdrawn(m: Monthly): bool = m.cuts.length() > 0 and m.publicCuts.length() == 0
pure def sometimesCutThenOwnerFinalized(m: Monthly): bool = m.trigger == OwnerTrigger and m.latestCutAt > 0
pure def sometimesOptedOutFrozenByOwner(m: Monthly): bool = m.trigger == OwnerTrigger and not(m.automatic)
pure def sometimesLateCutHoldsDefaultOff(m: Monthly): bool = m.phase == Proposed and not(m.automatic) and cutNoticeOutlastsCutoff(m)
pure val periodValues = Set(202611, 202610)
pure val nowValues = Set(1793491300, 1793577600, 1795046500, 1796083300, 1796169600, 1796256100, 1796342400, 1796342600, 1796343000)
pure val reasonLengthValues = Set(19, 20, 500)
pure val eligible: Eligibility = { revision: 1, active: true, verifiedPool: true, paused: false, restricted: false,
  retired: false, vaultRegistered: true, networkServed: true, receiptPolicyActive: true, monthlyPoolReward: true }
pure val eligibilityValues = Set(eligible, { ...eligible, paused: true }, { ...eligible, revision: 2 }, { ...eligible, restricted: true })
pure val revisionSample: RevisionFact = { number: 1, effectivePeriod: 202609, monthlyAmount: List(10), maximum: M::maxU128,
  rewardStartAt: 1790000000, vault: "vault", asset: "usdc", feePolicy: "v2", exclusions: List() }
pure val revisionValues = Set(revisionSample, { ...revisionSample, monthlyAmount: List(0) }, { ...revisionSample, effectivePeriod: 202612 },
  { ...revisionSample, number: 2, asset: "other" },
  { ...revisionSample, exclusions: List({ actor: 3, relationship: X::RelatedParty, fromPeriod: 202610, untilPeriod: 0 }) })
pure val snapshotSample: X::WorkSnapshot = { project: "eliza", period: 202611, digest: "d", coverage: X::CompleteCoverage,
  rows: List({ actor: 1, acceptedWork: List(10), participation: 30, recognition: 0 }, { actor: 2, acceptedWork: List(30), participation: 0, recognition: 5 },
    { actor: 3, acceptedWork: List(10), participation: 0, recognition: 0 }) }
pure val snapshotValues = Set(snapshotSample, { ...snapshotSample, rows: List() }, { ...snapshotSample, coverage: X::MissingSources },
  { ...snapshotSample, period: 202610 }, { ...snapshotSample, period: 202610, rows: List({ actor: 1, acceptedWork: List(10), participation: 0, recognition: 0 }) },
  { ...snapshotSample, project: "asi" })
pure val projectValues = Set("eliza", "asi")
pure val basisPointsValues = Set(0, 2000)
pure val decisionSample: S::Decision = { repository: 1, pull: 1, author: 9, authorOutside: true, decider: 1, deciderBot: false,
  kind: S::MergedByMaintainer, period: 202611, headForkOwnedByDecider: false, headForkMissing: false,
  deciderDeletedHeadWithinWindow: false }
pure val recordValues = Set(noShareRecord, { period: 202611, repositories: List(1), deciders: List(1, 4), digest: "m1",
  decisions: List(decisionSample, { ...decisionSample, pull: 2, decider: 4 }) })
pure val exclusionsValues = Set(List(), List({ actor: 3, relationship: X::RelatedParty, fromPeriod: 202610, untilPeriod: 0 }))
pure val actorValues = Set(1, 2, 3)
pure val amountValues = Set(List(0), List(2), List(5), List(6), List(10))
pure val expectedSequenceValues = Set(0, 1, 2)
pure val factValues = Set({ actor: 9, role: ProjectOwner, banned: false, revision: 1 }, { actor: 2, role: Steward, banned: false, revision: 1 },
  { actor: 9, role: Writer, banned: false, revision: 1 }, { actor: 9, role: ProjectOwner, banned: true, revision: 1 },
  { actor: 9, role: ProjectOwner, banned: false, revision: 2 }, { actor: 2, role: Steward, banned: false, revision: 2 })
pure val automaticValues = Set(true, false)
pure val settingsSequenceValues = Set(1, 2)
pure val observationValues = Set({ observedAt: 1796342400, free: List(20), earlierUnreserved: List(0), otherOpenPledges: List(0) },
  { observedAt: 1796342400, free: List(5), earlierUnreserved: List(0), otherOpenPledges: List(0) },
  { observedAt: 1796340000, free: List(20), earlierUnreserved: List(0), otherOpenPledges: List(0) },
  { observedAt: 1796342600, free: List(20), earlierUnreserved: List(0), otherOpenPledges: List(0) },
  { observedAt: 1796342400, free: List(20), earlierUnreserved: List(0), otherOpenPledges: List(15) })
pure val bansValues = Set(List(), List({ actor: 2, ban: 7 }))
pure def awardFact(actor: int, gross: M::Amount, paid: bool): AwardFact =
  { source: { project: "eliza", period: 202611, actor: actor }, actor: actor, gross: gross, paid: paid }
pure val awardValues = Set(awardFact(1, List(2), false)).union(Set(awardFact(1, List(2), true))).union(Set(awardFact(2, List(6), true)))
  .union(Set(awardFact(3, List(2), true))).union(Set(awardFact(1, List(3), true))).union(Set(awardFact(1, List(3), false)))
  .union(Set(awardFact(2, List(7), false))).union(Set(awardFact(2, List(7), true))).union(Set(awardFact(2, List(6), false)))
pure val weight_observeClock = 1
pure val weight_propose = 6
pure val weight_observeRevision = 1
pure val weight_adjust = 6
pure val weight_cut = 3
pure val weight_observeSettings = 1
pure val weight_finalize = 1
pure val weight_autoFreeze = 1
pure val weight_noteUnderfunded = 1
pure val weight_createObligations = 2
pure val weight_recordReserved = 2
pure val weight_recordPaid = 2
pure val weight_recordConflict = 1
```
