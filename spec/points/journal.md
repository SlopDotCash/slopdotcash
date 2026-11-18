# Append-only Points journal

PRD sections 2 and 7 publish one Points measure. Monthly and lifetime totals
are views of one append-only history. This machine is that history: a ledger
of revisions keyed by project, recipient, category, source and work unit,
following `src/lib/points.ts` (`PointRevision`, `pointKey`,
`assertRevisionChain`) and the D1 table `points_revisions`.

Every revision names the latest revision of its key as its predecessor,
keeps the key's original occurrence time and records its own recording time.
Any revision may carry a decision; when it does, the decision's delta
reconciles the amount change, its basis is bound to the state that justifies
it and its source names the deciding record (`value:<digest>` for a value
decision). A frozen reward period
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
- `RetainedBatch` and `Supersession`: the retained review and evaluator
  batch and the complete leaderboard snapshot applied by
  `scripts/generate-points.ts` (`applyRetainedHistoryBatch`,
  `applyPointsSnapshot`), each with its digest; the snapshot's coverage
  digests are recorded in the journal.
- `PR::VaultPayment`: the public projection of a recipient's finalized
  ordinary vault payments.
- `RH::Retirement` and `RH::RecipientCorrection`: the owner-reviewed
  duplicate retirement and recipient correction verified by the
  [reviewed historical runner](./reviewedHistory.md).

## Story: Preserve accepted work and correct unpaid attribution

### Revisions bind a key, a recorded rule and a reconciling decision

Categories follow `src/lib/points.ts`. Evidence and payout recognition never
count as accepted work. A penalty records its published debit request and
the debit applied against the month's credit, never positive and never more
than the request; a reversed penalty applies nothing, and every penalty
revision carries its decision. Payout recognition is exactly 25 Points. A
merged-work revision carries its unit's whole value, at least 10 Points, or
zero once superseded, and the exact largest-remainder shares of its
recipients. A decision is optional on every revision; when present its rule
is the v2 score (`ScoreV2`, or `ValueV1`, which is recorded as
`slop-score-v2`) or the penalty table, its source is non-empty (the
adapter parses it as an identifier of 4 to 256 characters of
`[A-Za-z0-9_=-]`, or `value:` and 64 hexadecimal digits), its
effective time is no later than its recording and its delta is the amount
change.
An evaluated award is a multiple of 30 Points up to 240. The revision
identifier is a digest of its body in production and a counter here.

```quint
import periods as P from "./periods"
import payoutRecognition as PR from "./payoutRecognition"
import allocation as A from "./allocation"
import workUnits as W from "./workUnits"
import scoringPolicy as SP from "./scoringPolicy"
import evaluations as E from "./evaluations"
import reviewedHistory as RH from "./reviewedHistory"
type Category = MergedWork | ResolvedIssue | MaterialTest | Evidence | Review | Evaluated | PayoutReceived | Penalty
type SourceRule = ScoreV1 | ScoreV2 | MergedHistoryV1 | ValueV1 | VerifiedPayoutV1 | PenaltyTable
type Basis = NoBasis | Reassessment | Reallocation | Ratification | DisputeUpheld | ManifestDecision |
  RetirementBatch | IncidentRecovery | PenaltyChange | Superseded | DuplicateRetirement
type AwardKey = { project: str, actor: int, category: Category, source: int, workUnit: int }
type Decision = { basis: Basis, effectiveAt: int, reason: str, delta: int, source: str, valued: bool }
type Revision = { id: int, previous: int, key: AwardKey, amount: int, priorAmount: int,
  occurredAt: int, recordedAt: int, rule: SourceRule, tableVersion: int, sourceDigest: str,
  provisional: bool, decision: Decision, recipients: List[A::Recipient], completeLines: bool,
  shares: List[A::PointShare], debit: int, reversed: bool }
type FrozenPeriod = { project: str, period: int }
type Ledger = { revisions: List[Revision], nextId: int, now: int, frozen: List[FrozenPeriod],
  removedSources: Set[int], bannedActors: Set[int], units: W::Units, admitted: List[E::Manifest], coverage: Set[str] }
pure val noDecision: Decision = { basis: NoBasis, effectiveAt: 0, reason: "", delta: 0, source: "", valued: false }
pure val noKey: AwardKey = { project: "", actor: 0, category: Evidence, source: 0, workUnit: 0 }
pure val noRevision: Revision = { id: 0, previous: 0, key: noKey, amount: 0, priorAmount: 0,
  occurredAt: 0, recordedAt: 0, rule: ScoreV2, tableVersion: 0, sourceDigest: "",
  provisional: false, decision: noDecision, recipients: List(), completeLines: false, shares: List(), debit: 0, reversed: false }
pure val initial: Ledger = { revisions: List(), nextId: 1, now: 2432000, frozen: List(),
  removedSources: Set(), bannedActors: Set(), units: W::initial, admitted: List(), coverage: Set() }
pure def acceptedWork(cat: Category): bool = cat != Evidence and cat != PayoutReceived and cat != Penalty
pure def amountAllowed(cat: Category, amount: int): bool =
  if (cat == Penalty) amount <= 0 and amount >= 0 - P::maxSafe
  else if (cat == PayoutReceived) amount == 25
  else if (cat == MergedWork) amount == 0 or (amount >= 10 and amount <= P::maxSafe)
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
    (if (r.amount == 0) r.previous > 0 and r.shares == A::allocatePoints(0, r.recipients)
     else A::canWriteAllocation(r.amount, r.recipients, r.completeLines, false) and
       r.shares == A::allocatePoints(r.amount, r.recipients) and A::pointTotal(r.shares) == r.amount)
  else r.recipients.length() == 0 and r.shares.length() == 0
pure def decisionRule(cat: Category, rule: SourceRule): bool = rule == ScoreV2 or rule == ValueV1 or cat == Penalty
pure def alwaysNextIdPositive(l: Ledger): bool = l.nextId >= 1
pure def alwaysRevisionsWellFormed(l: Ledger): bool = l.revisions.every(r =>
  r.id > 0 and r.id < l.nextId and r.previous >= 0 and r.previous < r.id and validKey(r.key) and
  amountAllowed(r.key.category, r.amount) and ruleAllowed(r.key.category, r.rule) and unitAllocation(r) and
  r.recordedAt >= r.occurredAt and r.occurredAt >= 0 and r.recordedAt <= l.now and r.sourceDigest != "" and
  (r.provisional implies (r.key.category == MergedWork or r.key.category == Review)) and
  (r.key.category == Penalty implies (not(r.provisional) and r.tableVersion > 0 and r.debit > 0 and
    0 - r.amount <= r.debit and (r.reversed implies r.amount == 0) and r.decision.basis != NoBasis)) and
  (r.key.category != Penalty implies (r.tableVersion == 0 and r.debit == 0 and not(r.reversed))))
pure def alwaysDecisionsReconcile(l: Ledger): bool = l.revisions.every(r =>
  (r.previous == 0 implies r.priorAmount == 0) and
  (r.decision.basis == NoBasis implies r.decision == noDecision) and
  (r.decision.basis != NoBasis implies (r.decision.delta == r.amount - r.priorAmount and
    r.decision.reason != "" and r.decision.effectiveAt <= r.recordedAt and r.decision.source != "" and
    decisionRule(r.key.category, r.rule))))
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
copy. A new joint unit may supersede a credited unit only when that unit is
a source credited by its own record (one source); the superseded award is
zeroed under the joint decision (`zeroSuperseded`, the own-record merge
absorbed), and the joint unit is credited only once every credited unit it
superseded is zero, as development appends both in one batch. Any other
regrouping of credited units is refused (owner decision gate G4). A group
that names a source with an evaluated award is refused.

```quint
pure def canFormUnit(l: Ledger, g: W::GroupEvidence): bool =
  W::canForm(l.units, g) and
  l.units.units.every(u => W::touches(u, g.sources, g.commits) implies (not(unitCredited(l, u.id)) or u.sources.size() == 1)) and
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
  u.sources.forall(s => not(sourceHasEvaluation(l, s))) and
  l.units.units.every(o => (o.supersededBy == c.unit and unitCredited(l, o.id)) implies latest(l, unitKey(o.project, o.id)).amount == 0)
