# Qualified automatic closure decision

PRD section 5 governs closure, and CLAUDE.md "Slopbot" and "Automatic closure"
restate it. The project automatic-closure setting comes from the approved
project revision: a new draft starts unchecked and a missing saved value is
false (owner decision, 13 November 2026;
[closure consent](../backend/closureConsent.md)). Source
`workers/slopbot/review.ts` (`runReview`, `stillMayClose`, `closureState`,
`confirmedClosure`, `grounded`, `duplicateOf`, `matchingOpenItem`),
`closure-eligibility.ts`, `contracts.ts` and migrations `0060` and `0064` at
the development head.

Each instance is one reviewed item revision, from its first observation to
its recorded decision and the labels that decision posts. What happens after
a close decision lives in sibling machines that start from this decision:
the [close attempt](./closeAttempt.md) of a close candidate and the
[maintainer hold](./maintainerHold.md) of an uncertain finding. Every fact
that authorizes an action is either state this model owns or a typed
observation whose provenance is a named verified service:

| Observation | Verified by |
|---|---|
| `GateObservation.source` | the GitHub review adapter: exact item, head, content digest, installation, item state, assignees, author role, the approved project revision with its saved consent, and the repository's `.github/slopbot.json` |
| `GateObservation.participation` | the closure-eligibility reader over `points_members`, `trace_runs` and `run_progress_events` in D1 |
| `GateObservation.activation` | closure activation (`closureActivation.md`) |
| `Verdict` | the provider route of review (`review.md`), one retained call record per triage or confirm call |
| `GroundingCheck` | the review worker's deterministic verbatim comparison (`grounded`) of the call's quotes with the reviewed item text and the policy files it read |
| `RelatedItemCheck` | the review worker's duplicate lookup (`duplicateOf`, `matchingOpenItem`) |
| `ReopenEvidence`, `RemovalEvidence` | GitHub's reopen event with the actor's verified role, and the label read |
| `AppealOutcome` | appeals (`appeals.md`) |

Binding these machines into one composed state is an open composition
obligation; until then each observation is an input of this machine. A
shell obligation remains: each adapter must produce its observation from the
named verified source and never from request text.

## Story: Decide a current review under the registered repository's policy

### Review actions require the exact current source and effective repository scope

The observation binds project, permanent repository ID, item kind and node,
head revision, content digest and author. An unknown source, installation,
item state, coverage, assignment or author role refuses action and leaves the
item recoverable for a later check. A draft, merged or closed item, a removed
or suspended installation and a limited review cannot label, close or
penalize. A paused, flagged or quarantined project (`SecurityOnly`) permits
only an authorized security comment and the confirmed scam label. A retired
(`ReversalOnly`) or unregistered repository permits no review action. The
decision keeps the scope where it was made, so a security-only result never
becomes a full-review decision after reinstatement.

```quint
import categories as F from "./categories"
import closureConsent as CC from "../backend/closureConsent"
type ReviewItemKind = PullRequest | Issue
type RepositoryScope = Unregistered | Active | SecurityOnly | ReversalOnly
type SourceStatus = SourceUnknown | SourceCurrent | SourceSuperseded
type InstallationStatus = InstallationUnknown | InstallationActive | InstallationSuspended | InstallationRemoved
type ItemCondition = ItemUnknown | ItemOpen | ItemClosed | ItemMerged
type ClosedBy = NotClosed | ClosedBySlopbot | ClosedByHuman
type Coverage = CoverageUnknown | CoverageComplete | CoverageLimited
type Assignment = AssignmentUnknown | Unassigned | Assigned
type AuthorRole = RoleUnknown | Maintainer | NonMaintainer
type PolicyFile = FileAbsent | FileValid | FileInvalid
type CategoryMode = ModeOff | ModeLabel | ModeClose
type ReviewIdentity = { project: int, repository: int, kind: ReviewItemKind, itemNode: str, revision: str,
  contentDigest: str, author: int }
type SourceObservation = { identity: ReviewIdentity, scope: RepositoryScope, source: SourceStatus,
  installation: InstallationStatus, item: ItemCondition, closedBy: ClosedBy, draft: bool, coverage: Coverage,
  assignment: Assignment, authorRole: AuthorRole, projectRevision: int, consent: CC::SavedConsent,
  file: PolicyFile, fileClosure: bool, modeCategory: F::Category, fileMode: CategoryMode, securityAuthorized: bool }
pure val reviewedItem: ReviewIdentity = { project: 1, repository: 7, kind: PullRequest, itemNode: "pr",
  revision: "head", contentDigest: "review", author: 5 }
pure val unknownSource: SourceObservation = { identity: reviewedItem, scope: Unregistered, source: SourceUnknown,
  installation: InstallationUnknown, item: ItemUnknown, closedBy: NotClosed, draft: false, coverage: CoverageUnknown,
  assignment: AssignmentUnknown, authorRole: RoleUnknown, projectRevision: 0, consent: CC::Absent,
  file: FileInvalid, fileClosure: false, modeCategory: F::NoFinding, fileMode: ModeOff, securityAuthorized: false }
pure def sourceUsable(o: SourceObservation, identity: ReviewIdentity): bool =
  o.identity == identity and o.source == SourceCurrent and o.installation == InstallationActive and
  o.item == ItemOpen and not(o.draft) and o.coverage != CoverageUnknown
pure def mayPostOrdinaryFor(o: SourceObservation, identity: ReviewIdentity): bool =
  o.scope == Active and sourceUsable(o, identity)
pure def mayActOrdinaryFor(o: SourceObservation, identity: ReviewIdentity): bool =
  mayPostOrdinaryFor(o, identity) and o.coverage == CoverageComplete
pure def lawUnknownSourceRefusesAction(identity: ReviewIdentity): bool = not(sourceUsable(unknownSource, identity))
pure def lawLimitedCoverageNeverActs(sampleObservation: SourceObservation, identity: ReviewIdentity): bool =
  sampleObservation.coverage != CoverageComplete implies not(mayActOrdinaryFor(sampleObservation, identity))
```

