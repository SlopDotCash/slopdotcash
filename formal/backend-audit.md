# API, account, and private-report state review

This review targets `origin/development` commit `e3d7dea64` in the separate
`slopdotcash-quint` worktree. It does not claim coverage of the older dirty
checkout. The old checkout's models and fixes were not copied into this tree.

## Model/source/action map

Every model contains exact `@source` file annotations. These are design-level
coverage references; they are not proof that all statements in a referenced
file refine the model. The source inventory retains unmapped files as pending.

| Model | Source entry points and state represented | Principal checks |
| --- | --- | --- |
| `api_identity` | Identity `startFlow`, `oauthCallback`, `pollFlow`, assertion creation/consumption, local handoff | Callback/issuance expiry, PKCE erasure, failed callback terminality, audience binding, single consume; local handoff creates no production assertion |
| `api_identity_admission` | `consumeExactRateLimit`, identity Worker edge/exact admission | Exact fixed-window count, denied excess requests, failed storage admits nothing |
| `api_accounts` | Points join, session creation/revoke/signout, account closure/reopen | Explicit reopen; closing removes sessions/connections/consent while preserving reserved identities and obligations |
| `api_x_connection` | X start/callback/provider verification/link/disconnect | Session remains live through provider call; verified numeric ID reservation persists after disconnect; connection earns no new points |
| `api_project_registry` | Project create, old application publish, setup check/activation, append revision | Installed App and current write authority, funding independent from readiness, revision and enforcement-generation compare-and-swap, immutable ordered revision history |
| `api_project_enforcement` | Restriction folding, flags, malicious restriction, appeals, separate account reinstatement | Two distinct flags, clean-scan reinstatement, independent moderator for confirmed malice, project reinstatement does not silently clear account ban or obligations |
| `api_reporting_readiness` | Cached reporting observation and repository/revision selection | Cache bound to revision and repository identity; stale/disabled/unavailable distinct |
| `api_email_consent` | Email verification request, account-bound single-use verify, preference CAS, unsubscribe | Verification does not revive later withdrawn consent; expired token does not install destination; activity/security switches independent |
| `api_inbox` | Atomic source-event notice append, read, acknowledgement | No notice without committed source; read and acknowledgement distinct; account ownership required; replay idempotent |
| `api_mail_delivery` | Security/activity queue claim, send, receipt reconciliation, retry, opt-out | Provider acceptance differs from delivery; unknown send does not retry until definite non-acceptance; bounded attempts; no new provider call after observed opt-out |
| `api_trace` | Run, intent, permanent object reservation, byte write, attachment commit, finalize, grant/read | Intake gate before upload; orphan bytes do not imply attachment; finalized run requires attachment; one audited operator read; contributor event append stops at finalization |
| `api_wallet_claims` | Claim lineage, possession challenge, challenge consumption, signature verification | Append-only revisions; existing observation does not imply possession; expired/invalid proof grants nothing; no payment authority derives from proof |
| `api_private_intake` | Stored report, screening, explicit owner routing, GitHub forwarding, uncertain-send reconciliation, receipt | Durable Slop receipt independent of external delivery; ambiguous forward must reconcile before retry; private content never becomes public fallback |
| `api_private_authorization` | Intake OAuth begin/complete/read grant | Per-submission, actor and session binding; expired or switched-account grant cannot send |
| `api_private_assessment` | Report-version assessment start/finish/retry and owner intervention | Stale model completion cannot replace newer report or human decision; unavailable result remains retryable, not passed |
| `api_private_case` | Technical decision, appeal, related-party review, award, remediation, disclosure | Independent review, funded decision preserved, exact redacted digest before disclosure, deployed mitigation follows evidenced fix |
| `api_bounty_reservation` | `planAward` / `awardReservation`, finalized program funds, participation/restriction guards | No overspend; pledge is not reserve; related-party review precedes reservation; later ban preserves existing obligation |
| `api_award_recovery` | Private direct payment and successor recovery | Renewed destination consent, retirement proof before replacement, paid legs preserved, no second settlement of same leg |
| `api_points_disputes` | Own-award dispute intake, triage/escalation, independent resolution | Unrelated actor cannot file, only escalated dispute reaches moderator, no self-resolution, immutable source award retained |