pure def creditUnit(l: Ledger, c: UnitCredit): Ledger =
  val u = unitOf(l, c.unit)
  appendRevision({ ...noRevision, id: l.nextId, key: unitKey(c.project, c.unit), amount: u.value,
    occurredAt: c.occurredAt, recordedAt: l.now, rule: c.rule, sourceDigest: c.digest,
    provisional: c.provisional, recipients: c.recipients, completeLines: c.completeLines,
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

### A recorded award follows the latest complete snapshot's score

A recorded unit's value follows the score the latest complete snapshot
gives it: its [scoring policy](./scoringPolicy.md) state, which is the
snapshot's value coverage, in phase `Assessed` (a reassessment), `Ratified`
(a ratification) or `LegacyScored` (the legacy v2 score of a later
snapshot). An assessed or ratified score carries the value decision
`value:<record digest>`; a legacy score carries no decision. A provisional
minimum never replaces a recorded value. The new value is divided between
the unit's existing recipients. A frozen reward period refuses the change.

```quint
pure def rescoreBasis(s: SP::Scored): Basis = if (s.phase == SP::Ratified) Ratification else Reassessment
pure def canRescoreUnit(l: Ledger, s: SP::Scored, reason: str, digest: str): bool =
  val prior = latest(l, unitKey(s.project, s.unit))
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  (s.phase == SP::Assessed or s.phase == SP::Ratified or s.phase == SP::LegacyScored) and s.project != "" and s.unit > 0 and
  s.points != prior.amount and s.points >= 10 and s.points <= P::maxSafe and
  not(isFrozen(l, s.project, P::periodOf(prior.occurredAt))) and reason != "" and digest != "" and
  A::canWriteAllocation(s.points, prior.recipients, prior.completeLines, false)
pure def rescoreUnit(l: Ledger, s: SP::Scored, reason: str, digest: str): Ledger =
  val prior = latest(l, unitKey(s.project, s.unit))
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: unitKey(s.project, s.unit), amount: s.points,
    priorAmount: prior.amount, occurredAt: prior.occurredAt, recordedAt: l.now, rule: ValueV1, sourceDigest: digest,
    decision: if (s.phase == SP::LegacyScored) noDecision
      else { basis: rescoreBasis(s), effectiveAt: l.now, reason: reason, delta: s.points - prior.amount, source: digest, valued: true },
    recipients: prior.recipients, completeLines: prior.completeLines, shares: A::allocatePoints(s.points, prior.recipients) }, l)
```

### A reallocation keeps the unit's whole value and changes only its recipients

Rebalancing without a current value assessment preserves the complete
previously recorded total, including a former carrier's share. The new
recipients and lines must be writable for that total. The decision keeps the
pool's latest value decision source when it has one, so assessed work stays
in its value month, and otherwise names the source pull request
(`valueSourceId ?? row.pullRequestId` in development); the digest names the
snapshot or correction that reallocates. A frozen reward period refuses it.

```quint
pure def latestValueDecision(l: Ledger, k: AwardKey): Decision =
  l.revisions.foldl(noDecision, (acc, r) => if (r.key == k and r.decision.valued) r.decision else acc)
pure def canReallocateUnit(l: Ledger, project: str, unit: int, recipients: List[A::Recipient], completeLines: bool,
    reason: str, digest: str, pullRequest: str): bool =
  val prior = latest(l, unitKey(project, unit))
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  project != "" and unit > 0 and recipients != prior.recipients and reason != "" and digest != "" and pullRequest != "" and
  prior.amount >= 10 and prior.amount <= P::maxSafe and
  not(isFrozen(l, project, P::periodOf(prior.occurredAt))) and
  A::canWriteAllocation(prior.amount, recipients, completeLines, false)
pure def reallocateUnit(l: Ledger, project: str, unit: int, recipients: List[A::Recipient], completeLines: bool,
    reason: str, digest: str, pullRequest: str): Ledger =
  val prior = latest(l, unitKey(project, unit))
  val valueSource = latestValueDecision(l, unitKey(project, unit))
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: unitKey(project, unit), amount: prior.amount,
    priorAmount: prior.amount, occurredAt: prior.occurredAt, recordedAt: l.now, rule: ValueV1, sourceDigest: digest,
    decision: { basis: Reallocation, effectiveAt: l.now, reason: reason, delta: 0,
      source: if (valueSource.valued) valueSource.source else pullRequest, valued: valueSource.valued },
    recipients: recipients, completeLines: completeLines, shares: A::allocatePoints(prior.amount, recipients) }, l)
pure def lawReallocationKeepsTotal(total: int, recipients: List[A::Recipient]): bool =
  A::canWriteAllocation(total, recipients, true, false) implies A::pointTotal(A::allocatePoints(total, recipients)) == total
```

### A source re-scored by the ingestion producer appends a reassessment

A resolved issue, material test, evidence or review award changes only with
fresh `SourceEvidence` for the same key. The original occurrence time never
moves. A frozen reward period refuses a changed amount. The producer's
scoring decision is optional, as in development's `applyPointsSnapshot`: a
re-score it supplies with no decision appends a successor with no decision;
one it supplies with a decision (`scoreDecisionSourceId`) appends a
reassessment under the v2 score carrying that decision's source, effective
time and reason, and a changed decision alone also appends. Applying a
snapshot never rewrites a key the retained batch owns (below); the retained
batch itself updates its own keys this way.

```quint
pure def canRescoreSource(l: Ledger, a: AwardInput, e: SourceEvidence, decision: Decision): bool =
  val prior = latest(l, a.key)
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  ordinaryCategory(a.key.category) and evidenceBinds(a, e) and e.actorKind == HumanActor and e.accepted and
  a.occurredAt == prior.occurredAt and
  amountAllowed(a.key.category, a.amount) and ruleAllowed(a.key.category, a.rule) and
  (decision.basis == NoBasis implies decision == noDecision) and
  (decision.basis != NoBasis implies (decision.basis == Reassessment and decision.reason != "" and decision.source != "" and
    decision.effectiveAt >= 0 and decision.effectiveAt <= l.now and decisionRule(a.key.category, a.rule))) and
  (a.provisional implies a.key.category == Review) and
  (a.amount != prior.amount or a.digest != prior.sourceDigest or a.provisional != prior.provisional or
    (decision.basis != NoBasis and (decision.source != prior.decision.source or
      decision.effectiveAt != prior.decision.effectiveAt or decision.reason != prior.decision.reason))) and
  (isFrozen(l, a.key.project, P::periodOf(prior.occurredAt)) implies a.amount == prior.amount)
pure def rescoreSource(l: Ledger, a: AwardInput, e: SourceEvidence, decision: Decision): Ledger =
  val prior = latest(l, a.key)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: a.key, amount: a.amount, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: a.rule, sourceDigest: a.digest, provisional: a.provisional,
    decision: if (decision.basis == NoBasis) noDecision else { ...decision, delta: a.amount - prior.amount } }, l)
```

### An evaluated award changes only by a reviewed manifest decision, an omission zero or the incident recovery

A later reviewed maintainer decision sets the admitted award's legacy
points. A retained batch that no longer supplies a batch-owned award, and a
complete snapshot that supersedes one it does not own, zero it (below). The 20 October 2026 retirement batch is the one exact erroneous
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
    decision: { basis: ManifestDecision, effectiveAt: l.now, reason: d.reason, delta: 30 * d.points - prior.amount,
      source: d.decision, valued: false } }, l)
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
    decision: { basis: RetirementBatch, effectiveAt: l.now, reason: "retired evaluator batch", delta: 0 - prior.amount,
      source: E::retirementZeroDigest, valued: false } }, l)
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
    decision: { basis: IncidentRecovery, effectiveAt: l.now, reason: reason, delta: retained.amount - prior.amount,
      source: "retired-evaluator-recovery-v1", valued: false } }, l)