### The effective policy keeps file opt-outs, category restrictions and the saved project consent

Source `projectRepositoryConfig`: effective closure is the saved project
consent and the file's `closure` value; a missing file defers to the saved
consent with the default category modes; an invalid file is label-only for
every category and never closes. A category that can never close is
label-only even if a file asks for closure, since such a file is invalid.

```quint
pure def defaultMode(category: F::Category): CategoryMode =
  if (category == F::NoFinding) ModeOff
  else if (category == F::OutOfScope or category == F::MissingEvidence or category == F::LowQuality) ModeLabel
  else ModeClose
pure def effectiveMode(o: SourceObservation, category: F::Category): CategoryMode =
  if (category == F::NoFinding) ModeOff
  else if (o.file == FileInvalid) ModeLabel
  else if (o.file == FileAbsent) defaultMode(category)
  else if (o.modeCategory != category) ModeOff
  else if (F::neverCloses(category) and o.fileMode == ModeClose) ModeLabel
  else o.fileMode
pure def effectiveClosure(o: SourceObservation): bool =
  CC::consents(o.consent) and (o.file == FileAbsent or (o.file == FileValid and o.fileClosure))
pure def lawMissingConsentNeverCloses(sampleObservation: SourceObservation): bool =
  sampleObservation.consent != CC::Enabled implies not(effectiveClosure(sampleObservation))
pure def lawInvalidFileIsLabelOnly(sampleObservation: SourceObservation, category: F::Category): bool =
  sampleObservation.file == FileInvalid implies not(effectiveClosure(sampleObservation)) and effectiveMode(sampleObservation, category) != ModeClose
pure def lawNeverCloseCategoriesNeverModeClose(sampleObservation: SourceObservation, category: F::Category): bool =
  F::neverCloses(category) implies effectiveMode(sampleObservation, category) != ModeClose
pure def lawFileOptOutWins(sampleObservation: SourceObservation): bool =
  (sampleObservation.file == FileValid and not(sampleObservation.fileClosure)) implies not(effectiveClosure(sampleObservation))
```

### A repository file is valid only with version 1, a known audience, known keys and category modes, and a daily close cap from 0 to 200

Source `parseRepositoryConfig`, `configProblem` and `labelOnlyConfig` in
`workers/slopbot/contracts.ts`, and `loadContext` in `review.ts`. The
adapter reads `.github/slopbot.json` from the default branch at the
recorded base commit, at most 16 KiB. A file that exists but is truncated,
unreadable or not JSON is invalid, never a reason to use the defaults. A
valid file is one JSON object whose keys are among `version`, `audience`,
`issues`, `pullRequests`, `closure`, `reviewExempt`, `dailyCloseCap` and
`categories`; whose `version` is exactly the number 1; whose `audience` is
`protection` or `participants`; whose four flags, when present, are
booleans (absent: `issues` and `pullRequests` true, `closure` and
`reviewExempt` false); whose `dailyCloseCap`, when present, is an integer
from 0 to 200 (absent: 25); and whose `categories`, when present, is an
object mapping the nine category names other than `none` to `off`, `label`
or `close`, never `missing_evidence` to `close`. Unlisted categories keep
their default modes. As in the development code, `out_of_scope: "close"`
leaves the file valid, and the effective policy above still makes that
category label-only. Every other problem makes the observation
`FileInvalid`, which the rule above makes label-only with no closure and
the default cap of 25. The shell parses the bytes into `RepositoryFile`:
`ValueInteger` is a JSON number that is a whole number, and an integer
outside the safe range is `ValueOther`.

