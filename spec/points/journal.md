# Append-only Points journal

PRD sections 2 and 7 publish one Points measure. Monthly and lifetime totals
are views of one append-only history. This machine is that history: a ledger
of revisions keyed by project, recipient, category, source and work unit,
following `src/lib/points.ts` (`PointRevision`, `pointKey`,
`assertRevisionChain`) and the D1 table `points_revisions`.

Every revision names the latest revision of its key as its predecessor,
keeps the key's original occurrence time and records its own recording time.
A correction carries a decision whose delta reconciles the amount change and
whose basis is bound to the state that justifies it. A frozen reward period
refuses any change to the amount or shares of accepted work recorded in it.
A merged PR later removed by GitHub, and a later account ban, leave every
recorded revision unchanged.

Accepted merged work is valued per [work unit](./workUnits.md). The journal
owns the work-unit machine, so a unit's merged-work revision exists only for
a current, accepted unit, carries the unit's whole value (at least 10
Points) and records the [allocation](./allocation.md) of that value between
its recipients. In D1 the adapter writes the unit revision as one row per
recipient share in one transaction; that row split is an adapter obligation.

Participation (welcome and X-connection) awards are not journal categories;
they live in the [participation record](./participation.md). Payout
recognition is a journal category whose only producer is the [payout
recognition record](./payoutRecognition.md). Evaluated awards come only from
manifests admitted here under the rules of [evaluations](./evaluations.md).
Reward weights are derived from this ledger by [reward
weights](./rewardWeights.md).

The evidence records below are produced by named verified services and bind
the exact source they describe. Their verification is an adapter obligation:

- `SourceEvidence`: the GitHub ingestion and scoring producer (accepted
  state, immutable actor kind, repository start month and project
  collection state) for non-merge categories.
- `UnitCredit`: the GitHub ingestion producer with the [commit
  authorship](./authorship.md) recipient lines of the unit (composition
  obligation C8).
- `SP::Scored`: the [scoring policy](./scoringPolicy.md) state of the unit
  (composition obligation C3).
- `PenaltyEvidence`: the Slopbot penalty journal of
  [penalties](./penalties.md) (composition obligation C2).
- `P::FreezeEvidence`: the monthly settlement lifecycle through
  [periods](./periods.md) (composition obligation C1).

## Story: Preserve accepted work and correct unpaid attribution

### Revisions bind a key, a recorded rule and a reconciling decision

Categories follow `src/lib/points.ts`. Evidence and payout recognition never
count as accepted work. A penalty records the published debit request and is
never positive; its applied debit is derived below. Payout recognition is
exactly 25 Points. A merged-work revision carries its unit's whole value, at
least 10 Points, and the exact largest-remainder shares of its recipients.
An evaluated award is a multiple of 30 Points up to 240. The revision
identifier is a digest of its body in production and a counter here.

```quint
import periods as P from "./periods"
import payoutRecognition as PR from "./payoutRecognition"
import allocation as A from "./allocation"
import workUnits as W from "./workUnits"
import scoringPolicy as SP from "./scoringPolicy"
import evaluations as E from "./evaluations"
type Category = MergedWork | ResolvedIssue | MaterialTest | Evidence | Review | Evaluated | PayoutReceived | Penalty
type SourceRule = ScoreV1 | ScoreV2 | MergedHistoryV1 | ValueV1 | VerifiedPayoutV1 | PenaltyTable
type Basis = NoBasis | Reassessment | Reallocation | Ratification | DisputeUpheld | ManifestDecision |
  RetirementBatch | IncidentRecovery | PenaltyChange
type AwardKey = { project: str, actor: int, category: Category, source: int, workUnit: int }
type Decision = { basis: Basis, effectiveAt: int, reason: str, delta: int }
type Revision = { id: int, previous: int, key: AwardKey, amount: int, priorAmount: int,
  occurredAt: int, recordedAt: int, rule: SourceRule, tableVersion: int, sourceDigest: str,
  provisional: bool, decision: Decision, recipients: List[A::Recipient], completeLines: bool,
  shares: List[A::PointShare] }
type FrozenPeriod = { project: str, period: int }
type Ledger = { revisions: List[Revision], nextId: int, now: int, frozen: List[FrozenPeriod],
  removedSources: Set[int], bannedActors: Set[int], units: W::Units, admitted: List[E::Manifest] }
pure val noDecision: Decision = { basis: NoBasis, effectiveAt: 0, reason: "", delta: 0 }
pure val noKey: AwardKey = { project: "", actor: 0, category: Evidence, source: 0, workUnit: 0 }
pure val noRevision: Revision = { id: 0, previous: 0, key: noKey, amount: 0, priorAmount: 0,
  occurredAt: 0, recordedAt: 0, rule: ScoreV2, tableVersion: 0, sourceDigest: "",
  provisional: false, decision: noDecision, recipients: List(), completeLines: false, shares: List() }
pure val initial: Ledger = { revisions: List(), nextId: 1, now: 2432000, frozen: List(),
  removedSources: Set(), bannedActors: Set(), units: W::initial, admitted: List() }
pure def acceptedWork(cat: Category): bool = cat != Evidence and cat != PayoutReceived and cat != Penalty
pure def amountAllowed(cat: Category, amount: int): bool =
  if (cat == Penalty) amount <= 0 and amount >= 0 - P::maxSafe
  else if (cat == PayoutReceived) amount == 25
  else if (cat == MergedWork) amount >= 10 and amount <= P::maxSafe
  else if (cat == Evaluated) amount >= 0 and amount <= 240 and amount % 30 == 0
  else amount >= 0 and amount <= P::maxSafe
pure def ruleAllowed(cat: Category, rule: SourceRule): bool =
  if (cat == Penalty) rule == PenaltyTable
  else if (cat == PayoutReceived) rule == VerifiedPayoutV1
  else rule != PenaltyTable and rule != VerifiedPayoutV1
pure def validKey(k: AwardKey): bool =
  k.project != "" and k.source > 0 and k.workUnit > 0 and
  (if (k.category == MergedWork) (k.actor == 0 and k.source == k.workUnit) else k.actor > 0)
pure def unitAllocation(r: Revision): bool =
  if (r.key.category == MergedWork)
    A::canWriteAllocation(r.amount, r.recipients, r.completeLines, false) and
    r.shares == A::allocatePoints(r.amount, r.recipients) and A::pointTotal(r.shares) == r.amount
  else r.recipients.length() == 0 and r.shares.length() == 0
pure def alwaysNextIdPositive(l: Ledger): bool = l.nextId >= 1
pure def alwaysRevisionsWellFormed(l: Ledger): bool = l.revisions.every(r =>
  r.id > 0 and r.id < l.nextId and r.previous >= 0 and r.previous < r.id and validKey(r.key) and
  amountAllowed(r.key.category, r.amount) and ruleAllowed(r.key.category, r.rule) and unitAllocation(r) and
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

### Undecided policy is refused: an upheld dispute appends no correction

The effect of an upheld Points dispute is undecided (owner decision gate G1).
No transition records a `DisputeUpheld` correction; an upheld
[dispute](./disputes.md) changes no Points until the owner records that
decision and this rule is replaced.

```quint
pure def alwaysNoUpheldDisputeCorrection(l: Ledger): bool = l.revisions.every(r => r.decision.basis != DisputeUpheld)
```

### The latest revision of a key is its current value

```quint
pure def latest(l: Ledger, k: AwardKey): Revision =
  l.revisions.foldl(noRevision, (acc, r) => if (r.key == k) r else acc)
