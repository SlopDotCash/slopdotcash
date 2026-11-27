# Owner-signed vault transactions

PRD sections 6 and 9: Slop never holds keys, signs or broadcasts payments.
The owner's own wallet signs deposits, withdrawals, award commitments,
Solana monthly commitments and the monthly payment setting that Slop
prepares as unsigned plans. Source anchors are development `backend/payments/solana-funding.ts`
(`handleSolanaFunding`: `review` then `check`), `contracts/solana/funding.ts`,
`backend/payments/monthly.ts` (`POST .../monthly/:YYYY-MM/commitment` and
`.../solana-commitment`) and the routes `POST /api/v1/projects/:id/vault`,
`/payments/solana-funding`, `/payments/solana-monthly-commitment` (coverage
routes 21–23, 95–96 and 105). One instance is one owner request.

The review step rechecks the steward, repository authority, project
revision, enforcement state, served network, execution snapshot and funded
obligation. These arrive as one typed `ReviewFacts` record: stewardship and
repository authority from the projects area's current GitHub authority check
by permanent actor and repository IDs at the write boundary, restriction
from security enforcement, the served network from the reviewed deployment
configuration, and the snapshot and funding from the monthly coordinator.
The requester supplies none of them. The check step's `CheckResult` comes
from the chain adapter's finalized read of the submitted signature. The
review step then returns an unsigned plan whose exact message the browser
reconstructs before asking for a signature. The wallet may prepend only a
compute-budget instruction, and a bounded assertion instruction may guard
the expected balances. The browser saves the pending request before the
wallet call and recovers it after a reload without a second submission,
except a month lock or a lapsed-lock release, which only page memory holds. The
check step verifies the exact submitted signature and its finalized result.
A finalized reservation is a commitment, not a payment.

## Story: Review, sign elsewhere, and check exactly once

### A request is reviewed against current authority and becomes a fixed plan

Month locks (operator decision, 15 November 2026; development
`backend/payments/solana-month-lock.ts`, `POST /projects/:id/solana-month-lock`)
add two plans that need only a served network and the planner's acceptance,
because the program itself checks the owner: the owner's lock of 1, 3, 6 or
12 months from the current UTC month at one positive amount, and anyone's
release of one month's lapsed lock. `monthLockPlanned` is the
[month pledges](./monthPledges.md) planner's answer on the finalized read:
`lockPlanned` for a lock, `canPlanRelease` for a release. A lock with nothing
left to plan has no message to sign and is never reviewed. The check accepts
exactly the rebuilt pledge or release message, as for every plan. A
withdrawal review is refused while `lockedFunds` holds: the free balance
less the gross is below the vault's open pledged total
(`withdrawTakesPledgedFunds`; development `backend/payments/solana-funding.ts`).
The owner's automatic monthly payment setting on a Solana vault
(`set_monthly_commitment`; development `backend/payments/handler.ts`,
`POST /projects/:id/solana-monthly-commitment`, and
`contracts/solana/monthly-commitment.ts`) is a `MonthlySettingPlan`. Like a
deposit it needs only a served network, because the program itself checks
the owner signer and the planner refuses a wallet other than the vault's
owner, a cap outside u64, turning it on at a zero cap, a vault that does not
belong to the project and a vault that is not ordinary. A requested setting equal to the finalized one has nothing to sign
and is never reviewed.

```quint
type PlanKind = DepositPlan | WithdrawPlan | AwardPlan | SolanaMonthlyPlan | LockMonthsPlan | ReleaseLapsedPledgePlan | MonthlySettingPlan
type RequestPhase = Draft | Reviewed | Pending | Finalized | Failed | Expired
type ReviewFacts = { steward: bool, repositoryAuthority: bool, revision: int, restricted: bool, networkServed: bool,
  snapshotDigest: str, obligationFunded: bool, monthLockPlanned: bool, lockedFunds: bool }
type Submission = { message: str, prefix: str, signature: str, transaction: str }
type CheckResult = { transaction: str, message: str, finalized: bool, succeeded: bool, expired: bool }
type OwnerRequest = { kind: PlanKind, phase: RequestPhase, revision: int, snapshotDigest: str, message: str,
  submitted: Submission, submissions: int }
pure val noSubmission: Submission = { message: "", prefix: "", signature: "", transaction: "" }
pure val initial: OwnerRequest = { kind: DepositPlan, phase: Draft, revision: 1, snapshotDigest: "d", message: "",
  submitted: noSubmission, submissions: 0 }
pure def reviewAllowed(r: OwnerRequest, kind: PlanKind, facts: ReviewFacts): bool =
  if (kind == DepositPlan or kind == MonthlySettingPlan) facts.networkServed
  else if (kind == LockMonthsPlan or kind == ReleaseLapsedPledgePlan) facts.networkServed and facts.monthLockPlanned
  else facts.steward and facts.repositoryAuthority and facts.revision == r.revision and not(facts.restricted) and facts.networkServed
    and (if (kind == WithdrawPlan) not(facts.lockedFunds) else (facts.snapshotDigest == r.snapshotDigest and facts.obligationFunded))
pure def canReview(r: OwnerRequest, kind: PlanKind, facts: ReviewFacts, message: str): bool =
  r.phase == Draft and message != "" and reviewAllowed(r, kind, facts)
pure def review(r: OwnerRequest, kind: PlanKind, facts: ReviewFacts, message: str): OwnerRequest =
  { ...r, kind: kind, phase: Reviewed, message: message }
```