These models intentionally abstract crypto, identity strings, media payloads,
provider replies and integer amounts into finite equivalence classes. They do
not execute network calls or sign or submit a payment. Direct-payment chain
mechanics also have complementary money models from the financial review.

## Confirmed source fixes

Two failures were reproduced in the current authoritative source using actual
HTTP handlers, real crypto and migrated SQLite:

1. A callback started before OAuth expiry could finish its GitHub exchange
   after expiry and still return `200 Signed in`. The persisted
   `completeCallback` update lacked an expiry predicate. It now refuses an
   expired flow at the write boundary.
2. `pollFlow` captured time before asynchronous assertion persistence, and
   `markAssertionIssued` checked only callback status. A slow storage operation
   could issue a completed response after expiry. Issuance now compares expiry
   at the write and the handler supplies current time after persistence.

`workers/identity/expiry-boundary.test.ts` failed with two HTTP 200 results
before these changes and passes with 409/410 afterward. The original failed
callback and loopback tests still pass. No signer, deployment or live account
configuration was changed.

## Migration state review

Migration coverage is attached to the specific affected family, not one
undifferentiated schema model. Existing-data upgrades and creating empty
schema are different evidence boundaries.

| SQL files | Migration effect and model |
| --- | --- |
| 0001, 0005, 0058 | Initial run/object/intent state, atomic attachment commit witness, then immutable object reservation before R2 bytes: `api_trace` |
| 0006 | Trusted singleton private-intake availability observation; false/unverified never authorizes upload: `api_trace` |
| 0002, 0008, 0108_identity | OAuth/assertion tables; 0008 rebuild widens audience and adds optional node ID without rewriting old identity/time/status; 0108 rebuild adds terminal callback-failed status: `api_identity` |
| 0004 | Exact fixed-window admission state: `api_identity_admission` |
| 0003, 0007, 0010, 0015 | Normalize old fallback source name without changing record digest; immutable root/successor claims; additive possession proof; per-chain lineage retaining old claims as Solana; separate historical observations never become authority: `api_wallet_claims` |
| 0008, 0063, 0056 | Membership, revocable sessions, closed/private account guards, and retained historical Telegram identity reservations. Telegram has no active creation path under the current PRD: `api_accounts` |
| 0009 | Permanent X identity reservation versus removable visible link and expiring OAuth flow: `api_x_connection` |
| 0019, 0020, 0039_project | Revision/current-pointer registry, retained application authority observation and optional expected revision: `api_project_registry` |
| 0023, 0027, 0032, 0066_project, 0070, 0072 | Gapless immutable enforcement journal; successive rebuilds widen owner/system/account appeal roles while retaining row IDs; account bans/reinstatements separate from project state: `api_project_enforcement` |
| 0024, 0029, 0063, 0065 | Immutable notices with one-way read markers; widen kinds via copy/rebuild before reinstalling enqueue triggers so old mail is not replayed: `api_inbox` |
| 0030, 0033 | Separate security/activity outboxes and delivery evidence; preference-bound ordinary mail: `api_mail_delivery` |
| 0111, 0116 | Account-bound verified destination/token digests, independent security preference, opt-out suppression, and monotonic preference revision even when time/values repeat: `api_email_consent` |
| 0026, 0028, 0061 | Frozen private receipt/terms, decision/review state, related-party guards, asynchronous assessments: `api_private_case` and `api_private_assessment` |
| 0059, 0101 | Immutable submission attempts and uncertain forwarding; rebuild private cases preserving existing funded receipts; add durable Slop intake/report versions: `api_private_intake` |
| 0069, 0110 | Separate appeal triage and assessment report-version binding, leaving historical null-bound observations as history: `api_private_assessment` |
| 0086_repository | Versioned repository reporting observation, never case content: `api_reporting_readiness` |
| 0114 | Own-source Points dispute intake with explicit escalation and immutable identity: `api_points_disputes` |