```quint
type FileValue = ValueMissing | ValueBool | ValueInteger | ValueText | ValueObject | ValueOther
type CategoryOverride = { categoryKey: str, modeName: str }
type RepositoryFile = { jsonObject: bool, truncated: bool, fileKeys: List[str], versionValue: FileValue,
  versionNumber: int, audienceValue: FileValue, audienceText: str, issuesValue: FileValue,
  pullRequestsValue: FileValue, closureValue: FileValue, closureSetting: bool, reviewExemptValue: FileValue,
  capValue: FileValue, capNumber: int, categoriesValue: FileValue, overrides: List[CategoryOverride] }
pure val fileConfigKeys = Set("version", "audience", "issues", "pullRequests", "closure", "reviewExempt",
  "dailyCloseCap", "categories")
pure val fileCategoryKeys = Set("spam", "scam", "empty", "duplicate", "out_of_scope", "busywork",
  "missing_evidence", "gaming", "low_quality")
pure val fileModeNames = Set("off", "label", "close")
pure val fileReadLimitBytes = 16384
pure val fileMaxDailyCloseCap = 200
pure val fileDefaultDailyCloseCap = 25
pure def optionalBoolean(fileValue: FileValue): bool = fileValue == ValueMissing or fileValue == ValueBool
pure def validOverride(o: CategoryOverride): bool =
  fileCategoryKeys.contains(o.categoryKey) and fileModeNames.contains(o.modeName) and
  not(o.categoryKey == "missing_evidence" and o.modeName == "close")
pure def repositoryFileValid(f: RepositoryFile): bool =
  f.jsonObject and not(f.truncated) and f.fileKeys.every(k => fileConfigKeys.contains(k)) and
  f.versionValue == ValueInteger and f.versionNumber == 1 and
  f.audienceValue == ValueText and (f.audienceText == "protection" or f.audienceText == "participants") and
  optionalBoolean(f.issuesValue) and optionalBoolean(f.pullRequestsValue) and optionalBoolean(f.closureValue) and
  optionalBoolean(f.reviewExemptValue) and
  (f.capValue == ValueMissing or
    (f.capValue == ValueInteger and f.capNumber >= 0 and f.capNumber <= fileMaxDailyCloseCap)) and
  (f.categoriesValue == ValueMissing or (f.categoriesValue == ValueObject and f.overrides.every(o => validOverride(o))))
pure def policyFileOf(present: bool, f: RepositoryFile): PolicyFile =
  if (not(present)) FileAbsent else if (repositoryFileValid(f)) FileValid else FileInvalid
pure def fileClosureOf(f: RepositoryFile): bool =
  repositoryFileValid(f) and f.closureValue == ValueBool and f.closureSetting
pure def fileDailyCloseCap(f: RepositoryFile): int =
  if (repositoryFileValid(f) and f.capValue == ValueInteger) f.capNumber else fileDefaultDailyCloseCap
pure def lawFileCapWithinRange(sampleFile: RepositoryFile): bool =
  fileDailyCloseCap(sampleFile) >= 0 and fileDailyCloseCap(sampleFile) <= fileMaxDailyCloseCap
pure def lawInvalidFileNeverOptsIn(sampleFile: RepositoryFile): bool =
  not(repositoryFileValid(sampleFile)) implies
    (policyFileOf(true, sampleFile) == FileInvalid and not(fileClosureOf(sampleFile)) and
      fileDailyCloseCap(sampleFile) == fileDefaultDailyCloseCap)
pure def lawUnknownKeyInvalidates(sampleFile: RepositoryFile): bool =
  sampleFile.fileKeys.some(k => not(fileConfigKeys.contains(k))) implies not(repositoryFileValid(sampleFile))
pure def lawTruncatedFileInvalid(sampleFile: RepositoryFile): bool =
  sampleFile.truncated implies not(repositoryFileValid(sampleFile))
pure def lawMissingEvidenceNeverConfiguredToClose(sampleFile: RepositoryFile): bool =
  (repositoryFileValid(sampleFile) and sampleFile.categoriesValue == ValueObject) implies
    sampleFile.overrides.every(o => not(o.categoryKey == "missing_evidence" and o.modeName == "close"))
pure def lawMissingFileDefersToProject(sampleFile: RepositoryFile): bool =
  policyFileOf(false, sampleFile) == FileAbsent
pure val minimalFile: RepositoryFile = { jsonObject: true, truncated: false, fileKeys: List("version", "audience"),
  versionValue: ValueInteger, versionNumber: 1, audienceValue: ValueText, audienceText: "protection",
  issuesValue: ValueMissing, pullRequestsValue: ValueMissing, closureValue: ValueMissing, closureSetting: false,
  reviewExemptValue: ValueMissing, capValue: ValueMissing, capNumber: 0, categoriesValue: ValueMissing, overrides: List() }
pure val sampleFileValues = Set(minimalFile,
  { ...minimalFile, fileKeys: List("version", "audience", "closure", "dailyCloseCap"), closureValue: ValueBool,
    closureSetting: true, capValue: ValueInteger, capNumber: 200 },
  { ...minimalFile, capValue: ValueInteger, capNumber: 201 }, { ...minimalFile, versionNumber: 2 },
  { ...minimalFile, audienceText: "everyone" }, { ...minimalFile, fileKeys: List("version", "audience", "extra") },
  { ...minimalFile, truncated: true }, { ...minimalFile, jsonObject: false }, { ...minimalFile, issuesValue: ValueText },
  { ...minimalFile, categoriesValue: ValueObject, overrides: List({ categoryKey: "missing_evidence", modeName: "close" }) },
  { ...minimalFile, categoriesValue: ValueObject, overrides: List({ categoryKey: "out_of_scope", modeName: "close" }) },
  { ...minimalFile, categoriesValue: ValueObject, overrides: List({ categoryKey: "none", modeName: "off" }) })
```

### Only the author's own authenticated run for the exact PR supplies participation authority

Participation needs an active Slop membership (`points_members.closed_at IS
NULL`) for the author's permanent GitHub ID and a `pull_request_opened` event
whose actor equals the run's authenticated session actor, recorded for this
project and permanent repository ID and naming this exact PR node. A copied
footer, marker, receipt or URL supplies none of these facts. A closed, absent
or unknown membership refuses closure.

```quint
type Membership = MemberUnknown | MemberAbsent | MemberActive | MemberClosed
type PrOpenedEvent = { actor: int, sessionActor: int, project: int, repository: int, prNode: str }
type ParticipationEvidence = { member: int, membership: Membership, events: List[PrOpenedEvent], copiedMarker: bool }
pure val noParticipation: ParticipationEvidence = { member: 0, membership: MemberUnknown, events: List(), copiedMarker: false }
pure def participationAuthority(p: ParticipationEvidence, identity: ReviewIdentity): bool =
  identity.kind == PullRequest and identity.author > 0 and p.member == identity.author and
  p.membership == MemberActive and p.events.some(e => e.actor == identity.author and
    e.sessionActor == identity.author and e.project == identity.project and
    e.repository == identity.repository and e.prNode == identity.itemNode)
pure def lawCopiedMarkerNeverAuthorizes(sampleRun: ParticipationEvidence, identity: ReviewIdentity): bool =
  participationAuthority({ ...sampleRun, copiedMarker: true }, identity) iff participationAuthority({ ...sampleRun, copiedMarker: false }, identity)
pure def lawClosedMembershipRefuses(sampleRun: ParticipationEvidence, identity: ReviewIdentity): bool =
  sampleRun.membership != MemberActive implies not(participationAuthority(sampleRun, identity))
pure def lawOtherActorsRunRefuses(sampleRun: ParticipationEvidence, identity: ReviewIdentity): bool =
  sampleRun.events.every(e => e.actor != identity.author or e.sessionActor != identity.author) implies
    not(participationAuthority(sampleRun, identity))
```

