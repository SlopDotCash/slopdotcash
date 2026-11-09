# Application state models

This directory holds the source-to-model inventory and Quint models required by
[PRD section 12](../docs/slop-product-requirements.md#12-state-correctness-and-quint-verification).
The models cover frontend routes, accounts and wallet sessions, project
admission and revisions, private reports and awards, notifications, Points and
disputes, Slopbot review and scoring, vetting and evidence, payment contracts
and workers, fee handling, referral code, contributor tools, snapshots and
release. External provider and chain behavior remain separate trust boundaries.

## Layout

| Path | Contents |
| --- | --- |
| `models/<domain>/*.qnt` | Finite Quint models, one folder per domain. Model names are unique across folders. |
| `inventory.json` | Generated census of production sources, their linked models and lexical state candidates. |
| `lemmascript-inventory.json` | Generated callable census and selected runtime contracts; an inventory entry is not a proof. |
| `state-catalog.json` | Generated list of declared lifecycle string unions and SQL state constraints. |
| `stateless.json` | Reviewed reasons why a source holds no independent state. |
| `tlc.json` | TLC worker and JVM settings for `formal:verify`. |
| `tlc-safety-views.json` | Exact source and translation bindings for the reviewed journal safety view. |
| `lemmascript/` | Dafny proof artifacts for the selected `verified-*` TypeScript modules. |
| `tests/` | Implementation conformance tests that run actual migrations and handlers. |

Domains: `api`, `contracts`, `contributor`, `fees`, `payments`, `points`,
`referrals`, `release`, `rewards`, `slopbot`, `tooling`, `ui` and `vetting`.

## Commands

```sh
bun install --frozen-lockfile
bun run formal:check
bun run formal:verify
node scripts/check-formal.mjs --model=MODEL_NAME
node scripts/check-formal.mjs --verify --model=MODEL_NAME
SLOP_QUINT_TRANSLATOR_TEST=1 bun test ./scripts/quint-local-translator.test.ts ./scripts/quint-safety-view.test.ts
bun run formal:inventory:update
bun run lemmascript:inventory:update
```

`formal:check` requires a current inventory with zero unmapped sources, a
current state catalog, then typechecks each model, runs its scenarios and
samples 500 seeded traces of up to 60 steps. `formal:verify` explores each
finite state graph with TLC through the lockfile-pinned Quint. Translation
needs Java 21 and the pinned Apalache distribution. The runner uses a local
parser process instead of the upstream gRPC launcher, pins the JAR bytes and
supervises each process group. Commands fail on violations, errors or timeouts.
The Java 21 CI job enables the translator's real TLC regressions; without the
environment flag those cases are reported as skipped.

Type, scenario and simulation stages have a 90-second limit. Finite verification
normally has a 180-second limit; `ui_submitted_payment_recovery` has 600 seconds
and `direct_bounty_journal` has 1,800 seconds. The runner records the effective
limit and its own hash. These allowances change no model domain or invariant.
A timeout is an incomplete check, never a pass.

The journal uses the exact, hash-bound safety view described in
[the projection argument](tlc-safety-view-audit.md). Its result is exhaustive
only for that finite safety quotient. The submitted-payment model separately
projects unused stored payloads in its finite `step`; its concrete scenarios,
`concreteStep` and `unboundedStep` retain them. Neither projection proves exact
stored contents, unbounded retries, UI output equivalence or implementation
refinement. The runner refuses stale or unexpected view evidence.

## Model conventions

- Begin each model with one `// @source path` line per production file it
  abstracts. The runner binds each result to the model and every mapped source;
  a change to either during a run fails that run.
- Export `init`, `step` and `invariant`, plus named `run *Test` reachability
  scenarios. A model without a scenario fails the check.
- Name temporal properties `*Property`; TLC checks them. TLC deadlock detection
  is disabled, so cover terminal and stalled behavior with explicit scenarios
  and progress properties.
- State scheduler and external-service fairness assumptions beside each
  progress property. A timeout or retry bound must settle visibly; fairness
  must not assume that a payment, provider request or human approval succeeds.
- Record finite bounds and abstractions in the model's comments.

## Inventory and review

A source is `mapped-abstraction` when a model names it,
`reviewed-no-independent-state` when `stateless.json` gives a reason, and
otherwise `pending`. A mapping is a review index, not proof that every source
branch refines the model. Refreshing the inventory alone cannot turn an
unreviewed source into accepted coverage. After reviewing a source or model
change, run `bun run formal:inventory:update` and commit both indexes.

The LemmaScript callable census lives here rather than in the retired research
notes. Run `bun run lemmascript:inventory:update` after source changes;
`bun run lemmascript:inventory` rejects missing or stale census bytes.

Unmentioned literals in `state-catalog.json` are review leads, not proof of a
missing transition, and a matching literal is not proof of coverage. Boolean,
numeric, cross-process and implicit state still require manual review.

## Evidence

Results, exact commands, source and model hashes and tool versions are written
to the ignored `evidence/formal/` directory. Attach the relevant receipts to the
issue or PR. Distinguish sampled simulation, exhaustive finite exploration,
implementation conformance and live integration; do not count partial coverage
as complete.

## Completion boundaries and conformance

PRD sections 3, 6, 8, 10 and 12 require current authority, retained payment
evidence and correct private-view lifetimes. The models below separate a
request's completion from permission to replace current state. Test links are
entry points for conformance, not claims that a particular source revision
passed. Current execution results belong in the ignored evidence directory and
the reviewed PR; earlier per-branch results do not certify the combined source.

| Boundary | Models | Implementation evidence |
| --- | --- | --- |
| Owner and monthly wallet attempts | `ui/ui_owner_recovery_lifetime.qnt`, `ui/ui_monthly_setting_recovery.qnt` | `tests/e2e/owner-awards.spec.ts`, `tests/e2e/vault-actions.spec.ts` |
| Direct-payment journal and Solana pending records | `payments/direct_bounty_journal.qnt`, `ui/ui_solana_payment_pending.qnt` | `tests/e2e/bounty-full-flow.spec.ts`, `tests/e2e/bounty-solana-flow.spec.ts` |
| Payment-child selection and submitted recovery | `ui/ui_bounty_payment_parent.qnt`, `ui/ui_submitted_payment_recovery.qnt` | The same EVM and Solana payment suites |
| Private case ordering, Inbox mutation and Admin draft ownership | `ui/ui_private_case_revisions.qnt`, `ui/ui_inbox_mutation_focus.qnt`, `ui/ui_admin_editor_lifetime.qnt` | `tests/e2e/private-case-ordering.spec.ts`, `tests/e2e/inbox-response-owner.spec.ts`, `tests/e2e/admin-editor-lifetime.spec.ts` |
| Payment preparation and recovery at commit | `payments/direct_preparation_completion.qnt`, `payments/direct_recovery_completion.qnt` | `backend/security/direct-payments.integration.ts` with migrated SQLite and local Anvil |
| Monthly owner authority at commit | `rewards/monthly_owner_completion.qnt` | `backend/payments/monthly.test.ts` with actual SQLite writes |
| Registry snapshot and browser evidence publication | `release/registry_snapshot_publication.qnt`, `release/ci_browser_evidence.qnt` | Registry sync checks; separate normal and private-intake browser reports |
| Cancellation, detached descendants and proof receipts | `tooling/formal_process.qnt`, `tooling/formal_toolchain.qnt`, `tooling/runner_cancellation.qnt` | `scripts/e2e-runner.test.ts`, `scripts/e2e-runner-io.test.ts`, `scripts/lemmascript-cancellation.test.ts` |

Pending attempt mutations compare the last acknowledged stored record in one
synchronous browser task. New attempts have unique IDs; legacy records require
exact-value matching. A failed hash write retains in-memory evidence without
pretending storage changed. Departed verification callbacks cannot clear a
replacement; an already-open wallet prompt may update only its still-owned
slot. Explicit clearing ends that ownership. These are same-tab guarantees,
not cross-process locks, cancellation of wallet prompts or unlimited history.
UUID uniqueness, coherent session storage and React lifetime delivery are
assumptions; chain finality and backend authority remain separate checks.

The EVM journal mutates one nonce in the latest stored map and compares prompt
identity plus transaction bytes. A late response cannot erase another leg or
replace a newer same-nonce request. Solana recovery compares its captured
stored snapshot before saving a candidate and keeps returned signatures
distinct from editable input. Empty input cannot silently resubmit a saved
candidate. A signature is evidence to verify, never a paid state.

Private case replacements refuse older revisions. Equal revisions trigger or
join a fresh read because wallet, role and payment projections can change
without advancing the case revision. An accepted replacement fences older GET
callbacks; a refused replacement must not cancel the current GET. Departed
callbacks start no new private read. Inbox focus reads wait for an active
mutation's reconciliation. Admin saves remove only the submitted draft bytes
and do not navigate away from newer edits or a replacement editor.

Initial direct-payment publication checks both current wallet claims and exact
reporter consent in the same database batch as the case event and intent.
Recovery checks the current generation and payer claim, plus the current
reporter claim and consent when its leg is unpaid. A paid reporter leg retains
its frozen destination. Existing finalized transfers to earlier destinations
remain valid evidence. Monthly owner writes compare the captured registry
revision and manifest digest at INSERT time; a changed or absent registry
refuses the write, while an unchanged paused project remains manageable.
These predicates assume atomic database statements/batches; they do not create
a distributed transaction with GitHub or the chain.

Registry files are written sequentially, not atomically as a pair. An interrupted
write may leave partial or mismatched bytes; later validation must refuse them.
Normal registry and private-intake browser runs use distinct evidence folders;
execution success does not prove that a report survived an overwrite.

The browser supervisor records numeric process ancestry before a parent exits
and rechecks captured start identities before signaling detached groups. The
controlled Node launcher acknowledges startup and exit through the preload;
missing acknowledgement or cleanup failure fails the phase. Native programs,
removed preloads, unobserved reparenting, coarse OS timestamp resolution,
SIGKILL, host death and supervisor loss remain external limitations. No port or
command-name match grants process ownership. LemmaScript uses the same
supervisor and retains cancellation/failure receipts without starting later
proof commands or converting incomplete work into success.

Directory removal is independent of process cleanup: a failed spawn or cleanup
deadline can leave the private directory behind, and a removed directory does
not prove that child processes stopped. Ownership checkpoints remain active
during the interrupt grace period; each completion path retains its failures.

## Current source-only follow-up

The follow-up preserves the source work at
[`5eed5ada2`](https://github.com/SlopDotCash/slopdotcash/tree/5eed5ada2341fad8df23ac5176ab1fc5d6864338/formal)
while using the domain layout and consolidated stateless inventory from
`82477b08`. Historical per-branch research remains in that immutable source
and in ignored alignment notes; it is not restored as a second current audit
index. No application, browser, parser, simulator or verifier ran during this
alignment. Regenerated inventories and source comparisons are not acceptance.

| Boundary | Model families | Source or existing regression entry points |
| --- | --- | --- |
| Private reads, explicit sign-out and account changes | `ui_session`, `ui_explicit_signout`, `ui_inbox_reads`, `ui_points_disputes`, `ui_vetting_inventory`, `ui_vetting_reader` | `src/lib/project-api.ts`, `src/Inbox.tsx`, `tests/e2e/explicit-signout-lifetime.spec.ts`, `tests/e2e/inbox-response-owner.spec.ts` |
| Project publication and admin actions | `api_project_creation_completion`, `api_project_revision_receipt`, `ui_project_publication_lifetime`, `ui_admin_mutation_identity`, `ui_admin_enforcement_intent`, `ui_admin_vetting_requests` | `backend/projects/handler.ts`, `backend/projects/cloudflare-persistence.ts`, `src/Admin.tsx`, `tests/e2e/project-save.spec.ts`, `tests/e2e/admin-vetting-request-ownership.spec.ts` |
| Wallet, owner and referral continuations | `ui_earnings_actor_binding`, `ui_earnings_wallet_lifetime`, `ui_owner_recovery_lifetime`, `ui_owner_vault_setup`, `ui_referral_claim_lifetime` | `src/Earnings.tsx`, `src/OwnerVaultSetup.tsx`, `src/ReferralClaims.tsx`, `tests/e2e/earnings-wallet-lifetime.spec.ts`, `tests/e2e/referral-claims.spec.ts` |
| Direct-payment and monthly completion | `direct_preparation_completion`, `direct_recovery_completion`, `direct_bounty_journal`, `monthly_owner_completion`, `ui_submitted_candidate_ownership` | `backend/security/direct-payments.ts`, `backend/payments/monthly.ts`, `src/lib/pending-attempt.ts`, existing EVM/Solana payment workflows |
| Notifications and inference accounting | `notification_attempt_ownership`, `notification_admin_fanout`, `notification_escalation`, `bot_inference_reservations`, `bot_value_attempt_recovery`, `bot_value_precall_authority` | `workers/notify/security.ts`, `workers/notify/activity.ts`, `workers/slopbot/value-budget.ts`, migration `0118_slopbot_value_attempt_completion.sql`, existing notification and value-pipeline tests |
| Inbox storage and identity admission | `api_inbox`, `inbox_queries`, `inbox_mark_read`, `api_identity_admission`, `identity_rate_gate` | `backend/notifications/handler.ts`, `workers/identity/rate-limit.ts`, existing migrated notification workflows; direct rate-counter/gate execution evidence remains missing |
| Scheduled identity cleanup and intake renewal | `identity_intake_renewal`, `identity_scheduled_maintenance` | `workers/identity/index.ts`, `workers/identity/persistence.ts`, `scripts/identity-maintenance.test.ts`; token-fallback and outer scheduled-handler execution evidence remains incomplete |
| GitHub identity exchange and callback completion | `github_identity_exchange`, `identity_callback_completion` | `workers/identity/index.ts`, `workers/identity/handler.ts`, `workers/identity/persistence.ts`; `workers/identity/failed-callback.test.ts` and `workers/identity/expiry-boundary.test.ts` use an injected resolver and do not exercise real provider exchange |
| Polling, assertion storage and one-time consumption | `identity_assertion_lifecycle`, `ui_identity_poll_protocol` | `workers/identity/handler.ts`, `workers/identity/persistence.ts`, `src/lib/identity-flow.ts`, `workers/identity/expiry-boundary.test.ts`, existing login and account-closure browser workflows |
| Local identity handoff | `dev_identity_bridge` | `scripts/dev-identity-bridge.ts`, `scripts/dev-identity-bridge.test.ts`; remote and local persistence are separate authorities |
| Service-binding identity and contributor-token exchange | `identity_consumer_exchange` | `backend/identity-assertion.ts`, `backend/points/handler.ts`, `backend/trace/handler.ts`, `backend/trace/auth.ts`, existing publication and account-closure workflows |
| Contributor process and receipt ownership | `contributor_discovery_lock`, `contributor_lock_publication`, `contributor_command_completion`, `skill_run_local`, `contributor_terms_preflight`, `skill_installation` | Canonical contributor-template scripts; `scripts/contributor-discovery-startup.test.ts`, `scripts/contributor-lock-publication.test.ts`, installer integration definitions |
| Snapshot, evidence and backup publication | `cycle_snapshot_publication`, `evidence_capture`, `evidence_transport`, `evidence_process`, `vetting_backup_chain`, `vetting_audit_retention` | `scripts/sync-cycle-index.ts`, `scripts/record-evidence.mjs`, `scripts/evidence-bundle.mjs`, existing publication/transport/process regression definitions |
| Browser-local completion | `ui_image_decode`, `ui_clipboard_requests`, `ui_resource_deadline`, `ui_document_head`, `ui_link_dispatch`, `ui_email_preference_requests` | `src/ProjectImageField.tsx`, `src/lib/use-copy-feedback.ts`, `src/lib/use-public-resource.ts`, existing browser definitions |

Names in the table are unique model basenames within `models/<domain>/`.
Existing and added regression definitions have not run against this combined
candidate. The table names entry points, not successful results or full
model-to-implementation refinement.

The models retain the distinction between a session observation and continuous
knowledge of browser identity. Departed callbacks cannot replace a newer view;
an already accepted backend write is not undone by departure. Local storage
comparison-and-swap guards protect the compared slot only; they are not global
locks or guarantees that unavailable storage was erased. Clipboard feedback
belongs to the committed value and latest local request, not exclusive control
of the operating-system clipboard.

Notification pages and unread counts are independent observations. Committed
read marks remain durable when their response fails. Identity rate admission
uses the timestamp captured after edge admission, before hash and SQL awaits.
Cleanup and reordered requests can therefore produce a returned snapshot whose
expiry is already past the response-time clock. Its finite bound applies per
counter generation, not to every possible wall-clock window. No stronger
clock policy or approximate edge guarantee is inferred.

The scheduled Worker and operator CLI have different renewal outcomes. A
valid disabled observation can successfully complete Worker renewal; the CLI
can report that disabled result as a failure. The Worker conditionally stores
only newer timestamps, so its returned observation may differ from a newer
singleton already retained in D1. Cleanup runs six sequential deletes, not one
transaction. Earlier deletions can remain committed when a later stage fails.
The inner cleanup/renewal join and outer maintenance/reporting join await their
independent outcomes. A failed job does not imply that all effects rolled back
or that its other branch never ran. A later invocation is modeled explicitly;
no automatic host retry or provider success is assumed.

`identity_intake_renewal` bounds two invocations and timestamp ranks 0–2, with
at most one authenticated request and one anonymous fallback per invocation.
`identity_scheduled_maintenance` bounds two jobs and six ordered cleanup
statements. The existing maintenance test is only partial implementation
evidence; direct token-fallback, concurrent renewal and outer reporting paths
still need execution evidence. The
[ECMAScript all-settled contract](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.allsettled)
explains the joins, while the
[Workers scheduled-handler contract](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
defines the host entry point. Neither reference proves this implementation's
conformance. The models and their 34 scenarios remain unexecuted here.

The GitHub exchange model separates a refused HTTP response or invalid value
that returns null from a fetch or body-read exception. Its one token request
and one user request follow the
[GitHub App user-token flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).
Only the projected actor, login and optional valid User node ID are returned.
Clearing the local token variable does not revoke the token or erase other
references. A basic identity can serve the private-trace audience; Points
requires the node ID. A returned identity is not a completed callback.

The callback model bounds one flow and two competing requests. The claim
consumes the stored verifier, and a missing reply does not restore it. Failure
and completion writes can commit before their replies fail. Missing change-count
metadata also produces a refusal despite a committed write. Failure persistence
can itself fail, leaving the terminal state unconfirmed and replacing the
original error. Completion checks a fresh timestamp after the exchange, but SQL
uses that captured value if later work is delayed. Expiry cleanup can race with
these writes or remove a completed row before the HTML response is prepared.
The model does not assert that a successful response proves current row
availability, browser delivery or assertion issuance. Existing callback tests
cover selected refusal and expiry paths; they do not establish refinement for
all modeled races. Both new models and all their scenarios are unexecuted here.

The assertion review found a cross-request replay path in the previous source.
Two polls could read the completed flow before issuance. After the first poll
issued its deterministic token, that token could be consumed and its expired
row removed. A delayed second poll could insert the same token with its later
captured expiry. Its eventual issuance refusal did not undo the new unconsumed
row. The insertion now checks the flow is still `callback_complete` in the same
SQL statement. Production callers must pass the flow ID. The local bridge
explicitly passes null for its separate random token and local database.

`identity_assertion_lifecycle` retains the former insertion as a negative-control
scenario outside `step`. It bounds one flow, two polls, two consume requests,
two assertion-row generations and one cleanup sequence. It separates initial
poll time, issuance time, consumption time, writes and replies. The
[SQLite UPSERT contract](https://www.sqlite.org/lang_upsert.html) explains why
an existing row is retained; the parent-state insertion condition prevents a
removed row from being recreated after issuance. A migrated-handler regression
in `workers/identity/expiry-boundary.test.ts` exercises that delayed-poll path.
Neither that regression nor the models have run here.

The browser polling model bounds one helper invocation and two poll replies;
that prefix does not impose an application retry limit. It covers fresh and
resumed authorization, validation, timer cancellation, pending intervals,
expired assertions, storage-hook failures and the parent cancellation guard
before session exchange. Storage callbacks express requested effects, not
durability. The helper validates assertion expiry on receipt; it does not
refresh server expiry or promise that a later caller-owned hook ends before
that expiry. No UI behavior changed in this follow-up.

The local bridge model separates its in-memory flow map, the remote one-time
handoff and local assertion persistence. A remote claim can commit before its
reply fails. A valid reply removes the local flow before storing the independent
random assertion. A later local write or reply failure does not undo the remote
claim. Restart removes the map without deleting durable local assertions or
sessions. The map is not a lock: overlapping polls depend on the remote atomic
claim to prevent duplicate handoffs. Existing local integration tests cover
selected paths; they do not prove every modeled interruption.

The consumer model follows the
[HTTP service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
through atomic assertion consumption, response parsing and caller projection.
Consumption can remain committed after body-read, validation or later signing
failure. Points requires a valid node ID before its membership write; the trace
exchange can accept a basic identity and issues contributor authority only.
It does not issue operator authority or a database session row. A signed token's
expiry remains based on its captured issuance time, even if signing or delivery
is delayed. General bearer verification and later authenticated actions are
separate boundaries. These new models remain unexecuted here.

Contributor lock publication and evidence publication distinguish committed
state from cleanup failure. Failed compensation retains recovery inputs.
These operations do not provide crash-atomic multi-path publication or proof
against every unrelated filesystem writer. Evidence TLS success requires an
observed socket close; the probe deadline is not a deadline for DNS or the
whole recorder. Direct-child cleanup is not process-tree containment. Backup
objects, readback verification, completion records and queue acknowledgment
remain separate states.

This candidate still must incorporate the final reviewed changes from PR
[#2432](https://github.com/SlopDotCash/slopdotcash/pull/2432) before its own PR
review. Its independently collected results cover their named source heads,
not this later source-only combination. The user instruction to skip checks
remains in force for this lane; application-wide state assurance is incomplete.

## Acceptance requirements and limits

- Run the full code, model, database, contract and browser gates against one
  combined revision. Earlier per-checkpoint passes do not certify a later head.
- Payment acceptance includes the private Anvil and Solana browser lanes and
  the repeated wallet matrix. Local Solana acceptance must reach a passing
  finalized run; a newly compiled native program needs its own native evidence.
- LemmaScript proofs cover only the selected `verified-*` modules; other
  runtime functions remain unproved.
- Finite models, lexical state discovery, selected function proofs and passing
  workflows do not prove the absence of every application state error. Local
  provider and chain fixtures do not establish production deployment, live
  providers, devices, wallets or settlement availability.

## Method

The [Quint language guide](https://quint.sh/docs/language-basics) defines actions
and nondeterministic transitions. The
[property guide](https://quint.sh/docs/checking-properties) distinguishes
simulation, witnesses, invariants and model checking. The
[temporal operator reference](https://github.com/quint-co/quint/blob/main/docs/content/docs/builtin.md)
defines fairness and eventual progress. Models are finite, independently
checkable families with explicit cross-family assumptions, followed by
implementation conformance through actual workflow entry points.
