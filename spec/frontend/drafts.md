# Private report drafts

PRD section 8. Write report and Review and submit occupy one route. The browser
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

### A receipt requires a submitted account-bound draft

```quint
pure def alwaysDraftBinding(d: Draft): bool = d.actor >= 0 and d.project >= 0 and d.key >= 0 and d.receipt >= 0 and
  (d.actor == 0 implies d.project == 0 and d.digest == 0 and d.key == 0 and d.receipt == 0) and
  (d.stage == Sending or d.stage == Uncertain or d.stage == Received implies d.actor > 0 and d.project > 0 and d.digest > 0 and d.key > 0) and
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
