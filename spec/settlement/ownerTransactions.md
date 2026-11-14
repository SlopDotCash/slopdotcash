# Owner-signed vault transactions

PRD sections 6 and 9: Slop never holds keys, signs or broadcasts payments.
The owner's own wallet signs deposits, withdrawals, award commitments and
Solana monthly commitments that Slop prepares as unsigned plans. Source
anchors are development `backend/payments/solana-funding.ts`
(`handleSolanaFunding`: `review` then `check`), `contracts/solana/funding.ts`,
`backend/payments/monthly.ts` (`POST .../monthly/:YYYY-MM/commitment` and
`.../solana-commitment`) and the routes `POST /api/v1/projects/:id/vault`,
`/payments/solana-funding`, `/payments/solana-monthly-commitment` (coverage
routes 21–23, 95–96 and 105). One instance is one owner request.

The review step rechecks the steward, repository authority, project
revision, enforcement state, served network, execution snapshot and funded
obligation, then returns an unsigned plan whose exact message the browser
reconstructs before asking for a signature. The wallet may prepend only a
compute-budget instruction, and a bounded assertion instruction may guard
the expected balances. The browser saves the pending request before the
wallet call and recovers it after a reload without a second submission. The
check step verifies the exact submitted signature and its finalized result.
A finalized reservation is a commitment, not a payment.

## Story: Review, sign elsewhere, and check exactly once

### A request is reviewed against current authority and becomes a fixed plan

```quint
type PlanKind = DepositPlan | WithdrawPlan | AwardPlan | SolanaMonthlyPlan
type RequestPhase = Draft | Reviewed | Pending | Finalized | Failed | Expired
type ReviewFacts = { steward: bool, repositoryAuthority: bool, revision: int, restricted: bool, networkServed: bool,
  snapshotDigest: str, obligationFunded: bool }
type Submission = { message: str, prefix: str, signature: str, transaction: str }
type CheckResult = { transaction: str, message: str, finalized: bool, succeeded: bool, expired: bool }
type OwnerRequest = { kind: PlanKind, phase: RequestPhase, revision: int, snapshotDigest: str, message: str,
  submitted: Submission, submissions: int }
pure val noSubmission: Submission = { message: "", prefix: "", signature: "", transaction: "" }
pure val initial: OwnerRequest = { kind: DepositPlan, phase: Draft, revision: 1, snapshotDigest: "d", message: "",
  submitted: noSubmission, submissions: 0 }
pure def reviewAllowed(r: OwnerRequest, kind: PlanKind, facts: ReviewFacts): bool =
  if (kind == DepositPlan) facts.networkServed
  else facts.steward and facts.repositoryAuthority and facts.revision == r.revision and not(facts.restricted) and facts.networkServed
    and (kind == WithdrawPlan or (facts.snapshotDigest == r.snapshotDigest and facts.obligationFunded))
pure def canReview(r: OwnerRequest, kind: PlanKind, facts: ReviewFacts, message: str): bool =
  r.phase == Draft and message != "" and reviewAllowed(r, kind, facts)
pure def review(r: OwnerRequest, kind: PlanKind, facts: ReviewFacts, message: str): OwnerRequest =
  { ...r, kind: kind, phase: Reviewed, message: message }
```

### The pending request is saved before the wallet call and recovered without resubmission

Only the reviewed message with at most an allowed wallet prefix is accepted.
A reload recovers the pending request; it never creates a second submission.

```quint
pure def allowedPrefix(prefix: str): bool = prefix == "" or prefix == "compute-budget"
pure def canSavePending(r: OwnerRequest, submission: Submission): bool =
  r.phase == Reviewed and submission.message == r.message and allowedPrefix(submission.prefix)
    and submission.signature != "" and submission.transaction != ""
pure def savePending(r: OwnerRequest, submission: Submission): OwnerRequest =
  { ...r, phase: Pending, submitted: submission, submissions: r.submissions + 1 }
pure def canRecover(r: OwnerRequest): bool = r.phase == Pending
pure def recover(r: OwnerRequest): OwnerRequest = r
```

### Only the exact finalized submitted transaction completes the request

A failed or expired blockhash fails the request without moving funds; a new
review creates a new request.

```quint
pure def canCheckResult(r: OwnerRequest, result: CheckResult): bool =
  r.phase == Pending and result.transaction == r.submitted.transaction and result.message == r.message
pure def checkResult(r: OwnerRequest, result: CheckResult): OwnerRequest =
  if (result.finalized and result.succeeded) { ...r, phase: Finalized }
  else if (result.expired or (result.finalized and not(result.succeeded))) { ...r, phase: Failed }
  else r
pure def alwaysOneSubmission(r: OwnerRequest): bool = r.submissions <= 1
  and ((r.phase == Pending or r.phase == Finalized or r.phase == Failed) implies r.submissions == 1 and r.submitted.message == r.message)
pure def stepPlanFixed(before: OwnerRequest, after: OwnerRequest): bool =
  before.phase != Draft implies after.message == before.message and after.kind == before.kind
pure def stepTerminal(before: OwnerRequest, after: OwnerRequest): bool =
  (before.phase == Finalized or before.phase == Failed) implies after == before
pure def sometimesFinalized(r: OwnerRequest): bool = r.phase == Finalized and r.kind == AwardPlan
pure def sometimesFailedAfterExpiry(r: OwnerRequest): bool = r.phase == Failed
```

### Simulation samples

```quint
pure val kindValues = Set(DepositPlan, WithdrawPlan, AwardPlan, SolanaMonthlyPlan)
pure val factsSample: ReviewFacts = { steward: true, repositoryAuthority: true, revision: 1, restricted: false, networkServed: true,
  snapshotDigest: "d", obligationFunded: true }
pure val factsValues = Set(factsSample, { ...factsSample, steward: false }, { ...factsSample, restricted: true },
  { ...factsSample, snapshotDigest: "other" })
pure val messageValues = Set("m1")
pure val submissionValues = Set({ message: "m1", prefix: "", signature: "s", transaction: "t" },
  { message: "m1", prefix: "compute-budget", signature: "s", transaction: "t" }, { message: "m1", prefix: "transfer", signature: "s", transaction: "t" },
  { message: "m2", prefix: "", signature: "s", transaction: "t" })
pure val resultValues = Set({ transaction: "t", message: "m1", finalized: true, succeeded: true, expired: false },
  { transaction: "t", message: "m1", finalized: false, succeeded: false, expired: true },
  { transaction: "t", message: "m1", finalized: false, succeeded: false, expired: false },
  { transaction: "u", message: "m1", finalized: true, succeeded: true, expired: false })
```