pure def revisionById(l: Ledger, id: int): Revision =
  l.revisions.foldl(noRevision, (acc, r) => if (r.id == id) r else acc)
pure def isFrozen(l: Ledger, project: str, period: int): bool =
  l.frozen.some(f => f.project == project and f.period == period)
pure def unitKey(project: str, unit: int): AwardKey =
  { project: project, actor: 0, category: MergedWork, source: unit, workUnit: unit }
pure def unitCredited(l: Ledger, unit: int): bool =
  l.revisions.some(r => r.key.category == MergedWork and r.key.workUnit == unit)
pure val noUnit: W::Unit = { id: 0, project: "", sources: Set(), commits: Set(), band: 0, value: 0, accepted: false,
  acceptedPeriod: -1, superseded: true, frozen: false, supersededBy: 0 }
pure def unitOf(l: Ledger, unit: int): W::Unit = l.units.units.foldl(noUnit, (acc, u) => if (u.id == unit) u else acc)
pure def sourceHasOrdinaryCredit(l: Ledger, source: int): bool =
  l.revisions.some(r => r.key.source == source and acceptedWork(r.key.category) and r.key.category != Evaluated and
    r.key.category != MergedWork and r.amount > 0) or
  l.units.units.some(u => u.sources.contains(source) and unitCredited(l, u.id))
pure def sourceHasEvaluation(l: Ledger, source: int): bool =
  l.revisions.some(r => r.key.source == source and r.key.category == Evaluated)
pure def lastRevision(l: Ledger): Revision = l.revisions.nthOr(l.revisions.length() - 1, noRevision)
```

### Work units are formed, promoted and accepted inside the journal

The journal applies the [work-unit](./workUnits.md) transitions to its own
copy. A group that would supersede a unit whose merged work is already
credited is refused: regrouping credited units is owner decision gate G4. A
group that names a source with an evaluated award is refused.

```quint
pure def canFormUnit(l: Ledger, g: W::GroupEvidence): bool =
  W::canForm(l.units, g) and
  l.units.units.every(u => W::touches(u, g.sources, g.commits) implies not(unitCredited(l, u.id))) and
  g.sources.forall(s => not(sourceHasEvaluation(l, s)))
