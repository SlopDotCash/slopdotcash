# Private report drafts

PRD section 8. The steps Write and Review occupy one route. The browser
stores a draft only in session storage bound to an account and project. It keeps
the same idempotency key through uncertain retries. The private intake owns the
durable object, case and Inbox receipt transaction.

## Story: Recover a report draft and an uncertain submission

### A draft belongs to one account and project

The model carries content identity as a digest. Exact private bytes remain at the
storage boundary. No transition publishes those bytes or enables public logging.

```quint
type DraftStage = Writing | Reviewing | Sending | Uncertain | Received
type Draft = { actor: int, project: int, digest: int, key: int, stage: DraftStage, stored: bool, storageError: bool, receipt: int }
pure val initial: Draft = { actor: 0, project: 0, digest: 0, key: 0, stage: Writing, stored: false, storageError: false, receipt: 0 }
pure def canOpen(d: Draft, actorId: int, projectId: int): bool = actorId > 0 and projectId > 0
pure def open(d: Draft, actorId: int, projectId: int): Draft = {
  actor: actorId, project: projectId, digest: 0, key: 0, stage: Writing, stored: false, storageError: false, receipt: 0
}
pure def leaveAccount(d: Draft): Draft = initial
```

### Editing keeps storage failures visible and invalidates the reviewed content

```quint
pure def canEdit(d: Draft, contentDigest: int): bool = d.actor > 0 and d.project > 0 and contentDigest > 0 and
  (d.stage == Writing or d.stage == Reviewing)
pure def edit(d: Draft, contentDigest: int, storageAvailable: bool): Draft = {
  ...d, digest: contentDigest, key: 0, stage: Writing,
  stored: storageAvailable, storageError: not(storageAvailable), receipt: 0
}
pure def canReview(d: Draft): bool = d.actor > 0 and d.project > 0 and d.digest > 0 and d.stage == Writing
pure def review(d: Draft): Draft = { ...d, stage: Reviewing }
```

### The first send fixes a key and retries keep that key and content

The server binds an idempotency key to exact account, project and digest. The
caller supplies cryptographically strong keys at the boundary. Integer identity
here represents distinct values without modeling key generation.

```quint
pure def canSend(d: Draft, submissionKey: int): bool = d.stage == Reviewing and submissionKey > 0
pure def send(d: Draft, submissionKey: int): Draft = { ...d, key: submissionKey, stage: Sending }
pure def canLoseResponse(d: Draft): bool = d.stage == Sending
pure def loseResponse(d: Draft): Draft = { ...d, stage: Uncertain }
pure def canRetry(d: Draft): bool = d.stage == Uncertain and d.key > 0
pure def retry(d: Draft): Draft = { ...d, stage: Sending }
pure def canReceiveReceipt(d: Draft, actorId: int, projectId: int, contentDigest: int, submissionKey: int, receiptId: int): bool =
  (d.stage == Sending or d.stage == Uncertain) and actorId == d.actor and projectId == d.project and
  contentDigest == d.digest and submissionKey == d.key and receiptId > 0
pure def receiveReceipt(d: Draft, actorId: int, projectId: int, contentDigest: int, submissionKey: int, receiptId: int): Draft =
  { ...d, receipt: receiptId, stage: Received, stored: false }
```

### A definite refusal returns the report to review with a fresh key

A definite refusal of the send (HTTP 400) accepted no report: the draft
returns to Review with its account, project and content kept and no key, so
the next send takes a fresh one (development `src/PrivateReportForm.tsx`
`submit` at `67fd54fd4`). Only a send in flight can be refused.

```quint
pure def canRefuse(d: Draft): bool = d.stage == Sending
pure def refuse(d: Draft): Draft = { ...d, stage: Reviewing, key: 0 }
```

### A reviewed or submitted draft retains its account, project and content identity

Discovered by the proof: a synthetic Reviewing state with no account, project
or content could satisfy the earlier invariant and then reach Sending. Reviewing
now requires those same identities before a submission key is assigned.

```quint
pure def alwaysDraftBinding(d: Draft): bool = d.actor >= 0 and d.project >= 0 and d.digest >= 0 and d.key >= 0 and d.receipt >= 0 and
  (d.actor == 0 implies d.project == 0 and d.digest == 0 and d.key == 0 and d.receipt == 0) and
  (d.stage == Reviewing or d.stage == Sending or d.stage == Uncertain or d.stage == Received implies d.actor > 0 and d.project > 0 and d.digest > 0) and
  (d.stage == Sending or d.stage == Uncertain or d.stage == Received implies d.key > 0) and
  (d.stage == Received iff d.receipt > 0)
pure def stepRetryKeepsSubmission(before: Draft, via: str, after: Draft): bool = via == "retry" implies
  after.actor == before.actor and after.project == before.project and after.digest == before.digest and after.key == before.key
pure def sometimesReceived(d: Draft): bool = d.stage == Received
pure def sometimesUncertain(d: Draft): bool = d.stage == Uncertain
pure def sometimesStorageFailure(d: Draft): bool = d.storageError
pure val actorIdValues = Set(1, 2)
pure val projectIdValues = Set(1, 2)
pure val contentDigestValues = Set(1, 2)
pure val submissionKeyValues = Set(1, 2)
pure val receiptIdValues = Set(1, 2)
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val viaValues = Set("", "a", "b")
```

