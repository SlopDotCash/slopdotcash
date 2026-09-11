# Private trace backend

This directory is the private, incremental backend boundary for mandatory run
traces. Git remains the public authority for projects, scoring, cycles, and
settlement. D1 records private joins and metadata only. Trace bodies live in a
dedicated private R2 bucket and are never returned from a contributor or
project-owner route.

The authoritative content, consent, redaction, retention, and data-request
policy is [`protocol/private-trace-v1.md`](../../protocol/private-trace-v1.md).
This backend stores the selected file byte-for-byte and does not redact or scan
it. Backend integrity checks enforce the declared bytes; they do not replace
the contributor's required pre-upload inspection.

Trace upload and production activation require GitHub's public private
vulnerability reporting status to return exactly `enabled: true`. The deploy
workflow verifies GitHub directly, while the client reads only the bounded
server-authoritative Slop preflight. Both checks fail closed; an advisory URL
alone is not evidence of availability, and a public issue is never a private
intake.

## Storage contract

- Every finalized run has exactly one SHA-256 trace object.
- R2 keys are content addressed as `traces/sha256/<prefix>/<digest>`.
- Objects are UTF-8 `text/plain` or `application/x-ndjson`, at most 8 MiB.
- R2 writes are create-only and verify stored size and digest metadata.
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
status is never issued by this endpoint. Operator tokens must come from the
separate operator identity path, and an operator claim is accepted only when
the immutable GitHub numeric ID also appears in `OPERATOR_GITHUB_IDS`.
This repository does not currently implement that separate operator issuer;
therefore the operator grant, read, migration, and recovery routes must remain
operationally unavailable. Never mint an operator token by hand or reuse the
contributor assertion exchange as an operator issuer.

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

Contributors and project owners cannot read trace bodies, including their own.
A designated Slop operator must:

1. Submit an 8-500 character reason to
   `POST /api/v1/operator/traces/{digest}/grant`.
2. Use the returned grant within 60 seconds in `X-Trace-Read-Grant` on
   `GET /api/v1/operator/traces/{digest}`.

The grant is bound to the operator's numeric GitHub ID and digest, is consumed
atomically, and cannot be replayed. Grant creation and successful reads append
audit records. Responses are attachments with `no-store`, `nosniff`, and a
deny-all content security policy.

## Wallet registry

Contributors authenticate through the same one-time GitHub OAuth bridge and
append their claim with `POST /api/v1/wallet-claims`. `GET
/api/v1/wallet-claims/current` returns only the authenticated contributor's
current safe metadata; `GET /api/v1/wallet-claims/actors/{numericId}/current`
and `GET /api/v1/wallet-claims/{claimId}` are public metadata receipts used by
reward preparation. Wallet records are append-only; changes must name the exact
current predecessor, unique lineage indexes reject forks, and SQLite triggers
reject updates and deletes.

The operator endpoint remains only for bounded migration of historical GitHub
issue/profile observations and disaster recovery. No endpoint exposes a trace,
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
admission quota for run, event, intent, upload, or wallet writes. Production
trace uploads must remain disabled until a reviewed D1-backed policy bounds
authenticated storage and write amplification without relying on an
eventually-consistent edge counter.

Operational renewal, designated-reviewer unavailability, full-cycle
verification, and rollback are documented in
[`PRIVATE_INTAKE_RECOVERY.md`](PRIVATE_INTAKE_RECOVERY.md). The procedure keeps
trace collection fail-closed without blocking contribution or awaiting a website release.

The Cloudflare account and bucket permissions remain limited to designated
Slop operators. Application authorization does not replace Cloudflare account
access control and audit logging.

### Public funding and execution observation admission

The two public project/cycle verification routes consume the existing atomic
D1 `identity_rate_limits` counter before Solana RPC fanout. They share a budget
of 24 attempts per 60-second window, plus four per secret-hashed client bucket.
There are 1,024 fixed client buckets; collisions conservatively share a quota,
and no IP address is stored. The edge-supplied `CF-Connecting-IP` is required;
forwarded headers do not replace it. Counters use separate verification scopes
from OAuth and at most 1,025 rows per auth-secret revision. Admission rejection
returns 429 with `Retry-After`; missing D1 migration 0004, absent trusted IP,
invalid counters, or a two-second admission timeout return 503 without RPC.
Both verification routes must pass through this gate; absent admission fails
closed. These counters authorize observations only, never payments or writes.

### Execution API and registry compatibility

`GET /api/v1/projects/:projectId/executions/:cycleId` returns the shared
`SquadsExecutionObservation` directly, never an additional response envelope.
The public index remains `{ schemaVersion: 1, executions: [...] }`; each entry
contains the reviewed binding and exact allocation and full-plan SHA-256 hashes.
The Worker registry stores the full allocation and execution-plan bytes once per
project/cycle, with the complete canonical binding ledger. It delegates binding
variants to `assertSquadsBindingLedger` and `validateSquadsExecutionContext` and
live verification to `verifySquadsExecution`. The API must not infer support for
a new binding variant from extra fields or caller input: the shared validators
and exact decoder must accept it first. Existing single-transaction bindings
retain their representation when new variants are introduced.

The admission budget applies to the entire observation request. Any multi-account
or batch decoder must also bound transaction count, account count, response bytes,
RPC fanout and total work; additional instructions never bypass admission or
replace the exact approved full plan. A partial observation must not be returned
as `instructionVerification: "verified"`. Neither a proposal status nor matching
instructions promote `paymentVerified` or `retirementVerified`; finalized
settlement evidence remains the authority for paid state.

The batch binding contract is backward compatible: schema version `"1"` keeps
`kind: "squads-execution-binding"` and its `vaultTransactionAccount`. Version
`"2"` uses `kind: "squads-batch-execution-binding"`, substitutes `batchAccount`,
and includes ordered `children` records with `transactionIndex` (one-based
number), `transactionAccount`, `messageSha256`, and `transferIndexes`. Each child
covers at most five transfers; the complete list must cover every full-plan
transfer exactly once in order. The shared validators own these constraints.
The numeric public-index version stays `1`, and no new API route is needed.

Verified batch observations contain `batchProgress: { totalChildren,
executedChildren }`; unresolved batch observations contain `batchProgress: null`.
Single-transaction observations omit that field. The backend passes this field through from the exact shared
verifier without deriving it from a proposal status. An executed child or a fully
executed batch still has `paymentVerified: false` and `retirementVerified: false`;
the UI may display progress but must not promote it to paid. Partial execution is
distinct from partial instruction verification: `instructionVerification` may
be verified only after all bound child messages match the complete frozen plan,
regardless of how many have been executed.