pure def formUnit(l: Ledger, g: W::GroupEvidence): Ledger = { ...l, units: W::form(l.units, g) }
pure def canRecordPromotion(l: Ledger, g: W::GroupEvidence): bool = W::canRecordPromotion(l.units, g)
pure def recordPromotion(l: Ledger, g: W::GroupEvidence): Ledger = { ...l, units: W::recordPromotion(l.units, g) }
pure def canHoldPromotion(l: Ledger, g: W::GroupEvidence): bool = W::canHoldPromotion(l.units, g)
pure def holdPromotion(l: Ledger, g: W::GroupEvidence): Ledger = { ...l, units: W::holdPromotion(l.units, g) }
pure def canAcceptUnit(l: Ledger, unit: int, at: int): bool = at <= l.now and W::canAccept(l.units, unit, at)
pure def acceptUnit(l: Ledger, unit: int, at: int): Ledger = { ...l, units: W::accept(l.units, unit, at) }
```

### One current accepted unit is credited once with its whole value

The unit must be current and accepted, in the stated project, with its
occurrence in the unit's reward month, on or after the repository's start
month, in a collected project. The recipients' line allocation must be
writable for the unit's value: valid unique recipients, and complete lines
when there is more than one. The revision's shares sum to the unit's value.

```quint
type UnitCredit = { project: str, unit: int, recipients: List[A::Recipient], completeLines: bool, occurredAt: int,
  repositoryCountsFrom: int, projectCollected: bool, rule: SourceRule, provisional: bool, digest: str }
pure def appendRevision(r: Revision, l: Ledger): Ledger =
  { ...l, revisions: l.revisions.append(r), nextId: l.nextId + 1 }
pure def canCreditUnit(l: Ledger, c: UnitCredit): bool =
  val u = unitOf(l, c.unit)
  c.project != "" and c.unit > 0 and u.id == c.unit and W::live(u) and u.accepted and u.project == c.project and
  u.value >= 10 and u.value <= P::maxSafe and not(unitCredited(l, c.unit)) and c.projectCollected and c.digest != "" and
  c.occurredAt >= c.repositoryCountsFrom and c.occurredAt >= 0 and c.occurredAt <= l.now and
  P::periodOf(c.occurredAt) == u.acceptedPeriod and ruleAllowed(MergedWork, c.rule) and
  A::canWriteAllocation(u.value, c.recipients, c.completeLines, false) and
  u.sources.forall(s => not(sourceHasEvaluation(l, s)))
pure def creditUnit(l: Ledger, c: UnitCredit): Ledger =
  val u = unitOf(l, c.unit)
  appendRevision({ id: l.nextId, previous: 0, key: unitKey(c.project, c.unit), amount: u.value, priorAmount: 0,
    occurredAt: c.occurredAt, recordedAt: l.now, rule: c.rule, tableVersion: 0, sourceDigest: c.digest,
    provisional: c.provisional, decision: noDecision, recipients: c.recipients, completeLines: c.completeLines,
    shares: A::allocatePoints(u.value, c.recipients) }, l)
```

### One verified accepted source creates one first revision per key

The ingestion producer supplies `SourceEvidence` for the exact source of a
resolved issue, material test, evidence or review award. Only human GitHub
users of a collected project receive Points, and work before a repository's
start month counts for none. Slopbot and other bots never enter the ledger.
A source with an evaluated award receives no ordinary credit. A first
revision has no decision.

```quint
type SourceActor = HumanActor | BotActor | SlopbotActor
type SourceEvidence = { source: int, project: str, actor: int, actorKind: SourceActor, accepted: bool,
  occurredAt: int, repositoryCountsFrom: int, projectCollected: bool, workUnit: int, digest: str }
type AwardInput = { key: AwardKey, amount: int, occurredAt: int, rule: SourceRule, provisional: bool, digest: str }
pure def ordinaryCategory(cat: Category): bool =
  cat == ResolvedIssue or cat == MaterialTest or cat == Evidence or cat == Review
pure def evidenceBinds(a: AwardInput, e: SourceEvidence): bool =
  e.source == a.key.source and e.project == a.key.project and e.actor == a.key.actor and
  e.workUnit == a.key.workUnit and e.occurredAt == a.occurredAt and e.digest == a.digest and e.digest != ""
pure def canCredit(l: Ledger, a: AwardInput, e: SourceEvidence): bool =
  validKey(a.key) and ordinaryCategory(a.key.category) and
  latest(l, a.key) == noRevision and evidenceBinds(a, e) and
  e.actorKind == HumanActor and e.accepted and e.projectCollected and
  a.occurredAt >= e.repositoryCountsFrom and a.occurredAt >= 0 and a.occurredAt <= l.now and
  amountAllowed(a.key.category, a.amount) and ruleAllowed(a.key.category, a.rule) and
  (a.provisional implies a.key.category == Review) and
  not(sourceHasEvaluation(l, a.key.source))
pure def credit(l: Ledger, a: AwardInput, e: SourceEvidence): Ledger =
  appendRevision({ ...noRevision, id: l.nextId, key: a.key, amount: a.amount,
    occurredAt: a.occurredAt, recordedAt: l.now, rule: a.rule, sourceDigest: a.digest,
    provisional: a.provisional }, l)
```

### An evaluated award comes only from an admitted reviewed manifest

The journal admits a manifest under the [evaluation](./evaluations.md)
rules: well formed and not duplicating an admitted identity, source, work,
content or reviewer-per-PR. The award is the manifest's 30 to 240 Points for
its actor, project and source. A source with ordinary credit, or in a
credited work unit, refuses an evaluation.

```quint
pure def canAdmitManifest(l: Ledger, m: E::Manifest): bool = E::admissibleIn(l.admitted, m)
pure def admitManifest(l: Ledger, m: E::Manifest): Ledger = { ...l, admitted: l.admitted.append(m) }
pure def evaluationKey(m: E::Manifest): AwardKey =
  { project: m.project, actor: m.actor, category: Evaluated, source: m.source, workUnit: m.workKey }