`formal/tests/api-migrations.test.ts` runs six populated upgrade scenarios:
OAuth through 0008 and 0108, historical wallets through 0003/0010, unread/read
notices and already queued mail through 0063/0065, legacy email consent through
0111/0116, and an existing enforcement journal through 0027–0072 with stable
row ID and foreign keys. The existing
`backend/security/report-intake.test.ts` additionally verifies a populated
0101 upgrade preserving a funded private receipt and its reservation. These
scenarios pass; they do not establish every possible populated migration path.

## Verification and remaining scope

- The current source's assigned account/project/notification/security/identity
  suites passed: **318 tests, 0 failures, 2,926 assertions**.
- The added populated-upgrade suite passed: **6 tests, 0 failures, 67 assertions**.
- Named model scenarios, type checks and seeded simulations run through the
  shared formal runner. Final aggregate TLC verification belongs to the root
  task, after all agents stop changing models.
- `formal/backend-stateless.json` names only directly inspected files with no
  owned state. Unmapped helpers and handlers stay pending in the root census.

Bounds include two actors/sessions/destinations, three ordinary revisions,
five email send attempts, six OAuth clock ticks, two payment legs/requests,
one or two report versions/assessment attempts, and a four-unit example
reservation pool. Thresholds are scaled abstractions except the five-attempt
mail limit. They are not universal numeric proofs. Models establish safety of
these abstractions; fairness/liveness and full semantic refinement from all
TypeScript/D1 operations are not proved.

Large source files such as the complete private-case handler, direct-payment
RPC verifiers, every enforcement appeal combination, multi-project alias
interaction, stream/size parsing and all schema branches are not completely
refined to executable Quint traces. Provider/model authenticity, full live
GitHub OAuth, Cloudflare D1/R2 behavior, mail delivery, mainnet finality and
actual permissions remain external acceptance boundaries. Existing tests that
replace those providers prove application behavior under the given replies,
not provider qualification. No production migration has been applied here.

## Atomic local migration runner

The local bootstrap previously executed a migration and recorded its marker as
two independent commits. A process stop between them left schema changes without
a marker; restart then repeated non-idempotent DDL. `scripts/dev-migrations.ts`
now commits both in one immediate transaction, and `scripts/dev-backend.ts`
uses that runner. The marker is checked inside the write transaction so two
startup attempts cannot both apply one file.