```

### A penalty revision records the debit applied against the month's credit

The penalty journal supplies the item's table version, the published debit
request and whether it was reversed (an upheld appeal or a maintainer
reopen). The recorded amount is the applied debit: the request bounded by
what the actor's counted credit of the project and UTC month leaves after
the earlier requests, in order of occurrence and then work unit, as
development's `reconcilePointPenalties` consumes them; a reversal records
zero. Reconciliation appends a successor whenever the applied debit or the
reversal changes, so a later credit in the month is debited by an earlier
request. A penalty on work before the repository's start month is refused.
The request, table version, category and occurrence of a key never change,
and a reversal is final.

```quint
type PenaltyEvidence = { key: AwardKey, occurredAt: int, repositoryCountsFrom: int, tableVersion: int, requested: int,
  reversed: bool, digest: str, effectiveAt: int, reason: str }
pure def requestOf(p: PenaltyEvidence): int = if (p.reversed) 0 else p.requested
pure def effectiveRequest(r: Revision): int = if (r.reversed) 0 else r.debit
pure def earlierRequests(l: Ledger, k: AwardKey, occurredAt: int): int =
  l.revisions.foldl(0, (acc, o) => if (o.key.project == k.project and o.key.actor == k.actor and o.key.category == Penalty and
    isLatest(l, o) and P::periodOf(o.occurredAt) == P::periodOf(occurredAt) and
    (o.occurredAt < occurredAt or (o.occurredAt == occurredAt and o.key.workUnit < k.workUnit))) acc + effectiveRequest(o) else acc)