pure def canCreditEvaluation(l: Ledger, m: E::Manifest): bool =
  l.admitted.includes(m) and E::wellFormed(m) and m.reviewedAt <= l.now and
  latest(l, evaluationKey(m)) == noRevision and not(sourceHasEvaluation(l, m.source)) and
  not(sourceHasOrdinaryCredit(l, m.source))
pure def creditEvaluation(l: Ledger, m: E::Manifest): Ledger =
  appendRevision({ ...noRevision, id: l.nextId, key: evaluationKey(m), amount: E::slopPoints(m),
    occurredAt: m.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: m.decision }, l)
pure def lawEvaluatedAwardInRange(m: E::Manifest): bool =
  E::wellFormed(m) implies amountAllowed(Evaluated, E::slopPoints(m))
```

### Unit value changes only through a scored assessment or ratification of that unit

A reassessment needs the unit's [scoring policy](./scoringPolicy.md) state
in phase `Assessed`; a ratification needs phase `Ratified`. The new value is
that state's Points, divided between the unit's existing recipients. A
frozen reward period refuses the change.

```quint
pure def rescoreBasis(s: SP::Scored): Basis = if (s.phase == SP::Ratified) Ratification else Reassessment
pure def canRescoreUnit(l: Ledger, s: SP::Scored, reason: str, digest: str): bool =
  val prior = latest(l, unitKey(s.project, s.unit))
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  (s.phase == SP::Assessed or s.phase == SP::Ratified) and s.project != "" and s.unit > 0 and
  s.points != prior.amount and s.points >= 10 and s.points <= P::maxSafe and
  not(isFrozen(l, s.project, P::periodOf(prior.occurredAt))) and reason != "" and digest != "" and
  A::canWriteAllocation(s.points, prior.recipients, prior.completeLines, false)
pure def rescoreUnit(l: Ledger, s: SP::Scored, reason: str, digest: str): Ledger =
  val prior = latest(l, unitKey(s.project, s.unit))
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: unitKey(s.project, s.unit), amount: s.points,
    priorAmount: prior.amount, occurredAt: prior.occurredAt, recordedAt: l.now, rule: ValueV1, sourceDigest: digest,
    decision: { basis: rescoreBasis(s), effectiveAt: l.now, reason: reason, delta: s.points - prior.amount },
    recipients: prior.recipients, completeLines: prior.completeLines, shares: A::allocatePoints(s.points, prior.recipients) }, l)
```

### A reallocation keeps the unit's whole value and changes only its recipients

Rebalancing without a current value assessment preserves the complete
previously recorded total, including a former carrier's share. The new
recipients and lines must be writable for that total. A frozen reward period
refuses it.

```quint
pure def canReallocateUnit(l: Ledger, project: str, unit: int, recipients: List[A::Recipient], completeLines: bool,
    reason: str, digest: str): bool =
  val prior = latest(l, unitKey(project, unit))
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  project != "" and unit > 0 and recipients != prior.recipients and reason != "" and digest != "" and
  prior.amount >= 10 and prior.amount <= P::maxSafe and
  not(isFrozen(l, project, P::periodOf(prior.occurredAt))) and
  A::canWriteAllocation(prior.amount, recipients, completeLines, false)
pure def reallocateUnit(l: Ledger, project: str, unit: int, recipients: List[A::Recipient], completeLines: bool,
    reason: str, digest: str): Ledger =
  val prior = latest(l, unitKey(project, unit))
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: unitKey(project, unit), amount: prior.amount,
    priorAmount: prior.amount, occurredAt: prior.occurredAt, recordedAt: l.now, rule: ValueV1, sourceDigest: digest,
    decision: { basis: Reallocation, effectiveAt: l.now, reason: reason, delta: 0 },
    recipients: recipients, completeLines: completeLines, shares: A::allocatePoints(prior.amount, recipients) }, l)
pure def lawReallocationKeepsTotal(total: int, recipients: List[A::Recipient]): bool =
  A::canWriteAllocation(total, recipients, true, false) implies A::pointTotal(A::allocatePoints(total, recipients)) == total
```

### A source re-scored by the ingestion producer appends a reassessment

A resolved issue, material test, evidence or review award changes only with
fresh `SourceEvidence` for the same key. The original occurrence time never
moves. A frozen reward period refuses a changed amount.

```quint
pure def canRescoreSource(l: Ledger, a: AwardInput, e: SourceEvidence, reason: str): bool =
  val prior = latest(l, a.key)
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  ordinaryCategory(a.key.category) and evidenceBinds(a, e) and e.actorKind == HumanActor and e.accepted and
  a.occurredAt == prior.occurredAt and reason != "" and
  amountAllowed(a.key.category, a.amount) and ruleAllowed(a.key.category, a.rule) and
  (a.provisional implies a.key.category == Review) and
  (a.amount != prior.amount or a.digest != prior.sourceDigest or a.provisional != prior.provisional) and
  (isFrozen(l, a.key.project, P::periodOf(prior.occurredAt)) implies a.amount == prior.amount)