The runner honors explicit `foreign_keys=OFF` directives before beginning the
transaction, then validates all foreign keys before the marker and commit.
This is necessary because SQLite treats changing `foreign_keys` inside a
transaction as a no-op. `defer_foreign_keys` remains inside the transaction and
resets after it ends. Enforcement is restored to ON in a finally block. These
choices follow the [SQLite pragma semantics](https://www.sqlite.org/pragma.html)
and [Bun transaction API](https://bun.com/docs/runtime/sqlite#transactions).

`api_dev_migrations.qnt` models the transaction's schema/marker pair, partial
rebuild, failure/crash, retry, and foreign-key restoration. Its two-version bound
does not prove arbitrary SQL. Six concrete tests in
`scripts/dev-migrations.test.ts` cover the full checked-in migration chain and
idempotent restart, failure during DDL, failure writing the marker, a child
process that exits after SQL before the marker, a populated table rebuild with
an invalid-FK rejection, and the populated 0084 budget-parent rebuild with its
reconciliation and retained inference children preserved. All six pass.

Already-damaged databases made by the previous runner are not silently
classified as migrated. An unmarked pre-existing schema remains a visible
failure requiring inspection; treating an existing table as proof that the
whole migration completed would reintroduce false success. No existing user
database or migration-history SQL was rewritten by this change.


## Forwarding recovery beyond the initial intake model

`api_submission_recovery` separates optional GitHub forwarding from a saved
private report. It models the send revision claim, competing stale request,
interrupted-send timeout, the five-minute quiet period before an empty listing
can reopen a draft, late external copies, immutable earliest-copy binding,
receipt verification, terminal verification failure, idle abandonment and the
exception for a durable saved report or a verified receipt awaiting contacts.
Two external sends remain possible when a copy becomes visible only after a
complete empty listing; the invariant is one adopted receipt/case, not an
untrue exactly-once GitHub POST guarantee.

Seven named scenarios and 1,000 40-step sampled traces passed. The matching
existing real-handler and SQLite tests were rerun: 8 tests and 76 assertions
passed, including concurrent sends, interrupted list reads, late-copy adoption,
verification expiry and idle abandonment. No implementation change was needed
for these paths. The bound is two send attempts, eight revisions and six age
classes. Identity, permission, complete private listing and admission/consent
are assumed at the entry to these actions and remain separate models.

The previously identified private-case and cross-project alias composition
items now have the additional models and real-handler evidence below. This is
bounded transition coverage, not an automatic proof that every TypeScript
execution refines a Quint trace.


## Coupled private report and case revisions

`api_private_case_transaction` composes report revision, case revision, stale
analysis, assigned-triager revocation, owner decision, refusal appeal and a
later approved obligation. It exposed a concrete stale-decision bug: `/report`
advanced only the intake revision, so an owner decision prepared against the
previous report could still pass the case revision check. The two real
handlers reproduced that ordering: the report became version 2 and the old
owner decision returned 200.

Report replacement now advances the case revision and appends a private
`report-revised` case event in the same batch as the intake revision, retained
report reference and intake event. Each dependent statement requires the
preceding write to succeed. Either the owner decision or report replacement
wins. An injected report-row insertion failure rolls back both revision
counters and both event histories; retry then succeeds. Frozen receipt facts
and prior report versions remain unchanged.

The pinned Bun 1.3.14 run of `backend/security/handler.test.ts` and
`backend/security/report-intake.test.ts` passed 100 tests and 1,066 assertions.
It includes the new owner/report interleaving and transaction failure/retry,
the existing reverse interleaving, stale analysis, role revocation,
related-party independence, appeal priority, and funded-award protections.
Eight named model scenarios and 1,000 40-step sampled traces passed.
Intake screening advances its own revision independently of report content;
the composed model retains that distinction and rejects a stale reporter read
after a screening cycle.

## Cross-project aliases and application publication

`api_registry_alias_transaction` composes an existing project's pending update
with a different project's new application claiming the same alias. The key
index is the final transaction guard; the losing batch changes neither the
project history nor application decision. A stored update remains pending
when its base revision changes. Original repository keys remain reserved
after a rename. The existing implementation already handled these cases.

The pinned focused run passed eight tests and 53 assertions:

- `backend/projects/cloudflare-persistence.test.ts`: current-name resolution,
  legal alias append, and `a repository path acquired by another project before
  commit refuses the whole revision`.
- `scripts/project-self-service.test.ts`: duplicate project/repository refusal,
  one-time publication of a stored application, and stale update base refusal.
- `scripts/project-registry-api.test.ts`: another project's banned repository
  cannot be claimed, and a restriction arriving after the revision read blocks
  its commit.

The six model scenarios cover both alias race orders, stale base, changed
restriction generation, repeat publication and preservation of the original
key. New-project creation is not falsely modeled as atomically reading an
external GitHub permission; its initial paused state and subsequent capability
checks remain separate from the registry transaction.

## Remaining scope after this composition pass

The identified application-owned gaps in this pass now have explicit bounded
models plus the concrete handler/SQL evidence listed above and in the bot and
vetting audits. No further omitted application transition family was identified
in this pass. This does not assert universal absence of undiscovered defects.

Remaining proof limits are distinct from missing transition requirements:

- Automatic refinement from arbitrary TypeScript/SQL executions to models is
  not established. Models bound actors, requests, revisions, pages and attempts.
- Digest/signature algorithms, schemas and parsers use finite equivalence
  classes; their concrete byte behavior depends on source tests and review.
- GitHub, provider, mail, chain, deployment and Cloudflare availability/identity
  remain external evidence boundaries. Local fixtures do not qualify them.
- Unbounded schedules and processes that never return have no unconditional
  progress proof. Documented fair scheduling or timeout assumptions are local
  to the temporal properties that state them.
