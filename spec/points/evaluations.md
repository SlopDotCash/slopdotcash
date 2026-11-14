# Evaluation manifests

PRD section 7 uses reviewed evaluation manifests only for useful work that
ordinary scoring does not cover, and never rewards a source twice. Unusual
useful work may score only through a strict reviewed `evaluations/` manifest
(CLAUDE.md, "Scoring and work selection"). This machine follows
`src/lib/evaluator-awards.ts` (manifest validation and duplicate refusal) and
`scripts/generate-points.ts` (`retiredEvaluatorAwards`, the retired-evaluator
incident and its recovery), and the legacy `evaluated_award_import` and
`points_retained_provenance` models.

The maintainer-reviewed manifest merged into the repository is the only
source: raw model output never reaches the ledger. The [Points
journal](./journal.md) refuses an evaluated credit for a source that already
has ordinary credit, and ordinary credit for a source that has an evaluation.
The repository review that merged the manifest is verified by the repository
check; the manifest names the reviewer, the decision and the reason.

## Story: Import reviewed evaluation awards once and recover the retirement incident

### A manifest is admitted only with a review, a bounded award and evidence in time order

The manifest's award is 1 to 8 legacy points, 30 Slop Points each. Its
review cannot precede the contribution. External evidence is captured
between the contribution and its review.

```quint
type SourceKind = PullRequestSource | IssueSource | ReviewSource | CommentSource | ExternalSource
type ActorKind = User | Bot
type Manifest = { id: int, project: str, actor: int, actorKind: ActorKind, source: int, kind: SourceKind,
  workKey: int, contentDigest: int, pullRequest: int, points: int, occurredAt: int, capturedAt: int,
  reviewedAt: int, reviewer: int, decision: str, reason: str }
pure def slopPoints(m: Manifest): int = 30 * m.points
pure def wellFormed(m: Manifest): bool =
  m.id > 0 and m.project != "" and m.actor > 0 and m.actorKind == User and m.source > 0 and m.workKey > 0 and
  m.points >= 1 and m.points <= 8 and m.occurredAt >= 0 and m.reviewedAt >= m.occurredAt and
  m.reviewer > 0 and m.decision != "" and m.reason != "" and
  (m.kind == ExternalSource implies (m.contentDigest > 0 and m.capturedAt >= m.occurredAt and m.capturedAt <= m.reviewedAt)) and
  (m.kind != ExternalSource implies (m.contentDigest == 0 and m.capturedAt == 0)) and
  (m.kind == ReviewSource implies m.pullRequest > 0)
pure def lawAwardBounds(m: Manifest): bool = wellFormed(m) implies (slopPoints(m) >= 30 and slopPoints(m) <= 240)
```

### Identity, source, work, content and reviewer-per-PR are each awarded once

```quint
type Evaluations = { admitted: List[Manifest] }
pure def duplicates(s: Evaluations, m: Manifest): bool = s.admitted.some(o =>
  o.id == m.id or o.source == m.source or o.workKey == m.workKey or
  (m.contentDigest > 0 and o.project == m.project and o.contentDigest == m.contentDigest) or
  (m.kind == ReviewSource and o.kind == ReviewSource and o.project == m.project and o.actor == m.actor and o.pullRequest == m.pullRequest))
pure def admissible(s: Evaluations, m: Manifest): bool = wellFormed(m) and not(duplicates(s, m))
pure def admittedUnique(s: Evaluations): bool = s.admitted.every(m => wellFormed(m) and
  s.admitted.select(o => o.id == m.id or o.source == m.source or o.workKey == m.workKey).length() == 1)
```

### Awards retained before retirement survive the erroneous zeroing batch

The 19 October 2026 retirement of the evaluator manifests did not revoke
their awards. One exact later batch zeroed some of them in error. Recovery
restores the amount retained before retirement, once. Any other later
revision of the award, including an explicit zero or an unchanged
maintainer decision, ends the protection, and an unrelated zero never
recovers.