pure def rescoreSource(l: Ledger, a: AwardInput, e: SourceEvidence, reason: str): Ledger =
  val prior = latest(l, a.key)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: a.key, amount: a.amount, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: a.rule, sourceDigest: a.digest, provisional: a.provisional,
    decision: { basis: Reassessment, effectiveAt: l.now, reason: reason, delta: a.amount - prior.amount } }, l)
```

### An evaluated award changes only by a reviewed manifest decision or the incident recovery

A later reviewed maintainer decision sets the admitted award's legacy
points. The 20 October 2026 retirement batch is the one exact erroneous
zero: recorded at the batch instant, with the batch digest and the v2 rule,
of an award retained before the retirement. The recovery restores the
amount of the retained predecessor, only directly after that batch.

```quint
pure def canDecideEvaluation(l: Ledger, k: AwardKey, d: E::LaterDecision): bool =
  val prior = latest(l, k)
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  validKey(k) and k.category == Evaluated and E::validLaterDecision(d) and d.source == k.source and
  l.admitted.some(m => m.source == k.source and m.project == k.project and m.actor == k.actor) and
  (isFrozen(l, k.project, P::periodOf(prior.occurredAt)) implies 30 * d.points == prior.amount)
pure def decideEvaluation(l: Ledger, k: AwardKey, d: E::LaterDecision): Ledger =
  val prior = latest(l, k)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: k, amount: 30 * d.points, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: d.decision,
    decision: { basis: ManifestDecision, effectiveAt: l.now, reason: d.reason, delta: 30 * d.points - prior.amount } }, l)
pure def isRetirementBatch(r: Revision): bool =
  r.key.category == Evaluated and r.amount == 0 and r.recordedAt == E::retirementZeroedAt and
  r.sourceDigest == E::retirementZeroDigest and r.rule == ScoreV2 and r.decision.basis == RetirementBatch
pure def canRecordRetirementBatch(l: Ledger, k: AwardKey): bool =
  val prior = latest(l, k)
  prior.id > 0 and prior.id < l.nextId and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  validKey(k) and k.category == Evaluated and prior.amount > 0 and prior.recordedAt < E::retiredAt and
  l.now == E::retirementZeroedAt and not(isFrozen(l, k.project, P::periodOf(prior.occurredAt)))
pure def recordRetirementBatch(l: Ledger, k: AwardKey): Ledger =
  val prior = latest(l, k)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: k, amount: 0, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: E::retirementZeroDigest,
    decision: { basis: RetirementBatch, effectiveAt: l.now, reason: "retired evaluator batch", delta: 0 - prior.amount } }, l)
pure def canRecoverIncident(l: Ledger, k: AwardKey, reason: str): bool =
  val prior = latest(l, k)
  val retained = revisionById(l, prior.previous)
  prior.id > 0 and prior.id < l.nextId and prior.occurredAt >= 0 and prior.occurredAt <= l.now and prior.recordedAt <= l.now and
  validKey(k) and isRetirementBatch(prior) and prior.key == k and retained.id > 0 and retained.key == k and
  retained.recordedAt < E::retiredAt and retained.amount > 0 and retained.amount <= 240 and retained.amount % 30 == 0 and
  reason != "" and not(isFrozen(l, k.project, P::periodOf(prior.occurredAt)))
pure def recoverIncident(l: Ledger, k: AwardKey, reason: str): Ledger =
  val prior = latest(l, k)
  val retained = revisionById(l, prior.previous)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: k, amount: retained.amount, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: "retired-evaluator-recovery-v1",
    decision: { basis: IncidentRecovery, effectiveAt: l.now, reason: reason, delta: retained.amount - prior.amount } }, l)
```

### A penalty revision records one published debit request

The penalty journal supplies the item's table version and the published
debit request. A reversal (an upheld appeal or a maintainer reopen) records
zero. A penalty on work before the repository's start month is refused. A
changed request appends a successor; the table version, category and
occurrence of a key never change.

```quint
type PenaltyEvidence = { key: AwardKey, occurredAt: int, repositoryCountsFrom: int, tableVersion: int, requested: int,
  reversed: bool, digest: str, effectiveAt: int, reason: str }
pure def requestOf(p: PenaltyEvidence): int = if (p.reversed) 0 else p.requested
pure def canRecordPenalty(l: Ledger, p: PenaltyEvidence): bool =
  val prior = latest(l, p.key)
  validKey(p.key) and p.key.category == Penalty and p.tableVersion > 0 and p.digest != "" and
  p.requested >= 0 and p.requested <= P::maxSafe and p.reason != "" and
  p.occurredAt >= p.repositoryCountsFrom and
  p.occurredAt >= 0 and p.occurredAt <= l.now and p.effectiveAt >= p.occurredAt and p.effectiveAt <= l.now and
  prior.id >= 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.amount <= 0 and
  (prior.id > 0 implies (prior.tableVersion == p.tableVersion and prior.occurredAt == p.occurredAt and
     0 - requestOf(p) != prior.amount)) and
  (prior.id == 0 implies prior.amount == 0)
