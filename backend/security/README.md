# Private security bounty cases

PRD SEC-01 to SEC-18 and MVP-13. Program terms are public; cases are not.

## Program terms

A project opts in with the optional `securityBounty` section of its D1
manifest (`src/lib/security-bounty.mjs`). An application may include it only
as `pending-approval` with `pledged` funding. Admins open, pause or close the
program by appending a manifest revision on `/admin`. A program cannot be
removed, because its approvers govern restricted case access after closure.

- `amount.grossMinor` is integer minor units. It must be divisible by four, so
  the 75/25 researcher/Slop split is exact. Shares are derived, never stored.
- `rewardMode: "bounty-only"` requires a `$0` monthly pool with payments
  disabled. `separate` keeps the project's ordinary rewards.
- `status: "open"` requires `funding.state: "verified-available"` with an
  evidence reference. A pledge never opens paid capacity.
- `approvers.dispute` must not include a technical or financial approver.
- `intake.repository` must be one of the project repositories.

`/projects/:id/terms.json` and `/projects/:id/security` publish these terms.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/v1/security-programs/:id/intake` | public, edge cached 30 s | GitHub private vulnerability reporting readiness: `ready`, `disabled`, `forbidden` or `unavailable`. Only `ready` returns the GitHub handoff URL |
| `GET /api/v1/security-cases` | session | Cases the caller can see now, shaped per role |
| `POST /api/v1/security-cases` | session | `claim`: a reporter links a GitHub advisory ID. `record`: a technical approver records a verified advisory with GitHub's receipt time |
| `GET /api/v1/security-cases/:id` | session and role | One case; logs the read |
| `POST /api/v1/security-cases/:id/actions` | session and role | One human decision with `expectedRevision` and `idempotencyKey` |

A caller without a role gets the same 404 as for a missing case. Writes need
this site's `Origin` and a JSON content type. Responses are `private,
no-store` and `noindex`. Errors never log case data.

## Roles

Roles are computed on every request from the session and the current project
revision, so a revision or a revoked session removes access at once.

- Reporter: their own cases, never another report, root cause or triager.
- Technical approver (security maintainer): every case of the project.
- Triager: only assigned cases; triage, next action and remediation.
- Financial approver: only cases with a reserved, exhausted or approved
  award, and only award and payment fields.
- Dispute reviewer: only cases with an appeal or a related-party award
  review.
- Platform admins, sponsors and the public: nothing.

A reporter never acts on their own case. The financial approver cannot be the
technical decider. The technical decider cannot decide the appeal or the
related-party review, and the related-party reviewer cannot decide an appeal
of that review.

## States

Migration `0026_private_security_cases.sql` keeps independent receipt,
remediation, award, payment and disclosure states. A claim is not a receipt
until a technical approver verifies it; verification freezes the receipt
time, the project revision in force then, and its gross amount and split.
Slop does not fetch the advisory, so the receipt time is the time the
approver reads on GitHub and enters by hand: a human-attested time. Every
case response says so with `receivedAtSource: "maintainer-attested"`, and the
`record` and `verify-link` events store the same value beside the time.

A rejected link stays as history. The reporter can link the advisory again,
or a technical approver can record it, and that new case is verified
normally. A `record` that finds an open claim from the same reporter returns
`409 claim_pending`: verify or reject that claim instead. A `record` replays
only the exact request that created the verified case.

Triager assignment and revocation commit only together with their audit
event at the next case revision. A stale request changes no membership.
Triggers keep the frozen receipt, events, reservations, membership history
and the access log append-only.

A confirmed critical finding with verified potential or actual loss on an
in-scope asset reserves its gross amount once per root cause within the
current capacity. Without capacity the award is `capacity-exhausted`; the
finding stays confirmed. A reserved or approved award cannot be redecided.

Capacity is read from the current project revision. When an admin raises
`capacity.awards` by revision, a financial approver uses `reserve-award` on
an exhausted case. The earliest received exhausted case is funded first
(`409 earlier_receipt_waiting` otherwise). If no capacity is free, the request
returns `409 capacity_exhausted` and writes nothing. Every reserving path
(`decide`, related-party `approve`, and `reserve-award`) uses one guard in the
reservation insert: while an earlier confirmed case waits for capacity or
for its related-party review, a later decision or approval reserves nothing
and its award is `capacity-exhausted`, so it waits its turn. An earlier
confirmed case that waits for capacity also holds its root cause, even while
its appeal is open: a later report of the same root cause gets `409
root_cause_reserved` and is recorded as a duplicate, because it could never
reserve once the earlier case does.

A reporter may appeal an exhausted award: the shortage is a financial
exception, not a reason to relabel the finding (SEC-12). The appeal carries the
receipt into `disputed`, and that case still holds its place in the funding
order, so no later report can reserve its root cause or its capacity while an
independent reviewer resolves it. `uphold` restores the confirmed receipt
unchanged; `return` sends the finding back to a new decision, which reserves as
soon as capacity exists. Neither outcome erases or duplicates an award, and a
reserved or approved award is still never redecided.

The technical decision records `relatedParty`. The decider declares it, and a
reporter who is a program approver or the sponsor account is always related.
An eligible related-party award stays `pending` with no reservation until a
dispute reviewer records `decide-related-party`. `approve` reserves within
capacity like any other award; `refuse` makes the award `ineligible`, which
the reporter can appeal to a different reviewer. A pending review holds its
root cause: a later report of the same root cause gets `409
root_cause_reserved` and is recorded as a duplicate. Once a case is related,
it stays related. A redecision after a returned appeal needs a new review,
and the earlier reviewer stays recorded.

## Not available

- Payment: no private settlement rail is approved. An approved award has
  `paymentState: "rail-unavailable"` and nothing can mark it paid.
- Email: the restricted verified-destination pilot is implemented in
  `workers/notify/security.ts`; deployment and inbox delivery remain launch
  gates. See `workers/notify/README.md`. Every case inbox insert also queues
  one private outbox row in the same transaction. Only current case roles
  with operator-verified destinations receive generic notices. An email
  never contains a case identifier, amount, project or advisory. The inbox
  action **Acknowledge** records the recipient's authenticated response;
  **Mark read** is a separate state and never acknowledges a notice.
- GitHub advisory content is never fetched. Maintainers verify claims by
  hand on GitHub.
