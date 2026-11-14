# Private case review, awards and disclosure

PRD sections 8 and 10 preserve independent screening, technical decisions,
discretionary award decisions, funding, payment, remediation and disclosure.
This machine starts from one durable receipt supplied by intake. Actor 1 is
the representative reporter, actors 2 and 3 are independent reviewers and
actor 4 represents a separate moderator. Real identity and current role bindings come from the case service.

## Story: Obtain a human case decision without automatic rejection

### Screening outcomes preserve a recoverable private case

```quint
type Screening = Waiting | Plausible | NeedsEvidence | SuspectedSpam | ProviderFailure
type Finding = Undecided | Confirmed | Duplicate | OutOfScope | Rejected | Disputed
type AwardDecision = PendingAward | CapacityExhausted | DeclinedAward | ApprovedAward
type RelatedReview = NotRelated | RelatedPending | RelatedApproved | RelatedRefused
type PrivateCase = { related: bool, relatedReview: RelatedReview, screening: Screening, finding: Finding, award: AwardDecision, authorityEpoch: int, reviewers: Set[int], deciders: Set[int], appealOpen: bool, previousFinding: Finding, notified: bool, patchDigest: int, verifiedPatch: int, approvedDisclosure: int, publishedDisclosure: int, recognitionConsent: bool }
pure val initial: PrivateCase = { related: false, relatedReview: NotRelated, screening: Waiting, finding: Undecided, award: PendingAward, authorityEpoch: 1, reviewers: Set(2, 3), deciders: Set(), appealOpen: false, previousFinding: Undecided, notified: false, patchDigest: 0, verifiedPatch: 0, approvedDisclosure: 0, publishedDisclosure: 0, recognitionConsent: false }
pure def canScreen(c: PrivateCase, result: Screening): bool = c.screening == Waiting and result != Waiting
pure def screen(c: PrivateCase, result: Screening): PrivateCase = { ...c, screening: result }
pure def canRetryScreen(c: PrivateCase): bool = c.screening == ProviderFailure or c.screening == NeedsEvidence
pure def retryScreen(c: PrivateCase): PrivateCase = { ...c, screening: Waiting }
pure def alwaysScreeningIsAdvisory(c: PrivateCase): bool = c.deciders.size() == 0 implies c.finding == Undecided and c.award == PendingAward
```

The private screening route uses Surplus `claude-sonnet-5.5` without fallback,
executes no submitted code, and treats every report field as untrusted data.
The marketplace model identity remains an external attribution limitation.
General review-provider fallback is specified separately for Slopbot.

### Current authorized reviewers decide technical findings and awards

Every sensitive action carries the checked authority epoch. Revocation advances
that epoch, so a response prepared under the former role cannot commit.
Self-approval by the reporter is refused. Prior deciders remain in the journal.

```quint
pure def canRevoke(c: PrivateCase, actor: int): bool = c.reviewers.contains(actor)
pure def revoke(c: PrivateCase, actor: int): PrivateCase = { ...c, reviewers: c.reviewers.exclude(Set(actor)), authorityEpoch: c.authorityEpoch + 1 }
pure def canDecide(c: PrivateCase, by: int, checkedEpoch: int, finding: Finding, related: bool): bool = c.reviewers.contains(by) and by != 1 and checkedEpoch == c.authorityEpoch and c.finding == Undecided and finding != Undecided and finding != Disputed
pure def decide(c: PrivateCase, by: int, checkedEpoch: int, finding: Finding, related: bool): PrivateCase = { ...c, finding: finding, related: related, relatedReview: if (related) RelatedPending else NotRelated, deciders: c.deciders.union(Set(by)) }
pure def canApproveAward(c: PrivateCase, by: int, checkedEpoch: int): bool = c.finding == Confirmed and (c.award == PendingAward or c.award == CapacityExhausted) and (not(c.related) or c.relatedReview == RelatedApproved) and c.reviewers.contains(by) and by != 1 and checkedEpoch == c.authorityEpoch
pure def approveAward(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase = { ...c, award: ApprovedAward, deciders: c.deciders.union(Set(by)) }
pure def canDeclineAward(c: PrivateCase, by: int, checkedEpoch: int): bool = c.finding == Confirmed and (c.award == PendingAward or c.award == CapacityExhausted) and c.reviewers.contains(by) and by != 1 and checkedEpoch == c.authorityEpoch
pure def declineAward(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase = { ...c, award: DeclinedAward, deciders: c.deciders.union(Set(by)) }
pure def canRecordCapacityWait(c: PrivateCase, by: int, checkedEpoch: int): bool = c.finding == Confirmed and c.award == PendingAward and c.reviewers.contains(by) and checkedEpoch == c.authorityEpoch
pure def recordCapacityWait(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase = { ...c, award: CapacityExhausted, deciders: c.deciders.union(Set(by)) }
pure def canReviewRelated(c: PrivateCase, by: int, checkedEpoch: int): bool = c.related and c.finding == Confirmed and not(c.appealOpen) and c.relatedReview == RelatedPending and c.reviewers.contains(by) and by != 1 and not(c.deciders.contains(by)) and checkedEpoch == c.authorityEpoch
pure def reviewRelated(c: PrivateCase, by: int, checkedEpoch: int, approve: bool): PrivateCase = { ...c, relatedReview: if (approve) RelatedApproved else RelatedRefused, award: if (approve) c.award else DeclinedAward, deciders: c.deciders.union(Set(by)) }
pure val byValues = Set(1, 2, 3, 4)
pure val actorValues = Set(1, 2, 3)
pure val checkedEpochValues = Set(0, 1, 2)
pure def alwaysAwardHasAcceptance(c: PrivateCase): bool = c.award == ApprovedAward implies c.finding == Confirmed and c.deciders.size() > 0
```

