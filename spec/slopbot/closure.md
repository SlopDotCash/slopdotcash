# Qualified automatic closure

PRD section 5 governs closure. The user's migration instruction chooses the
unchecked default from the supplied AGENTS.md. This overrides the source
PRD's selected-new-draft default for this branch. Saved absence means false.

## Story: Close only a verified consenting participant's eligible PR

### A new draft starts with no saved closure consent

```quint
type ClosureCategory = Spam | Scam | RuleViolation | LowQuality | Duplicate | OutOfScope
type Closure = { consent: bool, member: bool, authenticatedRun: bool, exactPr: bool, maintainer: bool, qualified: bool, independent: bool, withinCap: bool, production: bool, sourceCurrent: bool, verdictRecorded: bool, uncertain: bool, daysWaiting: int, closed: bool, labelApplied: bool, reopened: bool, category: ClosureCategory, moderatorNotice: bool }
pure val initial: Closure = { consent: false, member: false, authenticatedRun: false, exactPr: false, maintainer: false, qualified: false, independent: false, withinCap: false, production: false, sourceCurrent: false, verdictRecorded: false, uncertain: false, daysWaiting: 0, closed: false, labelApplied: false, reopened: false, category: OutOfScope, moderatorNotice: false }
pure def canSaveConsent(c: Closure, currentOwner: bool): bool = currentOwner and not(c.closed)
pure def saveConsent(c: Closure, currentOwner: bool, consent: bool): Closure = { ...c, consent: consent }
```

### Participant evidence binds the member, authenticated run and exact PR

Copied footers and markers provide no membership or run proof. Permanent GitHub
actor and PR node IDs must match the author's own recorded authenticated event.

```quint
pure def canRecordParticipant(c: Closure): bool = not(c.closed)
pure def recordParticipant(c: Closure, member: bool, authenticatedRun: bool, exactPr: bool, maintainer: bool): Closure = { ...c, member: member, authenticatedRun: authenticatedRun, exactPr: exactPr, maintainer: maintainer }
pure def canRecordQualification(c: Closure): bool = not(c.closed)
pure def recordQualification(c: Closure, qualified: bool, independent: bool, withinCap: bool): Closure = { ...c, qualified: qualified, independent: independent, withinCap: withinCap }
pure def canRecordActivation(c: Closure): bool = not(c.closed)
pure def recordActivation(c: Closure, production: bool, sourceCurrent: bool): Closure = { ...c, production: production, sourceCurrent: sourceCurrent }
pure def canRecordVerdict(c: Closure): bool = not(c.closed)
pure def recordVerdict(c: Closure, uncertain: bool, category: ClosureCategory): Closure = { ...c, verdictRecorded: true, uncertain: uncertain, category: category }
```

### A close requires every independent eligibility gate

The published category table allows closure for spam, scam, quoted-rule
violations, qualified low-quality findings and duplicates. An out-of-scope
finding can receive a label and leaves the pull request open.

```quint
pure def eligible(c: Closure): bool = c.consent and c.member and c.authenticatedRun and c.exactPr and not(c.maintainer) and c.qualified and c.independent and c.withinCap and c.production and c.sourceCurrent and c.verdictRecorded and not(c.uncertain) and not(c.reopened) and c.category != OutOfScope
pure def canClose(c: Closure): bool = not(c.closed) and eligible(c)
pure def close(c: Closure): Closure = { ...c, closed: true, moderatorNotice: c.category == Scam }
pure def alwaysCloseEligible(c: Closure): bool = c.closed implies eligible(c)
pure def alwaysScamNotice(c: Closure): bool = c.closed and c.category == Scam implies c.moderatorNotice
pure def alwaysOutOfScopeStaysOpen(c: Closure): bool = c.category == OutOfScope implies not(c.closed)
pure def canLabelOutOfScope(c: Closure): bool = c.verdictRecorded and c.category == OutOfScope and not(c.uncertain) and c.sourceCurrent and not(c.labelApplied) and not(c.closed)
pure def labelOutOfScope(c: Closure): Closure = { ...c, labelApplied: true }
pure def sometimesClosed(c: Closure): bool = c.closed
```

### Uncertain findings can only become a label after seven days

```quint
pure def canWait(c: Closure, days: int): bool = not(c.closed) and days >= c.daysWaiting
pure def wait(c: Closure, days: int): Closure = { ...c, daysWaiting: days }
pure val daysValues = Set(0, 6, 7, 8)
pure def canLabelUncertain(c: Closure): bool = c.verdictRecorded and c.uncertain and c.daysWaiting >= 7 and not(c.labelApplied) and not(c.closed)
pure def labelUncertain(c: Closure): Closure = { ...c, labelApplied: true }
pure def canReopen(c: Closure): bool = c.closed
pure def reopen(c: Closure): Closure = { ...c, closed: false, reopened: true }
pure def alwaysUncertainNeverCloses(c: Closure): bool = c.uncertain implies not(c.closed)
pure def sometimesUncertainLabel(c: Closure): bool = c.uncertain and c.labelApplied and not(c.closed)
pure def sometimesReopened(c: Closure): bool = c.reopened and not(c.closed)
```

Existing `.github/slopbot.json` opt-outs and category restrictions remain
effective. Paused, flagged and quarantined repositories permit authorized
security comments and scam labels only. Retired repositories receive no review.
Real-case qualification and explicit production activation are required.
Objective-defect categories remain unavailable without their qualified verifier.
A fixed elapsed period or item count supplies no model-quality qualification.
Closure alone never authorizes a penalty.
