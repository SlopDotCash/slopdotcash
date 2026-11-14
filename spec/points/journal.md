# Append-only Points journal

PRD sections 2 and 7 publish one Points measure. Monthly and lifetime totals
are views of one append-only history. This machine is that history: a ledger
of revisions keyed by project, recipient, category, source and work unit,
following `src/lib/points.ts` (`PointRevision`, `pointKey`,
`assertRevisionChain`) and the D1 table `points_revisions`.

Every revision names the latest revision of its key as its predecessor,
keeps the key's original occurrence time and records its own recording time.
A correction carries a decision whose delta reconciles the amount change.
Approved, funded, scheduled and paid reward periods refuse retrospective
changes to accepted work. A merged PR later removed by GitHub, and a later
account ban, leave every recorded revision unchanged.

Participation (welcome and X-connection) awards are not journal categories;
they live in the [participation record](./participation.md). Payout
recognition is a journal category whose only producer is the [payout
recognition record](./payoutRecognition.md). Reward weights are derived from
this ledger by [reward weights](./rewardWeights.md).

The evidence records below are produced by named verified services and bind
the exact source they describe. Their verification is an adapter obligation:

- `SourceEvidence`: the GitHub ingestion and scoring producer (accepted
  state, immutable actor kind, repository start month, project collection
  state and current work-unit membership).
- `PenaltyEvidence`: the Slopbot penalty journal of
  [penalties](./penalties.md), with its applied debit computed by the bucket
  consumption of [reward weights](./rewardWeights.md).
- `FreezeEvidence`: the monthly settlement lifecycle of
  [monthly settlement](../settlement/monthly.md).

## Story: Preserve accepted work and correct unpaid attribution

### Time is encoded as UTC month and day and a period is the UTC month of occurrence

An instant is `month * 100 + day`, with `month` counted from year 0 and `day`
from 0. The adapter converts exact UTC timestamps without loss of order. A
penalty and an award belong to the UTC month of their occurrence time.

```quint
pure val monthSpan = 100
pure def periodOf(at: int): int = at / monthSpan
pure val september2026 = 24320
pure val october2026 = 24321
pure val november2026 = 24322
pure val september2026Start = 2432000
pure val november2026Start = 2432200
pure val maxSafe = 9007199254740991
pure def lawPeriodOrdered(first: int, second: int): bool = (first >= 0 and first <= second) implies periodOf(first) <= periodOf(second)
```

### Revisions bind a key, a recorded rule and a reconciling decision

Categories follow `src/lib/points.ts`. Evidence and payout recognition never
count as accepted work. A penalty is never positive, payout recognition is
exactly 25 Points, and every other category is never negative. The revision
identifier is a digest of its body in production and a counter here.