```quint
type Protection = Retained | IncidentZeroed | Recovered | Ended
type Retirement = { key: int, amount: int, phase: Protection, endedAfter: Protection }
type RetiredAwards = { evaluations: Evaluations, awards: List[Retirement] }
pure val initial: RetiredAwards = { evaluations: { admitted: List() }, awards: List() }
pure def canAdmitManifest(s: RetiredAwards, m: Manifest): bool = admissible(s.evaluations, m)
pure def admitManifest(s: RetiredAwards, m: Manifest): RetiredAwards =
  { ...s, evaluations: { admitted: s.evaluations.admitted.append(m) } }
pure def tracked(s: RetiredAwards, key: int): bool = s.awards.some(a => a.key == key)
pure def phaseOf(s: RetiredAwards, key: int): Protection =
  s.awards.foldl(Ended, (acc, a) => if (a.key == key) a.phase else acc)
pure def setPhase(key: int, phase: Protection, s: RetiredAwards): RetiredAwards =
  { ...s, awards: s.awards.listMap(a => if (a.key == key) { ...a, phase: phase } else a) }
pure def canRetain(s: RetiredAwards, key: int, amount: int): bool = key > 0 and amount > 0 and not(tracked(s, key))
pure def retain(s: RetiredAwards, key: int, amount: int): RetiredAwards =
  { ...s, awards: s.awards.append({ key: key, amount: amount, phase: Retained, endedAfter: Retained }) }
pure def canIncidentZero(s: RetiredAwards, key: int): bool = tracked(s, key) and phaseOf(s, key) == Retained
pure def incidentZero(s: RetiredAwards, key: int): RetiredAwards = setPhase(key, IncidentZeroed, s)
pure def canRecover(s: RetiredAwards, key: int): bool = tracked(s, key) and phaseOf(s, key) == IncidentZeroed
pure def recover(s: RetiredAwards, key: int): RetiredAwards = setPhase(key, Recovered, s)
pure def canLaterDecision(s: RetiredAwards, key: int): bool = tracked(s, key) and phaseOf(s, key) != Ended
pure def laterDecision(s: RetiredAwards, key: int): RetiredAwards =
  { ...s, awards: s.awards.listMap(a => if (a.key == key) { ...a, phase: Ended, endedAfter: a.phase } else a) }
pure def alwaysRetainedPositive(s: RetiredAwards): bool = s.awards.every(a => a.key > 0 and a.amount > 0 and
  s.awards.select(o => o.key == a.key).length() == 1)
pure def alwaysAdmittedWellFormed(s: RetiredAwards): bool = admittedUnique(s.evaluations)
pure def stepAdmittedPermanent(before: RetiredAwards, after: RetiredAwards): bool =
  before.evaluations.admitted.every(m => after.evaluations.admitted.includes(m))
pure def stepProtectionEndsForever(before: RetiredAwards, after: RetiredAwards): bool =
  before.awards.every(a => a.phase == Ended implies after.awards.includes(a)) and
  before.awards.every(a => a.phase == Recovered implies after.awards.some(b => b.key == a.key and (b.phase == Recovered or b.phase == Ended)))
pure def stepAmountsRetained(before: RetiredAwards, after: RetiredAwards): bool =
  before.awards.every(a => after.awards.some(b => b.key == a.key and b.amount == a.amount))
pure def sometimesRecovered(s: RetiredAwards): bool = s.awards.some(a => a.phase == Recovered)
pure def sometimesExplicitDecisionEndsRecovery(s: RetiredAwards): bool = s.awards.some(a => a.phase == Ended and a.endedAfter == IncidentZeroed)
pure def sometimesUnrelatedDecisionNeverRecovers(s: RetiredAwards): bool = s.awards.some(a => a.phase == Ended and a.endedAfter == Retained)
pure def sometimesAdmitted(s: RetiredAwards): bool = s.evaluations.admitted.length() > 1
```

### Simulation samples include duplicates, unreviewed and early-review manifests

```quint
pure val manifestSample: Manifest = { id: 1, project: "p", actor: 1, actorKind: User, source: 10, kind: ReviewSource,
  workKey: 100, contentDigest: 0, pullRequest: 5, points: 2, occurredAt: 2432005, capturedAt: 0,
  reviewedAt: 2432006, reviewer: 9, decision: "review", reason: "useful" }
pure val mValues = Set(manifestSample,
  { ...manifestSample, id: 2, source: 11, workKey: 101 },
  { ...manifestSample, id: 3, source: 12, workKey: 102, pullRequest: 6 },
  { ...manifestSample, id: 4, source: 13, workKey: 103, kind: ExternalSource, contentDigest: 7, capturedAt: 2432005, pullRequest: 0 },
  { ...manifestSample, id: 5, source: 14, workKey: 104, reviewer: 0 },
  { ...manifestSample, id: 6, source: 15, workKey: 105, reviewedAt: 2432004 },
  { ...manifestSample, id: 7, source: 16, workKey: 106, points: 9 })
pure val keyValues = Set(1, 2)
pure val amountValues = Set(0, 30)
```
