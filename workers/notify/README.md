# Slop notify Worker

`slop-notify` delivers the private and optional email for Slop inbox notices
and the internal Slopbot cost notices. It exists because Pages Functions
cannot use `send_email` bindings. It also still sends one plain-text email to
each Slop admin when a person submits a project application; that route
belongs to the legacy admin admission path and goes away with it, because
self-service setup (PRD section 4) needs no routine admin review.

## Inbox events (NOT-01)

Inbox rows are written in the same D1 batch as their source change by
`backend/notifications/events.ts`; one source transition is one event per
recipient. Notices report outcomes and exceptions, not routine admission:

| Kind | Writer | Recipients |
| --- | --- | --- |
| `project_ready` | `notifyProjectRevision` on a revision that makes the project active | owners, never the publisher |
| `project_scan_failed` | `notifyProjectScanFailed` for an `incomplete` assessment | owners |
| `project_installation_lost` | `notifySlopbotInstallationLost` when an installation is suspended or removed | owners of each affected project |
| `payout_held`, `payout_exception` | payout dispatch | contributor; project steward |
| `security_report_received` | `notifySecurityReportReceived` once a report is verified | reporter |
| `security_case` | private case events | current case role holders |

Only `security_case` notices ask for an acknowledgment, and only they
escalate when one is missed. A report receipt uses the `security-receipt-v1`
private template: it is mailed generically, escalates only on failed
delivery, and never waits for an acknowledgment. Ordinary notices have read
state only. The application kinds remain readable history.

## Project-application route

The Worker has no public route and `workers_dev` is off. The caller is a
service binding named `SLOP_NOTIFY` on the production Pages app. That caller
is the authenticated project-application submit path in
`backend/projects/handler.ts`. Cloudflare refuses to publish Pages with a
binding to a Worker that does not exist. The protected production release
39373511823 deployed this Worker before the binding was added to
`wrangler.toml`. Without the binding, the
application is saved and records `adminNotification: "failed"`. The project-application route
is:

```http
POST https://notify.internal/v1/project-applications
Content-Type: application/json

{
  "applicationId": "app_0123456789abcdef",
  "projectId": "example-project",
  "projectName": "Example Project",
  "repository": "example-org/example-repo",
  "applicantLogin": "octo-cat",
  "submittedAt": "2026-10-11T12:00:00.000Z",
  "reviewUrl": "https://slop.cash/admin/applications/app_0123456789abcdef"
}
```

The body must be JSON of at most 8 KiB with exactly these string keys. The
handler rejects any other host or path with 404, any other method with 405, and
any invalid body with 400 `{"error":"invalid_request"}`. It sends no email for
a rejected request.

Results:

| Status | Body                                         | Meaning                       |
| ------ | -------------------------------------------- | ----------------------------- |
| 202    | `{"status":"sent","recipients":<n>}`         | Every admin email was handed to Cloudflare. |
| 502    | `{"error":"delivery_failed","sent":<n>}`     | At least one send failed; `n` were sent. |
| 500    | `{"error":"service_misconfigured"}`          | The sender or admin list is invalid; nothing was sent. |

A 202 means Cloudflare accepted the messages. It does not prove inbox delivery.

## Recipients

The admin addresses are not in the repository. Operators set them as the
Worker secret `ADMIN_EMAILS`, a comma-separated list of 1 to 10 unique
addresses:

```sh
./node_modules/.bin/wrangler secret put ADMIN_EMAILS --config workers/notify/wrangler.toml
```

The handler sends nothing and returns 500 when the secret is missing, empty, or
contains an invalid or duplicate address. Callers cannot supply a recipient.

## Message

The handler builds the RFC 5322 message itself: CRLF line endings, a
quoted-printable UTF-8 body, and an RFC 2047 subject when the project name is
not ASCII. It removes control characters and line separators from every header
value, so request data cannot add a header. The body contains only the project
name and id, repository URL, applicant GitHub login and profile URL, submitted
time, application id, and the admin review link.

## Operator prerequisites

1. Configure Cloudflare email for the `slop.cash` zone so that the admin
   addresses can receive mail from `notifications@slop.cash`
   (`NOTIFY_FROM_ADDRESS`).
2. Create the `slop-notify` Worker once and set its `ADMIN_EMAILS` secret.
3. Set the repository variable `SLOP_NOTIFY_RELEASE` to `enabled`, and let one
   production release deploy the Worker.