```quint
import payoutRecognition as PR from "./payoutRecognition"
type Category = MergedWork | ResolvedIssue | MaterialTest | Evidence | Review | Evaluated | PayoutReceived | Penalty
type SourceRule = ScoreV1 | ScoreV2 | MergedHistoryV1 | ValueV1 | VerifiedPayoutV1 | PenaltyTable
type Basis = NoBasis | Reassessment | Reallocation | Ratification | DisputeUpheld | ManifestDecision | IncidentRecovery | PenaltyChange
type AwardKey = { project: str, actor: int, category: Category, source: int, workUnit: int }
type Decision = { basis: Basis, effectiveAt: int, reason: str, delta: int }
type Revision = { id: int, previous: int, key: AwardKey, amount: int, priorAmount: int,
  occurredAt: int, recordedAt: int, rule: SourceRule, tableVersion: int, sourceDigest: str,
  provisional: bool, decision: Decision }
type FrozenPeriod = { project: str, period: int }
type Ledger = { revisions: List[Revision], nextId: int, now: int, frozen: List[FrozenPeriod],
  removedSources: Set[int], bannedActors: Set[int] }
pure val noDecision: Decision = { basis: NoBasis, effectiveAt: 0, reason: "", delta: 0 }
pure val noKey: AwardKey = { project: "", actor: 0, category: Evidence, source: 0, workUnit: 0 }
pure val noRevision: Revision = { id: 0, previous: 0, key: noKey, amount: 0, priorAmount: 0,
  occurredAt: 0, recordedAt: 0, rule: ScoreV2, tableVersion: 0, sourceDigest: "",
  provisional: false, decision: noDecision }
pure val initial: Ledger = { revisions: List(), nextId: 1, now: 2432000, frozen: List(),
  removedSources: Set(), bannedActors: Set() }
pure def acceptedWork(cat: Category): bool = cat != Evidence and cat != PayoutReceived and cat != Penalty
pure def amountAllowed(cat: Category, amount: int): bool =
  if (cat == Penalty) amount <= 0 and amount >= 0 - maxSafe
  else if (cat == PayoutReceived) amount == 25
  else amount >= 0 and amount <= maxSafe
pure def ruleAllowed(cat: Category, rule: SourceRule): bool =
  if (cat == Penalty) rule == PenaltyTable
  else if (cat == PayoutReceived) rule == VerifiedPayoutV1
  else rule != PenaltyTable and rule != VerifiedPayoutV1
pure def validKey(k: AwardKey): bool = k.project != "" and k.actor > 0 and k.source > 0 and k.workUnit > 0
pure def alwaysNextIdPositive(l: Ledger): bool = l.nextId >= 1
pure def alwaysRevisionsWellFormed(l: Ledger): bool = l.revisions.every(r =>
  r.id > 0 and r.id < l.nextId and r.previous >= 0 and r.previous < r.id and validKey(r.key) and
  amountAllowed(r.key.category, r.amount) and ruleAllowed(r.key.category, r.rule) and
  r.recordedAt >= r.occurredAt and r.occurredAt >= 0 and r.recordedAt <= l.now and r.sourceDigest != "" and
  (r.provisional implies (r.key.category == MergedWork or r.key.category == Review)) and
  (r.key.category == Penalty implies (not(r.provisional) and r.tableVersion > 0)) and
  (r.key.category != Penalty implies r.tableVersion == 0))
pure def alwaysDecisionsReconcile(l: Ledger): bool = l.revisions.every(r =>
  (r.previous == 0 implies r.priorAmount == 0) and
  (r.decision.basis == NoBasis implies (r.decision == noDecision and r.previous == 0)) and
  (r.decision.basis != NoBasis implies (r.decision.delta == r.amount - r.priorAmount and
    r.decision.reason != "" and r.decision.effectiveAt <= r.recordedAt)))
```

### The latest revision of a key is its current value

```quint
pure def latest(l: Ledger, k: AwardKey): Revision =
  l.revisions.foldl(noRevision, (acc, r) => if (r.key == k) r else acc)
pure def hasKey(l: Ledger, k: AwardKey): bool = latest(l, k).id > 0
pure def isFrozen(l: Ledger, project: str, period: int): bool =
  l.frozen.some(f => f.project == project and f.period == period)
pure def sourceHasOrdinaryCredit(l: Ledger, source: int): bool =
  l.revisions.some(r => r.key.source == source and acceptedWork(r.key.category) and r.key.category != Evaluated and r.amount > 0)
pure def sourceHasEvaluation(l: Ledger, source: int): bool =
  l.revisions.some(r => r.key.source == source and r.key.category == Evaluated)
pure def lastRevision(l: Ledger): Revision = l.revisions.nthOr(l.revisions.length() - 1, noRevision)
```

### One verified accepted source creates one first revision per key

The ingestion producer supplies `SourceEvidence` for the exact source. Only
human GitHub users of a collected project receive Points, and work before a
repository's start month counts for none. Slopbot and other bots never enter
the ledger. Ordinary credit and evaluated credit never share a source, so a
source is never rewarded twice. A first revision has no decision.