## Story: Keep a submitted report's text only while it can still be sent

> As a reporter, I want the text of a report I sent from Slop to survive a
> GitHub redirect or an uncertain send, and to be gone from this tab once it
> can no longer be sent or I sign out.

### Submitted report text is kept only while its submission can still be sent and is erased on sign-out

The tab keeps the text of each submission in session storage under
`slop-intake-draft:<submission id>`; storage may be unavailable, and the text
then stays in memory only, so the page never leaves for GitHub without a saved
copy. The text is still needed only for a submission made on Slop that has no
advisory yet and is a draft, sending, uncertain, or failed with a failure that
a resend can fix. The failures `author-mismatch`, `already-recorded`,
`not-private-report` and `unverifiable` are terminal. Each time the signed-in
reporter's submission list loads, every stored text whose submission is not in
that list or is no longer needed is removed. Sign-out removes every stored
report text and every `slop-report-compose:` entry of the tab, which is the
list-pruning with an empty list.

```quint
type IntakeStage = IntakeDraft | IntakeSubmitting | IntakeUncertain | IntakeFailed | IntakeSettled
type IntakeRecord = { fromSlop: bool, hasAdvisory: bool, intake: IntakeStage, terminalFailure: bool }
type IntakeEntry = { id: int, record: IntakeRecord }
pure val terminalFailureCodes = Set("author-mismatch", "already-recorded", "not-private-report", "unverifiable")
pure def draftStillNeeded(intakeRecord: IntakeRecord): bool =
  intakeRecord.fromSlop and not(intakeRecord.hasAdvisory) and
    (intakeRecord.intake == IntakeDraft or intakeRecord.intake == IntakeSubmitting or intakeRecord.intake == IntakeUncertain or
      (intakeRecord.intake == IntakeFailed and not(intakeRecord.terminalFailure)))
pure def keptDraftIds(intakeEntries: List[IntakeEntry], storedIds: List[int]): List[int] =
  storedIds.select(id => intakeEntries.some(e => e.id == id and draftStillNeeded(e.record)))
pure def lawTerminalFailureErasesText(intakeRecord: IntakeRecord): bool =
  (intakeRecord.intake == IntakeFailed and intakeRecord.terminalFailure) implies not(draftStillNeeded(intakeRecord))
pure def lawOnlySlopSubmissionsWithoutAdvisoryKeepText(intakeRecord: IntakeRecord): bool =
  draftStillNeeded(intakeRecord) implies intakeRecord.fromSlop and not(intakeRecord.hasAdvisory)
pure def lawPruningKeepsOnlyNeededText(intakeEntries: List[IntakeEntry], storedIds: List[int]): bool =
  keptDraftIds(intakeEntries, storedIds).every(id => storedIds.includes(id) and
    intakeEntries.some(e => e.id == id and draftStillNeeded(e.record)))
pure def lawSignOutErasesEveryText(storedIds: List[int]): bool = keptDraftIds(List(), storedIds) == List()
pure val intakeRecordValues = Set(
  { fromSlop: true, hasAdvisory: false, intake: IntakeUncertain, terminalFailure: false },
  { fromSlop: true, hasAdvisory: false, intake: IntakeFailed, terminalFailure: true },
  { fromSlop: true, hasAdvisory: false, intake: IntakeFailed, terminalFailure: false },
  { fromSlop: false, hasAdvisory: false, intake: IntakeDraft, terminalFailure: false },
  { fromSlop: true, hasAdvisory: true, intake: IntakeSubmitting, terminalFailure: false },
  { fromSlop: true, hasAdvisory: false, intake: IntakeSettled, terminalFailure: false }
)
pure val intakeEntriesValues = Set(List(),
  List({ id: 1, record: { fromSlop: true, hasAdvisory: false, intake: IntakeDraft, terminalFailure: false } },
    { id: 2, record: { fromSlop: true, hasAdvisory: false, intake: IntakeFailed, terminalFailure: true } }))
pure val storedIdsValues = Set(List(), List(1, 2, 3))
```