pure def boundedRequest(l: Ledger, k: AwardKey, occurredAt: int, request: int): int =
  val room = penaltyCredit(l, k.project, k.actor, P::periodOf(occurredAt)) - earlierRequests(l, k, occurredAt)
  if (request <= 0 or room <= 0) 0 else if (request < room) request else room
pure def penaltyAmount(l: Ledger, p: PenaltyEvidence): int = 0 - boundedRequest(l, p.key, p.occurredAt, requestOf(p))
pure def canRecordPenalty(l: Ledger, p: PenaltyEvidence): bool =
  val prior = latest(l, p.key)
  val amount = penaltyAmount(l, p)
  validKey(p.key) and p.key.category == Penalty and p.tableVersion > 0 and p.digest != "" and
  p.requested >= 1 and p.requested <= P::maxSafe and p.reason != "" and
  p.occurredAt >= p.repositoryCountsFrom and
  p.occurredAt >= 0 and p.occurredAt <= l.now and p.effectiveAt >= p.occurredAt and p.effectiveAt <= l.now and
  prior.id >= 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.amount <= 0 and
  (prior.id > 0 implies (prior.tableVersion == p.tableVersion and prior.occurredAt == p.occurredAt and
     prior.debit == p.requested and (prior.reversed implies p.reversed) and
     (amount != prior.amount or p.reversed != prior.reversed))) and
  (prior.id == 0 implies prior.amount == 0)
pure def recordPenalty(l: Ledger, p: PenaltyEvidence): Ledger =
  val prior = latest(l, p.key)
  val amount = penaltyAmount(l, p)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: p.key, amount: amount, priorAmount: prior.amount,
    occurredAt: p.occurredAt, recordedAt: l.now, rule: PenaltyTable, tableVersion: p.tableVersion,
    sourceDigest: p.digest, debit: p.requested, reversed: p.reversed,
    decision: { basis: PenaltyChange, effectiveAt: p.effectiveAt, reason: p.reason, delta: amount - prior.amount,
      source: p.digest, valued: false } }, l)
```

### A retained-batch award the batch no longer supplies is zeroed once

A key is owned by the retained review and evaluator batch when its latest
revision is positive, a review or evaluated award under the v2 score, with a
digest no applied snapshot recorded in its coverage and no value decision.
A retained batch appends, with its own digest, the v2 score and no decision,
one zero successor for each owned key it does not supply, unless the key's
project is no longer listed. An award already zero is not owned, so a replay
appends nothing. A frozen reward period refuses it.

```quint
type RetainedBatch = { digest: str, supplied: List[AwardKey], listedProjects: Set[str] }
pure def batchOwned(l: Ledger, k: AwardKey): bool =
  val r = latest(l, k)
  r.id > 0 and r.amount > 0 and (k.category == Review or k.category == Evaluated) and r.rule == ScoreV2 and
  not(l.coverage.contains(r.sourceDigest)) and not(r.decision.valued)
pure def canZeroRetainedOmission(l: Ledger, k: AwardKey, batch: RetainedBatch): bool =
  val prior = latest(l, k)
  validKey(k) and batchOwned(l, k) and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and
  prior.occurredAt <= l.now and batch.digest != "" and not(batch.supplied.includes(k)) and
  batch.listedProjects.contains(k.project) and not(isFrozen(l, k.project, P::periodOf(prior.occurredAt)))
pure def zeroRetainedOmission(l: Ledger, k: AwardKey, batch: RetainedBatch): Ledger =
  val prior = latest(l, k)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: k, amount: 0, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: batch.digest,
    provisional: prior.provisional }, l)
pure def sometimesRetainedOmissionZeroed(l: Ledger): bool =
  l.revisions.some(r => r.key.category == Review and r.amount == 0 and r.previous > 0 and r.decision.basis == NoBasis)
