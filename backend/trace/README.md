# Private trace backend

This directory is the private, incremental backend boundary for optional run
traces. Git remains the public authority for projects, scoring, cycles, and
settlement. D1 records private joins and metadata only. Trace bodies live in a
dedicated private R2 bucket and are never returned from a contributor or
project-owner route.

The [privacy contract below](#private-trace-privacy-contract) governs content,
consent, redaction, retention, and data requests under PRD sections 4 and 8.
The build publishes that section at `/protocol/private-trace-v1.md` for installed
clients. This is its only maintained copy.

Optional trace upload requires a fresh authenticated observation that GitHub's
private vulnerability reporting is enabled. The hourly health workflow renews
that observation independently of website publication. The client reads the
bounded server-authoritative preflight; stale, disabled or unavailable status
blocks trace upload only. The capability upload checks the same observation
before it reserves or writes bytes and refuses with HTTP 503
`private_intake_unavailable`, so a client that skips the preflight cannot store
a trace. Ordinary GitHub submission and website deployment remain available.
An advisory URL alone is not evidence of availability, and a public issue is
never a private intake.

## Private trace privacy contract

This section defines the content and privacy contract for a Slop private trace
under PRD sections 4 and 8. It applies to every contribution and review skill
that uploads a trace to `https://api.slop.cash`.

### Consent boundary

Uploading is optional for every contribution and review. It is not
background synchronization: the contributor selects one local file and invokes
the `trace` command. Before GitHub authorization starts, the command opens that
path once without following a final symlink, verifies the opened descriptor is
a regular file, reads one snapshot, and enforces the byte bound again after the
read. It displays that snapshot's local path, byte count, media type, and
SHA-256 digest. Inspect it before opening the printed authorization URL. If any
byte needs to change, cancel the waiting command, replace the file, and rerun
`trace`; the current process will upload only its already-disclosed snapshot.
The uploader sends those exact bytes without transformation, and a changed file
has a different digest and requires a new upload intent.

Do not authorize or upload if this contract or permanent retention is
unacceptable. Submit the contribution or review without private-trace evidence. A human
who did not use an agent may declare a human-only contribution and does not
upload an agent trace.

### Required scope and permitted records

A trace is a minimized, contribution-specific event record, not the complete
history of a client, account, or machine. It must cover the measured Slop run
from start through verification and contain the material chronological events
needed to investigate provenance and reproduce the claimed work:

- timestamps, event types, run state, and command exit status;
- the user and repository instructions that governed the run;
- model-visible prompts and assistant responses for the run;
- tool or command names, arguments, and outputs after the exclusions below;
- test, verification, and submission results; and
- explicit redaction records sufficient to show what category was removed.

The file may be UTF-8 plain text or newline-delimited JSON and must be non-empty
and no larger than 8 MiB. Slop does not require hidden chain-of-thought,
provider-internal reasoning, unrelated conversations, global client history,
or events before or after the measured run. “Full” or “raw” trace elsewhere in
the repository means this complete contribution-specific event record after
the required minimization and redaction; it never means an unfiltered client
export.

### Required exclusions and redaction

The contributor must remove or replace these values before upload:

- passwords, passkeys, API keys, OAuth or upload capabilities, cookies, bearer
  tokens, private keys, wallet seed phrases, and other authentication secrets;
- environment-variable values and credential-store contents;
- source-file bodies, private diffs, and unrelated file or database contents;
- absolute local paths, home-directory names, account identifiers, session
  identifiers, and personal data not necessary to attribute the contribution;
- hidden chain-of-thought or provider-internal reasoning; and
- content from unrelated conversations, repositories, tasks, or users.

Keep the event and replace only its prohibited field with a category marker
such as `[REDACTED:CREDENTIAL]`, `[REDACTED:SOURCE]`, or
`[REDACTED:LOCAL_PATH]` when that event is material. Repository-relative paths,
public GitHub identifiers, public patch content already intended for the
contribution, aggregate usage values, and ordinary non-secret tool output are
permitted.

Neither the receipt CLI nor the trace API automatically redacts or scans the
file. There is no best-effort or guaranteed server-side secret removal: the
selected bytes are the retained bytes. The contributor or exporting client is
responsible for applying the exclusions and inspecting the final file before
authorization. An exporter may provide additional local redaction, but it must
disclose its rules and must not claim that pattern matching guarantees removal
of every secret.

### Storage, access, and retention

The trace body is stored as one immutable, content-addressed object in a
private R2 bucket. D1 stores its digest, size, media type, actor and run joins,
upload progress, and access-audit metadata, but not the body. Public GitHub and
Slop artifacts contain only safe run metadata, the digest, and immutable upload
identity; they never contain the trace body.

Retention is permanent: there is no expiry, contributor download, update,
correction, or voluntary deletion route. Contributors and project owners
cannot read trace bodies, including their own, after upload. No website or API
route returns a trace body. Cloudflare account access is separately limited to
designated operators.

For a privacy, security, or data-subject request, use the authenticated private
Slop reporting page at <https://slop.cash/projects/slopdotcash/security> and
follow its status in Inbox. Slop retains the report privately and handles any
authorized private GitHub forwarding. Do not include a contributor trace body
in a report, or put private data or request details in a public issue.

An independent hourly Actions job authenticates to GitHub and records the
private-reporting status in D1. Trace intake reads that status with a 24-hour
maximum age. Missing, stale, malformed, or disabled status blocks only optional
trace collection. Website deployments and GitHub contributions continue.
The advisory URL alone is not evidence that intake is usable.
Operators must authenticate the requester and handle any action required by
applicable law outside the contributor API with an audit record. This channel
does not create a voluntary deletion or contributor-read right that conflicts
with the permanent, write-only product contract.

### Integrity requirements

Minimization and redaction do not weaken the fail-closed receipt join. The API
accepts only the exact declared byte count, media type, and SHA-256 digest;
upload capabilities are short-lived and one-use; object creation is immutable;
and finalization fails unless the object is attached. Failed export, upload, finalization, or receipt joins do not block GitHub
submission. They never qualify as finalized evidence or earn a trace bonus.

## Storage contract

- Every finalized run has exactly one SHA-256 trace object.
- R2 keys are content addressed as `traces/sha256/<prefix>/<digest>`.
- Objects are UTF-8 `text/plain` or `application/x-ndjson`, at most 8 MiB.
- R2 writes are create-only and verify stored size and digest metadata.
- Before a write, D1 atomically reserves one digest and its safe object metadata
  for the run. Overlapping uploads cannot write a different trace. The permanent
  reservation records the attempted object even if storage or attachment fails.
  A retry may use the same bytes; choosing different bytes requires a new run.
  A reservation alone does not mark the trace uploaded or permit finalization.
  A participation ban refuses new intents, reservations, attachments, and
  finalization. Bytes written under a reservation made before the ban stay
  unattached.
  Apply migration 0058 before deploying the updated trace handler.
- There is no trace update, delete, listing, or public-read API.
- The bucket must have no lifecycle expiration rule. Permanent retention is an
  operational invariant as well as an application invariant.
- D1 stores the digest, size, content type, actor, run link, upload intent,
  progress events, and audit records. It never stores trace bytes.

## Authentication and upload

The production authority is `https://api.slop.cash`. A Slop GitHub App/OAuth
authorization-code + PKCE or device login service issues a short-lived,
audience-bound, one-time identity assertion. The installed client exchanges it
at `POST /api/v1/auth/session` in `X-Slop-Identity-Assertion`. The API consumes
that assertion through the internal `SLOP_IDENTITY` Cloudflare service binding.

This API never accepts a GitHub PAT, `gh auth token`, repository credential, or
workflow token. The assertion and returned Slop token must never be printed,
placed in argv or an environment variable, written to a trace, or exposed to
the model.

The exchange returns a contributor-only token valid for ten minutes. Operator
status is never issued by this endpoint. The separate operator bearer issuer remains
unimplemented; legacy operator wallet migration stays unavailable. Never mint
an operator token by hand or reuse the contributor assertion exchange as an
operator issuer. Existing operator bearer validation still requires a maximum
five-minute lifetime and the current `OPERATOR_GITHUB_IDS` allowlist.

The write flow is:

1. `POST /api/v1/runs` with `Idempotency-Key` and `{ clientRunId, projectId,
repository, projectPolicyRevision, provider, model, client, clientVersion }`.
2. `POST /api/v1/runs/{serverRunId}/trace-intents` with `Idempotency-Key` and
   `{ sha256, sizeBytes, contentType }`.
3. `PUT` the exact returned `uploadUrl` within five minutes, with the exact
   declared body, `Content-Type`, and `Digest: sha-256=<lowercase hex>`.
4. `POST /api/v1/runs/{serverRunId}/finalize` with `Idempotency-Key`.

Upload URLs are HMAC-derived, one-time write capabilities. Consumption is an
atomic D1 update. An unconsumed, unexpired capability may retry the exact same
upload after a failed attempt; its permanent reservation does not permit
different bytes. A consumed capability cannot be used again. An authenticated
client may renew an expired, unconsumed intent only by repeating the exact
idempotent request for the same run, digest, size, and
content type; mismatched retries fail closed. Finalization fails closed unless
the trace is attached.

Intent creation and renewal check the current run owner, non-finalized state
and compatible attached digest in the database write. Existing-intent reads
and renewal readback apply the same guard. An already authorized read can
finish after another request finalizes the run, but cannot change its intent.

The public contribution receipt keeps its client `run_id` and includes the
private join fields `server_run_id`, trace object ID, authority, and digest.
Ingestion must join those fields to a finalized D1 run and verify the GitHub
actor, project, repository, policy revision, model/client declaration, client
run ID, and digest. There is intentionally no public run-status endpoint.

## Trace access

No website or API route returns trace bodies. Contributors, project owners,
admins, moderators and operators cannot read a trace body through Slop,
including their own. The owner removed the Private traces page and the operator
grant and read routes on 27 October 2026. The former `/operator/traces` page,
with or without a trailing slash, returns HTTP 404. Earlier grant and audit rows
stay in D1 (`trace_read_grants` and `private_audit_events`).

## Wallet registry

Contributors authenticate through the same one-time GitHub OAuth bridge and
append their claim with `POST /api/v1/wallet-claims`. `GET
/api/v1/wallet-claims/current` returns only the authenticated contributor's
current safe metadata; `GET /api/v1/wallet-claims/actors/{numericId}/current`
and `GET /api/v1/wallet-claims/{claimId}` are public metadata receipts used by
reward preparation. The actor route returns `200` with a JSON `null` body when
that actor has no current claim. Wallet records are append-only; changes must name the exact
current predecessor, unique lineage indexes reject forks, and SQLite triggers
reject updates and deletes.

A contributor holds one lineage per chain. `POST` accepts an optional `chain`
of `solana` (the default), `base`, `robinhood` or `ethereum`, and both
`current` reads accept `?chain=`. An EVM address is its lowercase `0x` form only. A successor must
stay on its predecessor's chain, so a Base claim can never retire a Solana
address. Solana records keep their original digest layout; all EVM records
name a chain in the digested bytes. Registering a wallet does not make a row
payable: escrow payment needs a destination binding under PAY-05.

The operator endpoint remains only for bounded migration of historical GitHub
issue/profile observations and disaster recovery. No wallet endpoint exposes a trace,
OAuth capability, assertion, bearer token, or credential.

## Cloudflare provisioning

Provision resources before enabling the API routes:

```bash
bunx wrangler d1 create slop-private
bunx wrangler r2 bucket create slop-private-traces
bunx wrangler d1 migrations apply slop-private --remote
bunx wrangler pages secret put TRACE_AUTH_SECRET --project-name eliza-computer
```

Then add the returned D1 ID and R2 binding to the production Pages project:

```toml
[[d1_databases]]
binding = "SLOP_DB"
database_name = "slop-private"
database_id = "<provisioned-id>"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PRIVATE_TRACES"
bucket_name = "slop-private-traces"

[[services]]
binding = "SLOP_IDENTITY"
service = "slop-identity"
```

Set `OPERATOR_GITHUB_IDS` to an explicit comma-separated list of numeric IDs.
The independent hourly renewal workflow authenticates GitHub private-reporting
status and stores its boolean and timestamp in D1. The public
`GET /api/v1/private-request-intake` route reads that observation. Missing,
disabled, malformed, future-dated, or older-than-24-hour status stops optional
trace collection. Ordinary GitHub submission and website deployments continue.
No contributor or runtime GitHub credential is involved.
`TRACE_AUTH_SECRET` is opaque HMAC key material and must contain 32-128
high-entropy printable ASCII characters. It must never be configured as a
checked-in `[vars]` value. Generate a recommended 43-character base64url value
with `node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'`.
Bind `SLOP_IDENTITY` to the
separately deployed OAuth/PKCE identity Worker; it must consume assertions once
and return only the numeric GitHub actor ID and login for the
`private-trace-api` audience. Bind `api.slop.cash` only after a deployment proves
the D1 migration, private R2 access, limited identity exchange, and fail-closed
behavior. Do not enable an R2 public domain or lifecycle expiry.

The current API has strict body and capability bounds but no durable per-actor
admission quota for run, event, intent, upload, or wallet writes. The owner
accepts this risk for the MVP (owner decision, 29 October 2026, PRD section 11,
#1411 B4): an authenticated actor can add storage and write amplification up
to the per-request bounds without a per-actor limit. The bounded size,
authentication, and checksum rules above remain unchanged. A later quota needs
a reviewed D1-backed policy that does not rely on an eventually-consistent edge
counter.

Operational renewal, designated-reviewer unavailability, full-cycle
verification, and rollback are documented in
[`PRIVATE_INTAKE_RECOVERY.md`](PRIVATE_INTAKE_RECOVERY.md). The procedure keeps
trace collection fail-closed without blocking contribution or awaiting a website release.

The Cloudflare account and bucket permissions remain limited to designated
Slop operators. Application authorization does not replace Cloudflare account
access control and audit logging.
