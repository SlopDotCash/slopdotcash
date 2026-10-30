# Private security bounty cases

PRD section 8 ("Report and decide privately", "Pay a private award"), section
10, SEC-01 to SEC-18 and MVP-13 (issue #910). Program terms are public; cases
are not.

Registered projects accept private reports without paid bounty terms or funds.
Without terms, intake uses the primary registered repository. Receipts freeze
`terms: null` and `award_state: not-applicable`; later terms do not grant an
award to an earlier report. Current repository authority grants technical
case access only. Registry authors and the steward are notification candidates;
Slop checks their current GitHub repository permission before use and delivery.
No public page read requires a maintainer permission check.

## Program terms

A project opts in with the optional `securityBounty` section of its D1
manifest (`src/lib/security-bounty.mjs`). New after-approval terms may open as a pledge without a vault. Owners edit terms, open, pause or close the
program in project settings. Each change uses the existing project revision
route and checks current GitHub authority through Slopbot. Historical programs
require available funds from a current finalized snapshot of the separate,
reviewed bounty vault before opening. The approved `fundingPolicy:
"after-approval"` publishes a pledge: the owner may select an award before
funding. A direct award is approved without claiming a reservation; an existing vault-backed award needs a current finalized balance for its reservation. The server sets funding evidence; an owner cannot supply it.
The project steward or a repository admin manages contacts and the sponsor.
Ordinary write access cannot grant or remove private-case roles. Authority
checks use the stored project's repository before reading private funds.
New vault registration is a separate verification boundary. This editor does
not deploy a vault or accept client-supplied contract trust metadata.
A program cannot be removed. Existing cases retain their receipt terms and
funded obligations remain available after a pause or closure.

Private bounties use the same verified reward assets as monthly projects: network
stablecoins, native coins and custom tokens. `amount.asset` freezes the address,
network, kind, symbol and precision. The API reads token metadata and parses the
separate decimal `bountyAmount`; client-supplied precision is never trusted.
Historical USD/USDC terms without `amount.asset` remain valid.

New programs use `eligibility: "in-scope-security"`: the owner decides whether a
report meets the published scope and criteria. Existing
`critical-loss-of-funds` programs keep their severity and impact restrictions.
Eligibility is frozen at receipt, so later edits cannot change an existing
report's award conditions.

A bounty does not require a payment vault. Existing registered bounty vaults
remain available with their verified asset and purpose. Their balances stay
private and never enter ordinary contribution payment totals.

- `amount.grossMinor` is the published gross award per finding, in integer
  minor units divisible by four, so the 75/25 researcher/Slop split is exact.
  Shares are derived, never stored. Awards are discretionary: the owner may
  choose the frozen published amount or none under `after-approval` terms.
  Historical programs retain their original discretionary-amount rules.
- `rewardMode: "bounty-only"` requires a `$0` monthly pool with payments
  disabled. `separate` keeps the project's ordinary rewards.
- `status: "open"` normally requires `funding.state: "verified-available"`
  with an evidence reference. `fundingPolicy: "after-approval"` explicitly
  permits pledged terms, with no claim that money is available. Its
  `capacity.awards: null` means each first qualifying finding is considered
  separately, not a fixed number of awards. Owner decision
  D10: the funds an owner can reserve are the finalized free balance of the
  program's reviewed bounty vaults (`settlement.deployments`), from a
  `security_vault_snapshots` row in the program asset no older than 30
  minutes, minus every approved reservation that has not yet left that free
  balance through a finalized on-chain commitment. Published amounts and
  award counts are terms, not funds. A program without a reviewed vault
  reserves nothing. One payment draws on one vault, so with several vaults
  only the one with the largest current free balance counts.
- `approvers.dispute` names the program's dispute contact. A Slop moderator
  decides escalated disputes (see "Roles").
- `intake.repository` must be one of the project repositories.

`/projects/:id/terms.json` and `/projects/:id/security` publish these terms.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/v1/security-programs/:id/intake` | public, edge cached 30 s | Stored GitHub private reporting observation: `ready`, `disabled` or `unavailable`, with `checkedAt` and `stale`. `automatic` is `ready`, `app-not-installed`, `unavailable` or `off`; `automaticConfigured` reports configuration only. No provider request runs on this public read. |
| `GET /api/v1/security-cases` | session | Cases the caller can see now, shaped per role |
| `POST /api/v1/security-cases` | session | `claim`: a reporter links a GitHub advisory ID. `record`: a technical approver records a verified advisory with GitHub's receipt time. `import`: a maintainer imports direct GitHub reports |
| `GET /api/v1/security-cases/:id` | session and role | One case; logs the read |
| `POST /api/v1/security-cases/:id/actions` | session and role | One human decision with `expectedRevision` and `idempotencyKey` |
| `GET /api/v1/security-submissions` | session | Reporter and current technical case roles: saved reports, screening and routing states, optional GitHub delivery |
| `POST /api/v1/security-submissions` | session | Saves a `slop` report and receipt without OAuth; `direct` retains the legacy verification path |
| `GET /api/v1/security-submissions/:id` | current private role | Reads the saved report and records an access audit |
| `POST /api/v1/security-submissions/:id/{screen,review,report}` | reporter or current technical role, as applicable | Retry screening/routing, record a human routing decision, or save a new immutable report version |
| `GET /api/v1/security-submissions/authorize/callback` | GitHub redirect | PKCE exchange, `/user` identity binding, grant cookie |
| `POST /api/v1/security-submissions/:id/{authorize,send,reconcile,verify}` | reporter only | Reauthorize, send privately, reconcile an uncertain send, verify a direct report |

Submission lists include `recipientGithubId`, bound to the authenticated actor
whose records were queried. Clients match this value to their active account
before displaying or retaining the response. A later session read does not
establish who received an earlier response. Case lists already carry `viewer`
for the same check.

The private workspace also sends `x-slop-expected-github-id` on each report,
case and notification action request. Notification reads bind to the actor
when the preceding session read succeeds. Authentication resolves the current
actor first, then
refuses a malformed expectation or a different actor before private reads or
writes. The header only narrows the authenticated session; it never supplies
authority. Existing clients may omit it and retain the normal role checks.
The browser drops retained private views on account changes or access loss,
and clears tab drafts after confirmed sign-out while retaining uncertain
submissions through temporary session failures.

A caller without a role gets the same 404 as for a missing case. Writes need
this site's `Origin` and a JSON content type. Responses are `private,
no-store` and `noindex`. Errors never log case data.

## Cached reporting readiness

PRD sections 8 and 9 require private reporting and cached public reads. The
existing identity hourly schedule calls the private `ReportingReadinessRefresher`
entrypoint on Slopbot (the repository-access Worker in staging). It reads current
D1 registry repositories, including paused and unfunded projects, using the
existing GitHub App. The release publishes that entrypoint before its caller.
No new service, token, permission or schedule is required.

`repository_reporting_status` binds each observation to its project revision,
canonical repository name and immutable GitHub database/node IDs. Primary IDs
must match the registry; a secondary repository's first verified IDs cannot be
replaced within the revision. A changed revision starts unknown. A failed refresh
keeps the last verified enabled/disabled value and time, and marks it stale.
An observation also becomes stale after the hourly refresh interval. No case
content, token or GitHub error body enters this table.

The public page shows those observations. Unknown and stale are not disabled.
When automatic intake is configured, the researcher can keep preparing a draft;
creating it and sending it each recheck GitHub with the existing installation App.
A stale cache cannot block a successful fresh check or authorize a failed one.
Failed checks keep the authorized draft. Receipt reconciliation and send replay
retain their existing rules. This change does not enable intake mode.

`node backend/security/reporting-readiness.workflow.mjs` exercises the named
service, actual App JWT/token adapter, native D1 and Pages routes against synthetic
GitHub responses. The existing private-submission workflow tests verify fresh
send refusal, recovery and replay. These local results do not prove live App
permissions, scheduled execution or reporter delivery.

## Durable Slop-first intake

`POST /api/v1/security-submissions` accepts `origin: "slop"`, `projectId`,
`idempotencyKey` and a structured `report` from the authenticated Slop session.
New acceptance uses `reportIntakeEnabled` independently of retained reads.
This flow needs `reportStorage`, wired to the existing private R2 bucket under
`security-reports/`; it does not need a GitHub reporting grant, PVR readiness,
or a new provider. Missing private storage refuses acceptance. The source
receipt, frozen policy, case, submission metadata and reporter Inbox notice
commit together after the validated report is stored and its digest checked. The case
uses `receivedAtSource: "slop-received"`, `verifiedBy: "slop"` and no advisory.
No GitHub receipt is invented. GitHub-backed historical receipts are unchanged.

Migration `0101_durable_security_intake.sql` retains immutable body versions
as R2 references and SHA-256 digests. D1 contains no report body. Authorized
reporters and current technical case roles read the body through
`GET /api/v1/security-submissions/:id`; each read is audited, private,
no-store and noindex. Financial roles alone receive no body. Contributor
trace APIs cannot read this prefix. Bodies are never included in notification
text, activity mail, public pages, exports, analytics or logs.

Public report creation, evidence revisions and rescreen work share ten
admissions per account in a rolling hour. An atomic D1 admission precedes each
R2 write or paid call, including retained legacy drafts. Expired admission
counters may be removed; case, report and audit history is permanent. Completed
idempotent replays, reads, human decisions and notification-only retries do not
spend this budget. A refusal preserves the retained report, appeal access and
funded obligations. Screening retries return promptly through `waitUntil`;
Inbox's Refresh reports control reads the eventual state. A failed background
call remains recoverable within its existing bounded timeout.

The existing Surplus analyzer screens the saved report before owner routing.
States are `queued`, `running`, `legitimate`, `needs-information`, `spam` and
`unavailable`. Screening judges plausibility and concrete evidence; it is not
an award, rejection or disclosure decision. A complete legitimate screen
queues the existing generic private-case email and Inbox link. Held reports
stay readable to their reporter and current case authorities. They are not
automatically rejected or awarded. Failed delivery preserves the receipt;
retrying `/screen` on a legitimate report retries only idempotent routing.

- `POST /:id/screen` retries an unavailable or lost screen, or pending routing.
- `POST /:id/review` lets a current technical maintainer record `forward` or
  `request-information` with a private reason and the expected intake revision.
- `POST /:id/report` lets the reporter add a new immutable report version and
  rescreen before GitHub delivery or a final case decision. The original receipt
  time, bytes and terms remain retained. An old model result cannot overwrite
  the new version or a human routing review.
- The signed-in submissions list includes the reporter's reports and the
  current case authorities' reports. The normal case actions and private
  settlement work without a GitHub advisory.

New legacy-shaped `slop` drafts without a report are refused when durable storage is configured. Unfinished legacy drafts pass the same screen before their first forward.

GitHub forwarding is optional after a legitimate screen or a human `forward`
review. The existing per-submission reporter OAuth grant sends the exact saved
version as the reporter, with the same uncertain-send reconciliation. A
verified GitHub link is stored on the submission; it never rewrites the Slop
receipt or its terms, and later imports do not create a second case.

The `after-approval` policy lets the owner approve an award for direct payment
without a vault or a claimed fund reservation. Existing vault-backed programs
keep a chosen amount pending until verified funds can cover it. The first chosen
root cause is held against duplicate awards. An `in-scope-security` award
requires the owner's confirmed finding against the published scope and criteria.
Historical `critical-loss-of-funds` terms retain their severity and impact
conditions. Existing approved awards and prefunded-program behavior stay unchanged.

## Legacy GitHub-first private intake

PRD section 8 ("Private reporting is automatic"), SEC-07, SEC-10, SEC-17.
Legacy OAuth, forwarding and receipt-verification routes return 404 unless
`SLOP_PRIVATE_INTAKE_MODE=on` and all intake App secrets are set
(`GITHUB_INTAKE_APP_CLIENT_ID`, `GITHUB_INTAKE_APP_CLIENT_SECRET`,
`GITHUB_INTAKE_APP_ID`, `GITHUB_INTAKE_APP_PRIVATE_KEY`,
`SLOP_INTAKE_GRANT_KEY`). Owner decision D10: these hold the existing
slopdotcash GitHub App (5257625); there is no separate intake App and no
long-lived token. Owner decision, 30 October 2026: the App configuration may
request "Repository security advisories: write" for the researcher's
user-authorized private-report request. Backend installation tokens still
request only `repository_advisories: read` and must never file or change an
advisory. Each installation owner must accept the requested permission.
Keep optional forwarding unavailable until reporter authorization and an
independently verified GitHub receipt qualify the flow; the saved private
Slop report and its review do not depend on forwarding. The permission change
is approved, not evidence that live delivery has succeeded.

Provision the five intake secrets and `SURPLUS_API_KEY` on the production
Pages project `eliza-computer`. The release secret inventory permits staged
provisioning. Store the App private key as PEM, not base64-encoded PEM.
Generate `SLOP_INTAKE_GRANT_KEY` from 32 random bytes encoded as base64url.
Keep `SLOP_PRIVATE_INTAKE_MODE` off until the App callback URL and live
reporter authorization have been checked. Provisioning secrets does not
activate intake or prove that GitHub or Surplus is available.

- Authorization: a per-submission PKCE consent for the intake App. The
  callback checks that `/user` is the account that began the consent and
  stores the user token only in an AES-GCM encrypted HttpOnly
  `__Secure-slop_intake_grant` cookie (path `/api/v1/security-submissions`,
  2 hours) bound to the submission and the site session. No access or
  refresh token is stored in D1. GitHub records the reporter as the author.
- `security_submissions` (migration 0059) holds no report content. States:
  `draft`, `submitting`, `uncertain`, `submitted`, `receipt-verified`,
  `failed`, `abandoned`. Every transition is a revision compare-and-set
  with an insert-only event in the same batch. `submitting` commits before
  GitHub is called; a lost answer, a 5xx, a malformed 201 or a 201 naming
  another author is `uncertain`. A GitHub rate limit (429, or 403 with
  `x-ratelimit-remaining: 0`, `retry-after` or a rate-limit message) keeps
  no copy: the send returns the draft for another send with a `rate-limited`
  event and the wait GitHub gives. It never records `forbidden`.
- Marker: the description gets one line, `Report reference: <32 hex>`, a
  random value per submission. It names neither the submission nor Slop,
  because it stays in the text if the advisory is published
  (OPEN_QUESTION 9); the consent notice says so.
- Reconcile before retry: an uncertain send lists the reporter's advisories
  since the first attempt with their own token and matches the marker line
  and author. Only a complete listing without a match, taken at least
  5 minutes after the attempt began, reopens the draft for another send;
  an earlier empty listing or a listing error stays `uncertain`. Several
  matches adopt the earliest and show the rest to the technical approvers
  only. A resend that GitHub accepts lists again and adopts an earlier copy
  that landed late, recording the accepted one as a duplicate. A
  `submitting` row older than 60 seconds becomes `uncertain` and is never
  resent. A `submitted` row Slop cannot verify within 24 hours fails as
  `unverifiable`; it is never resent and no longer blocks a new report.
  A GitHub-verified receipt held for unavailable routing contacts does not
  expire or become an abandoned draft. Its existing journal records that
  distinction. When contacts return, the reporter can finish verification;
  an expired two-hour GitHub grant requires fresh reporter authorization.
  Recovery rechecks the receipt and current contacts without sending again.
- Receipt: GitHub's advisory must name the program repository and the
  reporter as author (a reporter credit never counts), carry the marker
  (Slop origin) and have a past `created_at`. A direct report must also be
  a private vulnerability report (GitHub's `submission` object) in
  `triage`, `draft` or `published`; anything else fails as
  `not-private-report` and uses the manual claim path. The verified case,
  its `submit` or `submit-direct` event (the reporter's own action; the
  detail records `verifiedBy: "github"`), routing fields, the access log and the inbox rows commit with the
  submission transition. The inbox rows are the technical approvers' case
  notice and the reporter's generic `security_report_received` receipt, which
  asks for no acknowledgment. The receipt time is GitHub's `created_at`
  (`receivedAtSource: "github-verified"`), the verifier is the sentinel
  `github`, and `receipt_evidence_digest` stores the SHA-256 of the
  advisory fields GitHub returned.
- Direct reports: "Already reported on GitHub? Verify it" runs the same
  receipt check on a GHSA the reporter filed themselves; GitHub's original
  `created_at` is kept. Without the App installed, the manual claim and
  verify-link path below remains the fallback.
- Analysis: `report-analysis.ts` recommends only, from GitHub's structured
  severity and CVSS fields. Its result is in the restricted event detail
  only; the case's owner, neutral next action and due time (the published
  acknowledgement target) do not depend on it, because the reporter sees
  them. It never sets severity, receipt, award or disclosure.
- After verified receipt, `analysis.ts` schedules a private proposal. The
  owner selected Surplus Intelligence only, with `SURPLUS_API_KEY`. It requests
  `claude-opus-5.5` through the Surplus Messages API. The requested model is
  not proof of the model served by the marketplace. A zero-data-retention
  agreement is not required. Retention follows the applicable account terms.
  There is no fallback: without the key every analysis is `unavailable`.
  A refusal or a cut-off answer is `failed`.
  The automatic attempt runs after the response and has 25 seconds, because
  Cloudflare stops that work about 30 seconds after the response; a slower
  answer is `failed`. The owner's retry runs inside the request and waits up
  to 120 seconds.
  Only maintainers and assigned triagers see the proposal. The endpoint is
  fixed; only local browser tests may point it at a loopback fixture with
  `SLOP_ANALYSIS_API_ORIGIN` (`http://127.0.0.1:<port>`).
- Maintainers can import reports filed directly on GitHub through `mode: import`.
  This uses the same case and analysis records, not a second submission system.
  Receipt checks, imports and analysis retries read advisories with a
  repository-scoped installation token of the slopdotcash App that asks only
  for `repository_advisories: read` (`GITHUB_INTAKE_APP_ID` and
  `GITHUB_INTAKE_APP_PRIVATE_KEY`). Without them receipt checks are
  unavailable. The token cannot submit a report as the researcher.

## Roles

Roles are computed on every request from the session and the current project
revision, so a revision or a revoked session removes access at once.

- Reporter: their own cases, never another report, root cause or triager.
- Any registered user may report; project membership is not required.
- Technical approver (security maintainer, the project owner or maintainer
  authority of PRD section 10): every case of the project; decides findings,
  awards, remediation and disclosure; prepares the unsigned payment.
- Triager: only assigned cases; request information and remediation.
- Financial approver: only cases with an approved (or older reserved) award,
  and only award and payment fields; prepares the unsigned payment.
- Moderator (`PROJECT_MODERATOR_GITHUB_IDS`): only cases with an appeal or a
  related-party award review; decides them. The notify Worker suppresses
  moderator mail unless it has the same list.
- Platform admins, sponsors and the public: nothing.

A reporter never acts on their own case. PRD section 10 names two
authorities: the project owner or maintainer decides technical, award and
disclosure questions, so the decider may also approve the award and prepare
its payment. The technical decider cannot decide the appeal or the
related-party review, and the related-party reviewer cannot decide an appeal
of that review, or review the same case again once an appeal has returned it
for a new decision. Owner decision D10 dropped the older rule that separate
people hold the technical, financial and dispute roles.

## States

Migration `0026_private_security_cases.sql` keeps independent receipt,
remediation, award, payment and disclosure states. `0059` adds automatic
submissions and receipt evidence; `0061` adds chosen award amounts and analyses. Triggers keep the
frozen receipt, events, reservations, membership history, submissions and
finished analyses append-only.

Each case shows one derived next step for the viewer (`nextStep`, with
`nextStepDueAt` from the program's acknowledgement target while the report
waits for a first response, or the payment deadline). Nobody maintains a
separate task field. Owner actions: `request-information`, `decide`, `award`,
`remediation`; access and disclosure tools (`assign-triager`,
`revoke-triager`, `disclosure`) stay available but the page shows disclosure
first only once a fix exists or a disclosure decision was recorded.

Triager assignment and revocation commit only together with their audit
event at the next case revision. A stale request changes no membership.

## Awards

PRD section 8: critical bugs and potential loss of funds are priorities, not
an automatic payout promise. `decide` records outcome, severity, loss and
scope as guidance. A confirmed finding with paid terms then waits for the
owner's award decision (`award`, or an `award` object inside `decide`):

- `decision: "none"` makes the award `ineligible` (shown as "No award"). The
  reporter can appeal it.
- `decision: "amount"` with `grossMinor`, `paymentDeadline` and confirmation
  selects that exact gross amount. An `after-approval` program requires the
  frozen published amount. A direct award can be approved without a vault; it
  does not reserve wallet funds. For an existing vault-backed program without
  verified funds it remains pending. Once funded, the owner repeats the action
  and reserves the amount in the same batch. The
  reservation insert itself checks that the bounty vault's unreserved
  finalized free balance covers it; otherwise nothing is written
  (`409 insufficient_funds`). A pledge, a program without a reviewed vault,
  or a missing or stale snapshot reserves nothing (`409 funds_unavailable`). Only a security
  maintainer of the program decides; a reporter never decides their own case.

One root cause reserves once per project (`root_cause_reserved`). A reserved
or approved award is never redecided or withdrawn. A related-party reporter
(declared, a program approver, or the sponsor account) gets a proposed amount
that reserves nothing until a moderator approves it
(`decide-related-party`); the approval then reserves the proposed amount if
funds exist. Once related, a case stays related, and earlier reviewers stay
recorded.

Older cases keep their records: a `reserved` award from before discretionary
awards is approved at its reserved amount, and a `capacity-exhausted` award
waits for the owner's award decision like any `pending` one. The removed
`approve-award`, `reserve-award`, `verify-link`, `reject-link`, `triage` and
`next-action` events stay readable in history.

A reporter may appeal a duplicate, out-of-scope or rejected finding, or a
confirmed finding without an award. `uphold` restores the receipt unchanged;
`return` sends it back to a new decision and reopens the award decision.

Slopbot triages every appeal first (PRD section 8). When the reporter files
the appeal, the same analyzer as the report analysis (Surplus
`claude-opus-5.5`, prompt `slop-security-appeal-triage-1`) reads the appealed
decision, its reason, the appeal reason, Slopbot's earlier report summary and
the program scope from the case's recorded policy revision. Both report
analysis and appeal triage use that revision, not later project edits. If no
policy revision was recorded at receipt, the scope is unknown. The appeal
triage reads no advisory text again. It drafts `uphold` or
`return`, a rationale and a confidence (`security_appeal_triages`, migration
0069). The draft is advice only: it never decides the appeal, changes the case
or moves funds. Under the recorded escalation criteria a private security
case always goes to a moderator, so every draft records the escalation reason
`private-security-case`, and `confidence-below-floor` when its confidence is
below 0.9. The owner, triagers and dispute reviewers see the draft; the
reporter's view does not. A failed, unavailable or lost attempt lets a dispute
reviewer run `triage-appeal` again. A moderator decides the appeal with or
without a draft.

After a Quarantine or a Ban appends the paused, `retired` project revision, a
case that already exists keeps `analyze` and `triage-appeal`. New reports,
`check-receipt` and new awards stay closed, because a receipt check imports
every new report in the repository. The enforcement record must name the
revision it appended. An owner retirement before the restriction, or a
retired revision appended later for a `revision_pending` record, keeps these
actions closed.

## Disclosure approval records

A disclosure decision records its private human-approval evidence reference.
Approving redacted text also binds the exact content SHA-256. Recording disclosure
requires the latest disclosure decision to approve those same bytes, and retains
that approval's case revision. Changed bytes need a new approval. Any approved
embargo change is explicit in the immutable event; omission means no change.
These records do not publish content or schedule disclosure. Reporter recognition
consent stays separate. Older events remain unchanged and cannot authorize a new
disclosure without an exact content approval.

## Direct private payments

A program without a registered bounty vault uses direct payment. The reporter
accepts the wallet, asset and public transaction visibility. A financial approver
prepares an unsigned plan from their verified wallet. The plan freezes the
approved amount, asset, payer, reporter and canonical platform fee recipient.
It includes one or two EVM transfers, or one Solana transaction with the exact
native/SPL transfers. Slop does not sign or broadcast it.

The browser connects the payer's EVM or Solana wallet and presents only that
retained request. It rechecks the account and case before a wallet prompt.
A local journal records the request before sending. An uncertain wallet result
cannot trigger another send; the payer can enter or correct the transaction
identifier and verify it. Saved, unverified identifiers remain available during
wallet holds, while confirmed transfers are excluded.

`prepare-payment` reuses a pending request. Migration
`0112_direct_payment_recovery.sql` pins each new EVM transfer to a reserved payer
nonce and retains immutable payment generations. If the reporter changes wallets,
the unpaid researcher transfer is held until the reporter accepts the successor
wallet and the original payer confirms recovery. Verified legs are never issued
again. Lower pending nonces must clear before a later transfer can execute.
The unchanged fee transfer remains available while a changed researcher wallet
is held. A successor requires a finalized zero-value self-send with empty data at
the original transfer nonce,
or a finalized failed transaction that consumed that nonce. The payer signs these
transactions in their own wallet. Slop verifies canonical chain evidence before
it creates a new request. Successful self-cancellation also requires a plain EOA:
no payer code at either adjacent block and no payer authorization in the receipt
block. The website withholds this action for a coded or unchecked payer.
Migration `0113_direct_unpaid_leg_recovery.sql` permits recovery of either unpaid
leg while preserving every paid leg. The same verified researcher wallet can
recover a consumed nonce. An unpaid fee can recover after the researcher is paid,
without asking the reporter to consent again. A successful unrelated transaction
is not cancellation proof and requires manual review. A legacy EVM request without a pinned nonce cannot be
redirected automatically; renewed consent can restore only its original address.

Solana reuses the original unsigned bytes while their blockhash is valid. A new
message, including one for the same wallet, requires retirement of every issued
message first. Both configured independent RPC operators must confirm expiry and
retain the complete canonical history from each blockhash to the finalized tip.
Only after expiry does Slop request a signature over the old message, to identify
its deterministic transaction signature in that history. The signature is not
broadcast. Bounded history scans resume from private append-only cursors. A found
payment is verified instead of replaced; a matching canonical failed transaction
can retire that message. Missing, inconsistent or incomplete history cannot
authorize a successor. `SOLANA_RECOVERY_RPC_URL` must name a different recognized
operator from the primary `PAYMENT_RPC_URLS` Solana endpoint. Two URLs from one
operator do not qualify. The loopback exception is for non-mainnet local tests.
Verification of an already-sent transfer remains available throughout recovery.
`verify-payment` accepts one or both transaction IDs in either order. Each
finalized EVM transfer is retained separately; the next plan includes only
unpaid transfers. The case becomes paid only after every required transfer
is finalized and reconciled. Chain height/slot captured during
preparation excludes earlier transfers without comparing independent wall clocks.
Wrong networks, assets, parties, amounts, failed transactions
and receipts already used by another award are refused. An unavailable proof
stays unverified; a submitted hash alone is never payment evidence.

ERC-20 verification uses the configured `PAYMENT_RPC_URLS` endpoint's historical
state and transaction tracing: `debug_traceTransaction` with `prestateTracer`
and `diffMode`, plus `debug_traceCall` with state overrides and the call and
prestate tracers. Token preparation checks this capability before returning an
unsigned request. Native EVM preparation also checks transaction-state tracing.
Verification requires the recipient's exact native credit and the payer's exact
debit, with execution gas and Base data/operator fees kept separate. Refunds
or forwarding by a contract or delegated wallet do not count as receipt.
Missing proof support returns `payment_proof_unavailable`; there is no event-only
or whole-block-balance fallback. If verification is unavailable after a send,
retry verification when the service recovers; do not send the payment again.

Migration `0108_private_direct_payments.sql` keeps the immutable direct intent,
receipt and transaction-use records private and separate from vault settlements.
Migration `0109_direct_payment_transfer_receipts.sql` retains partial payments
and enforces transaction uniqueness before an award is complete.
Direct payments reserve no wallet balance. Existing approved splits and
related-party review requirements remain in force.
Direct platform fees use the same reviewed fee wallet and conversion policy
as project fees. Completed receipts keep the paid asset discoverable after
project edits. Native conversion credits only the proved fee amount, excluding
gas top-ups and unrelated wallet deposits. Robinhood fees remain in their
original asset under that network's existing policy.

## Existing vault settlement

The 22 October 2026 product decision uses the existing escrow rails with a
75% reporter share and 25% Slop share. Migration
`0057_private_security_payments.sql` separates settlement intents, payment
records, attempts and finalized vault snapshots from ordinary payments.
Canonical wallet possession and binding authorizations remain shared.

Existing vault payments use the reserved gross amount of the approved award.
Registration of a finalized vault attaches the
`securityBounty.settlement` policy with `feeBasisPoints: 2500` and
`withdrawalFeeBasisPoints: 200` (`attachBountyVault` in
`backend/projects/vault-setup.ts`). The vault must not appear in
any other payment program. Its verified asset must match the frozen award
asset; historical USD awards cannot be converted implicitly. The reporter accepts the selected
rail's public chain visibility before the maintainer or delegated payer prepares an
immutable unsigned commitment. Report state stays independent of payment
state, and no payment authorizes disclosure. Onchain records expose actor numbers, addresses,
times and amounts. They contain a random source commitment, never report data.

The owner submits the unsigned commitment outside Slop. The private worker
uses the existing finalized-event verifier and recovery engine, with the
25% fee policy and the exact approved private intent. Public payment queries,
notifications and aggregates never use these tables. A lost response is
uncertain until verified chain evidence resolves it. No action can manually
mark an award paid. Missing wallets retain their award. An added or changed
wallet activates immediately after the account and wallet-control proof,
with no waiting period (PRD section 11, "Wallet activation").

Generate the reviewed private deployment inventory with
`bun scripts/prepare-payment-deployments.ts testnet <network> --security-bounty`
and the existing stack generator with `--scope security-bounty`.
Production retains the existing attester-only policy; this change does not
authorize a Slop signer or mainnet dispatch. Test stacks use isolated databases.
A vault-backed payment needs its approved matching vault. A program without
one uses the direct payment path above.

Solana wallet co-signing uses the existing authenticated
`/api/v1/payments/wallets/solana-bind/prepare` and `complete` endpoints.
The lookup resolves the signed-in reporter's private obligation and records
an audited access. Private binding requests use the separate
`SECURITY_SOLANA_IDENTITY_ATTESTER` service binding; they never fall back to
the ordinary attester. Missing service configuration fails closed.

## Hosted services

- Email: the restricted verified-destination pilot is in
  `workers/notify/security.ts`; see `workers/notify/README.md`. Every case
  inbox insert also queues one private outbox row in the same transaction.
  Only current case roles with operator-verified destinations receive generic
  notices. An email never contains a case identifier, amount, project or
  advisory. The inbox action **Acknowledge** records the recipient's
  authenticated response; **Mark read** is a separate state and never
  acknowledges a notice.
- Optional GitHub forwarding reads only the reporter's own advisory with the
  reporter's token; imports and retries read with the slopdotcash App
  installation token. Durable Slop report versions stay in the private R2
  security-report prefix; legacy GitHub-first reports keep only digests. The App permission must be
  accepted on each installation.
- Private analysis needs `SURPLUS_API_KEY`; a zero-data-retention
  agreement is not required.

Owner decision, 26 October 2026 (PRD section 11, #910): the remaining
private-reporting live checks are accepted without proof. They are non-admin
delivery, automatic analysis, maintainer notices, interrupted-submission
recovery and funded private-bounty settlement. Record them as waived, not
passed. This acceptance grants no signing or spending authority, activates no
service, and does not establish completion of the whole MVP.

A moderator account ban prevents an account from proposing or approving a new
bounty award, or receiving a new bounty reservation. The database checks both
the decision maker and researcher again when it writes, including related-party
proposals. A ban recorded during approval cannot create the award.
Existing reservations are unchanged. The researcher can still read the case
and appeal. This check does not replace account checks on other new Slop work.