```quint
type ActorKind = User | Bot | Slopbot
type SourceEvidence = { source: int, project: str, actor: int, actorKind: ActorKind, accepted: bool,
  occurredAt: int, repositoryCountsFrom: int, projectCollected: bool, workUnit: int, workUnitCurrent: bool,
  digest: str }
type AwardInput = { key: AwardKey, amount: int, occurredAt: int, rule: SourceRule, provisional: bool, digest: str }
pure def evidenceBinds(a: AwardInput, e: SourceEvidence): bool =
  e.source == a.key.source and e.project == a.key.project and e.actor == a.key.actor and
  e.workUnit == a.key.workUnit and e.occurredAt == a.occurredAt and e.digest == a.digest and e.digest != ""
pure def canCredit(l: Ledger, a: AwardInput, e: SourceEvidence): bool =
  validKey(a.key) and (acceptedWork(a.key.category) or a.key.category == Evidence) and
  latest(l, a.key) == noRevision and evidenceBinds(a, e) and
  e.actorKind == User and e.accepted and e.projectCollected and e.workUnitCurrent and
  a.occurredAt >= e.repositoryCountsFrom and a.occurredAt >= 0 and a.occurredAt <= l.now and
  amountAllowed(a.key.category, a.amount) and ruleAllowed(a.key.category, a.rule) and
  (a.provisional implies (a.key.category == MergedWork or a.key.category == Review)) and
  not(sourceHasEvaluation(l, a.key.source)) and
  (a.key.category == Evaluated implies not(sourceHasOrdinaryCredit(l, a.key.source)))
pure def appendRevision(r: Revision, l: Ledger): Ledger =
  { ...l, revisions: l.revisions.append(r), nextId: l.nextId + 1 }
pure def credit(l: Ledger, a: AwardInput, e: SourceEvidence): Ledger =
  appendRevision({ id: l.nextId, previous: 0, key: a.key, amount: a.amount, priorAmount: 0,
    occurredAt: a.occurredAt, recordedAt: l.now, rule: a.rule, tableVersion: 0, sourceDigest: a.digest,
    provisional: a.provisional, decision: noDecision }, l)
```

### Unpaid corrections append a reconciled decision without rewriting history

A correction names its basis, a non-empty reason and an effective time no
later than its recording. Its delta is the exact amount change. The original
occurrence time never moves. A frozen reward period refuses any changed
amount for accepted work. Removal from GitHub, absence from a later feed or
a ban is never a basis. Penalty rows use their own transition.

```quint
type CorrectionInput = { key: AwardKey, amount: int, rule: SourceRule, provisional: bool, digest: str,
  basis: Basis, effectiveAt: int, reason: str }
pure def canCorrect(l: Ledger, c: CorrectionInput): bool =
  val prior = latest(l, c.key)
  prior.id > 0 and prior.id < l.nextId and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  prior.recordedAt <= l.now and validKey(c.key) and c.key.category != Penalty and c.key.category != PayoutReceived and
  c.basis != NoBasis and c.basis != PenaltyChange and c.reason != "" and
  c.effectiveAt >= prior.occurredAt and c.effectiveAt <= l.now and c.digest != "" and
  amountAllowed(c.key.category, c.amount) and ruleAllowed(c.key.category, c.rule) and
  (c.provisional implies (c.key.category == MergedWork or c.key.category == Review)) and
  (c.amount != prior.amount or c.digest != prior.sourceDigest or c.provisional != prior.provisional) and
  (isFrozen(l, c.key.project, periodOf(prior.occurredAt)) implies c.amount == prior.amount)
pure def correct(l: Ledger, c: CorrectionInput): Ledger =
  val prior = latest(l, c.key)
  appendRevision({ id: l.nextId, previous: prior.id, key: c.key, amount: c.amount, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: c.rule, tableVersion: 0, sourceDigest: c.digest,
    provisional: c.provisional,
    decision: { basis: c.basis, effectiveAt: c.effectiveAt, reason: c.reason, delta: c.amount - prior.amount } }, l)
```

### A penalty revision records the bucket-limited debit of one published decision

The penalty journal supplies the item's table version and the debit the
monthly bucket allows. The debit cannot exceed the published request. A
changed applied debit appends a successor; the table version and category of
a key never change. Reward weights of a frozen period keep their snapshot.

