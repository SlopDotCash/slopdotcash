# Closure activation and qualification

PRD section 5 "Appeals, qualification, and cost": qualify closure with
reviewed real cases and counterexamples; a fixed 14-day or 50-item threshold
is not sufficient; fixtures prove controls, not model quality; keep the
global switch off until explicit production activation; record the reviewed
evidence and any qualified objective verifier. PRD section 11 (launch):
closure categories that require an objective-defect receipt stay unavailable
without their own qualified verifier, and
`SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256` stays unset for launch. CLAUDE.md
"Automatic closure" repeats that qualification uses reviewed real cases and
counterexamples and that the current global closure switch stays off until
reviewed production activation. Source: `workers/slopbot/wrangler.toml`
ships `SLOPBOT_CLOSURE_ENABLED = "false"`, `review.ts` (`closureState`,
`qualityQualified`) and `QUALITY.md` (`slopbot_quality_shadow`,
`SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256`).

This machine owns the switch, the per-category qualification records and the
objective verifier qualification. [Closure](./closure.md) and the
[close attempt](./closeAttempt.md) consume its `ActivationView`.

Two choices have no recorded owner decision, so each is a gate that refuses
until an owner decision record exists: which identity may record a
qualification, and when the launch restriction on the objective verifier
ends. An `OwnerDecision` record carries the reference of the decision in the
reviewed repository (CLAUDE.md or the PRD) as merged to `main`; producing it
only from such a merged decision, never from a request, a fixture or a
model, is a shell obligation.

## Story: Keep closure off until a reviewed production release activates it with reviewed evidence

### Each closable category needs its own reviewed real cases and counterexamples, recorded by the decided qualifier

A qualification binds one closable category to a digest of the reviewed
evidence set, the number of reviewed real cases and the number of reviewed
counterexamples (each at least one), and the reviewer. Counts and elapsed
time alone never qualify: the reviewed evidence digest and its reviewer are
required. Label-only categories cannot be qualified for closure. Only the
qualifier named by a recorded owner decision may record or revoke one, and
until that decision exists nothing qualifies. A qualification can be
revoked; the history keeps every record.

```quint
import categories as F from "./categories"
type DecisionKind = QualifierNamed | VerifierLaunchLifted
type OwnerDecision = { kind: DecisionKind, reference: str, actor: int }
type QualificationReview = { category: F::Category, realCases: int, counterexamples: int,
  evidenceDigest: str, reviewer: int, elapsedDays: int }
type Qualification = { category: F::Category, evidenceDigest: str, reviewer: int, active: bool }
type VerifierReview = { profileDigest: str, shadowRecorded: bool, reviewer: int }
type EntryKind = Decided | Qualified | Revoked | VerifierQualified | VerifierRevoked | Activated | Deactivated
type Entry = { kind: EntryKind, by: int, category: F::Category, reference: str }
type Activation = { qualifier: int, verifierLaunchLifted: bool, enabled: bool, lastRelease: int,
  qualifications: List[Qualification], verifierProfile: str, journal: List[Entry] }
pure val initial: Activation = { qualifier: 0, verifierLaunchLifted: false, enabled: false, lastRelease: 0,
  qualifications: List(), verifierProfile: "", journal: List() }
pure def canRecordDecision(a: Activation, decision: OwnerDecision): bool = decision.reference != "" and
  (if (decision.kind == QualifierNamed) a.qualifier == 0 and decision.actor > 0 else not(a.verifierLaunchLifted))
pure def recordDecision(a: Activation, decision: OwnerDecision): Activation =
  { ...a, qualifier: if (decision.kind == QualifierNamed) decision.actor else a.qualifier,
    verifierLaunchLifted: a.verifierLaunchLifted or decision.kind == VerifierLaunchLifted,
    journal: a.journal.append({ kind: Decided, by: decision.actor, category: F::NoFinding, reference: decision.reference }) }
pure def reviewedEvidence(review: QualificationReview): bool =
  review.realCases > 0 and review.counterexamples > 0 and review.evidenceDigest != "" and review.reviewer > 0
pure def qualified(a: Activation, category: F::Category): bool =
  a.qualifications.some(q => q.category == category and q.active)
pure def canQualify(a: Activation, by: int, review: QualificationReview): bool =
  a.qualifier > 0 and by == a.qualifier and F::permittedAction(review.category) == F::CloseAllowed and
  reviewedEvidence(review) and not(qualified(a, review.category))
pure def qualify(a: Activation, by: int, review: QualificationReview): Activation =
  { ...a, qualifications: a.qualifications.append({ category: review.category, evidenceDigest: review.evidenceDigest,
      reviewer: review.reviewer, active: true }),
    journal: a.journal.append({ kind: Qualified, by: by, category: review.category, reference: review.evidenceDigest }) }
pure def canRevoke(a: Activation, by: int, category: F::Category): bool =
  a.qualifier > 0 and by == a.qualifier and qualified(a, category)
pure def revoke(a: Activation, by: int, category: F::Category): Activation =
  { ...a, qualifications: a.qualifications.listMap(q => if (q.category == category) { ...q, active: false } else q),
    journal: a.journal.append({ kind: Revoked, by: by, category: category, reference: "" }) }
pure def lawCountsAloneNeverQualify(review: QualificationReview): bool =
  (review.evidenceDigest == "" or review.reviewer <= 0) implies not(reviewedEvidence(review))
pure def lawCounterexamplesRequired(review: QualificationReview): bool =
  review.counterexamples <= 0 implies not(reviewedEvidence(review))
pure def alwaysOnlyClosableQualified(a: Activation): bool = a.qualifications.every(q =>
  F::permittedAction(q.category) == F::CloseAllowed and q.evidenceDigest != "" and q.reviewer > 0)
pure def alwaysNothingQualifiedBeforeDecision(a: Activation): bool =
  a.qualifier == 0 implies a.qualifications.length() == 0 and a.verifierProfile == "" and not(a.enabled)
pure def stepDecisionsPermanent(before: Activation, after: Activation): bool =
  (before.qualifier > 0 implies after.qualifier == before.qualifier) and
  (before.verifierLaunchLifted implies after.verifierLaunchLifted)
pure def sometimesWaitingForDecision(a: Activation): bool = a.qualifier == 0 and a.journal.length() == 0
```