pure def recordPenalty(l: Ledger, p: PenaltyEvidence): Ledger =
  val prior = latest(l, p.key)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: p.key, amount: 0 - requestOf(p), priorAmount: prior.amount,
    occurredAt: p.occurredAt, recordedAt: l.now, rule: PenaltyTable, tableVersion: p.tableVersion,
    sourceDigest: p.digest, decision: { basis: PenaltyChange, effectiveAt: p.effectiveAt, reason: p.reason,
      delta: (0 - requestOf(p)) - prior.amount } }, l)
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
  appendRevision({ ...noRevision, id: l.nextId, key: recognitionKey(paid), amount: PR::recognitionAmount(paid),
    occurredAt: paid.settledAt, recordedAt: l.now, rule: VerifiedPayoutV1, sourceDigest: paid.settlementDigest }, l)
```

### A frozen reward period, a removed PR and a ban never rewrite recorded Points

Monthly settlement supplies the freeze when the month's allocation is
frozen, reserved or completed, or an approved, funded, scheduled or paid
obligation exists. A freeze is never lifted, and it also freezes the
project's accepted units of that month. A removal or ban observation records
the fact and appends no revision.

```quint
pure def canFreeze(l: Ledger, f: P::FreezeEvidence): bool = P::freezes(f) and not(isFrozen(l, f.project, f.period))
pure def freeze(l: Ledger, f: P::FreezeEvidence): Ledger =
  { ...l, frozen: l.frozen.append({ project: f.project, period: f.period }),
    units: { ...l.units, units: l.units.units.listMap(u =>
      if (W::live(u) and u.accepted and u.project == f.project and u.acceptedPeriod == f.period) { ...u, frozen: true } else u) } }
pure def canObserveRemoved(l: Ledger, source: int): bool = source > 0 and not(l.removedSources.contains(source))
pure def observeRemoved(l: Ledger, source: int): Ledger = { ...l, removedSources: l.removedSources.union(Set(source)) }
pure def canObserveBan(l: Ledger, actor: int): bool = actor > 0 and not(l.bannedActors.contains(actor))
pure def observeBan(l: Ledger, actor: int): Ledger = { ...l, bannedActors: l.bannedActors.union(Set(actor)) }
pure def canAdvance(l: Ledger, at: int): bool = at > l.now and at <= P::maxSafe
pure def advance(l: Ledger, at: int): Ledger = { ...l, now: at }
```

### History is append-only, chained and never moves an occurrence time

Each appended revision names the previous latest revision of its key, keeps
that revision's occurrence time and records no earlier than it. A frozen
reward period keeps every accepted-work amount and share it had.
Observations of removal and bans and unit transitions change no revision.

```quint
pure def stepAppendOnly(before: Ledger, after: Ledger): bool =
  after.revisions.length() >= before.revisions.length() and
  before.revisions.every(r => after.revisions.includes(r)) and after.now >= before.now and
  before.frozen.every(f => after.frozen.includes(f)) and
  before.removedSources.subseteq(after.removedSources) and before.bannedActors.subseteq(after.bannedActors) and
  before.admitted.every(m => after.admitted.includes(m))
pure def chainsTo(before: Ledger, r: Revision): bool =
  val prior = latest(before, r.key)
  r.id == before.nextId and r.previous == prior.id and r.priorAmount == prior.amount and
  (prior.id > 0 implies (r.occurredAt == prior.occurredAt and r.recordedAt >= prior.recordedAt))
pure def frozenKeeps(before: Ledger, r: Revision): bool =
  (isFrozen(before, r.key.project, P::periodOf(r.occurredAt)) and r.key.category != Penalty and r.previous > 0)
    implies (r.amount == r.priorAmount and (r.key.category == MergedWork implies r.shares == latest(before, r.key).shares))
pure def stepChained(before: Ledger, after: Ledger): bool =
  after.revisions.length() == before.revisions.length() or
  (after.revisions.length() == before.revisions.length() + 1 and chainsTo(before, lastRevision(after)))
pure def stepFrozenAcceptedWorkUnchanged(before: Ledger, after: Ledger): bool =
  after.revisions.length() == before.revisions.length() or frozenKeeps(before, lastRevision(after))
pure def stepObservationsAppendNothing(before: Ledger, via: str, after: Ledger): bool =
  (via == "observeRemoved" or via == "observeBan" or via == "freeze" or via == "advance" or via == "formUnit" or
   via == "recordPromotion" or via == "holdPromotion" or via == "acceptUnit" or via == "admitManifest") implies
    after.revisions == before.revisions
pure def alwaysFrozenPeriodsValid(l: Ledger): bool = l.frozen.every(f => f.project != "" and f.period >= 0)
```

### Public totals are views of the latest revisions, with penalties bounded by the month's credit

A merged-work revision credits each recipient its share. A penalty debit
consumes the author's accepted-work credit of the project and UTC month in
occurrence order and never takes it below zero; a later credit in the same
month is debited by an earlier request that found no credit. The total
applied debit of a month is the smaller of its credit and its requests, as
in the bucket consumption of [reward weights](./rewardWeights.md).

```quint
pure def isLatest(l: Ledger, r: Revision): bool = latest(l, r.key).id == r.id
pure def shareOf(shares: List[A::PointShare], actor: int): int =
  shares.foldl(0, (acc, s) => if (s.actor == actor) acc + s.points else acc)
pure def actorAmount(r: Revision, actor: int): int =
  if (r.key.category == MergedWork) shareOf(r.shares, actor) else if (r.key.actor == actor) r.amount else 0