```quint
type PenaltyEvidence = { key: AwardKey, occurredAt: int, tableVersion: int, requested: int, applied: int,
  reversed: bool, digest: str, effectiveAt: int, reason: str }
pure def canRecordPenalty(l: Ledger, p: PenaltyEvidence): bool =
  val prior = latest(l, p.key)
  validKey(p.key) and p.key.category == Penalty and p.tableVersion > 0 and p.digest != "" and
  p.requested >= 0 and p.applied >= 0 and p.applied <= p.requested and p.applied <= maxSafe and
  (p.reversed implies p.applied == 0) and p.reason != "" and
  p.occurredAt >= 0 and p.occurredAt <= l.now and p.effectiveAt >= p.occurredAt and p.effectiveAt <= l.now and
  prior.id >= 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.amount <= 0 and
  (prior.id > 0 implies (prior.tableVersion == p.tableVersion and prior.occurredAt == p.occurredAt and
     0 - p.applied != prior.amount)) and
  (prior.id == 0 implies prior.amount == 0)
pure def recordPenalty(l: Ledger, p: PenaltyEvidence): Ledger =
  val prior = latest(l, p.key)
  appendRevision({ id: l.nextId, previous: prior.id, key: p.key, amount: 0 - p.applied, priorAmount: prior.amount,
    occurredAt: p.occurredAt, recordedAt: l.now, rule: PenaltyTable, tableVersion: p.tableVersion,
    sourceDigest: p.digest, provisional: false,
    decision: { basis: PenaltyChange, effectiveAt: p.effectiveAt, reason: p.reason, delta: (0 - p.applied) - prior.amount } }, l)
```

### Payout recognition is appended once per recipient, project and cycle

The [payout recognition record](./payoutRecognition.md) is the only producer.
It supplies the verified paid cycle; the work unit and source are the cycle
record. Recognition never counts as accepted work.

```quint
pure def recognitionKey(paid: PR::PaidRecipient): AwardKey =
  { project: paid.project, actor: paid.actor, category: PayoutReceived, source: paid.cycle, workUnit: paid.cycle }
pure def canRecognize(l: Ledger, paid: PR::PaidRecipient): bool =
  PR::eligible(paid) and paid.settledAt <= l.now and latest(l, recognitionKey(paid)) == noRevision
pure def recognize(l: Ledger, paid: PR::PaidRecipient): Ledger =
  appendRevision({ id: l.nextId, previous: 0, key: recognitionKey(paid), amount: PR::recognitionAmount(paid), priorAmount: 0,
    occurredAt: paid.settledAt, recordedAt: l.now, rule: VerifiedPayoutV1, tableVersion: 0,
    sourceDigest: paid.settlementDigest, provisional: false, decision: noDecision }, l)
```

### A frozen reward period, a removed PR and a ban never rewrite recorded Points

Monthly settlement supplies the freeze when the month's allocation is
frozen, reserved or completed, or an approved, funded, scheduled or paid
obligation exists. A freeze is never lifted. A removal or ban observation
records the fact and appends no revision.

```quint
type SettlementPhase = Collecting | Proposed | Frozen | Reserved | Completed
type FreezeEvidence = { project: str, period: int, phase: SettlementPhase, obligationExists: bool }
pure def canFreeze(l: Ledger, f: FreezeEvidence): bool =
  f.project != "" and f.period >= 0 and not(isFrozen(l, f.project, f.period)) and
  (f.phase == Frozen or f.phase == Reserved or f.phase == Completed or f.obligationExists)
pure def freeze(l: Ledger, f: FreezeEvidence): Ledger =
  { ...l, frozen: l.frozen.append({ project: f.project, period: f.period }) }
pure def canObserveRemoved(l: Ledger, source: int): bool = source > 0 and not(l.removedSources.contains(source))
pure def observeRemoved(l: Ledger, source: int): Ledger = { ...l, removedSources: l.removedSources.union(Set(source)) }
pure def canObserveBan(l: Ledger, actor: int): bool = actor > 0 and not(l.bannedActors.contains(actor))
pure def observeBan(l: Ledger, actor: int): Ledger = { ...l, bannedActors: l.bannedActors.union(Set(actor)) }
pure def canAdvance(l: Ledger, at: int): bool = at > l.now and at <= maxSafe
pure def advance(l: Ledger, at: int): Ledger = { ...l, now: at }
```

