# Scoring policy versions and historical rescoring

PRD sections 5 and 7 and the owner decisions of 24 and 25 October 2026
(`src/lib/scoring-policy.ts`). Work accepted before 1 September 2026 keeps
the Slop Score v2 rules. Eligible unpaid work accepted from 1 September
through 31 October 2026 takes the current size bands once its historical
import is released. Work accepted from 1 November 2026 is scored from
Slopbot's source-bound value assessment. A valid maintainer ratification is
the exception that takes precedence. Approved, funded, scheduled and paid
awards keep their original Points. Held or unassessed pre-November sources
keep their earlier Points. Every accepted merge keeps at least 10 Points.

Paid API assessment begins on 1 November 2026. September and October
assessments come from subscription subagents, and a subscription declaration
is never an API receipt or billing proof. This machine represents one
accepted merged PR or grouped work unit. Its evidence records come from the
Slopbot value journal ([value inference](../slopbot/valueInference.md)) and
the ratification record with the maintainer's GitHub permission as read by
the authority verifier ([projects](../backend/projects.md)) for the same
project. Both name the exact accepted head they assessed. The [historical
import](./historicalImport.md) releases a September–October rescoring: its
released import record must list this source. The freeze comes from monthly
settlement through [periods](./periods.md). The [Points journal](./journal.md)
reads this state as the evidence of a `Reassessment` or `Ratification`
correction.

## Story: Score each accepted source under the policy of its acceptance time

### The acceptance instant selects the policy

```quint
import periods as P from "./periods"
import allocation as A from "./allocation"
import historicalImport as HI from "./historicalImport"
type Policy = LegacyV2 | HistoricalValue | ValueV1
pure def policyFor(acceptedAt: int): Policy =
  if (acceptedAt < P::september2026Start) LegacyV2
  else if (acceptedAt < P::november2026Start) HistoricalValue
  else ValueV1
pure def lawPolicyBoundaries(acceptedAt: int): bool =
  (acceptedAt >= P::november2026Start implies policyFor(acceptedAt) == ValueV1) and
  (acceptedAt < P::september2026Start implies policyFor(acceptedAt) == LegacyV2)
pure val acceptedAtValues = Set(2431915, 2432000, 2432130, 2432200, 2432210)
```

### A scored source records its provenance and keeps the 10-Point minimum

A legacy-scored source keeps the amount the v2 rules gave it (including its
legacy category caps), supplied by the frozen v2 scorer. A new merge without
a current assessment is provisional at 10 Points.

```quint
type Provenance = Unscored | LegacyScored | Provisional | Assessed | Ratified
type AssessmentSource = SubscriptionDeclared | PaidApiReceipt
type Permission = NoPermission | ReadPermission | WritePermission | MaintainPermission | AdminPermission
type AcceptedSource = { project: str, unit: int, head: str, acceptedAt: int }
type Assessment = { band: int, source: AssessmentSource, sourceDigest: str, rubric: str, model: str, head: str }
type AuthorityEvidence = { maintainer: int, project: str, permission: Permission }
type Ratification = { band: int, maintainer: int, head: str, record: str, authority: AuthorityEvidence }
type Scored = { phase: Provenance, project: str, unit: int, head: str, acceptedAt: int, policy: Policy, legacyPoints: int,
  points: int, frozen: bool, frozenPoints: int, held: bool, pendingBand: int, rubric: str, model: str, billingProven: bool,
  jointWithheld: bool }
pure val initial: Scored = { phase: Unscored, project: "", unit: 0, head: "", acceptedAt: 0, policy: LegacyV2, legacyPoints: 0,
  points: 0, frozen: false, frozenPoints: 0, held: false, pendingBand: -1, rubric: "", model: "", billingProven: false,
  jointWithheld: false }
pure def canAccept(s: Scored, src: AcceptedSource, legacyPoints: int): bool =
  s.phase == Unscored and src.acceptedAt > 0 and src.project != "" and src.unit > 0 and src.head != "" and legacyPoints >= 10
pure def accept(s: Scored, src: AcceptedSource, legacyPoints: int): Scored =
  val base = { ...s, project: src.project, unit: src.unit, head: src.head, acceptedAt: src.acceptedAt, legacyPoints: legacyPoints }
  if (policyFor(src.acceptedAt) == ValueV1) { ...base, phase: Provisional, policy: ValueV1, points: 10 }
  else { ...base, phase: LegacyScored, policy: policyFor(src.acceptedAt), points: legacyPoints }
pure def alwaysMinimum(s: Scored): bool = s.phase != Unscored implies s.points >= 10
pure def alwaysUnscoredUntouched(s: Scored): bool = s.phase == Unscored implies
  (not(s.frozen) and not(s.held) and not(s.billingProven) and s.points == 0 and s.frozenPoints == 0)
pure def alwaysAcceptedIdentity(s: Scored): bool = s.phase != Unscored implies (s.project != "" and s.unit > 0 and s.head != "")
pure def alwaysLegacyScoredKeepsLegacyPoints(s: Scored): bool = s.phase == LegacyScored implies s.points == s.legacyPoints
pure def alwaysPolicyMatchesAcceptance(s: Scored): bool = s.phase != Unscored implies s.policy == policyFor(s.acceptedAt)
```

