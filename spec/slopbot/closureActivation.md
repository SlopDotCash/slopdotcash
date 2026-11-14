# Closure activation and qualification

PRD section 5 "Appeals, qualification, and cost": qualify closure with
reviewed real cases and counterexamples; a fixed 14-day or 50-item threshold
is not sufficient; fixtures prove controls, not model quality; keep the
global switch off until explicit production activation; record the reviewed
evidence and any qualified objective verifier. CLAUDE.md "Automatic closure"
repeats that qualification uses reviewed real cases and counterexamples and
that the current global closure switch stays off until reviewed production
activation. Source: `workers/slopbot/wrangler.toml` ships
`SLOPBOT_CLOSURE_ENABLED = "false"`, `review.ts` (`closureState`,
`qualityQualified`) and `QUALITY.md` (`slopbot_quality_shadow`,
`SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256`).

This machine owns the switch, the per-category qualification records and the
objective verifier qualification. [Closure](./closure.md) consumes its
`ActivationView`. The owner identity (`owner` below) and the release flow
that carries the decision are shell obligations: the shell must accept an
activation only from the owner's reviewed production release, never from a
request, a fixture or a model.

## Story: Keep closure off until the owner activates it with reviewed evidence

### Each closable category needs its own reviewed real cases and counterexamples

A qualification binds one closable category to a digest of the reviewed
evidence set, the number of reviewed real cases and the number of reviewed
counterexamples (each at least one), and the reviewer. Counts and elapsed
time alone never qualify: the reviewed evidence digest and its reviewer are
required. Label-only categories cannot be qualified for closure. A
qualification can be revoked; the history keeps every record.

```quint
import categories as F from "./categories"
type QualificationReview = { category: F::Category, realCases: int, counterexamples: int,
  evidenceDigest: str, reviewer: int, elapsedDays: int }
type Qualification = { category: F::Category, evidenceDigest: str, reviewer: int, active: bool }
type VerifierReview = { profileDigest: str, shadowRecorded: bool, reviewer: int }
type EntryKind = Qualified | Revoked | VerifierQualified | VerifierRevoked | Activated | Deactivated
type Entry = { kind: EntryKind, by: int, category: F::Category }
type Activation = { owner: int, enabled: bool, qualifications: List[Qualification], verifierProfile: str,
  journal: List[Entry] }
pure val initial: Activation = { owner: 18633264, enabled: false, qualifications: List(), verifierProfile: "",
  journal: List() }
pure def reviewedEvidence(review: QualificationReview): bool =
  review.realCases > 0 and review.counterexamples > 0 and review.evidenceDigest != "" and review.reviewer > 0
pure def qualified(a: Activation, category: F::Category): bool =
  a.qualifications.some(q => q.category == category and q.active)
pure def canQualify(a: Activation, by: int, review: QualificationReview): bool =
  by == a.owner and F::permittedAction(review.category) == F::CloseAllowed and reviewedEvidence(review) and
  not(qualified(a, review.category))
pure def qualify(a: Activation, by: int, review: QualificationReview): Activation =
  { ...a, qualifications: a.qualifications.append({ category: review.category, evidenceDigest: review.evidenceDigest,
      reviewer: review.reviewer, active: true }),
    journal: a.journal.append({ kind: Qualified, by: by, category: review.category }) }
pure def canRevoke(a: Activation, by: int, category: F::Category): bool = by == a.owner and qualified(a, category)
pure def revoke(a: Activation, by: int, category: F::Category): Activation =
  { ...a, qualifications: a.qualifications.listMap(q => if (q.category == category) { ...q, active: false } else q),
    journal: a.journal.append({ kind: Revoked, by: by, category: category }) }
pure def lawCountsAloneNeverQualify(review: QualificationReview): bool =
  (review.evidenceDigest == "" or review.reviewer <= 0) implies not(reviewedEvidence(review))
pure def lawCounterexamplesRequired(review: QualificationReview): bool =
  review.counterexamples <= 0 implies not(reviewedEvidence(review))
pure def alwaysOnlyClosableQualified(a: Activation): bool = a.qualifications.every(q =>
  F::permittedAction(q.category) == F::CloseAllowed and q.evidenceDigest != "" and q.reviewer > 0)
```

