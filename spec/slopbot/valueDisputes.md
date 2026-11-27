# Value disputes

PRD sections 5, 7 and 9 and CLAUDE.md "Slopbot triages disputes first, and a
moderator decides escalated disputes". Source `workers/slopbot/README.md`
(value disputes), `value-disputes.ts` (`valueDisputeKey`,
`currentValueDispute`, `retainedValueDispute`, `affectedValueActor`,
`draftValueDispute`), `review.ts` (`recordValueDispute`,
`applyAppealCommand`, `finishAppeal`) and `slopbot_appeals` rows whose key
starts with `value-appeal:`.

One instance is one dispute keyed
`value-appeal:<single|joint>:<record digest>:<actor>:<repository>:<PR number>`.
It binds the exact retained single or joint assessment journal record, never
a proposed score, and keeps that binding through later corrections. An upheld
value dispute records a decision only: it never changes Points, awards,
penalties or pull-request state. A correction must append through the
assessment journal ([value history](./valueHistory.md)).

## Story: An affected participant disputes the retained assessment of a PR

### Only the author, a current maintainer, an affected implementation actor or a credited reviewer may dispute, once per record and actor

The disputer check reads GitHub: the PR author, a current maintainer, an
implementation actor named by a joint claim carrying this PR or by a commit
of the unchanged assessed head, or a reviewer whose review the retained
assessment credited. Unavailable evidence refuses. The binding comes from the
retained journal row whose bytes match the digest and whose project,
repository, PR node and number match the dispute. The project scope comes
from the projects registry read for the bound project and repository, never
from the request; an unregistered repository refuses.

```quint
import categories as F from "./categories"
type RecordKind = SingleRecord | JointRecord
type Binding = { kind: RecordKind, digest: str, project: int, repository: int, item: str, number: int,
  headSha: str, baseSha: str, policySha: str, sources: int }
type DisputerRole = RoleUnavailable | NotAffected | PrAuthor | CurrentMaintainer | ImplementationActor | CreditedReviewer
type DisputerCheck = { actor: int, item: str, role: DisputerRole }
type JournalRead = { digest: str, bytesMatchDigest: bool, project: int, repository: int, item: str, number: int }
type ProjectScope = ScopeActive | ScopeSecurityOnly | ScopeRetired
type RegistryScope = NotRegistered | RegisteredActive | RegisteredSecurityOnly | RegisteredRetired
type ProjectView = { project: int, repository: int, registry: RegistryScope }
pure def scopeOf(view: ProjectView, b: Binding): ProjectScope =
  if (view.registry == RegisteredActive) ScopeActive
  else if (view.registry == RegisteredSecurityOnly) ScopeSecurityOnly
  else ScopeRetired
pure def viewMatches(view: ProjectView, b: Binding): bool =
  view.project == b.project and view.repository == b.repository and view.registry != NotRegistered
pure def affected(role: DisputerRole): bool =
  role == PrAuthor or role == CurrentMaintainer or role == ImplementationActor or role == CreditedReviewer
pure def bindingVerified(b: Binding, read: JournalRead): bool = b.digest != "" and read.digest == b.digest and
  read.bytesMatchDigest and read.project == b.project and read.repository == b.repository and
  read.item == b.item and read.number == b.number and b.sources >= 1
pure def lawUnavailableEvidenceRefuses(check: DisputerCheck): bool =
  (check.role == RoleUnavailable or check.role == NotAffected) implies not(affected(check.role))
```

### Slopbot drafts once; incomplete evidence, a partial joint record, a ban or low confidence go to a moderator

A restricted or retired project escalates without triage. The draft reads
the retained binding's source again: the gap is derived from that read
against the binding's assessed head, base and original policy digest. A
draft whose source head or base changed, whose source or original policy is
incomplete or changed, or whose joint record covers other PRs has its
confidence capped below 90 hundredths, so a moderator decides. A budget-deferred draft records nothing.
Escalation creates one Inbox notice per moderator.