```

### A complete newer snapshot zeroes superseded credit inside its window

A complete snapshot of a collected project zeroes a positive latest award
it no longer contains (not payout recognition, not a penalty, not owned by
the retained batch) when the award occurred inside the snapshot's window,
or is a review with an adverse exclusion. A pull request's award is zeroed
only when its value coverage is assessed, human-ratified or legacy-policy,
or a stale or incomplete coverage invalidates its joint decision, or a
merge now scored by its own record absorbs its joint unit: a missing
valuation, or a pull request absent from coverage, never zeroes it, and a
held unassessed pool is skipped. A review omitted for the value policy
boundary or for the window never zeroes; the omission must agree with the
recorded occurrence and the policy boundary, or the whole snapshot is
refused. The zero carries the superseding decision when there is one. A
frozen reward period refuses it.

```quint
type SourceCoverage = CoverageNotApplicable | CoverageAbsent | CoverageAssessed | CoverageRatified | CoverageLegacy |
  CoverageStale | CoverageIncomplete | CoverageMissing
type ReviewOmission = NotOmitted | OmittedBeforePolicy | OmittedOutsideWindow | AdverseExclusion
type Supersession = { snapshotDigest: str, windowFrom: int, windowTo: int, policyFrom: int, supplied: List[AwardKey],
  projectCollected: bool, heldPool: bool, coverage: SourceCoverage, invalidatesJoint: bool, ownRecordAbsorbs: bool,
  review: ReviewOmission, decision: Decision }
pure def inWindow(at: int, snapshot: Supersession): bool = at >= snapshot.windowFrom and at < snapshot.windowTo
pure def coverageAllowsZero(snapshot: Supersession): bool =
  snapshot.coverage == CoverageNotApplicable or snapshot.coverage == CoverageAssessed or
  snapshot.coverage == CoverageRatified or snapshot.coverage == CoverageLegacy or
  snapshot.invalidatesJoint or snapshot.ownRecordAbsorbs
pure def omissionAgrees(at: int, snapshot: Supersession): bool =
  if (snapshot.review == OmittedBeforePolicy) snapshot.policyFrom >= P::september2026Start and at < snapshot.policyFrom
  else if (snapshot.review == OmittedOutsideWindow) not(inWindow(at, snapshot))
  else true
pure def supersedingDecision(snapshot: Supersession, prior: Revision): Decision =
  if (snapshot.decision.basis == NoBasis) noDecision else { ...snapshot.decision, delta: 0 - prior.amount }
pure def snapshotMayZero(cat: Category, inside: bool, snapshot: Supersession): bool =
  cat != PayoutReceived and cat != Penalty and snapshot.snapshotDigest != "" and snapshot.windowFrom < snapshot.windowTo and
  snapshot.projectCollected and not(snapshot.heldPool) and
  (snapshot.review == NotOmitted or (cat == Review and snapshot.review == AdverseExclusion)) and
  (inside or (cat == Review and snapshot.review == AdverseExclusion)) and
  coverageAllowsZero(snapshot)
pure def canZeroSuperseded(l: Ledger, k: AwardKey, snapshot: Supersession): bool =
  val prior = latest(l, k)
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  validKey(k) and prior.amount > 0 and not(batchOwned(l, k)) and not(snapshot.supplied.includes(k)) and
  snapshotMayZero(k.category, inWindow(prior.occurredAt, snapshot), snapshot) and
  (snapshot.decision.basis == NoBasis implies snapshot.decision == noDecision) and
  (snapshot.decision.basis != NoBasis implies (snapshot.decision.basis == Superseded and snapshot.decision.source != "" and
    snapshot.decision.reason != "" and snapshot.decision.effectiveAt <= l.now)) and
  not(isFrozen(l, k.project, P::periodOf(prior.occurredAt)))
pure def zeroSuperseded(l: Ledger, k: AwardKey, snapshot: Supersession): Ledger =
  val prior = latest(l, k)
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: k, amount: 0, priorAmount: prior.amount,
    occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: snapshot.snapshotDigest,
    provisional: prior.provisional, decision: supersedingDecision(snapshot, prior), recipients: prior.recipients,
    completeLines: prior.completeLines, shares: A::allocatePoints(0, prior.recipients) }, l)
pure def lawPolicyOmissionNeverZeroes(cat: Category, inside: bool, snapshot: Supersession): bool =
  (snapshot.review == OmittedBeforePolicy or snapshot.review == OmittedOutsideWindow) implies
    not(snapshotMayZero(cat, inside, snapshot))
pure def lawMissingValuationNeverZeroes(cat: Category, inside: bool, snapshot: Supersession): bool =
  ((snapshot.coverage == CoverageAbsent or snapshot.coverage == CoverageMissing) and not(snapshot.invalidatesJoint) and
    not(snapshot.ownRecordAbsorbs)) implies not(snapshotMayZero(cat, inside, snapshot))
pure def sometimesSupersededZeroed(l: Ledger): bool =
  l.revisions.some(r => r.amount == 0 and r.previous > 0 and r.decision.basis == Superseded)
pure def sometimesReviewSupersededZeroed(l: Ledger): bool =
  l.revisions.some(r => r.key.category == Review and r.amount == 0 and r.previous > 0 and r.sourceDigest == "s1")
pure def sometimesJointAbsorbedOwnRecord(l: Ledger): bool =
  l.units.units.some(u => u.superseded and unitCredited(l, u.id) and latest(l, unitKey(u.project, u.id)).amount == 0) and
  l.revisions.some(r => r.key.category == MergedWork and r.amount > 0 and isLatest(l, r))