### Objective low-quality closure also needs a qualified verifier profile

No verifier host exists today, so this path stays unavailable until the
owner records a reviewed profile with retained shadow evidence.

```quint
pure def canQualifyVerifier(a: Activation, by: int, verifier: VerifierReview): bool =
  by == a.owner and verifier.profileDigest != "" and verifier.shadowRecorded and verifier.reviewer > 0 and
  a.verifierProfile == ""
pure def qualifyVerifier(a: Activation, by: int, verifier: VerifierReview): Activation =
  { ...a, verifierProfile: verifier.profileDigest,
    journal: a.journal.append({ kind: VerifierQualified, by: by, category: F::LowQuality }) }
pure def canRevokeVerifier(a: Activation, by: int): bool = by == a.owner and a.verifierProfile != ""
pure def revokeVerifier(a: Activation, by: int): Activation =
  { ...a, verifierProfile: "", journal: a.journal.append({ kind: VerifierRevoked, by: by, category: F::LowQuality }) }
```

### Only the owner switches closure on, only with a qualified category, and may switch it off at any time

```quint
pure def canActivate(a: Activation, by: int): bool =
  by == a.owner and not(a.enabled) and a.qualifications.some(q => q.active)
pure def activate(a: Activation, by: int): Activation =
  { ...a, enabled: true, journal: a.journal.append({ kind: Activated, by: by, category: F::NoFinding }) }
pure def canDeactivate(a: Activation, by: int): bool = by == a.owner and a.enabled
pure def deactivate(a: Activation, by: int): Activation =
  { ...a, enabled: false, journal: a.journal.append({ kind: Deactivated, by: by, category: F::NoFinding }) }
pure def categoryOpen(a: Activation, category: F::Category): bool =
  a.enabled and qualified(a, category) and (not(F::requiresObjectiveVerifier(category)) or a.verifierProfile != "")
pure def alwaysJournalByOwner(a: Activation): bool = a.journal.every(e => e.by == a.owner)
pure def alwaysEnabledWasActivated(a: Activation): bool =
  a.enabled implies a.journal.some(e => e.kind == Activated)
pure def stepJournalAppendOnly(before: Activation, after: Activation): bool =
  after.journal.length() >= before.journal.length() and before.journal.every(e => after.journal.includes(e))
pure def stepOwnerFixed(before: Activation, after: Activation): bool = after.owner == before.owner
pure def sometimesActive(a: Activation): bool = categoryOpen(a, F::Spam)
pure def sometimesDeactivatedAfterUse(a: Activation): bool = not(a.enabled) and a.journal.some(e => e.kind == Deactivated)
pure def sometimesQualifiedButOff(a: Activation): bool = not(a.enabled) and qualified(a, F::Spam)
pure def sometimesObjectiveOpen(a: Activation): bool = categoryOpen(a, F::LowQuality)
```

### Simulation samples include unreviewed counts, label-only categories and other actors

```quint
pure val reviewed: QualificationReview = { category: F::Spam, realCases: 12, counterexamples: 4,
  evidenceDigest: "cases", reviewer: 202660855, elapsedDays: 3 }
pure val reviewValues = Set(reviewed, { ...reviewed, category: F::LowQuality },
  { ...reviewed, evidenceDigest: "", realCases: 50, elapsedDays: 14 }, { ...reviewed, counterexamples: 0 },
  { ...reviewed, category: F::OutOfScope })
pure val verifierValues = Set({ profileDigest: "profile", shadowRecorded: true, reviewer: 202660855 },
  { profileDigest: "profile", shadowRecorded: false, reviewer: 202660855 })
pure val byValues = Set(18633264, 202660855)
pure val weight_qualify = 4
pure val weight_activate = 4
```