```quint
type DraftChoice = NoDraft | DraftUphold | DraftDeny
type Escalation = NotEscalated | RestrictedProject | IncompleteOrUncertain | ParticipationBan | DraftRejected | Overdue
type Resolution = Unresolved | Upheld | Denied
type ResolvedVia = NotResolved | AcceptedDraft | ModeratorDecision
type BanStatus = BanUnknown | NotBanned | Banned
type SourceRead = { digest: str, item: str, headSha: str, baseSha: str, sourceComplete: bool, policySha: str,
  policyComplete: bool }
type Dispute = { opened: bool, binding: Binding, disputer: int, scope: ProjectScope, openedAt: int, now: int, queuedAt: int,
  draft: DraftChoice, draftConfidence: int, draftGapped: bool, escalation: Escalation, notices: Set[int], ban: BanStatus,
  resolution: Resolution, via: ResolvedVia, resolvedBy: int, postedResolution: bool }
pure val noBinding: Binding = { kind: SingleRecord, digest: "", project: 0, repository: 0, item: "", number: 0,
  headSha: "", baseSha: "", policySha: "", sources: 0 }
pure val initial: Dispute = { opened: false, binding: noBinding, disputer: 0, scope: ScopeActive, openedAt: 0, now: 0,
  queuedAt: 0, draft: NoDraft, draftConfidence: 0, draftGapped: false, escalation: NotEscalated, notices: Set(), ban: BanUnknown,
  resolution: Unresolved, via: NotResolved, resolvedBy: 0, postedResolution: false }
pure val slopModerators: Set[int] = Set(18633264, 202660855)
pure val resolutionSeconds = 604800
pure val requeueSeconds = 86400
pure val cappedConfidence = 89
pure def canOpen(d: Dispute, by: int, binding: Binding, read: JournalRead, check: DisputerCheck, view: ProjectView): bool =
  not(d.opened) and by > 0 and check.actor == by and check.item == binding.item and affected(check.role) and
  bindingVerified(binding, read) and viewMatches(view, binding)
pure def open(d: Dispute, by: int, binding: Binding, read: JournalRead, check: DisputerCheck, view: ProjectView): Dispute =
  { ...d, opened: true, binding: binding, disputer: by, scope: scopeOf(view, binding), openedAt: d.now }
pure def unresolved(d: Dispute): bool = d.opened and d.resolution == Unresolved
pure def escalated(d: Dispute): bool = d.escalation != NotEscalated
pure def escalatedWith(reason: Escalation, d: Dispute): Dispute = { ...d, escalation: reason, notices: slopModerators }
pure def canObserveTime(d: Dispute, observedAt: int): bool = observedAt >= d.now
pure def observeTime(d: Dispute, observedAt: int): Dispute = { ...d, now: observedAt }
pure def canObserveBan(d: Dispute, status: BanStatus): bool = unresolved(d) and status != BanUnknown
pure def observeBan(d: Dispute, status: BanStatus): Dispute = { ...d, ban: status }
pure def canEscalateRestricted(d: Dispute): bool = unresolved(d) and not(escalated(d)) and d.scope != ScopeActive
pure def escalateRestricted(d: Dispute): Dispute = escalatedWith(RestrictedProject, d)
pure def partialJoint(b: Binding): bool = b.kind == JointRecord and b.sources > 1
pure def gapped(b: Binding, source: SourceRead): bool =
  source.headSha != b.headSha or source.baseSha != b.baseSha or not(source.sourceComplete) or
  source.policySha != b.policySha or not(source.policyComplete) or partialJoint(b)
pure def draftConfidenceFor(b: Binding, source: SourceRead, confidenceHundredths: int): int =
  if (gapped(b, source) and confidenceHundredths > cappedConfidence) cappedConfidence else confidenceHundredths
pure def canDraft(d: Dispute, uphold: bool, confidenceHundredths: int, source: SourceRead): bool =
  unresolved(d) and d.scope == ScopeActive and d.draft == NoDraft and F::validConfidence(confidenceHundredths) and
  source.digest == d.binding.digest and source.item == d.binding.item
pure def draft(d: Dispute, uphold: bool, confidenceHundredths: int, source: SourceRead): Dispute =
  { ...d, draft: if (uphold) DraftUphold else DraftDeny, draftGapped: gapped(d.binding, source),
    draftConfidence: draftConfidenceFor(d.binding, source, confidenceHundredths) }
pure def canEscalateDraft(d: Dispute): bool = unresolved(d) and not(escalated(d)) and d.draft != NoDraft and
  d.ban != BanUnknown and (d.ban == Banned or d.draftConfidence < F::closeConfidence)
pure def escalateDraft(d: Dispute): Dispute =
  escalatedWith(if (d.ban == Banned) ParticipationBan else IncompleteOrUncertain, d)
pure def lawGappedDraftNeverConfident(b: Binding, source: SourceRead, confidenceHundredths: int): bool =
  (gapped(b, source) and F::validConfidence(confidenceHundredths)) implies
    not(F::confident(draftConfidenceFor(b, source, confidenceHundredths)))
pure def alwaysGappedDraftBelowThreshold(d: Dispute): bool =
  (d.draftGapped implies d.draftConfidence < F::closeConfidence) and
  ((d.draft != NoDraft and partialJoint(d.binding)) implies d.draftGapped)
pure def alwaysGappedNeverAccepted(d: Dispute): bool = d.via == AcceptedDraft implies not(d.draftGapped)
pure def alwaysEscalationNotifies(d: Dispute): bool =
  (escalated(d) iff d.notices.size() > 0) and d.notices.subseteq(slopModerators) and
  (escalated(d) implies slopModerators.subseteq(d.notices))
pure def alwaysRestrictedNeverDrafted(d: Dispute): bool = d.scope != ScopeActive implies d.draft == NoDraft
pure def alwaysNothingBeforeOpening(d: Dispute): bool = not(d.opened) implies d.draft == NoDraft and
  not(escalated(d)) and d.resolution == Unresolved and d.via == NotResolved and d.queuedAt == 0 and d.openedAt == 0 and
  d.resolvedBy == 0
pure def stepBindingImmutable(before: Dispute, after: Dispute): bool = before.opened implies
  after.binding == before.binding and after.disputer == before.disputer and after.scope == before.scope
pure def stepDraftAndEscalationOnce(before: Dispute, after: Dispute): bool =
  (before.draft != NoDraft implies after.draft == before.draft and after.draftConfidence == before.draftConfidence and
    after.draftGapped == before.draftGapped) and
  (escalated(before) implies after.escalation == before.escalation)
pure def sometimesRestrictedEscalated(d: Dispute): bool = d.escalation == RestrictedProject
pure def sometimesUncertainEscalated(d: Dispute): bool = d.escalation == IncompleteOrUncertain
```