### Grounding and the duplicate relation are checked by the service, never taken from the model

A verdict is grounded only when the service's verbatim comparison for that
exact call and the reviewed content digest found every evidence quote in the
item text and, outside the universal categories, found every cited rule
verbatim in a complete policy read. A missing or truncated policy grounds no
quoted-rule category. A deterministic prefilter result is grounded by
construction. A duplicate needs the service's lookup of an open item by the
same author with the same content, other than the reviewed one. The grounded
and related results are computed when the verdict is recorded and kept with
it.

```quint
type PolicyRead = PolicyMissing | PolicyTruncated | PolicyComplete
type Verdict = { callId: str, category: F::Category, confidenceHundredths: int, limitations: bool,
  objectiveDefect: str, deterministic: bool }
type GroundingCheck = { callId: str, contentDigest: str, evidenceFound: bool, policy: PolicyRead, ruleFound: bool }
type RelatedItemCheck = { itemNode: str, relatedNode: str, author: int, relatedOpen: bool, sameContent: bool }
type AssessedVerdict = { verdict: Verdict, grounded: bool, related: bool }
pure val noVerdict: Verdict = { callId: "", category: F::NoFinding, confidenceHundredths: 0, limitations: false,
  objectiveDefect: "", deterministic: false }
pure val notAssessed: AssessedVerdict = { verdict: noVerdict, grounded: false, related: false }
pure def validVerdict(v: Verdict): bool = F::validConfidence(v.confidenceHundredths) and v.callId != ""
pure def groundedBy(v: Verdict, check: GroundingCheck, identity: ReviewIdentity): bool =
  v.deterministic or (check.callId == v.callId and check.contentDigest == identity.contentDigest and
    check.evidenceFound and (F::universal(v.category) or (check.policy == PolicyComplete and check.ruleFound)))
pure def relatedBy(related: RelatedItemCheck, identity: ReviewIdentity): bool =
  related.itemNode == identity.itemNode and related.relatedNode != "" and related.relatedNode != identity.itemNode and
  related.author == identity.author and related.relatedOpen and related.sameContent
pure def assess(v: Verdict, check: GroundingCheck, related: RelatedItemCheck, identity: ReviewIdentity): AssessedVerdict =
  { verdict: v, grounded: groundedBy(v, check, identity), related: relatedBy(related, identity) }
pure def lawIncompletePolicyNeverGroundsQuotedRule(v: Verdict, check: GroundingCheck, identity: ReviewIdentity): bool =
  (not(v.deterministic) and F::requiresQuotedRule(v.category) and check.policy != PolicyComplete) implies
    not(groundedBy(v, check, identity))
pure def lawOtherContentNeverGrounds(v: Verdict, check: GroundingCheck, identity: ReviewIdentity): bool =
  (not(v.deterministic) and check.contentDigest != identity.contentDigest) implies not(groundedBy(v, check, identity))
pure def lawSelfNeverRelated(related: RelatedItemCheck, identity: ReviewIdentity): bool =
  related.relatedNode == identity.itemNode implies not(relatedBy(related, identity))
```

### Two independent grounded verdicts with the same category are required before any close

The first call is triage; a close also needs a confirm call. A finding is
uncertain when it is not grounded, has confidence below 90 hundredths,
reports limitations, or is a duplicate without the verified related item. On
the closure path a deterministic prefilter without model triage and a
confirm call that disagrees, is ungrounded or is not confident are uncertain
too. Objective low quality also needs the same objective defect in both
verdicts.

```quint
pure def initiallyUncertain(t: AssessedVerdict): bool = t.verdict.category != F::NoFinding and
  (not(t.grounded) or not(F::confident(t.verdict.confidenceHundredths)) or t.verdict.limitations or
    (t.verdict.category == F::Duplicate and not(t.related)))
pure def confirms(t: AssessedVerdict, k: AssessedVerdict): bool =
  not(t.verdict.deterministic) and not(k.verdict.deterministic) and t.verdict.category == k.verdict.category and
  t.verdict.callId != k.verdict.callId and
  F::confident(t.verdict.confidenceHundredths) and F::confident(k.verdict.confidenceHundredths) and
  not(t.verdict.limitations) and not(k.verdict.limitations) and t.grounded and k.grounded and
  (t.verdict.category != F::Duplicate or t.related) and
  (t.verdict.category != F::LowQuality or
    (t.verdict.objectiveDefect != "" and t.verdict.objectiveDefect == k.verdict.objectiveDefect))
pure def lawUncertainNeverConfirms(sampleVerdict: AssessedVerdict, otherVerdict: AssessedVerdict): bool =
  initiallyUncertain(sampleVerdict) implies not(confirms(sampleVerdict, otherVerdict))
pure def lawDeterministicNeverConfirms(sampleVerdict: AssessedVerdict, otherVerdict: AssessedVerdict): bool =
  sampleVerdict.verdict.deterministic implies not(confirms(sampleVerdict, otherVerdict))
pure def lawDisagreementNeverConfirms(sampleVerdict: AssessedVerdict, otherVerdict: AssessedVerdict): bool =
  sampleVerdict.verdict.category != otherVerdict.verdict.category implies not(confirms(sampleVerdict, otherVerdict))
pure def lawSameCallNeverConfirms(sampleVerdict: AssessedVerdict): bool = not(confirms(sampleVerdict, sampleVerdict))
```

### Closing also needs current production activation, a qualified category and every independent gate