### History is append-only, chained and never moves an occurrence time

Each appended revision names the previous latest revision of its key, keeps
that revision's occurrence time and records no earlier than it. A frozen
reward period keeps every accepted-work amount it had. Observations of
removal and bans change no revision.

```quint
pure def stepAppendOnly(before: Ledger, after: Ledger): bool =
  after.revisions.length() >= before.revisions.length() and
  before.revisions.every(r => after.revisions.includes(r)) and after.now >= before.now and
  before.frozen.every(f => after.frozen.includes(f)) and
  before.removedSources.subseteq(after.removedSources) and before.bannedActors.subseteq(after.bannedActors)
pure def chainsTo(before: Ledger, r: Revision): bool =
  val prior = latest(before, r.key)
  r.id == before.nextId and r.previous == prior.id and r.priorAmount == prior.amount and
  (prior.id > 0 implies (r.occurredAt == prior.occurredAt and r.recordedAt >= prior.recordedAt))
pure def frozenKeeps(before: Ledger, r: Revision): bool =
  (isFrozen(before, r.key.project, periodOf(r.occurredAt)) and r.key.category != Penalty and r.previous > 0)
    implies r.amount == r.priorAmount
pure def stepChained(before: Ledger, after: Ledger): bool =
  after.revisions.length() == before.revisions.length() or
  (after.revisions.length() == before.revisions.length() + 1 and chainsTo(before, lastRevision(after)))
pure def stepFrozenAcceptedWorkUnchanged(before: Ledger, after: Ledger): bool =
  after.revisions.length() == before.revisions.length() or frozenKeeps(before, lastRevision(after))
pure def stepObservationsAppendNothing(before: Ledger, via: str, after: Ledger): bool =
  (via == "observeRemoved" or via == "observeBan" or via == "freeze" or via == "advance") implies
    after.revisions == before.revisions
pure def alwaysFrozenPeriodsValid(l: Ledger): bool = l.frozen.every(f => f.project != "" and f.period >= 0)
```

### Public totals are views of the latest revisions

A public total includes payout recognition; accepted-work totals exclude it,
evidence and penalties, which [reward weights](./rewardWeights.md) net
separately. Generated arithmetic refuses an unsafe integer.

```quint
pure def isLatest(l: Ledger, r: Revision): bool = latest(l, r.key).id == r.id
pure def publicTotal(l: Ledger, actor: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.actor == actor and isLatest(l, r)) acc + r.amount else acc)
pure def monthlyPublicTotal(l: Ledger, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.actor == actor and periodOf(r.occurredAt) == period and isLatest(l, r)) acc + r.amount else acc)
pure def acceptedWorkCredit(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and r.key.actor == actor and
    acceptedWork(r.key.category) and periodOf(r.occurredAt) == period and isLatest(l, r)) acc + r.amount else acc)
pure def penaltyDebit(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and r.key.actor == actor and
    r.key.category == Penalty and periodOf(r.occurredAt) == period and isLatest(l, r)) acc - r.amount else acc)
```

### Credited, corrected, penalized, recognized and frozen states are reachable

```quint
pure def sometimesCredited(l: Ledger): bool = l.revisions.some(r => r.key.category == MergedWork and r.amount >= 10)
pure def sometimesCorrected(l: Ledger): bool = l.revisions.some(r => r.previous > 0 and r.key.category != Penalty)
pure def sometimesPenalized(l: Ledger): bool = l.revisions.some(r => r.key.category == Penalty and r.amount < 0)
pure def sometimesRecognized(l: Ledger): bool = l.revisions.some(r => r.key.category == PayoutReceived)
pure def sometimesEvaluated(l: Ledger): bool = l.revisions.some(r => r.key.category == Evaluated)
pure def sometimesFrozenCorrectionKeepsAmount(l: Ledger): bool = l.revisions.some(r =>
  r.previous > 0 and r.key.category != Penalty and isFrozen(l, r.key.project, periodOf(r.occurredAt)) and r.amount == r.priorAmount)
pure def sometimesRemovedKeepsCredit(l: Ledger): bool = l.revisions.some(r => l.removedSources.contains(r.key.source) and r.amount > 0)
pure def sometimesBannedKeepsCredit(l: Ledger): bool = l.revisions.some(r => l.bannedActors.contains(r.key.actor) and r.amount > 0)
```