### Objective low-quality closure also needs a qualified verifier profile, which launch keeps unset

No verifier host exists today, and PRD section 11 keeps the verifier profile
unset for launch. A verifier can be qualified only after an owner decision
lifts that launch restriction, by the decided qualifier, with a reviewed
profile and retained shadow evidence.

```quint
pure def canQualifyVerifier(a: Activation, by: int, verifier: VerifierReview): bool =
  a.verifierLaunchLifted and a.qualifier > 0 and by == a.qualifier and verifier.profileDigest != "" and
  verifier.shadowRecorded and verifier.reviewer > 0 and a.verifierProfile == ""
pure def qualifyVerifier(a: Activation, by: int, verifier: VerifierReview): Activation =
  { ...a, verifierProfile: verifier.profileDigest,
    journal: a.journal.append({ kind: VerifierQualified, by: by, category: F::LowQuality, reference: verifier.profileDigest }) }
pure def canRevokeVerifier(a: Activation, by: int): bool = a.qualifier > 0 and by == a.qualifier and a.verifierProfile != ""
pure def revokeVerifier(a: Activation, by: int): Activation =
  { ...a, verifierProfile: "",
    journal: a.journal.append({ kind: VerifierRevoked, by: by, category: F::LowQuality, reference: "" }) }
pure def alwaysLaunchKeepsVerifierUnset(a: Activation): bool = not(a.verifierLaunchLifted) implies a.verifierProfile == ""
```

### Only a reviewed production release switches closure on, with a qualified category, and any later release may switch it off

The switch is `SLOPBOT_CLOSURE_ENABLED` in the Slopbot worker configuration.
It changes only with a release of the reviewed `main` branch through the
production release workflow, bound to the reviewed pull request and the
tested source commit. A release reporting the switch on activates closure
only when some category is qualified; a release reporting it off deactivates
it. Releases are taken in order; an older release never overrides a newer
one.