One gate observation carries the source, participation and activation read
together, with a sequence number that increases with each read. The closure
gates are: active full-review scope, a current open PR (never an issue) with
complete coverage, no assignee, a known non-maintainer author, effective
closure consent, a close mode for the category, participation authority, the
global switch on with the category qualified (and the objective verifier for
low quality), two confirming verdicts, and no reopen or appeal of this
revision. The close attempt evaluates the same gates again on a later
observation before it reserves capacity.

```quint
type ActivationView = { enabled: bool, category: F::Category, categoryQualified: bool, verifierQualified: bool }
type GateObservation = { seq: int, source: SourceObservation, participation: ParticipationEvidence,
  activation: ActivationView }
pure val inactive: ActivationView = { enabled: false, category: F::NoFinding, categoryQualified: false, verifierQualified: false }
pure val unobserved: GateObservation = { seq: 0, source: unknownSource, participation: noParticipation, activation: inactive }
pure def activationAllows(a: ActivationView, category: F::Category): bool =
  a.enabled and a.category == category and a.categoryQualified and
  (not(F::requiresObjectiveVerifier(category)) or a.verifierQualified)
pure def closePolicyFor(g: GateObservation, identity: ReviewIdentity, category: F::Category): bool =
  mayActOrdinaryFor(g.source, identity) and identity.kind == PullRequest and
  g.source.assignment == Unassigned and g.source.authorRole == NonMaintainer and effectiveClosure(g.source) and
  effectiveMode(g.source, category) == ModeClose and F::permittedAction(category) == F::CloseAllowed
pure def closePathFor(g: GateObservation, identity: ReviewIdentity, category: F::Category): bool =
  closePolicyFor(g, identity, category) and participationAuthority(g.participation, identity) and
  activationAllows(g.activation, category)
pure def closeGatesFor(g: GateObservation, identity: ReviewIdentity, t: AssessedVerdict, k: AssessedVerdict): bool =
  closePathFor(g, identity, t.verdict.category) and confirms(t, k)
pure def lawInactiveNeverAllows(category: F::Category): bool = not(activationAllows(inactive, category))
pure def lawIssuesNeverPassGates(g: GateObservation, identity: ReviewIdentity, category: F::Category): bool =
  identity.kind == Issue implies not(closePolicyFor(g, identity, category))
```

### A decision is recorded once and keeps its scope, verdicts and outcome

`decide` records exactly one outcome for the revision: advisory (no finding,
limited coverage or mode off), a certain label, an uncertain finding for the
maintainer hold, a security-only comment, or a close candidate. A close
candidate starts its close attempt, which reserves capacity only after a
later recheck. A budget-blocked or failed confirm call leaves the revision
triaged and retryable; it never decides. The initial observation, with
sequence number zero, is unusable, so every decision is made on a real read.

