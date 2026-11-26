# The slopbot:ready label

PRD section 5 (operator decision of 16 November 2026) lets a project owner
turn on the `slopbot:ready` label in project settings; absent settings mean
off. While it is on, Slopbot labels an open pull request and adds one line
to its review comment only when every condition holds at the exact head
commit, removes the label on a new push or as soon as a condition stops
holding, and never merges: a human does, and Points and scoring do not
change. Source is `workers/slopbot/ready-label.ts`,
`src/lib/slopbot-ready.mjs`, `workers/slopbot/index.ts` (`READY_ACTIONS`,
the queue handler and the scheduled run) and
`migrations/0130_slopbot_ready_labels.sql` at development `df21e37b7`.
Development's own model is `formal/models/slopbot/bot_ready_label.qnt`.

This unit owns one pull request's ready row in `slopbot_ready_labels` and
the label and line Slopbot leaves on it. [Review](./review.md) owns the
review whose verdict it reads and the review comment it edits; the
[job queue](./jobQueue.md) retries a failed ready check, its non-durable
`ReadyLabelJob`, like any other job. The shell reads GitHub and the database, and its protected-path
tables and owner glob matcher decide which changed paths are protected.

## Story: Label a pull request ready only while every condition holds at its head

> As a maintainer who turned the label on, I want Slopbot to mark a pull
> request `slopbot:ready` only while it is mergeable, reviewed clean,
> approved at its head by people with write access, small and outside
> protected paths, so that I can find what is ready and merge it myself.

### The owner's settings are off unless saved on, and stay within their bounds

The setting, its fields, bounds, defaults and validity are the backend's
[ready-label settings](../backend/readyLabelSettings.md), "Ready-label
settings are bounded, off when absent or disabled, and only add protected
paths"; Slopbot reads the saved setting and acts only on a valid one. The
label is on only when that rule says the setting is on and the project
still offers contributor work (`registeredProject` in
`workers/slopbot/registry.ts`, lines 276 to 279).

```quint
import readyLabelSettings as RLS from "../backend/readyLabelSettings"
pure val readyLabelName = "slopbot:ready"
pure val readyLineMarker = "<!-- slopbot:ready -->"
pure def savedSetting(saved: bool, settings: RLS::ReadyLabelConfig): RLS::ReadyLabelSetting =
  if (saved) RLS::presentSetting(settings) else RLS::ReadyLabelAbsent
pure def readyLabelOn(setting: RLS::ReadyLabelSetting, contributorWork: bool): bool =
  RLS::readyLabelOn(setting) and contributorWork
pure def lawAbsentSettingsAreOff(contributorWork: bool): bool =
  not(readyLabelOn(RLS::ReadyLabelAbsent, contributorWork))
```

### A changed file is protected when it is deleted, on a default or owner path, or has no text diff

The default set always applies and an owner can only add to it: `.github/`
and other CI directories at the root (`.circleci`, `.buildkite`,
`.woodpecker`, `.gitlab`, `.azure-pipelines`) and CI files at any depth;
dependency manifests and lockfiles; contracts and payment code
(`contracts`, `payments`, `escrow`, `billing`, `wallet` directories and
their singulars, `.sol`, `.vy`, `.move`, `.cairo`, Foundry, Anchor and
Hardhat files); skill, agent and policy files (`skills`, `.claude`,
`.cursor`, `.windsurf`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
`CODEOWNERS`, licences and the like); the Slop project manifest
(`slop-project.json`, `slopbot.json`); `SECURITY.md`; and binary
extensions, all compared case-insensitively. The shell's tables in
`ready-label.ts` are the exact lists, and a path or its previous name
under a rename may match. A removed file is protected, and a file GitHub
gives without a patch is binary unless it is a pure rename with no
changed lines. An owner pattern is gitignore-like: `*` within one segment,
`**` across segments, a pattern without `/` matches the name at any depth,
one with `/` is anchored at the root, and either covers everything below
a matching directory.

```quint
type FileChange = FileAdded | FileModified | FileRemoved | FileRenamed | FileOther
type ChangedFile = { change: FileChange, defaultProtected: bool, ownerProtected: bool, patched: bool, lines: int }
pure def protectedFile(changed: ChangedFile): bool =
  changed.change == FileRemoved or changed.defaultProtected or changed.ownerProtected
    or (not(changed.patched) and not(changed.change == FileRenamed and changed.lines == 0))
pure def protectedChange(files: List[ChangedFile]): bool = files.some(changed => protectedFile(changed))
pure def lawOwnerCannotUnprotectADefaultPath(changed: ChangedFile): bool = changed.defaultProtected implies protectedFile(changed)
pure val cleanFile: ChangedFile = { change: FileModified, defaultProtected: false, ownerProtected: false,
  patched: true, lines: 12 }
pure val changedValues = Set(cleanFile, { ...cleanFile, defaultProtected: true }, { ...cleanFile, change: FileRemoved },
  { ...cleanFile, patched: false }, { ...cleanFile, change: FileRenamed, patched: false, lines: 0 })
```

### Only the latest decision of each other account with write access counts, and only at the head