4. The production binding in the root `wrangler.toml` connects Pages to the
   released Worker:

   ```toml
   [[services]]
   binding = "SLOP_NOTIFY"
   service = "slop-notify"
   ```

## Release and current scope

The protected production job in `.github/workflows/deploy.yml` releases this
Worker only when `SLOP_NOTIFY_RELEASE` is `enabled`. The default profile requires
exactly `ADMIN_EMAILS`; explicit pilot profiles also require their verified
recipient secrets. The release uploads the tested commit and verifies the
selected bindings and active version before applying its schedule. Staging needs
its distinct opt-in and isolated Worker; preview remains unbound. See the
protected pilot profiles below. Do not use a local deployment to bypass the
release workflow.

Run the handler checks with `bun run test:notify`; `bun run verify:code`
includes them. A deployed version is not proof of a caller, domain readiness or
inbox delivery.

## Restricted private bounty pilot (SEC-16)

The Worker also implements a separate private bounty delivery path. Migration
`0030_security_notification_outbox.sql` inserts one outbox row with each new
security inbox notice, in the same transaction. It does not send old notices
from before the migration. Case receipt times and award decisions do not
change when email fails.

This path is **not activated by the project-application binding**. The default release permits only `ADMIN_EMAILS`. A selected pilot
release derives its private D1 binding from that environment's checked-in Pages
configuration and requires the exact extra secret inventory. Qualify the
separate staging audience before selecting a production pilot. No addresses or private verification records belong in git.

The operator must provision:

- `SLOP_DB`: the isolated pilot D1 database with migration 0030. Use separate
  staging and production bindings. Do not attach production cases to a staging
  Worker.
- `SECURITY_MAIL_PILOT`: a JSON secret with `inboxUrl` (the exact HTTPS
  `/inbox` page on that environment) and `recipients`, keyed by immutable
  GitHub actor ID. Each entry contains `email`, ISO UTC `verifiedAt`, private
  `evidenceReference`, and `backupGithubId`. The operator verifies both control
  by that GitHub actor and Cloudflare's verified-destination eligibility.
  A GitHub public email, a caller's address or `ADMIN_EMAILS` is not this proof.
- A verified backup for each participant. The backup must also have a current
  role for the case. Mapping an address never grants case access. Record the
  program's approved escalation contact privately before activation.

Missing pilot configuration or D1 binding sends nothing. A selected pilot requests a run every five minutes. The default profile has no schedule. Wrangler version
upload/deploy does not apply cron triggers. The approved pilot release must
also apply that trigger through the protected workflow and verify the actual
trigger and a successful scheduled invocation. A secret and binding alone do
not establish scheduling. It reads current case roles again before each send.
Revoked roles are suppressed, and so is a recipient with no verified
destination: nothing can be sent and the inbox shows no email state for the
notice. A verified destination not yet in effect retries at one, two, four and
eight minutes, then exhausts after five attempts. The per-event,
recipient and template key prevents duplicate queue insertion; an atomic claim
prevents concurrent dispatch. Each message has one recipient and a stable
opaque per-attempt Message-ID, a generic subject and body, and the authenticated inbox
link. It has no tracking pixel, case identifier, project, advisory or amount.

A successful Cloudflare send is `provider-accepted`, never `delivered`. A thrown
send or an expired in-flight claim is `ambiguous`; neither is resent. A backup
notice is queued for a failed delivery or a missed acknowledgment, using the
program's existing `responseTargets.acknowledgeHours`. Backups are not escalated
recursively. A missing or unauthorized backup remains an operator readiness
gap, not a successful escalation.

Private operator service routes (no public routes or `workers.dev` endpoint):

- `POST https://notify.internal/v1/security-notifications/dispatch`, body `{}`,
  drains up to 25 due notices. The scheduler uses the same dispatcher.
- `POST https://notify.internal/v1/security-notifications/reconcile`, body with
  `deliveryId`, `attempt`, `destinationDigest`, `outcome` and `evidenceReference`, records independent provider
  evidence. Outcomes are `delivered`, `bounced`, `suppressed`, or `not-accepted`.
  Provider `bounced` and `suppressed` evidence are failed deliveries and
  escalate to the backup.
  Only the exact accepted or ambiguous attempt and destination can be reconciled.
  Each immutable provider evidence reference is accepted once; an old receipt
  cannot authorize another retry. `not-accepted`
  permits a bounded retry; it requires proof that the provider did not accept
  the attempt. Do not infer this from an exception. Do not expose this route
  through a browser or public proxy. Delivery evidence is append-only.