```quint
type Phase = Unreviewed | Triaged | Decided
type ClosureOutcome = Undecided | Advisory | LabelFinding | Uncertain | SecurityAdvisory | CloseCandidate
type Closure = { identity: ReviewIdentity, gate: GateObservation, phase: Phase, triage: AssessedVerdict,
  hasConfirm: bool, confirm: AssessedVerdict, outcome: ClosureOutcome, decidedScope: RepositoryScope, decidedSeq: int,
  findingLabel: bool, securityCommented: bool, maintainerReopened: bool, authorAppealed: bool, appealUpheld: bool }
pure val initial: Closure = { identity: reviewedItem, gate: unobserved, phase: Unreviewed, triage: notAssessed,
  hasConfirm: false, confirm: notAssessed, outcome: Undecided, decidedScope: Unregistered, decidedSeq: 0,
  findingLabel: false, securityCommented: false, maintainerReopened: false, authorAppealed: false, appealUpheld: false }
pure def revisionDisputed(c: Closure): bool = c.maintainerReopened or c.authorAppealed or c.appealUpheld
pure def mayReview(c: Closure): bool = sourceUsable(c.gate.source, c.identity) and not(revisionDisputed(c))
pure def mayPostOrdinary(c: Closure): bool = mayPostOrdinaryFor(c.gate.source, c.identity) and not(revisionDisputed(c))
pure def mayActOrdinary(c: Closure): bool = mayActOrdinaryFor(c.gate.source, c.identity) and not(revisionDisputed(c))
pure def mayPostSecurity(c: Closure): bool = c.gate.source.scope == SecurityOnly and c.gate.source.securityAuthorized and mayReview(c)
pure def closePath(c: Closure): bool = closePathFor(c.gate, c.identity, c.triage.verdict.category)
pure def closeGates(c: Closure): bool = c.hasConfirm and closeGatesFor(c.gate, c.identity, c.triage, c.confirm)
pure def uncertainFinding(c: Closure): bool = c.triage.verdict.category != F::NoFinding and
  (initiallyUncertain(c.triage) or (closePath(c) and (c.triage.verdict.deterministic or
    (c.hasConfirm and not(confirms(c.triage, c.confirm))))))
pure def canObserve(c: Closure, observation: GateObservation): bool =
  observation.seq > c.gate.seq and observation.source.identity == c.identity
pure def observe(c: Closure, observation: GateObservation): Closure = { ...c, gate: observation }
pure def canRecordTriage(c: Closure, verdict: Verdict, grounding: GroundingCheck, related: RelatedItemCheck): bool =
  c.phase == Unreviewed and validVerdict(verdict) and (mayPostOrdinary(c) or mayPostSecurity(c))
pure def recordTriage(c: Closure, verdict: Verdict, grounding: GroundingCheck, related: RelatedItemCheck): Closure =
  { ...c, phase: Triaged, triage: assess(verdict, grounding, related, c.identity) }
pure def needsConfirm(c: Closure): bool = closePath(c) and not(initiallyUncertain(c.triage)) and
  not(c.triage.verdict.deterministic) and not(c.hasConfirm)
pure def canRecordConfirm(c: Closure, verdict: Verdict, grounding: GroundingCheck, related: RelatedItemCheck): bool =
  c.phase == Triaged and validVerdict(verdict) and needsConfirm(c) and mayPostOrdinary(c)
pure def recordConfirm(c: Closure, verdict: Verdict, grounding: GroundingCheck, related: RelatedItemCheck): Closure =
  { ...c, hasConfirm: true, confirm: assess(verdict, grounding, related, c.identity) }
pure def outcomeFor(c: Closure): ClosureOutcome =
  if (c.gate.source.scope == SecurityOnly) SecurityAdvisory
  else if (c.triage.verdict.category == F::NoFinding or c.gate.source.coverage != CoverageComplete or
    effectiveMode(c.gate.source, c.triage.verdict.category) == ModeOff) Advisory
  else if (uncertainFinding(c)) Uncertain
  else if (closeGates(c)) CloseCandidate
  else LabelFinding
pure def canDecide(c: Closure): bool = c.phase == Triaged and
  (if (c.gate.source.scope == SecurityOnly) mayPostSecurity(c) else mayPostOrdinary(c) and not(needsConfirm(c)))
pure def decide(c: Closure): Closure =
  { ...c, phase: Decided, outcome: outcomeFor(c), decidedScope: c.gate.source.scope, decidedSeq: c.gate.seq }
pure def alwaysUnobservedIsUnusable(c: Closure): bool =
  c.gate.seq >= 0 and (c.gate.seq == 0 implies not(sourceUsable(c.gate.source, c.identity)))
pure def alwaysOutcomeOnlyWhenDecided(c: Closure): bool = (c.phase == Decided) iff (c.outcome != Undecided)
pure def alwaysConfirmOnlyAfterTriage(c: Closure): bool = c.hasConfirm implies c.phase != Unreviewed
pure def alwaysOrdinaryOutcomesActive(c: Closure): bool =
  (c.outcome == Advisory or c.outcome == LabelFinding or c.outcome == Uncertain or c.outcome == CloseCandidate)
    implies c.decidedScope == Active
pure def alwaysSecurityDecisionKeepsScope(c: Closure): bool =
  (c.outcome == SecurityAdvisory iff (c.phase == Decided and c.decidedScope == SecurityOnly)) and
  (c.phase == Decided implies (c.decidedScope == Active or c.decidedScope == SecurityOnly))
pure def alwaysCandidateConfirmed(c: Closure): bool = c.outcome == CloseCandidate implies
  c.hasConfirm and confirms(c.triage, c.confirm) and c.identity.kind == PullRequest and
  F::permittedAction(c.triage.verdict.category) == F::CloseAllowed and c.decidedSeq > 0
pure def alwaysUncertainOrCandidateHasFinding(c: Closure): bool =
  (c.outcome == Uncertain or c.outcome == CloseCandidate or c.outcome == LabelFinding) implies
    c.triage.verdict.category != F::NoFinding
pure def stepDecisionImmutable(before: Closure, after: Closure): bool = before.phase == Decided implies
  after.phase == Decided and after.outcome == before.outcome and after.decidedScope == before.decidedScope and
  after.triage == before.triage and after.confirm == before.confirm and after.hasConfirm == before.hasConfirm and
  after.decidedSeq == before.decidedSeq
pure def stepIdentityFixed(before: Closure, after: Closure): bool = after.identity == before.identity
pure def stepObservationsAdvance(before: Closure, after: Closure): bool = after.gate.seq >= before.gate.seq
pure def sometimesAdvisory(c: Closure): bool = c.outcome == Advisory
pure def sometimesUncertainOutcome(c: Closure): bool = c.outcome == Uncertain
pure def sometimesCloseCandidate(c: Closure): bool = c.outcome == CloseCandidate
```

## Story: Label certain findings and security results without closing

### A certain finding that cannot close is labeled once; out-of-scope and missing evidence are label-only

Source `runReview`: a certain finding whose close is blocked by a policy gate
(no consent, an ineligible author, mode label, inactive switch) is commented
and labeled with its category label. Issues are labeled and never closed. A
close candidate whose close is later blocked is labeled by its close attempt.

```quint
pure def canLabelFinding(c: Closure): bool =
  c.outcome == LabelFinding and mayActOrdinary(c) and not(c.findingLabel) and
  effectiveMode(c.gate.source, c.triage.verdict.category) != ModeOff
pure def labelFinding(c: Closure): Closure = { ...c, findingLabel: true }
pure def alwaysLabelOnlyCategoriesNeverCandidates(c: Closure): bool =
  F::neverCloses(c.triage.verdict.category) implies c.outcome != CloseCandidate
pure def alwaysFindingLabelFollowsOutcome(c: Closure): bool = c.findingLabel implies
  (c.outcome == LabelFinding or (c.outcome == SecurityAdvisory and c.triage.verdict.category == F::Scam))
pure def sometimesLabeledFinding(c: Closure): bool = c.findingLabel and c.outcome == LabelFinding
```

### A restricted project permits only an authorized security comment and the confirmed scam label