### The disputer or a maintainer answers the draft; a moderator other than the disputer decides an escalated dispute

`/slopbot accept <key>` resolves with the draft and `/slopbot reject <key>`
escalates; only the disputer or a current maintainer may answer, and only an
unescalated, confident draft can be accepted. An answer while the disputer
has an active participation ban escalates with that reason, with or without
a draft, as for an appeal (`applyAppealCommand` in `review.ts` serves both);
an answer from anyone else is refused before the ban is read.
`/slopbot uphold|deny <key>`
from a moderator decides an escalated dispute; a moderator cannot decide
their own dispute. Unresolved disputes escalate after seven days. The
resolution comment is posted once.

```quint
pure def mayAnswer(d: Dispute, by: int, check: DisputerCheck): bool =
  by > 0 and (by == d.disputer or (check.actor == by and check.item == d.binding.item and check.role == CurrentMaintainer))
pure def answerable(d: Dispute): bool = unresolved(d) and not(escalated(d)) and d.draft != NoDraft
pure def canReject(d: Dispute, by: int, check: DisputerCheck): bool = answerable(d) and mayAnswer(d, by, check) and
  d.ban == NotBanned
pure def reject(d: Dispute, by: int, check: DisputerCheck): Dispute = escalatedWith(DraftRejected, d)
pure def canEscalateBanAtAnswer(d: Dispute, by: int, check: DisputerCheck): bool =
  unresolved(d) and not(escalated(d)) and d.ban == Banned and mayAnswer(d, by, check)
pure def escalateBanAtAnswer(d: Dispute, by: int, check: DisputerCheck): Dispute = escalatedWith(ParticipationBan, d)
pure def sometimesBanEscalatedBeforeDraft(d: Dispute): bool = d.escalation == ParticipationBan and d.draft == NoDraft
pure def canAccept(d: Dispute, by: int, check: DisputerCheck): bool = answerable(d) and mayAnswer(d, by, check) and
  d.ban == NotBanned and d.draftConfidence >= F::closeConfidence
pure def accept(d: Dispute, by: int, check: DisputerCheck): Dispute =
  { ...d, resolution: if (d.draft == DraftUphold) Upheld else Denied, via: AcceptedDraft, resolvedBy: by }
pure def canModeratorDecide(d: Dispute, by: int, uphold: bool): bool =
  unresolved(d) and escalated(d) and slopModerators.contains(by) and by != d.disputer
pure def moderatorDecide(d: Dispute, by: int, uphold: bool): Dispute =
  { ...d, resolution: if (uphold) Upheld else Denied, via: ModeratorDecision, resolvedBy: by }
pure def due(d: Dispute): bool = unresolved(d) and not(escalated(d)) and d.now - d.openedAt >= resolutionSeconds
pure def canDispatchDue(d: Dispute): bool = due(d) and (d.queuedAt == 0 or d.now - d.queuedAt >= requeueSeconds)
pure def dispatchDue(d: Dispute): Dispute = { ...d, queuedAt: d.now }
pure def canEscalateOverdue(d: Dispute): bool = due(d) and d.queuedAt > 0
pure def escalateOverdue(d: Dispute): Dispute = escalatedWith(Overdue, d)
pure def canPostResolution(d: Dispute): bool = d.opened and d.resolution != Unresolved and not(d.postedResolution)
pure def postResolution(d: Dispute): Dispute = { ...d, postedResolution: true }
pure def alwaysResolutionConsistent(d: Dispute): bool =
  ((d.resolution == Unresolved) iff (d.via == NotResolved)) and
  (d.via == ModeratorDecision implies escalated(d) and slopModerators.contains(d.resolvedBy) and d.resolvedBy != d.disputer) and
  (d.via == AcceptedDraft implies not(escalated(d)) and d.draftConfidence >= F::closeConfidence and d.scope == ScopeActive)
pure def alwaysTimes(d: Dispute): bool = d.openedAt <= d.now and d.queuedAt <= d.now and
  (d.queuedAt > 0 implies d.queuedAt - d.openedAt >= resolutionSeconds)
pure def stepResolutionOnce(before: Dispute, after: Dispute): bool = before.resolution != Unresolved implies
  after.resolution == before.resolution and after.via == before.via and after.resolvedBy == before.resolvedBy
pure def sometimesAccepted(d: Dispute): bool = d.via == AcceptedDraft
pure def sometimesModeratorUpheld(d: Dispute): bool = d.via == ModeratorDecision and d.resolution == Upheld
pure def sometimesOverdue(d: Dispute): bool = d.escalation == Overdue
```