### A November assessment needs a paid API receipt; a historical one needs a subscription declaration

An assessment binds the exact accepted head. A November assessment applies at
once unless ratified or frozen. A September–October assessment waits for the
historical import release. A v2-era source is never rescored by assessment.

```quint
pure def validAssessment(s: Scored, x: Assessment): bool =
  x.band >= 0 and x.band <= 5 and x.sourceDigest != "" and x.rubric != "" and x.model != "" and
  x.head != "" and x.head == s.head and
  (if (s.policy == ValueV1) x.source == PaidApiReceipt else x.source == SubscriptionDeclared)
pure def canAssess(s: Scored, x: Assessment): bool =
  (s.phase == Provisional or s.phase == Assessed or s.phase == LegacyScored) and s.policy != LegacyV2 and
  not(s.frozen) and not(s.held) and not(s.jointWithheld) and validAssessment(s, x)
pure def assess(s: Scored, x: Assessment): Scored =
  if (s.policy == ValueV1)
    { ...s, phase: Assessed, points: A::sizePoints(x.band), rubric: x.rubric, model: x.model,
      billingProven: x.source == PaidApiReceipt }
  else { ...s, pendingBand: x.band, rubric: x.rubric, model: x.model, billingProven: false }
```

### A released historical import applies the current band to eligible unpaid work

The released import record must list this exact source; a held,
reconciled-but-unreleased or refused import applies nothing.

```quint
type Release = { importId: int, imported: HI::Import }
pure def canApplyHistorical(s: Scored, r: Release): bool =
  s.policy == HistoricalValue and s.phase == LegacyScored and s.pendingBand >= 0 and
  r.importId > 0 and HI::includesSource(r.imported, s.unit) and not(s.frozen) and not(s.held)
pure def applyHistorical(s: Scored, r: Release): Scored =
  { ...s, phase: Assessed, points: A::sizePoints(s.pendingBand), pendingBand: -1 }
pure def lawHeldImportAppliesNothing(r: Release, s: Scored): bool =
  r.imported.phase != HI::Released implies not(canApplyHistorical(s, r))
```

### A valid ratification takes precedence and a later assessment cannot replace it

The ratification names the exact accepted head, and its maintainer holds
write, maintain or admin permission on the same project in the authority
record read with it. Neither a ratification nor an assessment changes a
frozen source; only settlement's freeze of the source's project and reward
month freezes it.