```quint
type ReleaseBranch = MainBranch | OtherBranch
type ReleaseWorkflow = ProductionRelease | OtherWorkflow
type ReleaseEvidence = { sequence: int, branch: ReleaseBranch, workflow: ReleaseWorkflow, reviewedPullRequest: int,
  sourceSha: str, closureEnabled: bool }
pure def reviewedRelease(a: Activation, release: ReleaseEvidence): bool =
  release.sequence > a.lastRelease and release.branch == MainBranch and release.workflow == ProductionRelease and
  release.reviewedPullRequest > 0 and release.sourceSha != ""
pure def canActivate(a: Activation, release: ReleaseEvidence): bool =
  reviewedRelease(a, release) and release.closureEnabled and not(a.enabled) and a.qualifications.some(q => q.active)
pure def activate(a: Activation, release: ReleaseEvidence): Activation =
  { ...a, enabled: true, lastRelease: release.sequence,
    journal: a.journal.append({ kind: Activated, by: 0, category: F::NoFinding, reference: release.sourceSha }) }
pure def canDeactivate(a: Activation, release: ReleaseEvidence): bool =
  reviewedRelease(a, release) and not(release.closureEnabled) and a.enabled
pure def deactivate(a: Activation, release: ReleaseEvidence): Activation =
  { ...a, enabled: false, lastRelease: release.sequence,
    journal: a.journal.append({ kind: Deactivated, by: 0, category: F::NoFinding, reference: release.sourceSha }) }
pure def categoryOpen(a: Activation, category: F::Category): bool =
  a.enabled and qualified(a, category) and (not(F::requiresObjectiveVerifier(category)) or a.verifierProfile != "")
pure def lawUnreviewedReleaseNeverActivates(a: Activation, release: ReleaseEvidence): bool =
  (release.branch != MainBranch or release.workflow != ProductionRelease or release.reviewedPullRequest <= 0) implies
    not(canActivate(a, release))
pure def alwaysJournalByDecidedActors(a: Activation): bool = a.journal.every(e =>
  e.kind == Decided or e.kind == Activated or e.kind == Deactivated or e.by == a.qualifier)
pure def alwaysEnabledWasActivated(a: Activation): bool =
  a.enabled implies a.journal.some(e => e.kind == Activated) and a.lastRelease > 0
pure def stepJournalAppendOnly(before: Activation, after: Activation): bool =
  after.journal.length() >= before.journal.length() and before.journal.every(e => after.journal.includes(e))
pure def stepReleasesInOrder(before: Activation, after: Activation): bool = after.lastRelease >= before.lastRelease
pure def sometimesActive(a: Activation): bool = categoryOpen(a, F::Spam)
pure def sometimesDeactivatedAfterUse(a: Activation): bool = not(a.enabled) and a.journal.some(e => e.kind == Deactivated)
pure def sometimesQualifiedButOff(a: Activation): bool = not(a.enabled) and qualified(a, F::Spam)
pure def sometimesObjectiveOpenAfterDecision(a: Activation): bool = categoryOpen(a, F::LowQuality) and a.verifierLaunchLifted
pure def sometimesLowQualityClosedAtLaunch(a: Activation): bool =
  a.enabled and qualified(a, F::LowQuality) and not(categoryOpen(a, F::LowQuality))
```

### Simulation samples include unreviewed counts, label-only categories, other actors and unreviewed releases

The decision samples are placeholders for the gates, not the owner's choice.

```quint
pure val reviewed: QualificationReview = { category: F::Spam, realCases: 12, counterexamples: 4,
  evidenceDigest: "cases", reviewer: 202660855, elapsedDays: 3 }
pure val reviewValues = Set(reviewed, { ...reviewed, category: F::LowQuality },
  { ...reviewed, evidenceDigest: "", realCases: 50, elapsedDays: 14 }, { ...reviewed, counterexamples: 0 },
  { ...reviewed, category: F::OutOfScope })
pure val verifierValues = Set({ profileDigest: "profile", shadowRecorded: true, reviewer: 202660855 },
  { profileDigest: "profile", shadowRecorded: false, reviewer: 202660855 })
pure val decisionValues = Set({ kind: QualifierNamed, reference: "decision-a", actor: 4 },
  { kind: VerifierLaunchLifted, reference: "decision-b", actor: 4 }, { kind: QualifierNamed, reference: "", actor: 4 })
pure val byValues = Set(4, 202660855)
pure val mainRelease: ReleaseEvidence = { sequence: 1, branch: MainBranch, workflow: ProductionRelease,
  reviewedPullRequest: 77, sourceSha: "sha1", closureEnabled: true }
pure val releaseValues = Set(mainRelease, { ...mainRelease, sequence: 2, closureEnabled: false },
  { ...mainRelease, sequence: 3 }, { ...mainRelease, sequence: 4, branch: OtherBranch },
  { ...mainRelease, sequence: 4, reviewedPullRequest: 0 })
pure val weight_recordDecision = 4
pure val weight_qualify = 4
pure val weight_activate = 4
```