### Plausible reports and authorized overrides permit private owner notification

```quint
pure def canNotifyOwner(c: PrivateCase, by: int, checkedEpoch: int): bool = not(c.notified) and c.screening != Waiting and (c.screening == Plausible or (c.reviewers.contains(by) and checkedEpoch == c.authorityEpoch))
pure def notifyOwner(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase = { ...c, notified: true }
```

### An independent moderator upholds or returns escalated appeals

Upholding restores the original finding. Returning a case reopens review and
keeps a capacity-exhausted award waiting for funds. A declined award returns
to pending. Related-party review requires a reviewer independent of every
prior case decider. Approved awards cannot be reduced by a later decision.

```quint
pure def canAppeal(c: PrivateCase, by: int): bool = by == 1 and not(c.appealOpen) and (c.finding == Rejected or c.finding == Duplicate or c.finding == OutOfScope or c.award == DeclinedAward or c.award == CapacityExhausted)
pure def appeal(c: PrivateCase, by: int): PrivateCase = { ...c, previousFinding: c.finding, finding: Disputed, appealOpen: true }
pure def canResolveAppeal(c: PrivateCase, by: int, moderator: bool): bool = c.appealOpen and moderator and by != 1 and not(c.deciders.contains(by))
pure def resolveAppeal(c: PrivateCase, by: int, moderator: bool, uphold: bool): PrivateCase = { ...c, finding: if (uphold) c.previousFinding else Undecided, award: if (uphold or c.award == CapacityExhausted) c.award else PendingAward, appealOpen: false, deciders: c.deciders.union(Set(by)) }
pure def alwaysAppealState(c: PrivateCase): bool = c.appealOpen == (c.finding == Disputed)
pure def alwaysAppealSource(c: PrivateCase): bool = c.appealOpen implies c.previousFinding != Disputed
pure def stepPreservesApprovedAward(before: PrivateCase, after: PrivateCase): bool = before.award == ApprovedAward implies after.award == ApprovedAward
pure def alwaysRelatedApproval(c: PrivateCase): bool = c.related and c.award == ApprovedAward implies c.relatedReview == RelatedApproved
pure def sometimesCapacityWait(c: PrivateCase): bool = c.award == CapacityExhausted
pure def sometimesAccepted(c: PrivateCase): bool = c.award == ApprovedAward
pure def sometimesAppealed(c: PrivateCase): bool = c.appealOpen
```

## Story: Verify remediation and approve exact disclosure independently

### A patch is verified at its exact digest

```quint
pure def canRecordPatch(c: PrivateCase, digest: int): bool = digest > 0
pure def recordPatch(c: PrivateCase, digest: int): PrivateCase = { ...c, patchDigest: digest, verifiedPatch: 0 }
pure def canVerifyPatch(c: PrivateCase, digest: int, independentReview: bool): bool = digest == c.patchDigest and digest > 0 and independentReview
pure def verifyPatch(c: PrivateCase, digest: int, independentReview: bool): PrivateCase = { ...c, verifiedPatch: digest }
pure def alwaysVerifiedPatchMatches(c: PrivateCase): bool = c.verifiedPatch != 0 implies c.verifiedPatch == c.patchDigest
```

### Only separately approved redacted content may be published

Payment, remediation and an elapsed embargo never substitute for content
approval. Recognition consent is independent from disclosure authorization.

```quint
pure def canApproveDisclosure(c: PrivateCase, by: int, checkedEpoch: int, digest: int): bool = c.reviewers.contains(by) and checkedEpoch == c.authorityEpoch and digest > 0 and c.publishedDisclosure == 0
pure def approveDisclosure(c: PrivateCase, by: int, checkedEpoch: int, digest: int): PrivateCase = { ...c, approvedDisclosure: digest }
pure def canPublishDisclosure(c: PrivateCase, digest: int): bool = digest > 0 and digest == c.approvedDisclosure and c.publishedDisclosure == 0
pure def publishDisclosure(c: PrivateCase, digest: int): PrivateCase = { ...c, publishedDisclosure: digest }
pure def canConsentRecognition(c: PrivateCase, by: int): bool = by == 1
pure def consentRecognition(c: PrivateCase, by: int): PrivateCase = { ...c, recognitionConsent: true }
pure def alwaysExactDisclosure(c: PrivateCase): bool = c.publishedDisclosure != 0 implies c.publishedDisclosure == c.approvedDisclosure
pure def sometimesVerifiedPatch(c: PrivateCase): bool = c.verifiedPatch > 0
pure def sometimesDisclosed(c: PrivateCase): bool = c.publishedDisclosure > 0
```

The settlement specification owns 75/25 and platform-only full-award amounts,
verified funds, partial direct legs, successor requests and exact payment
proofs. Technical acceptance creates no funded reserve. Frozen receipt-time
terms control eligibility and fixed offers. A case and its fix form one
financial work unit. Financial authority is checked independently of case roles.

The receipt-time award contract in `spec/security/terms.md` governs every
positive award admitted from this decision lifecycle. The stored term revision
and receipt time accompany the approved gross amount into settlement.

Discovered by the proof. An open appeal retains the preceding undisputed
finding. Upholding an appeal restores that finding and clears the open appeal.

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val digestValues = Set(0, 1, 2)
```