```

### An owner-reviewed duplicate retirement zeroes the October pool it covers

The [reviewed historical runner](./reviewedHistory.md) zeroes a source's
October implementation pool when every claim is already covered by an
earlier accepted source, with the decision `owner_duplicate_<dossier digest>`
and the v2 score, only inside a reviewed packet that applies
(`reconstructHistoricalPoints` refuses the whole packet otherwise). The
retirement names the unit's source. The pool must be positive and in October
2026. A frozen reward period refuses it.

```quint
pure def canRetireDuplicate(l: Ledger, project: str, unit: int, retirement: RH::Retirement, packetRun: RH::PacketRun,
    reason: str, digest: str): bool =
  val prior = latest(l, unitKey(project, unit))
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  project != "" and unit > 0 and prior.amount > 0 and P::periodOf(prior.occurredAt) == P::october2026 and
  retirement.source == unit and RH::retirementApplies(retirement) and RH::packetApplies(packetRun) and
  reason != "" and digest != "" and not(isFrozen(l, project, P::periodOf(prior.occurredAt)))
pure def retireDuplicate(l: Ledger, project: str, unit: int, retirement: RH::Retirement, packetRun: RH::PacketRun,
    reason: str, digest: str): Ledger =
  val prior = latest(l, unitKey(project, unit))
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: unitKey(project, unit), amount: 0,
    priorAmount: prior.amount, occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: digest,
    decision: { basis: DuplicateRetirement, effectiveAt: l.now, reason: reason, delta: 0 - prior.amount, source: digest,
      valued: false },
    recipients: prior.recipients, completeLines: prior.completeLines, shares: A::allocatePoints(0, prior.recipients) }, l)
pure def sometimesDuplicateRetired(l: Ledger): bool = l.revisions.some(r => r.decision.basis == DuplicateRetirement)
```

### An owner-reviewed recipient correction redivides the October pool it covers

The [reviewed historical runner](./reviewedHistory.md) redivides a source's
October implementation pool, unchanged since the owner's review, between the
reviewed recipients by their reviewed weights. The pool keeps its total; the
revision is recorded under the v2 score with the decision
`owner_october_<dossier digest>`, with the reviewed shares, only inside a
reviewed packet that applies. A frozen reward period refuses it.

```quint
pure def canCorrectRecipients(l: Ledger, project: str, unit: int, correction: RH::RecipientCorrection,
    packetRun: RH::PacketRun, reason: str, digest: str): bool =
  val prior = latest(l, unitKey(project, unit))
  prior.id > 0 and prior.id < l.nextId and prior.recordedAt <= l.now and prior.occurredAt >= 0 and prior.occurredAt <= l.now and
  project != "" and unit > 0 and prior.amount >= 10 and prior.amount <= P::maxSafe and correction.pool == prior.amount and
  P::periodOf(prior.occurredAt) == P::october2026 and RH::recipientCorrectionApplies(correction) and
  RH::packetApplies(packetRun) and A::canWriteAllocation(prior.amount, correction.recipients, true, false) and
  reason != "" and digest != "" and not(isFrozen(l, project, P::periodOf(prior.occurredAt)))
pure def correctRecipients(l: Ledger, project: str, unit: int, correction: RH::RecipientCorrection,
    packetRun: RH::PacketRun, reason: str, digest: str): Ledger =
  val prior = latest(l, unitKey(project, unit))
  appendRevision({ ...noRevision, id: l.nextId, previous: prior.id, key: unitKey(project, unit), amount: prior.amount,
    priorAmount: prior.amount, occurredAt: prior.occurredAt, recordedAt: l.now, rule: ScoreV2, sourceDigest: digest,
    decision: { basis: Reallocation, effectiveAt: l.now, reason: reason, delta: 0, source: digest, valued: false },
    recipients: correction.recipients, completeLines: true,
    shares: RH::correctedShares(correction) }, l)
pure def sometimesOwnerCorrected(l: Ledger): bool =
  l.revisions.some(r => r.key.category == MergedWork and r.rule == ScoreV2 and r.decision.basis == Reallocation)
```

### Payout recognition is appended once per recipient, project and cycle

The [payout recognition record](./payoutRecognition.md) is the only producer.
It supplies the verified paid cycle, or a finalized ordinary monthly vault
payment; the work unit and source are the month (a cycle is a month).
Recognition is appended once per project, month and actor over every earlier
payout revision, whichever source and network supplied it, and is never
withdrawn. Recognition never counts as accepted work. An actor number is the
interned code-unit rank of a GitHub node ID (see [allocation](./allocation.md)),
so the model compares node IDs: development keys the check on the numeric
GitHub ID decoded from any node-ID spelling (`githubUserIdFromNodeId`), and
treating two spellings of one numeric ID as one actor is the adapter's
obligation, which this model does not express.

```quint
pure def recognitionKey(paid: PR::PaidRecipient): AwardKey =
  { project: paid.project, actor: paid.actor, category: PayoutReceived, source: paid.cycle, workUnit: paid.cycle }
pure def recognizedIn(l: Ledger, project: str, month: int, actor: int): bool =
  l.revisions.some(r => r.key.category == PayoutReceived and r.key.project == project and r.key.source == month and
    r.key.actor == actor)
pure def canRecognize(l: Ledger, paid: PR::PaidRecipient): bool =
  PR::eligible(paid) and paid.settledAt <= l.now and not(recognizedIn(l, paid.project, paid.cycle, paid.actor))
pure def recognize(l: Ledger, paid: PR::PaidRecipient): Ledger =
  appendRevision({ ...noRevision, id: l.nextId, key: recognitionKey(paid), amount: PR::recognitionAmount(paid),
    occurredAt: paid.settledAt, recordedAt: l.now, rule: VerifiedPayoutV1, sourceDigest: paid.settlementDigest }, l)
pure def vaultKey(v: PR::VaultPayment): AwardKey =
  { project: v.project, actor: v.actor, category: PayoutReceived, source: v.month, workUnit: v.month }