### Simulation samples bind matching and mismatched evidence

These input sets bound simulation only.

```quint
pure val keyA: AwardKey = { project: "p", actor: 1, category: MergedWork, source: 1, workUnit: 1 }
pure val keyB: AwardKey = { project: "p", actor: 2, category: MergedWork, source: 1, workUnit: 1 }
pure val keyEval: AwardKey = { project: "p", actor: 1, category: Evaluated, source: 2, workUnit: 2 }
pure val keyPenalty: AwardKey = { project: "p", actor: 1, category: Penalty, source: 3, workUnit: 3 }
pure val goodEvidence: SourceEvidence = { source: 1, project: "p", actor: 1, actorKind: User, accepted: true,
  occurredAt: 2432005, repositoryCountsFrom: 2432000, projectCollected: true, workUnit: 1, workUnitCurrent: true, digest: "d1" }
pure val aValues = Set(
  { key: keyA, amount: 30, occurredAt: 2432005, rule: ScoreV2, provisional: false, digest: "d1" },
  { key: keyB, amount: 60, occurredAt: 2432005, rule: ValueV1, provisional: true, digest: "d1" },
  { key: keyEval, amount: 30, occurredAt: 2432005, rule: ScoreV2, provisional: false, digest: "d2" },
  { key: { ...keyEval, source: 1 }, amount: 30, occurredAt: 2432005, rule: ScoreV2, provisional: false, digest: "d1" })
pure val eValues = Set(goodEvidence, { ...goodEvidence, actor: 2 },
  { ...goodEvidence, actorKind: Bot }, { ...goodEvidence, projectCollected: false },
  { ...goodEvidence, source: 2, workUnit: 2, digest: "d2" }, { ...goodEvidence, repositoryCountsFrom: 2432100 })
pure val cValues = Set(
  { key: keyA, amount: 10, rule: ScoreV2, provisional: false, digest: "d3", basis: Reallocation, effectiveAt: 2432005, reason: "rebalanced" },
  { key: keyA, amount: 30, rule: ValueV1, provisional: false, digest: "d4", basis: Ratification, effectiveAt: 2432005, reason: "ratified" },
  { key: keyB, amount: 0, rule: ValueV1, provisional: false, digest: "d5", basis: DisputeUpheld, effectiveAt: 2432005, reason: "upheld" },
  { key: keyA, amount: 10, rule: ScoreV2, provisional: false, digest: "d6", basis: NoBasis, effectiveAt: 2432005, reason: "" })
pure val pValues = Set(
  { key: keyPenalty, occurredAt: 2432006, tableVersion: 1, requested: 30, applied: 30, reversed: false, digest: "pd", effectiveAt: 2432006, reason: "spam" },
  { key: keyPenalty, occurredAt: 2432006, tableVersion: 1, requested: 30, applied: 0, reversed: true, digest: "pd2", effectiveAt: 2432008, reason: "reopen" },
  { key: keyPenalty, occurredAt: 2432006, tableVersion: 2, requested: 30, applied: 10, reversed: false, digest: "pd3", effectiveAt: 2432008, reason: "table" })
pure val paidValues = Set({ ...PR::paidSample, settledAt: 2432010 }, { ...PR::paidSample, actor: 2, settledAt: 2432010 },
  { ...PR::paidSample, state: PR::CycleHeld, settledAt: 2432010 })
pure val fValues = Set({ project: "p", period: 24320, phase: Frozen, obligationExists: false },
  { project: "p", period: 24320, phase: Collecting, obligationExists: false },
  { project: "p", period: 24320, phase: Proposed, obligationExists: true })
pure val sourceValues = Set(0, 1, 2)
pure val actorValues = Set(0, 1, 2)
pure val atValues = Set(2432006, 2432010, 2432100)
```