pure def acceptedWorkCredit(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and acceptedWork(r.key.category) and
    P::periodOf(r.occurredAt) == period and isLatest(l, r)) acc + actorAmount(r, actor) else acc)
pure def penaltyRequested(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and r.key.actor == actor and
    r.key.category == Penalty and P::periodOf(r.occurredAt) == period and isLatest(l, r)) acc - r.amount else acc)
pure def boundedDebit(credit: int, requested: int): int =
  if (credit <= 0) 0 else if (requested < credit) requested else credit
pure def penaltyDebit(l: Ledger, project: str, actor: int, period: int): int =
  boundedDebit(acceptedWorkCredit(l, project, actor, period), penaltyRequested(l, project, actor, period))
pure def earlierRequested(l: Ledger, r: Revision): int =
  l.revisions.foldl(0, (acc, o) => if (o.key.project == r.key.project and o.key.actor == r.key.actor and
    o.key.category == Penalty and isLatest(l, o) and P::periodOf(o.occurredAt) == P::periodOf(r.occurredAt) and
    (o.occurredAt < r.occurredAt or (o.occurredAt == r.occurredAt and o.key.workUnit < r.key.workUnit))) acc - o.amount else acc)
pure def appliedDebit(l: Ledger, r: Revision): int =
  val credit = acceptedWorkCredit(l, r.key.project, r.key.actor, P::periodOf(r.occurredAt))
  val room = credit - earlierRequested(l, r)
  if (room <= 0) 0 else if (0 - r.amount < room) 0 - r.amount else room
pure def publicTotal(l: Ledger, actor: int): int =
  l.revisions.foldl(0, (acc, r) => if (isLatest(l, r))
    (if (r.key.category == Penalty) (if (r.key.actor == actor) acc - appliedDebit(l, r) else acc) else acc + actorAmount(r, actor))
    else acc)
pure def lawDebitBounded(credit: int, requested: int): bool =
  (requested >= 0) implies (boundedDebit(credit, requested) >= 0 and boundedDebit(credit, requested) <= requested and
    (credit > 0 implies boundedDebit(credit, requested) <= credit))
pure def lawLateCreditIsDebited(credit: int, requested: int): bool =
  (requested > 0 and credit >= requested) implies boundedDebit(credit, requested) == requested
```

### Credited, corrected, penalized, recognized and frozen states are reachable

```quint
pure def sometimesUnitCredited(l: Ledger): bool = l.revisions.some(r => r.key.category == MergedWork and r.shares.length() > 1)
pure def sometimesRescored(l: Ledger): bool = l.revisions.some(r => r.key.category == MergedWork and r.decision.basis == Reassessment)
pure def sometimesRatified(l: Ledger): bool = l.revisions.some(r => r.decision.basis == Ratification)
pure def sometimesReallocated(l: Ledger): bool = l.revisions.some(r => r.decision.basis == Reallocation)
pure def sometimesSourceRescored(l: Ledger): bool = l.revisions.some(r => r.key.category == Review and r.previous > 0)
pure def sometimesPenalized(l: Ledger): bool = l.revisions.some(r => r.key.category == Penalty and r.amount < 0)
pure def sometimesPenaltyExceedsCredit(l: Ledger): bool = l.revisions.some(r => r.key.category == Penalty and isLatest(l, r) and
  r.amount < 0 and appliedDebit(l, r) < 0 - r.amount)
pure def sometimesRecognized(l: Ledger): bool = l.revisions.some(r => r.key.category == PayoutReceived)
pure def sometimesEvaluated(l: Ledger): bool = l.revisions.some(r => r.key.category == Evaluated)
pure def sometimesIncidentRecovered(l: Ledger): bool = l.revisions.some(r => r.decision.basis == IncidentRecovery)
pure def sometimesManifestDecided(l: Ledger): bool = l.revisions.some(r => r.decision.basis == ManifestDecision)
pure def sometimesFrozenUnitCredited(l: Ledger): bool = l.revisions.some(r =>
  r.key.category == MergedWork and isFrozen(l, r.key.project, P::periodOf(r.occurredAt)))
pure def sometimesRemovedKeepsCredit(l: Ledger): bool = l.revisions.some(r => l.removedSources.contains(r.key.source) and r.amount > 0)
pure def sometimesBannedKeepsCredit(l: Ledger): bool = l.revisions.some(r => l.bannedActors.contains(r.key.actor) and r.amount > 0)
```

### Simulation samples bind matching and mismatched evidence

These input sets bound simulation only.

```quint
pure val gValues = Set(
  { project: "p", sources: Set(1), commits: Set(11), band: -1, hashesVerified: true, digest: "a", promotion: W::NotPromotion },
  { project: "p", sources: Set(1, 2), commits: Set(11, 12), band: 2, hashesVerified: true, digest: "c", promotion: W::NotPromotion },
  { project: "p", sources: Set(5), commits: Set(11), band: 0, hashesVerified: true, digest: "e",
    promotion: W::PromotionTrees({ base: "t", head: "t", merge: "t" }) })