```quint
pure def currentAuthority(s: Scored, rat: Ratification): bool =
  rat.authority.maintainer == rat.maintainer and rat.authority.project == s.project and
  (rat.authority.permission == WritePermission or rat.authority.permission == MaintainPermission or
   rat.authority.permission == AdminPermission)
pure def canRatify(s: Scored, rat: Ratification): bool =
  s.phase != Unscored and not(s.frozen) and rat.band >= 0 and rat.band <= 5 and rat.maintainer > 0 and
  rat.head != "" and rat.head == s.head and currentAuthority(s, rat) and rat.record != ""
pure def ratify(s: Scored, rat: Ratification): Scored =
  { ...s, phase: Ratified, points: A::sizePoints(rat.band), pendingBand: -1, jointWithheld: false }
pure def canHold(s: Scored): bool = s.phase != Unscored and s.phase != Ratified and not(s.held)
pure def hold(s: Scored): Scored = { ...s, held: true }
pure def canFreeze(s: Scored, f: P::FreezeEvidence): bool =
  s.phase != Unscored and not(s.frozen) and P::freezes(f) and f.project == s.project and f.period == P::periodOf(s.acceptedAt)
pure def freeze(s: Scored, f: P::FreezeEvidence): Scored = { ...s, frozen: true, frozenPoints: s.points }
pure def alwaysFrozenPointsKept(s: Scored): bool = s.frozen implies s.points == s.frozenPoints
pure def alwaysHeldPreNovemberKeepsEarlier(s: Scored): bool =
  (s.held and s.policy != ValueV1 and s.phase == LegacyScored) implies s.points == s.legacyPoints
pure def alwaysLegacyNeverAssessed(s: Scored): bool = s.policy == LegacyV2 implies (s.phase == LegacyScored or s.phase == Ratified or s.phase == Unscored)
pure def alwaysSubscriptionIsNotBilling(s: Scored): bool = s.policy != ValueV1 implies not(s.billingProven)
pure def stepRatificationPrecedes(before: Scored, after: Scored): bool =
  before.phase == Ratified implies after.phase == Ratified
pure def stepFrozenNeverChanges(before: Scored, after: Scored): bool =
  before.frozen implies (after.frozen and after.points == before.points)
pure def stepIdentityFixed(before: Scored, after: Scored): bool = before.phase != Unscored implies
  (after.project == before.project and after.unit == before.unit and after.head == before.head and after.acceptedAt == before.acceptedAt)
pure def sometimesValueAssessed(s: Scored): bool = s.phase == Assessed and s.policy == ValueV1 and s.points > 10
pure def sometimesHistoricalRescored(s: Scored): bool = s.phase == Assessed and s.policy == HistoricalValue
pure def sometimesRatifiedOverValue(s: Scored): bool = s.phase == Ratified and s.policy == ValueV1
pure def sometimesHeldKeepsLegacy(s: Scored): bool = s.held and s.policy == HistoricalValue and s.pendingBand >= 0
pure def sometimesZeroSizeKeepsMinimum(s: Scored): bool = s.phase == Assessed and s.points == 10
pure def sometimesFrozenSource(s: Scored): bool = s.frozen and s.phase != Unscored
```

### A joint member that a sibling's ratification withholds keeps the accepted-merge minimum

Under the value policy a joint value decision scores its member pull
requests by unit (`src/lib/leaderboard.ts`, `scoreMergedPullRequests`). When
any claim of a unit is carried by a pull request with a valid maintainer
ratification, the whole unit is withheld. A member pull request with a claim
in such a unit that the ratification does not cover, with no ratification of
its own and no claim in a unit that is scored, would otherwise lose the unit
and its merge event together: it keeps the accepted-merge minimum of 10
Points (the one-third minimum), never its superseded per-pull-request
assessment, with the explanation "A maintainer ratification of another pull
request withheld this merge's joint value assessment; the accepted merge
keeps the one-third minimum." A later assessment of its own does not apply
while it stays a joint member; a ratification of its own takes precedence as
always. When such a member lacks attribution proof, its hold keeps the Points
it already has (`hold`) and, because it has no claim in the group's other
units, does not hold them (`holdsJointDecision`); any other attribution-held
member still holds the joint decision.