```quint
pure def canCommentSecurity(c: Closure): bool = c.outcome == SecurityAdvisory and mayPostSecurity(c) and not(c.securityCommented)
pure def commentSecurity(c: Closure): Closure = { ...c, securityCommented: true }
pure def canLabelSecurityScam(c: Closure): bool = c.outcome == SecurityAdvisory and mayPostSecurity(c) and
  c.gate.source.coverage == CoverageComplete and
  F::securityCategory(c.triage.verdict.category) and not(initiallyUncertain(c.triage)) and not(c.findingLabel)
pure def labelSecurityScam(c: Closure): Closure = { ...c, findingLabel: true }
pure def alwaysRestrictedNeverCandidate(c: Closure): bool = c.decidedScope == SecurityOnly implies c.outcome != CloseCandidate
pure def alwaysSecurityLabelIsScam(c: Closure): bool =
  (c.findingLabel and c.decidedScope == SecurityOnly) implies c.triage.verdict.category == F::Scam
pure def sometimesRestrictedScamLabel(c: Closure): bool =
  c.decidedScope == SecurityOnly and c.triage.verdict.category == F::Scam and c.securityCommented and c.findingLabel
```

## Story: Reopen and appeal decisions stop further automatic action on the revision

### A maintainer reopen or an author appeal blocks further review actions on that revision