Reviews are read in pages of 100, at most 10 pages. A review counts only
from a `User` account and only when it approves, requests changes or is
dismissed; a later one from the same account replaces the earlier. The
author's own reviews never count. An approval counts only on the head
commit, and a change request at any commit. Each counted account's
permission is looked up, at most 25 lookups, and counts only when it is
`admin` or `write` for the same account ID. A history over 10 pages, an
unreadable page or more than 25 lookups counts nothing.

```quint
type ReviewDecision = ReviewApproved | ReviewChangesRequested | ReviewDismissed | ReviewCommented
type PullReview = { reviewer: int, userAccount: bool, decision: ReviewDecision, atHead: bool, writeAccess: bool }
type ReviewRead = { complete: bool, reviews: List[PullReview] }
pure val reviewPageLimit = 10
pure val permissionLookupLimit = 25
pure def decisive(r: PullReview): bool =
  r.userAccount and (r.decision == ReviewApproved or r.decision == ReviewChangesRequested or r.decision == ReviewDismissed)
pure def latestDecisions(reviews: List[PullReview]): List[PullReview] =
  reviews.foldl(List(), (kept, r) => if (decisive(r)) kept.select(k => k.reviewer != r.reviewer).append(r) else kept)
pure def approvesAtHead(r: PullReview, author: int): bool =
  r.reviewer != author and r.decision == ReviewApproved and r.atHead
pure def requestsChanges(r: PullReview, author: int): bool = r.reviewer != author and r.decision == ReviewChangesRequested
pure def reviewsUsable(fetched: ReviewRead, author: int): bool =
  val counted = latestDecisions(fetched.reviews).select(r => approvesAtHead(r, author) or requestsChanges(r, author))
  fetched.complete and counted.length() <= permissionLookupLimit
pure def writerApprovals(fetched: ReviewRead, author: int): int =
  if (reviewsUsable(fetched, author))
    latestDecisions(fetched.reviews).select(r => approvesAtHead(r, author) and r.writeAccess).length()
  else 0
pure def writerRequestedChanges(fetched: ReviewRead, author: int): bool =
  reviewsUsable(fetched, author) and latestDecisions(fetched.reviews).some(r => requestsChanges(r, author) and r.writeAccess)
pure def lawReadOnlyApprovalNeverCounts(fetched: ReviewRead, author: int): bool =
  fetched.reviews.every(r => not(r.writeAccess)) implies writerApprovals(fetched, author) == 0
pure def lawAuthorNeverApprovesTheirOwnPull(fetched: ReviewRead, author: int): bool =
  fetched.reviews.every(r => r.reviewer == author) implies
    (writerApprovals(fetched, author) == 0 and not(writerRequestedChanges(fetched, author)))
pure def lawIncompleteReviewsCountNothing(fetched: ReviewRead, author: int): bool =
  not(fetched.complete) implies (writerApprovals(fetched, author) == 0 and not(writerRequestedChanges(fetched, author)))
pure val approval: PullReview = { reviewer: 7, userAccount: true, decision: ReviewApproved, atHead: true, writeAccess: true }
pure val fetchedValues = Set({ complete: true, reviews: List(approval) },
  { complete: true, reviews: List(approval, { ...approval, decision: ReviewDismissed }) },
  { complete: true, reviews: List({ ...approval, writeAccess: false }) },
  { complete: true, reviews: List({ ...approval, atHead: false }, { ...approval, reviewer: 8, decision: ReviewChangesRequested }) },
  { complete: true, reviews: List({ ...approval, reviewer: 3 }) },
  { complete: false, reviews: List(approval) })
pure val authorValues = Set(3, 9)
```

### The decision takes the first failing condition, and only a running review or unsettled mergeability is pending