```quint
type JointMembership = { inWithheldUnit: bool, ownRatification: bool, inScoredUnit: bool }
pure def withheldMember(membership: JointMembership): bool = membership.inWithheldUnit and not(membership.ownRatification) and not(membership.inScoredUnit)
pure def holdsJointDecision(attributionHeld: bool, membership: JointMembership): bool = attributionHeld and not(withheldMember(membership))
pure def canWithholdJoint(s: Scored, membership: JointMembership): bool =
  s.policy == ValueV1 and (s.phase == Provisional or s.phase == Assessed) and not(s.frozen) and not(s.held) and
  withheldMember(membership)
pure def withholdJoint(s: Scored, membership: JointMembership): Scored =
  { ...s, phase: Provisional, points: 10, rubric: "", model: "", billingProven: false, jointWithheld: true }
pure def alwaysWithheldMemberKeepsMinimum(s: Scored): bool =
  (s.jointWithheld and s.phase != Ratified) implies (s.phase == Provisional and s.points == 10 and s.policy == ValueV1)
pure def lawRatifiedOrScoredMemberNotWithheld(membership: JointMembership): bool =
  (membership.ownRatification or membership.inScoredUnit) implies not(withheldMember(membership))
pure def lawWithheldMemberHoldsNoSibling(attributionHeld: bool, membership: JointMembership): bool =
  withheldMember(membership) implies not(holdsJointDecision(attributionHeld, membership))
pure def sometimesJointWithheldKeepsMinimum(s: Scored): bool = s.jointWithheld and s.phase == Provisional and s.points == 10
pure val membershipValues = Set({ inWithheldUnit: true, ownRatification: false, inScoredUnit: false },
  { inWithheldUnit: true, ownRatification: true, inScoredUnit: false },
  { inWithheldUnit: true, ownRatification: false, inScoredUnit: true },
  { inWithheldUnit: false, ownRatification: false, inScoredUnit: false })
pure val attributionHeldValues = Set(false, true)
```

### Simulation samples include receipts, declarations, stale heads and held imports

```quint
pure val legacyPointsValues = Set(10, 30)
pure val srcValues = Set({ project: "p", unit: 1, head: "h", acceptedAt: 2431915 },
  { project: "p", unit: 1, head: "h", acceptedAt: 2432010 }, { project: "p", unit: 1, head: "h", acceptedAt: 2432210 })
pure val xValues = Set(
  { band: 2, source: PaidApiReceipt, sourceDigest: "d", rubric: "value-v1", model: "m", head: "h" },
  { band: 0, source: PaidApiReceipt, sourceDigest: "d", rubric: "value-v1", model: "m", head: "h" },
  { band: 3, source: SubscriptionDeclared, sourceDigest: "d", rubric: "value-v1", model: "m", head: "h" },
  { band: 3, source: PaidApiReceipt, sourceDigest: "d", rubric: "value-v1", model: "m", head: "old" })
pure val ratValues = Set(
  { band: 1, maintainer: 3, head: "h", record: "slop-score", authority: { maintainer: 3, project: "p", permission: MaintainPermission } },
  { band: 4, maintainer: 3, head: "h", record: "slop-score", authority: { maintainer: 3, project: "p", permission: ReadPermission } },
  { band: 4, maintainer: 3, head: "old", record: "slop-score", authority: { maintainer: 3, project: "p", permission: AdminPermission } })
pure val releasedImport: HI::Import = { ...HI::noImport, phase: HI::Released, sources: 1, sourceIds: List(1), assessed: 1,
  coverageComplete: true, duplicateChecked: true, fundedChecked: true, changesDigest: "c", journalDigest: "j" }
pure val rValues = Set({ importId: 1, imported: releasedImport }, { importId: 1, imported: { ...releasedImport, phase: HI::Reconciled } },
  { importId: 1, imported: { ...releasedImport, sourceIds: List(2) } })
pure val fValues = Set({ project: "p", period: 24321, phase: P::Frozen, obligationExists: false },
  { project: "p", period: 24321, phase: P::Proposed, obligationExists: false },
  { project: "p", period: 24322, phase: P::Completed, obligationExists: false })
```