The signed-in recipient uses **Acknowledge** in `/inbox`. The page posts the
inbox event key to `/api/v1/security-cases/:id/acknowledge`; the server rechecks
session, current case role and exact recipient. The inbox returns the recorded
`acknowledgedAt`. Reading the notice, a delivery receipt or an email-open pixel
cannot set this value.

Before activation, run the isolated browser matrix and controlled mail sends
to the approved maintainer and reporter inboxes. Verify sender authentication,
quota, actual receipt, bounce/suppression, ambiguity recovery, backup escalation
and environment isolation. Local tests substitute the transport and do not
prove provider acceptance or inbox delivery. This code neither activates a
bounty nor selects a private payment rail.

## Optional activity email (NOT-01)

The activity pilot is separate from the private bounty pilot. Its
`ACTIVITY_MAIL_PILOT` secret contains the same `inboxUrl` and actor-keyed
`recipients` shape, but each recipient has only `email`, `verifiedAt` and
`evidenceReference`. The operator must verify account control and Cloudflare
recipient eligibility; public GitHub email is not proof. No browser route
accepts or changes an address. These private settings still need an explicit
protected release inventory, isolated database and provider qualification.

`GET /api/v1/notifications/email` reads the signed-in person's current
eligibility from the private Worker. The inbox shows the verified address
before consent. `POST` with `enabled: true` and its `destinationVersion`
records explicit consent to that exact verified destination. A change requires
fresh consent. `POST` with only `enabled: false` withdraws consent even during
a mail-service outage and suppresses queued activity mail. No old inbox history
is mailed after opt-in. A send already in flight cannot be recalled.

Migration 0033 queues each new ordinary event atomically only for an enabled
preference. Before dispatch, the Worker checks both the saved preference and
its destination version again. It also rechecks the recipient's role (PRD
section 9): a payout exception mails only the project's current GitHub
steward, and an owner notice only an account that still lists or stewards the
project. A reinstatement review mails only a current moderator. A
contributor-flag pause notice mails only current staff or a current owner.
Confirmed-malicious ban notices also retain their existing affected
contributor and staff audiences, rechecked against current contribution and
retained payment records and the same configured admin and moderator IDs as
the Pages writer. Queued mail is suppressed when the recipient no longer
belongs to that notice's audience; the inbox notice itself stays.
Wallet-change account-security notices use a
separate essential flag and require a verified destination, but do not use
the optional activity preference. Private bounty notices remain in their own
SEC-16 queue and are unaffected by this switch.

All activity messages are generic and link to `/inbox`. They contain no
wallet address, amount, project, event identifier or case data. The scheduled
handler dispatches both queues independently. The private service routes under
`/v1/activity-notifications/dispatch` and `/reconcile` use the same empty drain
request and exact-attempt provider-evidence contract as the security path.
`/eligibility` accepts only a server-derived GitHub actor ID and returns that
actor's verified destination to the authenticated preference API. Do not proxy
these internal routes to a public client.

Provider acceptance remains separate from delivery. Exceptions remain
ambiguous. Independent negative evidence can authorize a retry, up to five
attempts. An essential notice whose verified record is not yet in effect made
no provider call; it retries on the security queue's one, two, four and eight
minute schedule and exhausts on the fifth attempt. An essential notice with no
verified record, and any optional notice without an effective consented
destination, is suppressed.

`GET /api/v1/notifications` reports each notice's email outcome from its
outbox row as `emailDelivery`: `queued`, `sent` (provider-accepted),
`delivered` (independent receipt), `failed` (bounced or exhausted) or
`uncertain` (ambiguous). Suppressed and unmailed notices carry no value. The
inbox never returns an address, destination digest, provider reference or
attempt count, and read and acknowledgment remain separate fields. The private outbox and append-only evidence table retain exhausted,
suppressed, bounced and ambiguous outcomes for operators. No mail result
reverses a source notification, award or wallet change.


## Protected pilot release profiles