Every fact is read at the pull request's current head. Slopbot's verdict is
its latest review row of that item at exactly that head: none is missing,
a running row is running, a row not completed or without a readable verdict
is missing, a verdict with a finding is a finding, a verdict whose action
was not the comment is missing, a verdict whose limitations are not an
empty list is limited, and otherwise there is no finding. The order is:
open, not a draft, no unpaid submission fee ("its submission fee has not
been paid": the live fee was asked and is not paid, `unpaidAsk` of the
[submission fee gate](./submissionFeeGate.md); development `8008b4617`,
#3058), the verdict, changed lines (additions plus deletions)
within the line cap, changed files within the file cap, at most 300
deleted lines, the whole file list read (at most four pages of 100) and as
long as GitHub's count, no protected file, no change request by a writer,
enough writer approvals at the head, and GitHub reporting the branch
mergeable with the state `clean` or `has_hooks`. Only a running review,
and mergeability that is unreported, `unknown`, `unstable`, `blocked` or
`behind`, is pending. A ready decision without Slopbot's review comment is
not ready.

```quint
type ReviewVerdict = VerdictNone | VerdictFinding | VerdictLimited | VerdictRunning | VerdictMissing
type SlopbotReviewRow = { found: bool, running: bool, completed: bool, parsed: bool, finding: bool,
  commented: bool, limitationsListed: bool, limitations: int }
type MergeState = MergeClean | MergeHasHooks | MergeUnknown | MergeUnstable | MergeBlocked | MergeBehind
  | MergeDirty | MergeDraft | MergeNotReported
type ReadyReason = NotChecked | NotOpen | IsDraft | StillReviewing | NotReviewed | LimitedCoverage | HasFinding
  | OverLineCap | OverFileCap | LargeDeletion | FileListIncomplete | TouchesProtectedPath | WriterRequestedChanges
  | TooFewApprovals | NotMergeable | CommentUnavailable | AllConditionsHold | LabelOff | HeadMoved | FeeUnpaid
type ReadyFacts = { open: bool, draft: bool, mergeable: bool, mergeState: MergeState, verdict: ReviewVerdict,
  additions: int, deletions: int, changedFiles: int, filesRead: bool, files: List[ChangedFile], approvals: int,
  changesRequested: bool, feeUnpaid: bool }
type ReadyDecision = { ready: bool, pending: bool, reason: ReadyReason }
pure val largeDeletionLines = 300
pure val changedFilePageLimit = 4
pure def verdictOf(row: SlopbotReviewRow): ReviewVerdict =
  if (not(row.found)) VerdictMissing
  else if (row.running) VerdictRunning
  else if (not(row.completed) or not(row.parsed)) VerdictMissing
  else if (row.finding) VerdictFinding
  else if (not(row.commented)) VerdictMissing
  else if (not(row.limitationsListed) or row.limitations > 0) VerdictLimited
  else VerdictNone
pure def mergeableState(m: MergeState): bool = m == MergeClean or m == MergeHasHooks
pure def mergePending(m: MergeState): bool =
  m == MergeNotReported or m == MergeUnknown or m == MergeUnstable or m == MergeBlocked or m == MergeBehind
pure def notReady(reason: ReadyReason, pending: bool): ReadyDecision = { ready: false, pending: pending, reason: reason }
pure def readyDecision(f: ReadyFacts, s: RLS::ReadyLabelConfig): ReadyDecision =
  if (not(f.open)) notReady(NotOpen, false)
  else if (f.draft) notReady(IsDraft, false)
  else if (f.feeUnpaid) notReady(FeeUnpaid, false)
  else if (f.verdict == VerdictRunning) notReady(StillReviewing, true)
  else if (f.verdict == VerdictMissing) notReady(NotReviewed, false)
  else if (f.verdict == VerdictLimited) notReady(LimitedCoverage, false)
  else if (f.verdict == VerdictFinding) notReady(HasFinding, false)
  else if (f.additions + f.deletions > s.maxChangedLines) notReady(OverLineCap, false)
  else if (f.changedFiles > s.maxChangedFiles) notReady(OverFileCap, false)
  else if (f.deletions > largeDeletionLines) notReady(LargeDeletion, false)
  else if (not(f.filesRead) or f.files.length() != f.changedFiles) notReady(FileListIncomplete, false)
  else if (protectedChange(f.files)) notReady(TouchesProtectedPath, false)
  else if (f.changesRequested) notReady(WriterRequestedChanges, false)
  else if (f.approvals < s.approvals) notReady(TooFewApprovals, false)
  else if (not(f.mergeable and mergeableState(f.mergeState))) notReady(NotMergeable, mergePending(f.mergeState))
  else { ready: true, pending: false, reason: AllConditionsHold }
pure def lawReadyNeedsEveryCondition(facts: ReadyFacts, settings: RLS::ReadyLabelConfig): bool =
  readyDecision(facts, settings).ready implies (facts.open and not(facts.draft) and not(facts.feeUnpaid)
    and facts.verdict == VerdictNone
    and facts.additions + facts.deletions <= settings.maxChangedLines and facts.changedFiles <= settings.maxChangedFiles
    and facts.deletions <= largeDeletionLines and facts.filesRead and facts.files.length() == facts.changedFiles
    and not(protectedChange(facts.files)) and not(facts.changesRequested) and facts.approvals >= settings.approvals
    and facts.mergeable and mergeableState(facts.mergeState))
pure def lawPendingOnlyForARunningReviewOrUnsettledMergeability(facts: ReadyFacts, settings: RLS::ReadyLabelConfig): bool =
  readyDecision(facts, settings).pending implies (facts.verdict == VerdictRunning or mergePending(facts.mergeState))
pure def lawLimitationsMakeTheVerdictLimited(reviewRow: SlopbotReviewRow): bool =
  (reviewRow.found and not(reviewRow.running) and reviewRow.completed and reviewRow.parsed and not(reviewRow.finding)
    and reviewRow.commented and reviewRow.limitations > 0) implies verdictOf(reviewRow) == VerdictLimited
pure val readyFacts: ReadyFacts = { open: true, draft: false, mergeable: true, mergeState: MergeClean,
  verdict: VerdictNone, additions: 10, deletions: 2, changedFiles: 1, filesRead: true, files: List(cleanFile),
  approvals: 1, changesRequested: false, feeUnpaid: false }
pure val enabledSettings: RLS::ReadyLabelConfig = { enabled: true, approvals: RLS::defaultApprovals,
  maxChangedLines: RLS::defaultMaxChangedLines, maxChangedFiles: RLS::defaultMaxChangedFiles, protectedPaths: List() }
pure val factsValues = Set(readyFacts, { ...readyFacts, verdict: VerdictRunning },
  { ...readyFacts, mergeable: false, mergeState: MergeUnknown }, { ...readyFacts, mergeState: MergeDirty },
  { ...readyFacts, files: List({ ...cleanFile, defaultProtected: true }) }, { ...readyFacts, approvals: 0 },
  { ...readyFacts, additions: 399, deletions: 2 }, { ...readyFacts, changedFiles: 2 },
  { ...readyFacts, changesRequested: true }, { ...readyFacts, feeUnpaid: true })
pure val settingsValues = Set(enabledSettings, { ...enabledSettings, approvals: 2, maxChangedLines: 5000 })
pure val reviewRowValues = Set({ found: true, running: false, completed: true, parsed: true, finding: false,
  commented: true, limitationsListed: true, limitations: 0 },
  { found: true, running: false, completed: true, parsed: true, finding: false, commented: true,
    limitationsListed: true, limitations: 2 },
  { found: true, running: true, completed: false, parsed: false, finding: false, commented: false,
    limitationsListed: false, limitations: 0 })
```

### A refresh rewrites the row from facts read at the head, and writes only while the head is unmoved

A refresh first reads the setting and the row. With the label off and no
row in the `ready` state it does nothing; with the installation removed or
suspended, or the pull request unreadable, it does nothing. The first
check of a head starts its pending window. With the label turned off (or
the project no longer offering contributor work) and a ready row, an open
pull request loses the label and the line, and the row becomes `off` with
no next check. A closed or merged pull request keeps its last label as
history: its row records `ready` when the label is on and `not-ready`
otherwise, with no next check. On an open pull request the decision is
made. When it would change the label or a review comment exists to carry
the line, the pull request is read again first: when its head moved or it
is unreadable, the label is removed if the new head was read, and the row
becomes `not-ready` for the head now seen, with a new pending window and a
check due now. Otherwise the label is added or removed to match the
decision, the line marked `<!-- slopbot:ready -->` in Slopbot's review
comment states the decision at the short head commit, and the row records
the decision. Adding the label rechecks the contributor scope first, and
every GitHub write must be confirmed (200 with the label, 200 or 404 for a
removal, 200 with the same comment ID).

```quint
type PullStatus = PullOpen | PullClosed | PullMerged
type RowState = NoReadyRow | NotReadyRow | ReadyRow | OffRow
type ReadyLine = NoReadyLine | LabelledLine | NotLabelledLine
type HeadAtWrite = SameHead | MovedHead | UnreadableHead
type ReadyObservation = { contributorWork: bool, installationActive: bool, pullReadable: bool, saved: bool,
  settings: RLS::ReadyLabelConfig, facts: ReadyFacts, commentFound: bool, headAtWrite: HeadAtWrite }
type ReadyPull = { now: int, pr: PullStatus, pullHead: int, row: RowState, rowHead: int, firstSeenAt: int,
  nextCheckAt: int, reason: ReadyReason, labelled: bool, line: ReadyLine, dispatches: int }
pure val pendingRecheckSeconds = 600
pure val readyRecheckSeconds = 3600
pure val pendingWindowSeconds = 1209600
pure val initial: ReadyPull = { now: 1, pr: PullOpen, pullHead: 1, row: NoReadyRow, rowHead: 0, firstSeenAt: 0,
  nextCheckAt: 0, reason: NotChecked, labelled: false, line: NoReadyLine, dispatches: 0 }
pure def nextCheckAfter(d: ReadyDecision, now: int, firstSeen: int): int =
  if (d.ready) now + readyRecheckSeconds
  else if (d.pending and now - firstSeen < pendingWindowSeconds) now + pendingRecheckSeconds
  else 0
pure def canRefresh(p: ReadyPull, observed: ReadyObservation): bool =
  observed.facts.open == (p.pr == PullOpen) and RLS::readyLabelValid(savedSetting(observed.saved, observed.settings))
pure def refresh(p: ReadyPull, observed: ReadyObservation): ReadyPull =
  val currentHead = p.pullHead
  val isOpen = p.pr == PullOpen
  val labelOn = readyLabelOn(savedSetting(observed.saved, observed.settings), observed.contributorWork)
  val firstSeen = if (p.row != NoReadyRow and p.rowHead == currentHead) p.firstSeenAt else p.now
  val decided = readyDecision(observed.facts, observed.settings)
  val decision = if (decided.ready and not(observed.commentFound)) notReady(CommentUnavailable, false) else decided
  val writes = decision.ready != p.labelled or observed.commentFound
  val seenHead = if (observed.headAtWrite == MovedHead) currentHead + 1 else currentHead
  if (not(labelOn) and p.row != ReadyRow) p
  else if (not(observed.installationActive) or not(observed.pullReadable)) p
  else if (not(labelOn))
    { ...p, row: OffRow, rowHead: currentHead, firstSeenAt: firstSeen, nextCheckAt: 0, reason: LabelOff,
      labelled: p.labelled and not(isOpen), line: if (isOpen) NoReadyLine else p.line }
  else if (not(isOpen))
    { ...p, row: if (p.labelled) ReadyRow else NotReadyRow, rowHead: currentHead, firstSeenAt: firstSeen, nextCheckAt: 0,
      reason: NotOpen }
  else if (writes and observed.headAtWrite != SameHead)
    { ...p, pullHead: seenHead, labelled: p.labelled and observed.headAtWrite == UnreadableHead, row: NotReadyRow,
      rowHead: seenHead, firstSeenAt: p.now, nextCheckAt: p.now, reason: HeadMoved }
  else
    { ...p, labelled: decision.ready,
      line: if (not(observed.commentFound)) p.line else if (decision.ready) LabelledLine else NotLabelledLine,
      row: if (decision.ready) ReadyRow else NotReadyRow, rowHead: currentHead, firstSeenAt: firstSeen, reason: decision.reason,
      nextCheckAt: nextCheckAfter(decision, p.now, firstSeen) }
pure def alwaysReadyRowIsLabelled(p: ReadyPull): bool = p.row == ReadyRow implies p.labelled
pure def alwaysHeadsAndClock(p: ReadyPull): bool =
  p.now >= 1 and p.pullHead >= 1 and p.rowHead >= 0 and p.rowHead <= p.pullHead and p.dispatches >= 0
pure def alwaysOffRowHasNoNextCheck(p: ReadyPull): bool =
  (p.row == OffRow or p.row == NoReadyRow) implies p.nextCheckAt == 0
pure def stepSlopbotLabelsOnlyWhenEveryConditionHolds(before: ReadyPull, after: ReadyPull): bool =
  (after.labelled and not(before.labelled)) implies (after.row == ReadyRow and after.reason == AllConditionsHold
    and after.rowHead == after.pullHead and after.pr == PullOpen and after.line == LabelledLine)
pure def stepTurningOffClearsAnOpenPull(before: ReadyPull, after: ReadyPull): bool =
  (after.row == OffRow and before.row != OffRow and after.pr == PullOpen)
    implies (not(after.labelled) and after.line == NoReadyLine)
pure def stepClosedPullKeepsItsLabel(before: ReadyPull, after: ReadyPull): bool =
  (before.pr != PullOpen and after.pr == before.pr) implies after.labelled == before.labelled
```

### A push, a review decision or a finished review queues a check, and the pull request's own events are GitHub's

A webhook queues a ready check only for a public repository, an event
about a pull request not sent by Slopbot's own App user, and one of the
actions `synchronize`, `edited`, `reopened`, `converted_to_draft` and
`ready_for_review` of `pull_request` or `submitted`, `edited` and
`dismissed` of `pull_request_review`, and only while the label is on or
the row is `ready`. Closing is not one of them, so a closed pull request
keeps its last label. The webhook reads the row and sends the check before
the delivery's review job, whatever the repository's registration; a
failure to read or send releases the delivery and answers GitHub with an
error, so its redelivery repeats both (`fetch` in
`workers/slopbot/index.ts`, lines 487 to 508 and 558 to 561). A finished review of a pull request queues a check
under the same condition; a failure to queue it never replays the review.
A push moves the head and leaves the label until the check it queues
removes it.

```quint
type TriggerEvent = PullRequestEvent | PullRequestReviewEvent | OtherGithubEvent
type TriggerAction = ActionOpened | ActionSynchronize | ActionEdited | ActionReopened | ActionConvertedToDraft
  | ActionReadyForReview | ActionSubmitted | ActionDismissed | ActionClosed | ActionOther
type ReadyTrigger = { hook: TriggerEvent, hookAction: TriggerAction, publicRepository: bool, hasPull: bool,
  fromSlopbot: bool }
pure def readyCheckWanted(labelOn: bool, row: RowState): bool = labelOn or row == ReadyRow
pure def readyAction(t: ReadyTrigger): bool =
  (t.hook == PullRequestEvent and (t.hookAction == ActionSynchronize or t.hookAction == ActionEdited
    or t.hookAction == ActionReopened or t.hookAction == ActionConvertedToDraft or t.hookAction == ActionReadyForReview))
  or (t.hook == PullRequestReviewEvent and (t.hookAction == ActionSubmitted or t.hookAction == ActionEdited
    or t.hookAction == ActionDismissed))
pure def queuesReadyCheck(t: ReadyTrigger, wanted: bool): bool =
  readyAction(t) and t.publicRepository and t.hasPull and not(t.fromSlopbot) and wanted
pure def queuesAfterReview(pullRequest: bool, wanted: bool): bool = pullRequest and wanted
pure def lawClosingQueuesNoCheck(t: ReadyTrigger, wanted: bool): bool =
  t.hookAction == ActionClosed implies not(queuesReadyCheck(t, wanted))
pure def lawOffWithoutReadyRowQueuesNothing(t: ReadyTrigger): bool =
  not(queuesReadyCheck(t, readyCheckWanted(false, NotReadyRow)))
pure val sampleTrigger: ReadyTrigger = { hook: PullRequestEvent, hookAction: ActionSynchronize, publicRepository: true,
  hasPull: true, fromSlopbot: false }
pure val tValues = Set(sampleTrigger, { ...sampleTrigger, hookAction: ActionClosed },
  { ...sampleTrigger, hookAction: ActionOpened }, { ...sampleTrigger, hook: PullRequestReviewEvent, hookAction: ActionSubmitted }, { ...sampleTrigger, fromSlopbot: true },
  { ...sampleTrigger, publicRepository: false })
pure def canPushCommit(p: ReadyPull): bool = p.pr == PullOpen
pure def pushCommit(p: ReadyPull): ReadyPull = { ...p, pullHead: p.pullHead + 1 }
pure def canClosePull(p: ReadyPull): bool = p.pr == PullOpen
pure def closePull(p: ReadyPull): ReadyPull = { ...p, pr: PullClosed }
pure def canReopenPull(p: ReadyPull): bool = p.pr == PullClosed
pure def reopenPull(p: ReadyPull): ReadyPull = { ...p, pr: PullOpen }
pure def canElapse(p: ReadyPull, seconds: int): bool = seconds > 0
pure def elapse(p: ReadyPull, seconds: int): ReadyPull = { ...p, now: p.now + seconds }
```

### Only a human merges

The label is Slopbot's only effect on the pull request. Slopbot has no
merge action and needs no new GitHub App permission; a maintainer merges.

```quint
pure def canHumanMerge(p: ReadyPull): bool = p.pr == PullOpen
pure def humanMerge(p: ReadyPull): ReadyPull = { ...p, pr: PullMerged }
pure def stepOnlyAHumanMerges(before: ReadyPull, via: str, after: ReadyPull): bool =
  (after.pr == PullMerged and before.pr != PullMerged) implies via == "humanMerge"
```

### A due row is claimed before its check is sent, every 10 minutes while pending for 14 days a head and every hour while ready

A pending decision is checked again 10 minutes later, but not after 14
days on the same head; a ready row is checked again every hour in case a
check is re-run; any other decision waits for a webhook. Every scheduled
run selects at most 20 rows whose next check is due, oldest first, moves
each one's next check 10 minutes on before sending its job, so an
overlapping run does not queue it twice, and the job sets the next time
itself.

```quint
pure val readyDispatchBatch = 20
pure def canClaimDue(p: ReadyPull): bool = p.nextCheckAt > 0 and p.nextCheckAt <= p.now
pure def claimDue(p: ReadyPull): ReadyPull =
  { ...p, nextCheckAt: p.now + pendingRecheckSeconds, dispatches: p.dispatches + 1 }
pure def stepDueClaimMovesTheNextCheck(before: ReadyPull, after: ReadyPull): bool =
  after.dispatches > before.dispatches implies
    (before.nextCheckAt > 0 and before.nextCheckAt <= before.now and after.nextCheckAt == before.now + pendingRecheckSeconds)
pure def lawPendingRecheckStopsAfterTheWindow(d: ReadyDecision, now: int, firstSeen: int): bool =
  (not(d.ready) and now - firstSeen >= pendingWindowSeconds) implies nextCheckAfter(d, now, firstSeen) == 0
pure def lawReadyIsRecheckedHourly(d: ReadyDecision, now: int, firstSeen: int): bool =
  d.ready implies nextCheckAfter(d, now, firstSeen) == now + readyRecheckSeconds
pure val dValues = Set({ ready: true, pending: false, reason: AllConditionsHold },
  { ready: false, pending: true, reason: StillReviewing }, { ready: false, pending: false, reason: HasFinding })
pure val firstSeenValues = Set(1, 600)
pure val nowValues = Set(1, 601, 1209601, 1210201)
pure def sometimesReady(p: ReadyPull): bool =
  p.row == ReadyRow and p.labelled and p.pr == PullOpen and p.line == LabelledLine
pure def sometimesPendingRecheck(p: ReadyPull): bool = p.row == NotReadyRow and p.nextCheckAt > p.now
pure def sometimesPendingWindowClosed(p: ReadyPull): bool =
  p.row == NotReadyRow and p.reason == StillReviewing and p.nextCheckAt == 0
pure def sometimesHeadMovedDuringACheck(p: ReadyPull): bool =
  p.row == NotReadyRow and p.reason == HeadMoved and p.rowHead == p.pullHead and p.rowHead > 1
pure def sometimesTurnedOff(p: ReadyPull): bool = p.row == OffRow and p.pr == PullOpen and not(p.labelled)
pure def sometimesMergedKeepsItsLabel(p: ReadyPull): bool = p.pr == PullMerged and p.labelled
pure def sometimesDueClaimed(p: ReadyPull): bool = p.dispatches > 0
pure val readyObservation: ReadyObservation = { contributorWork: true, installationActive: true, pullReadable: true,
  saved: true, settings: enabledSettings, facts: readyFacts, commentFound: true, headAtWrite: SameHead }
pure val observedValues = Set(readyObservation,
  { ...readyObservation, facts: { ...readyFacts, verdict: VerdictRunning } },
  { ...readyObservation, facts: { ...readyFacts, mergeable: false, mergeState: MergeUnknown } },
  { ...readyObservation, facts: { ...readyFacts, files: List({ ...cleanFile, defaultProtected: true }) } },
  { ...readyObservation, commentFound: false },
  { ...readyObservation, headAtWrite: MovedHead }, { ...readyObservation, headAtWrite: UnreadableHead },
  { ...readyObservation, saved: false },
  { ...readyObservation, facts: { ...readyFacts, open: false } },
  { ...readyObservation, settings: { ...enabledSettings, enabled: false }, facts: { ...readyFacts, open: false } })
pure val secondsValues = Set(600, 3600, 1209600)
pure val weight_refresh = 5
```

## Story: Merge verified ready pull requests through this repository's workflow

> As the operator of Slop's own repository, I want a manually dispatched
> repository workflow to merge open `slopbot:ready` pull requests into the
> registered integration branch only after re-verifying every condition at the
> exact head commit, so that Slopbot never gains merge authority.

### The pilot workflow merges only on Slop's own repository when switched on, into the registered integration branch, and never touches `.github/`

PRD section 5 (operator decision of 25 November 2026) adds a pilot on
`SlopDotCash/slopdotcash` (repository ID `1319812413`) run by
`.github/workflows/ready-auto-merge.yml` with the workflow's own token
(`contents: write`, `pull-requests: write`) and never Slopbot's App token.
The workflow acts only while `SLOPBOT_AUTO_MERGE` equals `on` (absent or any
other value reads and merges nothing unless `--dry-run` is passed, which
never writes). A base branch is permitted only when it is in the pilot
repository, is not `main` or the repository's default branch,
and `.github/slop-project.json` on that base branch names this repository
and that branch as `integrationBranch`. Every candidate is verified from
fresh GitHub reads before merging: open, not a draft, still carrying
`slopbot:ready`, permitted base, the newest `labeled` or `unlabeled` event
for `slopbot:ready` is a `labeled` event by `slopdotcash[bot]` (ID
`340374191`, type `Bot`), some non-pending review of the exact head commit
was submitted at or before that label event and no `head_ref_force_pushed`
event occurred at or after it, at least one non-author `User` with `admin`
or `write` permission has an `APPROVED` latest decision at the exact head
commit and no such account has an open `CHANGES_REQUESTED` decision, GitHub
reports `mergeable: true` and `mergeable_state: "clean"`, the changed file
list is non-empty and complete and touches nothing at or under `.github/`
(including renamed previous paths, case-insensitively), and a second pull
request read just before the merge confirms the same head commit, same base
branch and pull-level mergeability. Each run merges at most 5 pull requests,
lowest number first, pinning the merge commit to the verified head SHA and
posting one comment naming the approvers without mentions.

```quint
pure val pilotRepository = "SlopDotCash/slopdotcash"
pure val pilotRepositoryId = 1319812413
pure val slopbotBotId = 340374191
pure val slopbotBotLogin = "slopdotcash[bot]"
pure val maxAutoMergesPerRun = 5
pure val autoMergeListPageLimit = 5
pure val autoMergeEventPageLimit = 10
pure val autoMergeReviewPageLimit = 10
pure val autoMergeFilePageLimit = 30
type AutoMergeLabelSource = LabelNone | LabelBySlopbot | LabelByOther
type AutoMergeReason = AutoMergeReady | AutoMergeSwitchOff | AutoMergeLimitReached | AutoMergeNotOpen
  | AutoMergeIsDraft | AutoMergeMissingLabel | AutoMergeWrongRepo | AutoMergeDisallowedBase
  | AutoMergeUnregisteredBase | AutoMergeNotMergeable | AutoMergeNotClean | AutoMergeNotBotLabel
  | AutoMergeForcePushed | AutoMergeStaleLabel | AutoMergeChangeRequested | AutoMergeNoWriterApproval
  | AutoMergeNoFiles | AutoMergeIncompleteFiles | AutoMergeTouchesGithub | AutoMergeHeadOrBaseMoved
type AutoMergeCandidate = {
  switchOn: bool, dryRun: bool, mergesSoFar: int,
  prOpen: bool, prDraft: bool, prLabelled: bool,
  sameRepo: bool, baseRef: str, defaultBranch: str, registeredIntegrationBranch: bool,
  prMergeable: bool, prClean: bool,
  labelSource: AutoMergeLabelSource, forcePushedAfterLabel: bool, headReviewedBeforeLabel: bool,
  writerChangeRequested: bool, writerApprovalCount: int,
  fileCount: int, filesComplete: bool, touchesGithub: bool,
  recheckSameHeadAndBase: bool, recheckOpen: bool, recheckDraft: bool, recheckLabelled: bool,
  recheckMergeable: bool, recheckClean: bool
}
pure def autoMergeSwitchActive(switchOn: bool, dryRun: bool): bool = switchOn or dryRun
pure def autoMergePermittedBase(sameRepo: bool, baseRef: str, defaultBranch: str, registeredIntegrationBranch: bool): bool =
  sameRepo and baseRef != "main" and baseRef != defaultBranch and registeredIntegrationBranch
pure def autoMergePullOk(prOpen: bool, prDraft: bool, prLabelled: bool, sameRepo: bool, baseRef: str,
  defaultBranch: str, registeredIntegrationBranch: bool, prMergeable: bool, prClean: bool): bool =
  prOpen and not(prDraft) and prLabelled and autoMergePermittedBase(sameRepo, baseRef, defaultBranch, registeredIntegrationBranch)
    and prMergeable and prClean
pure def autoMergeReason(candidate: AutoMergeCandidate): AutoMergeReason =
  if (not(autoMergeSwitchActive(candidate.switchOn, candidate.dryRun))) AutoMergeSwitchOff
  else if (candidate.mergesSoFar >= maxAutoMergesPerRun) AutoMergeLimitReached
  else if (not(candidate.prOpen)) AutoMergeNotOpen
  else if (candidate.prDraft) AutoMergeIsDraft
  else if (not(candidate.prLabelled)) AutoMergeMissingLabel
  else if (not(candidate.sameRepo)) AutoMergeWrongRepo
  else if (candidate.baseRef == "main" or candidate.baseRef == candidate.defaultBranch) AutoMergeDisallowedBase
  else if (not(candidate.prMergeable)) AutoMergeNotMergeable
  else if (not(candidate.prClean)) AutoMergeNotClean
  else if (not(candidate.registeredIntegrationBranch)) AutoMergeUnregisteredBase
  else if (candidate.labelSource != LabelBySlopbot) AutoMergeNotBotLabel
  else if (candidate.forcePushedAfterLabel) AutoMergeForcePushed
  else if (candidate.writerChangeRequested) AutoMergeChangeRequested
  else if (candidate.writerApprovalCount < 1) AutoMergeNoWriterApproval
  else if (not(candidate.headReviewedBeforeLabel)) AutoMergeStaleLabel
  else if (candidate.fileCount < 1) AutoMergeNoFiles
  else if (not(candidate.filesComplete)) AutoMergeIncompleteFiles
  else if (candidate.touchesGithub) AutoMergeTouchesGithub
  else if (not(candidate.recheckSameHeadAndBase)) AutoMergeHeadOrBaseMoved
  else if (not(candidate.recheckOpen)) AutoMergeNotOpen
  else if (candidate.recheckDraft) AutoMergeIsDraft
  else if (not(candidate.recheckLabelled)) AutoMergeMissingLabel
  else if (not(candidate.recheckMergeable)) AutoMergeNotMergeable
  else if (not(candidate.recheckClean)) AutoMergeNotClean
  else AutoMergeReady
pure def autoMergeAllowed(candidate: AutoMergeCandidate): bool =
  autoMergeReason(candidate) == AutoMergeReady
pure def autoMergeWillWrite(candidate: AutoMergeCandidate): bool =
  autoMergeAllowed(candidate) and not(candidate.dryRun)
pure def lawAutoMergeSwitchOffNeverWrites(candidate: AutoMergeCandidate): bool =
  not(candidate.switchOn) implies not(autoMergeWillWrite(candidate))
pure def lawAutoMergeNeverTargetsMainOrDefault(candidate: AutoMergeCandidate): bool =
  (candidate.baseRef == "main" or candidate.baseRef == candidate.defaultBranch
    or not(candidate.registeredIntegrationBranch) or not(candidate.sameRepo))
    implies not(autoMergeAllowed(candidate))
pure def lawAutoMergeRequiresSlopbotFreshLabel(candidate: AutoMergeCandidate): bool =
  (candidate.labelSource != LabelBySlopbot or candidate.forcePushedAfterLabel or not(candidate.headReviewedBeforeLabel))
    implies not(autoMergeAllowed(candidate))
pure def lawAutoMergeRequiresWriteApprovalAndNoChangeRequest(candidate: AutoMergeCandidate): bool =
  (candidate.writerApprovalCount < 1 or candidate.writerChangeRequested) implies not(autoMergeAllowed(candidate))
pure def lawAutoMergeRequiresCleanAndNoGithubPaths(candidate: AutoMergeCandidate): bool =
  (not(candidate.prMergeable) or not(candidate.prClean) or candidate.touchesGithub or candidate.fileCount < 1 or not(candidate.filesComplete))
    implies not(autoMergeAllowed(candidate))
pure def lawAutoMergeRecheckPinsHeadBaseAndRunCap(candidate: AutoMergeCandidate): bool =
  (not(candidate.recheckSameHeadAndBase) or not(candidate.recheckOpen) or candidate.recheckDraft
    or not(candidate.recheckLabelled) or not(candidate.recheckMergeable) or not(candidate.recheckClean)
    or candidate.mergesSoFar >= maxAutoMergesPerRun)
    implies not(autoMergeAllowed(candidate))
pure val validAutoMergeCandidate: AutoMergeCandidate = {
  switchOn: true, dryRun: false, mergesSoFar: 0,
  prOpen: true, prDraft: false, prLabelled: true,
  sameRepo: true, baseRef: "develop", defaultBranch: "main", registeredIntegrationBranch: true,
  prMergeable: true, prClean: true,
  labelSource: LabelBySlopbot, forcePushedAfterLabel: false, headReviewedBeforeLabel: true,
  writerChangeRequested: false, writerApprovalCount: 1,
  fileCount: 1, filesComplete: true, touchesGithub: false,
  recheckSameHeadAndBase: true, recheckOpen: true, recheckDraft: false, recheckLabelled: true,
  recheckMergeable: true, recheckClean: true
}
pure val candidateValues = Set(
  validAutoMergeCandidate,
  { ...validAutoMergeCandidate, switchOn: false },
  { ...validAutoMergeCandidate, switchOn: false, dryRun: true },
  { ...validAutoMergeCandidate, mergesSoFar: 5 },
  { ...validAutoMergeCandidate, baseRef: "main" },
  { ...validAutoMergeCandidate, baseRef: "trunk", defaultBranch: "trunk" },
  { ...validAutoMergeCandidate, baseRef: "feature", registeredIntegrationBranch: false },
  { ...validAutoMergeCandidate, labelSource: LabelByOther },
  { ...validAutoMergeCandidate, forcePushedAfterLabel: true },
  { ...validAutoMergeCandidate, headReviewedBeforeLabel: false },
  { ...validAutoMergeCandidate, writerChangeRequested: true },
  { ...validAutoMergeCandidate, writerApprovalCount: 0 },
  { ...validAutoMergeCandidate, prClean: false },
  { ...validAutoMergeCandidate, touchesGithub: true },
  { ...validAutoMergeCandidate, recheckSameHeadAndBase: false }
)
```