pure def canRecognizeVaultPayment(l: Ledger, v: PR::VaultPayment): bool =
  PR::vaultEligible(v) and v.indexedAt <= l.now and not(recognizedIn(l, v.project, v.month, v.actor))
pure def recognizeVaultPayment(l: Ledger, v: PR::VaultPayment): Ledger =
  appendRevision({ ...noRevision, id: l.nextId, key: vaultKey(v), amount: PR::vaultRecognitionAmount(v),
    occurredAt: v.indexedAt, recordedAt: l.now, rule: VerifiedPayoutV1, sourceDigest: v.digest }, l)
pure def alwaysRecognizedOncePerMonth(l: Ledger): bool = l.revisions.every(r => r.key.category == PayoutReceived implies
  l.revisions.select(o => o.key.category == PayoutReceived and o.key.project == r.key.project and
    o.key.source == r.key.source and o.key.actor == r.key.actor).length() == 1)
```

### A frozen reward period, a removed PR and a ban never rewrite recorded Points

Monthly settlement supplies the freeze when the month's allocation is
frozen, reserved or completed, or an approved, funded, scheduled or paid
obligation exists. A freeze is never lifted, and it also freezes the
project's accepted units of that month. A removal or ban observation records
the fact and appends no revision. A removed PR has no value coverage, so a
snapshot that omits it never zeroes its award; recording a snapshot's
coverage digests appends nothing either.

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
pure def canRecordSnapshotCoverage(l: Ledger, snapshotDigest: str): bool =
  snapshotDigest != "" and not(l.coverage.contains(snapshotDigest))
pure def recordSnapshotCoverage(l: Ledger, snapshotDigest: str): Ledger =
  { ...l, coverage: l.coverage.union(Set(snapshotDigest)) }
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
  before.admitted.every(m => after.admitted.includes(m)) and before.coverage.subseteq(after.coverage)
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
   via == "recordPromotion" or via == "holdPromotion" or via == "acceptUnit" or via == "admitManifest" or
   via == "recordSnapshotCoverage") implies
    after.revisions == before.revisions
pure def alwaysFrozenPeriodsValid(l: Ledger): bool = l.frozen.every(f => f.project != "" and f.period >= 0)
```

### Public totals are views of the latest revisions, with penalties bounded by the month's credit

A merged-work revision credits each recipient its share. The earned awards
of an actor are counted once per group of project, category, month of the
award for a value-decided key, and canonical review for a non-provisional
review or else work unit: the group keeps the highest amount, then the
earlier occurrence, then the smaller source, then the key recorded first. A
review is not counted when the same actor holds a positive evaluated award
for the same review. Recorded penalty amounts, already the debits applied
against the month's counted credit, add by signed sum. An actor whose only
awards are value-decided zeros is still a member, with total zero. The
counted credit of a month bounds penalties; reward weights keep their own
accepted-work credit and requests.

