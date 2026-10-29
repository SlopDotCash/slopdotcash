# Private trace backend

This directory is the private, incremental backend boundary for optional run
traces. Git remains the public authority for projects, scoring, cycles, and
settlement. D1 records private joins and metadata only. Trace bodies live in a
dedicated private R2 bucket and are never returned from a contributor or
project-owner route.

The authoritative content, consent, redaction, retention, and data-request
policy is [`protocol/private-trace-v1.md`](../../protocol/private-trace-v1.md).
This backend stores the selected file byte-for-byte and does not redact or scan
it. Backend integrity checks enforce the declared bytes; they do not replace
the contributor's required pre-upload inspection.

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
atomic D1 update. Failed or already-used capabilities cannot be retried
directly. An authenticated client may renew an expired, unconsumed intent only
by repeating the exact idempotent request for the same run, digest, size, and
content type; mismatched retries fail closed. Finalization fails closed unless
the trace is attached.

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