### The pending request is saved before the wallet call and recovered without resubmission

Only the reviewed message with at most an allowed wallet prefix is accepted.
A reload recovers the pending request; it never creates a second submission.
The saved request and its recovery after a reload apply to deposit,
withdrawal, award, Solana monthly and monthly setting plans. A month lock or a lapsed-lock
release is held only in page memory, so a reload loses its automatic check
and the owner reviews and sends again (development `src/VaultMonthLock.tsx`
keeps the sent lock or release in component state;
[month lock](../frontend/monthLock.md)).

```quint
pure def allowedPrefix(prefix: str): bool = prefix == "" or prefix == "compute-budget"
pure def canSavePending(r: OwnerRequest, submission: Submission): bool =
  r.phase == Reviewed and submission.message == r.message and allowedPrefix(submission.prefix)
    and submission.signature != "" and submission.transaction != ""
pure def savePending(r: OwnerRequest, submission: Submission): OwnerRequest =
  { ...r, phase: Pending, submitted: submission, submissions: r.submissions + 1 }
pure def savedKind(k: PlanKind): bool = k != LockMonthsPlan and k != ReleaseLapsedPledgePlan
pure def canRecover(r: OwnerRequest): bool = r.phase == Pending and savedKind(r.kind)
pure def recover(r: OwnerRequest): OwnerRequest = r
```

### Only the exact finalized submitted transaction completes the request

A failed or expired blockhash fails the request without moving funds; a new
review creates a new request. A request has zero submissions while draft or
reviewed and exactly one once pending, finalized or failed.

```quint
pure def canCheckResult(r: OwnerRequest, result: CheckResult): bool =
  r.phase == Pending and result.transaction == r.submitted.transaction and result.message == r.message
pure def checkResult(r: OwnerRequest, result: CheckResult): OwnerRequest =
  if (result.finalized and result.succeeded) { ...r, phase: Finalized }
  else if (result.expired or (result.finalized and not(result.succeeded))) { ...r, phase: Failed }
  else r
pure def alwaysOneSubmission(r: OwnerRequest): bool = r.submissions <= 1
  and ((r.phase == Draft or r.phase == Reviewed) implies r.submissions == 0)
  and ((r.phase == Pending or r.phase == Finalized or r.phase == Failed) implies r.submissions == 1 and r.submitted.message == r.message)
pure def stepPlanFixed(before: OwnerRequest, after: OwnerRequest): bool =
  before.phase != Draft implies after.message == before.message and after.kind == before.kind
pure def stepTerminal(before: OwnerRequest, after: OwnerRequest): bool =
  (before.phase == Finalized or before.phase == Failed) implies after == before
pure def sometimesFinalized(r: OwnerRequest): bool = r.phase == Finalized and r.kind == AwardPlan
pure def sometimesFailedAfterExpiry(r: OwnerRequest): bool = r.phase == Failed
pure def sometimesMonthsLocked(r: OwnerRequest): bool = r.phase == Finalized and r.kind == LockMonthsPlan
pure def sometimesLapsedLockReleased(r: OwnerRequest): bool = r.phase == Finalized and r.kind == ReleaseLapsedPledgePlan
pure def sometimesMonthlySettingChanged(r: OwnerRequest): bool = r.phase == Finalized and r.kind == MonthlySettingPlan
```

### Simulation samples

```quint
pure val kindValues = Set(DepositPlan, WithdrawPlan, AwardPlan, SolanaMonthlyPlan, LockMonthsPlan, ReleaseLapsedPledgePlan, MonthlySettingPlan)
pure val factsSample: ReviewFacts = { steward: true, repositoryAuthority: true, revision: 1, restricted: false, networkServed: true,
  snapshotDigest: "d", obligationFunded: true, monthLockPlanned: true, lockedFunds: false }
pure val factsValues = Set(factsSample, { ...factsSample, steward: false }, { ...factsSample, restricted: true },
  { ...factsSample, snapshotDigest: "other" }, { ...factsSample, lockedFunds: true }, { ...factsSample, monthLockPlanned: false })
pure val messageValues = Set("m1")
pure val submissionValues = Set({ message: "m1", prefix: "", signature: "s", transaction: "t" },
  { message: "m1", prefix: "compute-budget", signature: "s", transaction: "t" }, { message: "m1", prefix: "transfer", signature: "s", transaction: "t" },
  { message: "m2", prefix: "", signature: "s", transaction: "t" })
pure val resultValues = Set({ transaction: "t", message: "m1", finalized: true, succeeded: true, expired: false },
  { transaction: "t", message: "m1", finalized: false, succeeded: false, expired: true },
  { transaction: "t", message: "m1", finalized: false, succeeded: false, expired: false },
  { transaction: "u", message: "m1", finalized: true, succeeded: true, expired: false })
```