```quint
pure def isLatest(l: Ledger, r: Revision): bool = latest(l, r.key).id == r.id
pure def shareOf(shares: List[A::PointShare], actor: int): int =
  shares.foldl(0, (acc, s) => if (s.actor == actor) acc + s.points else acc)
pure def actorAmount(r: Revision, actor: int): int =
  if (r.key.category == MergedWork) shareOf(r.shares, actor) else if (r.key.actor == actor) r.amount else 0
pure def involves(r: Revision, actor: int): bool =
  if (r.key.category == MergedWork) r.shares.some(x => x.actor == actor) else r.key.actor == actor
pure def valueMonth(r: Revision): int = if (r.decision.valued) P::periodOf(r.occurredAt) else -1
pure def groupUnit(r: Revision): int = if (r.key.category == Review and not(r.provisional)) r.key.source else r.key.workUnit
pure def sameGroup(o: Revision, r: Revision): bool =
  o.key.project == r.key.project and o.key.category == r.key.category and valueMonth(o) == valueMonth(r) and
  groupUnit(o) == groupUnit(r)
pure def firstIdOf(l: Ledger, k: AwardKey): int = l.revisions.foldl(0, (acc, x) => if (acc == 0 and x.key == k) x.id else acc)
pure def suppressedReview(l: Ledger, r: Revision, actor: int): bool =
  r.key.category == Review and l.revisions.some(o => o.key.category == Evaluated and o.key.actor == actor and o.amount > 0 and
    o.key.source == r.key.source and isLatest(l, o))
pure def earned(l: Ledger, r: Revision, actor: int): bool =
  r.key.category != Penalty and actorAmount(r, actor) > 0 and isLatest(l, r) and not(suppressedReview(l, r, actor))
pure def beats(l: Ledger, o: Revision, r: Revision, actor: int): bool =
  val a = actorAmount(o, actor)
  val b = actorAmount(r, actor)
  a > b or (a == b and (o.occurredAt < r.occurredAt or (o.occurredAt == r.occurredAt and
    (o.key.source < r.key.source or (o.key.source == r.key.source and firstIdOf(l, o.key) < firstIdOf(l, r.key))))))
pure def counted(l: Ledger, r: Revision, actor: int): bool =
  earned(l, r, actor) and not(l.revisions.some(o => o.id != r.id and sameGroup(o, r) and earned(l, o, actor) and beats(l, o, r, actor)))
pure def acceptedWorkCredit(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and acceptedWork(r.key.category) and
    P::periodOf(r.occurredAt) == period and isLatest(l, r)) acc + actorAmount(r, actor) else acc)
pure def penaltyCredit(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and r.key.category != PayoutReceived and
    P::periodOf(r.occurredAt) == period and counted(l, r, actor)) acc + actorAmount(r, actor) else acc)
pure def penaltyRequested(l: Ledger, project: str, actor: int, period: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.project == project and r.key.actor == actor and
    r.key.category == Penalty and P::periodOf(r.occurredAt) == period and isLatest(l, r)) acc + effectiveRequest(r) else acc)
pure def boundedDebit(credit: int, requested: int): int =
  if (credit <= 0) 0 else if (requested < credit) requested else credit
pure def penaltyDebit(l: Ledger, project: str, actor: int, period: int): int =
  boundedDebit(acceptedWorkCredit(l, project, actor, period), penaltyRequested(l, project, actor, period))
pure def appliedDebit(l: Ledger, r: Revision): int = boundedRequest(l, r.key, r.occurredAt, effectiveRequest(r))
pure def isMember(l: Ledger, actor: int): bool =
  l.revisions.some(r => counted(l, r, actor) or (r.decision.valued and r.amount == 0 and involves(r, actor) and isLatest(l, r)))
pure def publicTotal(l: Ledger, actor: int): int =
  l.revisions.foldl(0, (acc, r) => if (r.key.category == Penalty and r.key.actor == actor and isLatest(l, r)) acc + r.amount
    else if (counted(l, r, actor)) acc + actorAmount(r, actor) else acc)
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
  r.amount < 0 and 0 - r.amount < effectiveRequest(r))
pure def sometimesPenaltyReversed(l: Ledger): bool = l.revisions.some(r => r.key.category == Penalty and r.reversed and r.previous > 0)
pure def sometimesVaultRecognized(l: Ledger): bool = l.revisions.some(r => r.key.category == PayoutReceived and r.sourceDigest == "vault")
pure def sometimesValueZeroMember(l: Ledger): bool = l.revisions.some(r => isLatest(l, r) and r.decision.valued and r.amount == 0)
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
    projectCollected: true, rule: ScoreV2, provisional: false, digest: "u3" },
  { project: "p", unit: 1, recipients: twoRecipients, completeLines: true, occurredAt: 2432110, repositoryCountsFrom: 2432000,
    projectCollected: true, rule: ScoreV2, provisional: false, digest: "u4" })
pure val sValues = Set({ ...SP::initial, phase: SP::Assessed, project: "p", unit: 1, head: "h", acceptedAt: 2432005, points: 90 },
  { ...SP::initial, phase: SP::Ratified, project: "p", unit: 1, head: "h", acceptedAt: 2432005, points: 30 },
  { ...SP::initial, phase: SP::Provisional, project: "p", unit: 1, head: "h", acceptedAt: 2432005, points: 10 },
  { ...SP::initial, phase: SP::LegacyScored, project: "p", unit: 1, head: "h", acceptedAt: 2432005, legacyPoints: 30, points: 30 })
pure val recipientsValues = Set(List({ actor: 2, lines: 1 }), twoRecipients)
pure val completeLinesValues = Set(true, false)
pure val reasonValues = Set("checked", "")
pure val digestValues = Set("d9")
pure val pullRequestValues = Set("PR_kwDOAAAB")
pure val snapshotDigestValues = Set("r1", "r2", "s1")
pure val decisionValues = Set(noDecision,
  { basis: Reassessment, effectiveAt: 2432000, reason: "scored", delta: 0, source: "value:r2", valued: true },
  { basis: Reassessment, effectiveAt: 2432000, reason: "", delta: 0, source: "value:r2", valued: true })
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
pure val kValues = Set(keyEval, keyReview, unitKey("p", 1))
pure val batchValues = Set({ digest: "b1", supplied: List(), listedProjects: Set("p") },
  { digest: "b2", supplied: List(keyReview), listedProjects: Set("p") }, { digest: "b3", supplied: List(), listedProjects: Set("q") })
pure val supersedingSample: Supersession = { snapshotDigest: "s1", windowFrom: 2432000, windowTo: 2432200, policyFrom: 2432000,
  supplied: List(), projectCollected: true, heldPool: false, coverage: CoverageAssessed, invalidatesJoint: false,
  ownRecordAbsorbs: false, review: NotOmitted,
  decision: { basis: Superseded, effectiveAt: 2432000, reason: "superseded", delta: 0, source: "value:s1", valued: true } }
pure val snapshotValues = Set(supersedingSample, { ...supersedingSample, decision: noDecision, coverage: CoverageLegacy },
  { ...supersedingSample, coverage: CoverageMissing, ownRecordAbsorbs: true },
  { ...supersedingSample, coverage: CoverageAbsent }, { ...supersedingSample, review: OmittedOutsideWindow },
  { ...supersedingSample, windowFrom: 2432100, review: AdverseExclusion })
pure val retirementValues = Set(RH::readyRetirement, { ...RH::readyRetirement, claimedPaths: 2 })
pure val packetRunValues = Set(RH::readyRun, { ...RH::readyRun, candidateMatches: false })
pure val ownerCorrection: RH::RecipientCorrection = { ...RH::readyCorrection, pool: 10,
  recipients: List({ actor: 1, lines: 1 }, { actor: 2, lines: 2 }),
  reviewedShares: List({ actor: 1, points: 3 }, { actor: 2, points: 7 }) }
pure val correctionValues = Set(ownerCorrection, { ...ownerCorrection, poolUnchanged: false }, { ...ownerCorrection, pool: 30 })
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