### Simulation samples cover unaffected actors, unmatched records, gaps and restricted projects

```quint
pure val singleBinding: Binding = { kind: SingleRecord, digest: "d1", project: 1, repository: 7, item: "pr", number: 3,
  headSha: "h", baseSha: "b", policySha: "p", sources: 1 }
pure val bindingValues = Set(singleBinding, { ...singleBinding, kind: JointRecord, sources: 2 })
pure val readValues = Set({ digest: "d1", bytesMatchDigest: true, project: 1, repository: 7, item: "pr", number: 3 },
  { digest: "d1", bytesMatchDigest: false, project: 1, repository: 7, item: "pr", number: 3 },
  { digest: "d1", bytesMatchDigest: true, project: 2, repository: 7, item: "pr", number: 3 })
pure val checkValues = Set({ actor: 5, item: "pr", role: PrAuthor }, { actor: 6, item: "pr", role: CurrentMaintainer },
  { actor: 6, item: "pr", role: CreditedReviewer }, { actor: 7, item: "pr", role: NotAffected },
  { actor: 5, item: "pr", role: RoleUnavailable })
pure val byValues = Set(5, 6, 7, 18633264)
pure val viewValues = Set({ project: 1, repository: 7, registry: RegisteredActive },
  { project: 1, repository: 7, registry: RegisteredSecurityOnly },
  { project: 1, repository: 7, registry: RegisteredRetired }, { project: 1, repository: 7, registry: NotRegistered },
  { project: 2, repository: 7, registry: RegisteredActive })
pure val unchangedSource: SourceRead = { digest: "d1", item: "pr", headSha: "h", baseSha: "b", sourceComplete: true,
  policySha: "p", policyComplete: true }
pure val sourceValues = Set(unchangedSource, { ...unchangedSource, headSha: "h2" }, { ...unchangedSource, policyComplete: false },
  { ...unchangedSource, digest: "d2" })
pure val bValues = bindingValues
pure val confidenceHundredthsValues = Set(40, 89, 95)
pure val observedAtValues = Set(0, 604800, 691200)
pure val weight_open = 2
pure val weight_draft = 2
pure val eval_witness_sometimesUncertainEscalated = (
  ("open", 5, singleBinding, { digest: "d1", bytesMatchDigest: true, project: 1, repository: 7, item: "pr", number: 3 }, { actor: 5, item: "pr", role: PrAuthor }, { project: 1, repository: 7, registry: RegisteredActive }),
  ("observeBan", NotBanned, 5),
  ("draft", true, 40, unchangedSource, 5),
  ("escalateDraft", 5)
)
```