The checked-in workflow can release the admin-only Worker or an explicitly
selected verified-mail pilot. No pilot is selected by default. The operator
sets these variables in the selected protected GitHub environment only after
reviewing its private destination records and isolated delivery evidence:

- `SLOP_NOTIFY_RELEASE=enabled` enables the production Worker release.
  Staging requires the distinct `SLOP_NOTIFY_STAGING_RELEASE=enabled`; the
  existing production switch cannot enable a staging Worker.
- `SLOP_NOTIFY_MAIL_PILOTS` is empty for admin-only, `security`, `activity`, or
  `security,activity`. All other values fail closed. This selects existing
  approved mail capabilities; it does not verify recipients or authorize payments.
  Staging uses `SLOP_NOTIFY_STAGING_MAIL_PILOTS` for this selection; the workflow
  passes it to the same release script as `SLOP_NOTIFY_MAIL_PILOTS`.

Production uses `slop-notify` and the production Pages D1 contract. Staging uses
`slop-notify-staging` and the separate staging Pages D1 contract. Staging Pages
receives its service binding only after the isolated Worker release succeeds;
preview Pages remains unbound. The runtime rejects a pilot whose secret inbox
URL does not match the selected environment's exact `/inbox` URL.
Security mail also binds the selected Pages `SLOPBOT` service. For a project
without paid bounty terms, it rechecks current repository authority before
sending a maintainer notice. An unavailable check sends nothing and retries.
The release verifies this private binding and `SLOP_ENVIRONMENT`. Project-application
review links must use that environment's site origin; staging email links
open the staging admin queue.

The named Worker must already exist with workers.dev and preview URLs disabled,
no routes and no custom domains. The release reads and verifies these settings
before any version upload, and refuses an absent or publicly reachable Worker.
Version APIs do not apply routing settings; applying them after upload can expose
a private version. Initial private Worker provisioning is a separate operator gate.

`scripts/release-notify.mjs` verifies this boundary and the exact secret inventory, uploads the
checked-out branch SHA, verifies uploaded D1 and secret bindings, promotes that
one version, and confirms it is active at 100%. It then applies and reads back
the selected cron schedule. Admin-only has no D1 binding or cron. Moving back
to admin-only requires removal of pilot secrets as well as the empty selection;
an unexpected secret stops the release. Version and schedule checks do not
prove that a scheduled invocation or a real message succeeded.

Review generated configuration without credentials or remote changes:

```bash
SLOP_NOTIFY_MAIL_PILOTS=security,activity bun scripts/release-notify.mjs prepare staging /tmp/slop-notify-staging-review
./node_modules/.bin/wrangler deploy --dry-run --config /tmp/slop-notify-staging-review/wrangler.json
```

Do not run deployment from a local checkout. The protected workflow supplies
`deploy`, the target environment and exact SHA after its existing checks.
Retain the generated `profile.json` and `release.json` in the protected runner
for release inspection. They contain names, immutable version IDs and public
configuration only; private recipient secrets remain in Cloudflare. Real
provider acceptance, inbox receipt, failures, scheduled invocation, and bounty
acknowledgment/escalation still require controlled acceptance evidence.


## Slopbot API cost notices

`POST https://notify.internal/v1/slopbot-spend` accepts exactly `month`,
`thresholdMicroUsd`, `recordedMicroUsd`, and `estimatedCalls`. The month is UTC;
the positive threshold is a multiple of 500,000,000 integer micro-USD. The
private Slopbot binding derives these fields from its cost ledger and claims
each milestone before sending. The existing `ADMIN_EMAILS` secret supplies
recipients. No public route, recipient override or model content is accepted.
The response has the same acceptance/failure contract as project notices.
Slopbot retains ambiguous outcomes rather than retrying accepted recipients.


## Slopbot provider failures

`POST https://notify.internal/v1/slopbot-failure` accepts only `callId`, `model`,
`kind` (`budget-exhausted` or `request-failed`) and canonical UTC `occurredAt`.
It uses the same configured admin recipients. It accepts no provider body,
prompt, response, key or request identifier.

Migration `0085` queues new failed Surplus cost records. Slopbot claims each
notice before calling this route and retains accepted or ambiguous results.
An unknown delivery is not sent again automatically. Earlier cost records do
not become a fresh notification backlog. These notices neither change provider
budgets nor configure Surplus's own low-balance notification threshold.