A confirmed reopen event binds the actor, the reopened revision and its
event time. A current maintainer's reopen is a maintainer decision and always
wins. The author's reopen of their own item is an appeal of the revision it
reopened. A reopen by anyone else records no decision (source
`recordHumanSignal`; the README's "any reopen" means these two). An author's
`/slopbot appeal` also disputes the revision. An author's appeal of a
revision that no finding covers decides nothing for that revision, which
keeps its own review (`appeal-before-finding`). Each blocks review actions on
this revision; a newer head is a new instance.

```quint
type ReopenActorRole = ReopenByMaintainer | ReopenByAuthor | ReopenByOther
type ReopenEvidence = { itemNode: str, revision: str, actor: int, role: ReopenActorRole, at: int }
pure def findingRecorded(c: Closure): bool = c.phase == Decided and c.triage.verdict.category != F::NoFinding
pure def canObserveReopen(c: Closure, reopen: ReopenEvidence): bool =
  reopen.itemNode == c.identity.itemNode and reopen.revision == c.identity.revision and reopen.at > 0 and
  (reopen.role == ReopenByMaintainer or
    (reopen.role == ReopenByAuthor and reopen.actor == c.identity.author and findingRecorded(c)))
pure def observeReopen(c: Closure, reopen: ReopenEvidence): Closure =
  if (reopen.role == ReopenByMaintainer) { ...c, maintainerReopened: true } else { ...c, authorAppealed: true }
pure def canObserveAuthorAppeal(c: Closure, appellant: int): bool =
  appellant == c.identity.author and appellant > 0 and findingRecorded(c)
pure def observeAuthorAppeal(c: Closure, appellant: int): Closure = { ...c, authorAppealed: true }
pure def alwaysAppealCoversFinding(c: Closure): bool = (c.authorAppealed or c.appealUpheld) implies findingRecorded(c)
pure def stepDisputeIsPermanent(before: Closure, after: Closure): bool =
  (before.maintainerReopened implies after.maintainerReopened) and (before.authorAppealed implies after.authorAppealed) and
  (before.appealUpheld implies after.appealUpheld)
pure def stepNoLabelAfterDispute(before: Closure, via: str, after: Closure): bool =
  (via == "labelFinding" or via == "labelSecurityScam") implies not(revisionDisputed(before))
pure def sometimesMaintainerReopened(c: Closure): bool = c.maintainerReopened and c.findingLabel
```

### An upheld appeal or a maintainer reopen removes the decision's finding label

Source `finishAppeal` and `reconcileConfirmedReopen`: the finding label is
removed and GitHub must confirm removal or absence. The appeal and debit
journals own their resolutions; this model only consumes the outcome.

```quint
type AppealVerdict = AppealUpheld | AppealDenied
type AppealOutcome = { itemNode: str, revision: str, verdict: AppealVerdict }
type RemovalEvidence = { itemNode: str, revision: str, confirmedRemoval: bool }
pure def canObserveAppealOutcome(c: Closure, appealOutcome: AppealOutcome): bool =
  appealOutcome.itemNode == c.identity.itemNode and appealOutcome.revision == c.identity.revision and
  appealOutcome.verdict == AppealUpheld and not(c.appealUpheld) and findingRecorded(c)
pure def observeAppealOutcome(c: Closure, appealOutcome: AppealOutcome): Closure = { ...c, appealUpheld: true }
pure def canRemoveLabel(c: Closure, removal: RemovalEvidence): bool =
  (c.appealUpheld or c.maintainerReopened) and c.findingLabel and
  removal.itemNode == c.identity.itemNode and removal.revision == c.identity.revision and removal.confirmedRemoval
pure def removeLabel(c: Closure, removal: RemovalEvidence): Closure = { ...c, findingLabel: false }
pure def sometimesLabelRemoved(c: Closure): bool = not(c.findingLabel) and c.appealUpheld and c.outcome == LabelFinding
```

### Simulation samples include allowed and refused repository, participation and verdict observations

The finite samples exercise changes after a review, closure opt-outs, absent
consent, an invalid file, ineligible participation and inactive activation.
They do not bound production values.

```quint
pure val verifiedSource: SourceObservation = { identity: reviewedItem, scope: Active, source: SourceCurrent,
  installation: InstallationActive, item: ItemOpen, closedBy: NotClosed, draft: false, coverage: CoverageComplete,
  assignment: Unassigned, authorRole: NonMaintainer, projectRevision: 3, consent: CC::Enabled,
  file: FileAbsent, fileClosure: false, modeCategory: F::NoFinding, fileMode: ModeOff, securityAuthorized: false }
pure val ownRun: PrOpenedEvent = { actor: 5, sessionActor: 5, project: 1, repository: 7, prNode: "pr" }
pure val eligibleParticipation: ParticipationEvidence = { member: 5, membership: MemberActive,
  events: List(ownRun), copiedMarker: false }
pure val activeSpam: ActivationView = { enabled: true, category: F::Spam, categoryQualified: true, verifierQualified: false }
pure val eligibleGate: GateObservation = { seq: 1, source: verifiedSource, participation: eligibleParticipation,
  activation: activeSpam }
pure val observationValues = Set(eligibleGate, { ...eligibleGate, seq: 2 },
  { ...eligibleGate, seq: 2, source: { ...verifiedSource, scope: SecurityOnly, securityAuthorized: true } },
  { ...eligibleGate, seq: 1, source: { ...verifiedSource, coverage: CoverageLimited } },
  { ...eligibleGate, seq: 3, source: { ...verifiedSource, consent: CC::Absent } })
pure val sampleObservationValues = Set(verifiedSource,
  { ...verifiedSource, scope: ReversalOnly }, { ...verifiedSource, consent: CC::Absent },
  { ...verifiedSource, consent: CC::Disabled }, { ...verifiedSource, coverage: CoverageLimited },
  { ...verifiedSource, file: FileValid, fileClosure: false, modeCategory: F::Spam, fileMode: ModeClose },
  { ...verifiedSource, file: FileValid, fileClosure: true, modeCategory: F::OutOfScope, fileMode: ModeClose },
  { ...verifiedSource, file: FileInvalid }, { ...verifiedSource, assignment: Assigned },
  { ...verifiedSource, authorRole: RoleUnknown }, { ...verifiedSource, item: ItemClosed, closedBy: ClosedByHuman })
pure val sampleRunValues = Set(eligibleParticipation,
  { ...eligibleParticipation, membership: MemberClosed },
  { ...eligibleParticipation, events: List({ ...ownRun, sessionActor: 6 }), copiedMarker: true },
  { ...eligibleParticipation, events: List({ ...ownRun, prNode: "other" }) },
  { ...eligibleParticipation, events: List({ ...ownRun, repository: 8 }) })
pure val spamVerdict: Verdict = { callId: "t", category: F::Spam, confidenceHundredths: 95, limitations: false,
  objectiveDefect: "", deterministic: false }
pure val verdictValues = Set(spamVerdict, { ...spamVerdict, callId: "k" },
  { ...spamVerdict, callId: "k", confidenceHundredths: 89 }, { ...spamVerdict, category: F::Scam },
  { ...spamVerdict, category: F::OutOfScope })
pure val groundingValues = Set({ callId: "t", contentDigest: "review", evidenceFound: true, policy: PolicyComplete, ruleFound: true },
  { callId: "k", contentDigest: "review", evidenceFound: true, policy: PolicyComplete, ruleFound: true },
  { callId: "t", contentDigest: "review", evidenceFound: true, policy: PolicyTruncated, ruleFound: true })
pure val checkValues = Set({ callId: "t", contentDigest: "review", evidenceFound: true, policy: PolicyComplete, ruleFound: true },
  { callId: "t", contentDigest: "review", evidenceFound: true, policy: PolicyTruncated, ruleFound: true },
  { callId: "t", contentDigest: "other", evidenceFound: true, policy: PolicyComplete, ruleFound: true })
pure val relatedValues = Set({ itemNode: "pr", relatedNode: "", author: 5, relatedOpen: false, sameContent: false })
pure val assessedSpam: AssessedVerdict = { verdict: spamVerdict, grounded: true, related: false }
pure val sampleVerdictValues = Set(assessedSpam, { ...assessedSpam, grounded: false },
  { ...assessedSpam, verdict: { ...spamVerdict, confidenceHundredths: 89 } },
  { ...assessedSpam, verdict: { ...spamVerdict, deterministic: true } },
  { ...assessedSpam, verdict: { ...spamVerdict, callId: "k", category: F::Busywork } },
  { ...assessedSpam, verdict: { ...spamVerdict, limitations: true } },
  { ...assessedSpam, verdict: { ...spamVerdict, category: F::Duplicate } },
  { ...assessedSpam, verdict: { ...spamVerdict, callId: "k", category: F::Duplicate }, related: true },
  { ...assessedSpam, verdict: { ...spamVerdict, category: F::LowQuality, objectiveDefect: "d" } },
  { ...assessedSpam, verdict: { ...spamVerdict, callId: "k", category: F::LowQuality, objectiveDefect: "e" } },
  { ...assessedSpam, verdict: { ...spamVerdict, callId: "k" } })
pure val otherVerdictValues = sampleVerdictValues
pure val vValues = Set(spamVerdict, { ...spamVerdict, category: F::Busywork }, { ...spamVerdict, deterministic: true })
pure val gValues = Set(eligibleGate, { ...eligibleGate, source: { ...verifiedSource, identity: { ...reviewedItem, kind: Issue } } })
pure val identityValues = Set(reviewedItem, { ...reviewedItem, author: 6 }, { ...reviewedItem, kind: Issue })
pure val reopenValues = Set({ itemNode: "pr", revision: "head", actor: 9, role: ReopenByMaintainer, at: 50 },
  { itemNode: "pr", revision: "head", actor: 5, role: ReopenByAuthor, at: 50 },
  { itemNode: "pr", revision: "head", actor: 6, role: ReopenByOther, at: 50 })
pure val appellantValues = Set(5, 6)
pure val appealOutcomeValues = Set({ itemNode: "pr", revision: "head", verdict: AppealUpheld })
pure val removalValues = Set({ itemNode: "pr", revision: "head", confirmedRemoval: true })
pure val weight_observe = 4
pure val weight_recordTriage = 10
pure val weight_recordConfirm = 10
pure val weight_decide = 10
pure val weight_labelFinding = 6
pure val weight_commentSecurity = 15
pure val weight_labelSecurityScam = 15
pure val weight_removeLabel = 6
```