pure val unitValues = Set(1, 2)
pure val atValues = Set(2432005, 2432119, 2432210)
pure val twoRecipients: List[A::Recipient] = List({ actor: 1, lines: 1 }, { actor: 2, lines: 3 })
pure val cValues = Set(
  { project: "p", unit: 1, recipients: twoRecipients, completeLines: true, occurredAt: 2432005, repositoryCountsFrom: 2432000,
    projectCollected: true, rule: ScoreV2, provisional: false, digest: "u1" },
  { project: "p", unit: 2, recipients: List({ actor: 1, lines: 0 }), completeLines: true, occurredAt: 2432005,
    repositoryCountsFrom: 2432000, projectCollected: true, rule: ValueV1, provisional: true, digest: "u2" },
  { project: "p", unit: 1, recipients: twoRecipients, completeLines: false, occurredAt: 2432005, repositoryCountsFrom: 2432000,
    projectCollected: true, rule: ScoreV2, provisional: false, digest: "u3" })
pure val sValues = Set({ ...SP::initial, phase: SP::Assessed, project: "p", unit: 1, head: "h", acceptedAt: 2432005, points: 90 },
  { ...SP::initial, phase: SP::Ratified, project: "p", unit: 1, head: "h", acceptedAt: 2432005, points: 30 },
  { ...SP::initial, phase: SP::Provisional, project: "p", unit: 1, head: "h", acceptedAt: 2432005, points: 10 })
pure val recipientsValues = Set(List({ actor: 2, lines: 1 }), twoRecipients)
pure val completeLinesValues = Set(true, false)
pure val reasonValues = Set("checked", "")
pure val digestValues = Set("d9")
pure val projectValues = Set("p")
pure val keyReview: AwardKey = { project: "p", actor: 1, category: Review, source: 3, workUnit: 3 }
pure val keyEval: AwardKey = { project: "p", actor: 1, category: Evaluated, source: 4, workUnit: 104 }
pure val keyPenalty: AwardKey = { project: "p", actor: 1, category: Penalty, source: 6, workUnit: 6 }
pure val goodEvidence: SourceEvidence = { source: 3, project: "p", actor: 1, actorKind: HumanActor, accepted: true,
  occurredAt: 2432005, repositoryCountsFrom: 2432000, projectCollected: true, workUnit: 3, digest: "r1" }
pure val aValues = Set(
  { key: keyReview, amount: 30, occurredAt: 2432005, rule: ScoreV2, provisional: false, digest: "r1" },
  { key: keyReview, amount: 60, occurredAt: 2432005, rule: ScoreV2, provisional: false, digest: "r2" },
  { key: { ...keyReview, category: MergedWork }, amount: 30, occurredAt: 2432005, rule: ScoreV2, provisional: false, digest: "r1" })
pure val eValues = Set(goodEvidence, { ...goodEvidence, digest: "r2" }, { ...goodEvidence, actorKind: BotActor },
  { ...goodEvidence, projectCollected: false }, { ...goodEvidence, repositoryCountsFrom: 2432100 })
pure val manifest: E::Manifest = { id: 1, project: "p", actor: 1, actorKind: E::User, source: 4, kind: E::ReviewSource,
  workKey: 104, contentDigest: 0, pullRequest: 5, points: 2, occurredAt: 2432003, capturedAt: 0,
  reviewedAt: 2432004, reviewer: 9, decision: "review", reason: "useful" }
pure val mValues = Set(manifest, { ...manifest, id: 2, source: 1, workKey: 105 }, { ...manifest, id: 3, reviewer: 0, source: 7, workKey: 107 })
pure val kValues = Set(keyEval, keyReview)
pure val dValues = Set({ source: 4, points: 0, reviewer: 9, decision: "withdrawn", reason: "duplicate" },
  { source: 4, points: 3, reviewer: 0, decision: "raise", reason: "x" })
pure val pValues = Set(
  { key: keyPenalty, occurredAt: 2432006, repositoryCountsFrom: 2432000, tableVersion: 1, requested: 30, reversed: false,
    digest: "pd", effectiveAt: 2432006, reason: "spam" },
  { key: keyPenalty, occurredAt: 2432006, repositoryCountsFrom: 2432000, tableVersion: 1, requested: 30, reversed: true,
    digest: "pd2", effectiveAt: 2432119, reason: "reopen" },
  { key: { ...keyPenalty, source: 8, workUnit: 8 }, occurredAt: 2432006, repositoryCountsFrom: 2432100, tableVersion: 1,
    requested: 240, reversed: false, digest: "pd3", effectiveAt: 2432006, reason: "early" },
  { key: { ...keyPenalty, source: 9, workUnit: 9 }, occurredAt: 2432007, repositoryCountsFrom: 2432000, tableVersion: 1,
    requested: 240, reversed: false, digest: "pd4", effectiveAt: 2432007, reason: "large" })
pure val paidValues = Set({ ...PR::paidSample, settledAt: 2432010 }, { ...PR::paidSample, state: PR::CycleHeld, settledAt: 2432010 })
pure val fValues = Set({ project: "p", period: 24320, phase: P::Frozen, obligationExists: false },
  { project: "p", period: 24320, phase: P::Collecting, obligationExists: false },
  { project: "p", period: 24320, phase: P::Proposed, obligationExists: true })
pure val sourceValues = Set(0, 1, 3)
pure val actorValues = Set(0, 1)
pure val creditValues = Set(0, 10, 30)
pure val requestedValues = Set(0, 30, 240)
pure val totalValues = Set(10, 30)
```
