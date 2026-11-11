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

CI (`.github/workflows/formal.yml`) splits the sorted model list across
parallel shards. Each shard runs `check-formal.mjs [--verify] --model=NAME`
for its models. The final `quint` job fails unless every current model has
exactly one passing check report and one passing verification report bound to
the checked-out model, source and tool bytes, and it publishes the merged
`checks.json` and `verification.json`. `tlc.json` runs four TLC workers, one
per hosted-runner vCPU; the worker count changes no explored state space.

Manual diagnostics may select space-separated model names with
`gh workflow run formal.yml --ref BRANCH -f models="MODEL_NAME OTHER_MODEL" -f shards='[1]'`.
The defaults are `all` and six shards. Each shard must contain a model, so small
diagnostics select one shard. A focused result covers only the selected models; trusted
branch releases still require every model and retain the same native controls,
source bindings and report checks.

Type, scenario and simulation stages have a 90-second limit. Finite verification
normally has a 180-second limit. Explicit resource exceptions in
`scripts/check-formal.mjs` retain all model domains and invariants:

- 600 seconds: `ui_submitted_payment_recovery`, `ui_payout_consent_lifetime`,
  `ui_email_actions`, `ui_email_preference_requests`, `ui_project_authority`,
  `ui_vetting_reader`, `solana_wallet_provider`, `api_trace`, `ui_private_intake`,
  `solana_binding_completion`, `evm_wallet_discovery`, `fee_value_caps`,
  `vetting_generation_storage`, `vetting_evidence_registration`,
  `vetting_generation_retirement`, `submission_authorization_wrappers`,
  `api_submission_recovery`, `wallet_claim_publication`,
  `stored_binding_broadcast_authority`, `evm_binding_consent_api`, and
  `trace_event_finalization`, `api_private_authorization`, and
  `wallet_possession_completion`.
- 1,200 seconds: `ui_security_settings_lifetime` and `solana_binding_api`.
- 1,800 seconds: `api_owner_vault_lifecycle`, `api_project_lookup_routes`,
  `ui_admin_mutation_identity`, `ui_project_publication_lifetime`,
  `ui_bounty_payment_parent`, and `direct_bounty_journal`.
- 3,600 seconds: `ui_cycle_archive`. The corrected full concrete temporal graph
  completed in 34 minutes 48 seconds with 3,929,088 distinct states, zero queued,
  and no violation. Its domains, invariant and temporal property are unchanged.

The admin graph still had 3.11 million states queued after 600 seconds; the
publication graph had 2.18 million queued at that limit. The unchanged value-cap
graph reached 962,410 distinct states before its 180-second timeout. Earlier
owner/lookup VIEW measurements also exhausted 180 seconds; those incomplete
receipts do not establish a pass for the final V3 projections. After its
reductions, `ui_solana_payment_pending` uses the ordinary limit. The runner
records the effective limit and its own hash.
A timeout is an incomplete check, never a pass.

`bot_inference_retention` has a separately bound
[attempt-ID symmetry argument](bot-inference-symmetry-audit.md). It retains all
eight attempts, every row bit, multiplicities, and the current/retained roles.
Only permutations of otherwise uninterpreted attempt IDs are identified. This
does not authorize an ID-specific property or temporal verification.

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

### Tracked storage key

The payment-parent model tracks durable storage contents for one storage key,
chosen at initialization. Every guard and invariant that reads `savedKeys` or
`hashKeys` concerns the current storage key or the open prompt key, and no
transition copies contents between keys. An untracked slot is treated as
empty, which only adds storage replies, so each tracked run over-approximates
the full model's behavior for that key. Generation and message values 1 and 2
are interchangeable (the initial state uses 0 and keys are compared only for
equality), so keys 111, 112, 213 and 214 represent all twelve storage keys.
This removes the `3^12` product of slot subsets that kept the full graph from
completing. Scenarios fix the tracked key they assert on. This is reviewed
reasoning, not a machine-checked equivalence theorem.

### Duplicate transition choices

The affected API, payment, UI, contributor, Slopbot, tooling and vetting
models bind each `step` choice inside the branch that reads it.
Their former outer choices ranged only over literal nonempty sets, inclusive
constant integer ranges, or constant aliases for such sets (`ids`, `slots`,
`actors`, `observedActors`, `kinds`, `routes`, `keyIds`, `outcomes` and
`clearances`). None depends on the current state. For nonempty domains,
existential choice distributes over disjunction: each old branch successor
still has a local witness, and every local witness can be extended with any
value of the unused outer choices. Thus the same calls, arguments, guards,
initial states, invariants and full-state successor sets remain. No state field
or transition is projected away. The change avoids repeated enumeration of
identical branch successors and changes seeded sampling frequencies. This
argument would not apply to a possibly empty state-dependent outer domain.
Retain before/after model hashes and exact graph receipts in the ignored formal
evidence directory; a timeout is still incomplete verification.

Scenario-only helpers containing `init.then(...)` use `run` declarations. Their
expressions and assertions stay unchanged; production dispatchers do not call
them. This removes the pinned native translator's initializer/action ambiguity
without increasing the original `*Test` scenario set.

### Source-bound safety views

The journal, owner-vault, project-lookup, admin, email, publication,
security-settings, Solana-binding, wallet-provider and allocation operators in `tlc-safety-views.json`
are individually allowlisted. Each binds the complete model source, generated
TLA, projection expression and final viewed TLA, plus the pinned official
adapter. Unknown definitions, source changes and temporal properties refuse
before TLC. The official runner's result handling is unchanged.

A VIEW changes fingerprints while TLC retains a complete representative state.
It must preserve the invariant and future projected successors; deleting
fields merely because they are absent from the invariant is insufficient.
Separate observations retain separate false classes whenever later transitions
can repair one clause independently of another. The unchanged concrete actions,
scenario assertions and sampled traces retain their original values.

### Owner-vault verification

`api_owner_vault_lifecycle` keeps its ordinary `step` and original scenarios.
The transaction encoding and body/expected result expressions are extracted
without changing their expressions, validation precedence or concrete guards.
Only finite verification selects the explicitly source-bound
`verificationStep`. Its receipt names
`forward-safety-simulation-delayed-inputs`; this is an additional abstraction,
not the complete concrete graph.

- `verificationBegin` selects the original slot, mode and purpose with legal
  `evm`/`exact`/revision-1 placeholders.
- At Register's body transition, the full original family and raw transaction
  domains are selected once and passed through the original encoding and body
  expression atomically. Review never consumes those two inputs.
- At the expected transition, the full original revision domain `0..3` is
  selected once and evaluated by the original expected expression. Neither
  consumer can return to its input phase or resample.

Relate a reachable concrete state to an abstract state with equal globals and
requests except inputs not yet consumed, and the permanently dead GET/Review
inputs. At each consumer, choose exactly the values selected by the original
concrete `begin`. Every value remains available. Earlier branches do not read
those values beyond their satisfied legal-domain checks. Captured project,
policy, deployment, restriction and authority observations remain at the same
transitions; concurrent global writes and cross-slot phase observations remain
exact. Every concrete step therefore has a related abstract successor. This
is a manual forward safety simulation, not full concrete successor equality.

Invariant preservation does not assume the invariant is true. `init` and
`begin` set nonterminal `result` to `none` and `committed` to zero; only
`respond` changes result while entering a terminal phase, and commit occurs
after the consumers. Thus the deferred family cannot affect the conditional
existing-deployment clause before it is materialized. A replay does not consume
expected revision. Invalid body/purpose and unavailable service still precede
replay; replay precedes expected-zero validation; expected zero precedes the
existing-deployment and malformed-transaction refusals. EVM case folding and
Solana case sensitivity remain distinct.

The owner VIEW preserves every global. It erases only these nonterminal
observations after their last use:

| Mode or phase | Erased observations and reason |
| --- | --- |
| All | `creationRevision`, `creationCap`, `canSetup`, `received` are write-only for subsequent transitions and the invariant. Concrete scenarios retain them. |
| GET | Expected/transaction/family and current/policy/cap/captured/generation cannot reach a write; funds/service returns before body. Current only feeds an unobserved GET response revision. |
| Review | Transaction/family, policy/cap/generation and captured transaction/family never reach replay or append. Expected/current and captured existence remain exact through the expected check. |
| Chain and later | Expected/history checking has finished; Review also no longer consumes current or captured deployment. |
| After authority | Captured restricted/banned fields are dead. Append validation still reads the exact global restrictions. |
| Postcommit | Register policy/cap/transaction/family/generation have already made their global writes; committed revision remains live. |

Each terminal request retains all five local invariant truth values and
`C = committed > 0 implies policyAt(committed).exists and deploymentAt(purpose).exists`,
computed from the complete representative. While C is false, its exact
committed/purpose indices remain. While true, the indices can be canonical:
seed, edit and successful commit only add existing entries; no continuation
writes existence false or deletes an entry. Terminal indices never change.
True C is therefore closed under every writer; false C is recomputed from
retained indices and exact globals and can still become true. No truth bit is
supplied as an assumed authorization fact.

Response and done share one canonical terminal phase. Owner slots are never
reused, and cross-slot guards test only unused. `send` changes phase and the
unobserved received field, so its projection is a self-loop, matched by the
explicit `s' = s` in both dispatchers. All other projected successors agree.
This is an **unlabeled whole-next safety quotient**: it does not preserve
per-action send enabledness, action labels, response delivery, fairness or
liveness. Lookup cannot use this phase collapse because it reuses done slots.
The [terminal/stutter audit](owner-vault-terminal-stutter-view-audit.md) gives
the continuation argument. Whole-source and transition-boundary guards reject
new early reads, narrowed domains, resampling, terminal reuse, backward reads,
changed consumer expressions, removed stutter or invariant changes.

### Project-lookup verification

`api_project_lookup_routes` retains the complete concrete model. Its VIEW
erases the unused legacy-cache and login bytes. Data/cache versions and
request payloads retain zero-versus-positive observations: the consumers test
positivity and copy those values, never compare positive markers. Normalization
commutes with copies, cache replacement and expiry. Rename, data changes and
legacy writes can project to stutter, matched by the explicit step self-loop.
Exact freshness and login bytes are not VIEW guarantees.

The five additional input normalizations use explicit post-consumption phases:

| Inputs | Last reader | Phases where normalization is permitted |
| --- | --- | --- |
| Method and transport | Dispatch | Session, cache, validate, actor, owned-list, repository, buffer, selection-input, selection-actor |
| Expected actor | Session | Cache, validate, actor, owned-list, repository, buffer, selection-input, selection-actor |
| Repository and login-valid flag | Session key capture and validate | Actor, owned-list, repository, buffer |

These inputs occur in no original invariant clause. No phase returns to an
earlier consumer; done reuse fully replaces them from idle. Other live fields
remain exact. A deterministically refused dispatch additionally erases only
inputs that cannot reach session/cache/selection, while retaining the exact
403-versus-404 decision operands.

Response, done and enforcement-handoff retain their **distinct phases**, attempt,
pending-put flag, pending key/subject/payload positivity/wait flag, and each of
the seven original invariant observations independently. With no pending put,
its dependencies may be dummy values. Respond changes only phase and an
unobserved delivery flag. Put completion clears pending and makes the
pending-payload and error-implies-no-pending clauses true; the other five
observations remain unchanged, including false ones. Success writes the
retained cache destination and normalized contents. Begin reads only phase,
attempt and pending before resetting the record. Handoff has no continuation
except a hypothetical pending put. Invariant truth and future successor
classes are preserved. Exact terminal payloads are not VIEW guarantees.
`project-lookup-legacy-quotient.test.ts` binds the complete audited module and
requires review for new reads, backward phases, reuse or invariant changes.

### Other reviewed safety views

- The [admin continuation audit](admin-mutation-continuation-view-audit.md)
  retains all live identity, session, lifetime, storage, ownership and callback
  dependencies. Dead slots retain exact admission truth; the clear-witness
  implication remains a separate observation, including false values.
- The [email preference audit](email-preference-request-view-audit.md) preserves
  early cookie and returned-observation dependencies, separate authentication
  truth and indexed publication witnesses. Counters and generations stay live.
- The [publication continuation audit](publication-continuation-view-audit.md)
  retains every future identity, ownership, server-admission and publication
  dependency. Version 2 erases additional phase-dead payloads after their last
  consumer, while preserving independent false admission observations.
- The [security-settings audit](tlc-safety-view-audit.md#security-settings-lifetime-view)
  preserves per-publication admission truth independently. Version 2 also
  retains each stale HTTP read's exact admission predicate and current read
  identity, while erasing only phase-dead or permanently stale payloads.
- The [Solana binding audit](solana-binding-api-view-audit.md) keeps exact global
  audit/effect membership and timestamps, terminal dispatch enabledness and nine
  separate request clauses. Ledger availability and success/non-success are
  the only normalized value classes.
- The [wallet-provider audit](solana-wallet-provider-view-audit.md) preserves
  exact pre-provider dependencies, provider-wait method/invocation and six
  independent safety observations, including dormant false registration and
  reconnection facts. Seven capability values normalize only after their
  consumers become permanently disabled; late send effects remain observable.
- The [allocation audit](tlc-safety-view-audit.md#contributor-allocation-view)
  retains each account's eligibility, all global outputs and every future
  request dependency. Version 2 distinguishes permanently stale requests from
  current requests, preserves valid snapshots and absent-file closed state,
  and erases payloads that are overwritten or ignored before consumption.
- The existing [journal audit](tlc-safety-view-audit.md) retains its separate
  projection and controls.

All arguments are manual, source-bound safety arguments, not mechanically
checked refinement theorems or exhaustive UI-output verification. The trusted
native-control step runs the actual pinned TLC adapter, including false-clause,
continuation and source-drift controls. These fixtures cannot substitute for a
completed model graph. Resource limits are explicit per model; timeout,
cancellation, input drift or queued work remains incomplete verification.
Keep original receipts unchanged. A quotient state count is not a full-record
count, and the owner forward simulation is named separately in its receipt.
Implementation conformance, provider calls, chains and deployment need their
own evidence.

The separately frozen version-2 publication, security-settings and allocation
quotients completed with 6,051,015, 798,102 and 57,276 distinct states,
respectively, each with an empty queue under its recorded budget. Those
receipts belong to their recorded prototype inputs; they are not a claim that
a later combined revision ran those graphs. Earlier version-1 timeouts remain
incomplete. Native controls, final source bindings and implementation evidence
remain separate qualification requirements.

The Solana binding API's identical configure guard now runs before its 384
unchanged input tuples. Its existing VIEW expression is unchanged, with renewed
source/TLA pins. That separately frozen quotient completed 3,373,889 distinct
states with an empty queue in 688.320 seconds under its explicit 1,200-second
allowance. Earlier 180- and 600-second attempts remain incomplete. Ordinary
scenario and sampling budgets stay unchanged.

The separately frozen wallet-provider V3 quotient completed 2,526,432 distinct
states with an empty queue in 516.944 seconds under its recorded 600-second
allowance. Its concrete model and original invariant remain unchanged. Native
qualification reused the unchanged fresh V3 controls across the resource-only
follow-up; this does not claim a final combined-head graph or native execution.

### Other duplicate transition choices

The payment-parent model enumerates reply payloads only for the current,
authenticated read. Every payload for another pending read produces the same
removal from the pending set, so one original payload represents that successor.
Storage replies retain both current-epoch plan values and the failed-write
successor. A stale epoch already produced the identity successor from every
state, including epochs outside the finite choice range; the wrapper retains
that successor once and keeps the original range guard for current replies.

The Solana pending model's completion flags affect its successor only through
`authorized && storageWorks`. The wrapper therefore retains the original
`true, true` and `false, false` representatives. Its direct action still accepts
all four combinations, including the separately tested refusal cases.

These changes preserve each wrapper's enabledness and full-state successors.
They change the number of equivalent nondeterministic choices and can change
seeded simulation frequencies. They do not project state fields or change
initial states, direct actions, invariants, finite bounds or scenario outcomes.

### Write-only fields and canonical choices

The following finite `step` reductions remove state that no guard, update,
invariant or scenario expectation reads, or fix a choice among interchangeable
values. Each model header repeats its argument. Direct actions and named
scenarios keep the original behavior unless stated. This is reviewed
reasoning, not a machine-checked equivalence theorem.

- `payment_dispatch` no longer stores `failedGenerations`. No guard or update
  read it; its only invariant conjunct followed from
  `readA, readB <= generation <= 2`, which the invariant still states.
- `bot_value_pipeline` no longer records the last action name in `last`.
  Removing it maps each state to one reduced state with the same enabled
  actions and successors. The conformance test locates the tick by the clock
  change, which only `tick` performs.
- `direct_bounty_journal` reserves the fresh request ID `used.size() + 1`.
  Request IDs are opaque and compared only with each other or with 0, and
  `used` only grows, so any other unused ID reaches a permuted copy of a
  canonical state with the same invariant truth. The safety view keeps `used`,
  so its congruence argument still holds (see the audit record).
- `ui_solana_payment_pending` leaves the write-only `warnings` empty in `step`
  and edits drafts 0..3 only. Draft 4 and 0 both fail `validSignature`,
  neither falls back to the stored record, and `draft` has no other reader;
  dedicated scenarios check the equivalence. Named scenarios keep `warnings`.
- `ui_submitted_payment_recovery` records the write-only `error` flag as false
  in `step`, through the same projection as its stored payloads. Named
  scenarios, `concreteStep` and `unboundedStep` keep the exact flag.
- `ui_review_pool` ingests the smallest unseen review ID. `seen` is read only
  when it is complete, so every ingestion order reaches the same allocation.
- `binding_veto_policy` keeps cancellation and payment membership for the
  current version only. Guards read only the current version, `bind` moves to
  a version neither set contains, and an older version's membership is frozen
  after the disjointness invariant checked it.
- `referral_root_history` stores a voided epoch in one fixed form. Nothing
  un-voids an epoch and every reader skips voided epochs, so only the list
  length and the already checked `priorMax` range remain observable.

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
| Private case ordering, Inbox mutation and Admin draft ownership | `ui/ui_private_case_revisions.qnt`, `ui/ui_inbox_mutation_focus.qnt`, `ui/ui_admin_editor_lifetime.qnt`, `ui/ui_admin_mutation_identity.qnt` | `tests/e2e/private-case-ordering.spec.ts`, `tests/e2e/inbox-response-owner.spec.ts`, `tests/e2e/admin-editor-lifetime.spec.ts` |
| Admin vetting request ownership | `ui/ui_admin_vetting_requests.qnt` | `tests/e2e/admin-vetting-request-ownership.spec.ts` |
| Evidence registration, inventory and upload completion | `vetting/vetting_evidence_registration.qnt`, `vetting/vetting_evidence_inventory.qnt`, `vetting/vetting_upload_completion.qnt`, `vetting/vetting_object_lifecycle.qnt` | `scripts/vetting-api.test.ts`; legacy and execution limits below remain open |
| Generation storage, raw backup and retirement | `vetting/vetting_generation_storage.qnt`, `vetting/vetting_observed_part.qnt`, `vetting/vetting_generation_retirement.qnt` | `scripts/vetting-api.test.ts`, `workers/vetting-backup/generation-retirement.workflow.mjs` |
| Payment preparation and recovery at commit | `payments/direct_preparation_completion.qnt`, `payments/direct_recovery_completion.qnt` | `backend/security/direct-payments.integration.ts` with migrated SQLite and local Anvil |
| Monthly owner authority at commit | `rewards/monthly_owner_completion.qnt` | `backend/payments/monthly.test.ts` with actual SQLite writes |
| Registry snapshot and browser evidence publication | `release/registry_snapshot_publication.qnt`, `release/ci_browser_evidence.qnt` | Registry sync checks; separate normal and private-intake browser reports |
| Maintainer removal and applicant cancellation | `api/api_project_removal.qnt`, `ui/ui_project_removal.qnt` | `scripts/project-self-service.test.ts`, `backend/projects/cloudflare-persistence.test.ts`, `tests/e2e/project-removal.spec.ts` |
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

Project removal checks current GitHub authority against the stored repository,
then appends a paused, retired revision through the revision and enforcement
generation guards. It preserves historical Points, cases and funded obligations.
Applicant cancellation is independent of GitHub availability and competes with
publication through a conditional database write. Its retained cancellation
marker projects a distinct terminal state and prevents later publication.
Neither a lost response nor a departed UI callback reverses a committed write.
These models cover one bounded application/project and request lifetime; they
do not make GitHub and D1 a distributed transaction or prove payment behavior.

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
| Notifications and inference accounting | `notification_attempt_ownership`, `notification_admin_fanout`, `notification_escalation`, `bot_inference_reservations`, `bot_value_attempt_recovery`, `bot_value_precall_authority` | `workers/notify/security.ts`, `workers/notify/activity.ts`, `workers/slopbot/value-budget.ts`, migration `0120_slopbot_value_attempt_completion.sql`, existing notification and value-pipeline tests |
| Inbox storage and identity admission | `api_inbox`, `inbox_queries`, `inbox_mark_read`, `api_identity_admission`, `identity_rate_gate` | `backend/notifications/handler.ts`, `workers/identity/rate-limit.ts`, existing migrated notification workflows; direct rate-counter/gate execution evidence remains missing |
| Scheduled identity cleanup and intake renewal | `identity_intake_renewal`, `identity_scheduled_maintenance` | `workers/identity/index.ts`, `workers/identity/persistence.ts`, `scripts/identity-maintenance.test.ts`; token-fallback and outer scheduled-handler execution evidence remains incomplete |
| GitHub identity exchange and callback completion | `github_identity_exchange`, `identity_callback_completion` | `workers/identity/index.ts`, `workers/identity/handler.ts`, `workers/identity/persistence.ts`; `workers/identity/failed-callback.test.ts` and `workers/identity/expiry-boundary.test.ts` use an injected resolver and do not exercise real provider exchange |
| Polling, assertion storage and one-time consumption | `identity_assertion_lifecycle`, `ui_identity_poll_protocol` | `workers/identity/handler.ts`, `workers/identity/persistence.ts`, `src/lib/identity-flow.ts`, `workers/identity/expiry-boundary.test.ts`, existing login and account-closure browser workflows |
| Local identity handoff | `dev_identity_bridge` | `scripts/dev-identity-bridge.ts`, `scripts/dev-identity-bridge.test.ts`; remote and local persistence are separate authorities |
| Service-binding identity and contributor-token exchange | `identity_consumer_exchange` | `backend/identity-assertion.ts`, `backend/points/handler.ts`, `backend/trace/handler.ts`, `backend/trace/auth.ts`, existing publication and account-closure workflows |
| Trace token validation and request admission | `trace_bearer_tokens`, `trace_route_authorization` | `backend/trace/auth.ts`, `backend/trace/handler.ts`, `scripts/trace-upload-attachable.test.ts`, the binding-recovery path in `backend/security/payments.integration.ts` |
| Trace creation, progress events and finalization | `trace_run_creation`, `trace_event_finalization` | `backend/trace/cloudflare-persistence.ts`, `backend/trace/handler.ts`, `scripts/trace-upload-attachable.test.ts`, `scripts/project-self-service.test.ts` |
| Wallet-claim publication and possession evidence | `wallet_claim_publication`, `wallet_possession_completion` | `backend/trace/handler.ts`, `backend/trace/cloudflare-persistence.ts`, `src/lib/wallet-possession.ts`, `scripts/wallet-legacy-claim-confirm.test.ts`, `scripts/wallet-possession.test.ts` |
| Payment-wallet registration and activation | `payment_wallet_registration`, `payment_wallet_activation`, `api_payment_wallet_protocol` | `backend/payments/wallet-registration.ts`, `backend/payments/handler.ts`, `scripts/wallet-legacy-claim-confirm.test.ts`, `backend/payments/wallet-replacement.test.ts` |
| EVM binding consent and broadcast authority | `evm_binding_consent_api`, `binding_consent_renewal`, `stored_binding_broadcast_authority` | `backend/payments/handler.ts`, `backend/payments/possession.ts`, `workers/payment-executor/core.ts`, `backend/payments/evm.integration.ts`, `workers/payment-executor/binding-nonce-limit.integration.ts` |
| Solana signed journal and binding completion | `solana_executor_journal`, `solana_binding_completion` | `workers/payment-executor/solana.ts`, `contracts/solana/transactions.ts`, `contracts/solana/integration/executor.e2e.mjs` |
| Payout consent UI and Solana account API | `ui_payout_consent_lifetime`, `ui_payout_consent`, `solana_binding_api` | `src/PayoutConsent.tsx`, `src/Earnings.tsx`, `backend/payments/handler.ts`, `tests/e2e/payout-consent.spec.ts`, `contracts/solana/integration/executor.e2e.mjs` |
| Wallet-provider calls and mutable signing bytes | `evm_wallet_discovery`, `solana_wallet_provider`, `solana_binding_wire`, `solana_message_buffers` | `src/lib/use-payout-wallets.ts`, `src/lib/payout-consent.ts`, `src/PayoutConsent.tsx`, `tests/e2e/payout-wallet-picker.spec.ts`, `tests/e2e/payout-consent.spec.ts` |
| Expired Solana payment history | `ui_solana_history_recovery`, `solana_history_retirement`, `direct_solana_retirement` | `src/SolanaBountyRecovery.tsx`, `backend/security/direct-solana-recovery.ts`, `tests/e2e/solana-history-recovery.spec.ts`, `formal/tests/direct-solana-retirement.test.ts` |
| Public payment history and received totals | `payment_history`, `received_totals` | `backend/payments/public-records.ts`, `src/lib/use-vault-payments.ts`, `backend/payments/public-records.test.ts` |
| Generated project skill publication | `project_skill_publication` | `backend/projects/skill-publication.ts`, `src/lib/project-skill-publication.mjs`, `scripts/project-registry-api.test.ts` |
| Retained value-dispute evidence and triage | `bot_value_dispute_binding`, `bot_value_dispute_read`, `bot_value_dispute_actor`, `bot_value_dispute_draft` | `workers/slopbot/value-disputes.ts`, `workers/slopbot/penalty-appeal.test.ts` |
| Archive filters, clocks and historical detail | `ui_cycle_archive`, `ui_cycle_publication`, `ui_record_deadlines` | `src/CyclePages.tsx`, `src/App.tsx`, `tests/e2e/site.spec.ts`, `tests/e2e/ui-clock-transitions.spec.ts` |
| Setup status and activation | `api_project_setup_check`, `ui_setup_check_lifetime` | `backend/projects/setup.ts`, `backend/projects/handler.ts`, `scripts/project-self-service.test.ts`, `tests/e2e/project-access-retry.spec.ts`, `tests/e2e/project-setup-resume.spec.ts` |
| Private submission claim ownership | `api_submission_recovery`, `api_private_intake` | `backend/security/submissions.ts`, `backend/security/submissions.test.ts` |
| Retained-copy binding and historical import | `retained_copy_bindings`, `historical_subscription_intake` | `workers/slopbot/value-retained-copy.ts`, `workers/slopbot/value-import.ts`, existing promotion and publication-fence workflows |
| Owner vault infrastructure selection | `vault_setup_resolution`, `vault_creation` | `backend/projects/vault-setup.ts`, existing EVM/Solana vault setup workflows |
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

Trace token validation separates secret configuration, bearer shape, decoding,
HMAC verification, JSON and claim checks, time admission and role filtering.
The verifier permits the existing 30-second skew and applies the 300-second
operator lifetime or 600-second ordinary lifetime before removing an unlisted
operator role. A remaining contributor or project-owner role can still be
accepted. The signer validates structure without granting route admission or
performing the verifier's time and allowlist checks. The
[Web Cryptography HMAC contract](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#hmac-operations)
defines the underlying signature operations; the model assumes their
authenticity and does not prove their implementation.

The dispatcher model preserves route lookup and authority checks before bearer
verification. Public, identity and capability routes keep their own downstream
checks. Wallet-binding recovery accepts the separate same-origin session path
only when the Authorization header is absent; an empty header is still present.
Session and allowlist observations create only a request-local operator role.
Admission does not prove the delegated operation succeeds, and an observation
does not imply continuous knowledge of current global policy. Both new models
are source-only and unexecuted.

Trace creation models two actors, keys, payloads and request slots, with one
retry per slot. An actor/key collision returns the existing run only when the
declared payload matches. Generated IDs, the caller's current login and request
time do not replace stored creation metadata. New insertion checks the ban in
the statement; a previously admitted existing-row read can finish after a
later ban. Readback can observe a run advanced by upload or finalization.

The event/finalization model starts with one owned run and two request slots.
An event insert checks current finalization and ban state. A concurrent
same-key loser returns conflict under the current implementation; a later
admitted matching retry returns the existing event. Finalization requires a
trace and preserves the first committed timestamp, including on retries. Its
idempotency header is validated but is not a stored comparison key. Missing
and foreign runs both return 404. Statement commits remain distinct from
metadata, readback and response delivery. Existing workflows cover selected
creation, ban and finalization paths; concurrent event and partial-reply
conformance remains incomplete. The new models are unexecuted here.

Wallet publication distinguishes the current unsuperseded claim from a returned
historical digest match. A backdated successor can still be the current leaf.
Actor and chain separate each lineage. Contributor predecessor checks precede
the registry same-address/login no-op; the payment registration adapter has a
separate no-op rule. New claims, audits and wallet-change notices share a batch.
Retries can recover a committed claim after missing metadata or a lost reply.
The claim model bounds two actors, four chain labels, two request slots with
one retry each, and six retained rows.

Possession remains additive evidence for an immutable claim. A successor keeps
the older claim's evidence. Challenge consumption precedes signature, binding
and exact issued-window validation, so invalid submissions can burn a challenge
without creating evidence. Two valid challenges for one claim can be consumed,
but the attestation and audit batch preserves one record. The possession model
bounds two claims, challenges and submission slots with clock ranks 0–5. It
does not authorize payment or assert continued key possession. The PRD now
names the retired `protocol/wallet-possession.md` document precisely, preserving
the runtime and callers that the recorded owner decision kept. These models
remain unexecuted. A valid inactive map index also replaces the creation model's
out-of-domain sentinel; that source-only correction has not been parsed here.

Payment registration now refuses a same-address historical claim that wins a
concurrent append. That record cannot pass the registry-only challenge query.
The previous conflict-recovery branch returned it as success. A retry can now
append the required registry successor. The new regression interleaves the
real payment and authorized historical-claim handlers against migrated SQLite,
then follows the retry through challenge and authorization; it has not run here.
The registration model preserves the distinct login-insensitive payment no-op,
the current-tip reread, and the prior condition as a negative control outside
the permitted transitions.

The activation model starts after the existing protocol model's signature and
one-time challenge checks. It separates authorization/outbox commit from reply
and effective-wallet readback. Only matching reserved obligations with absent
or held outbox rows become ready. Processing, submitted and paid rows remain
unchanged. An unsigned successor leaves a prior authorized wallet effective;
an authorized successor changes future readback without erasing history. The
model has two claims, two requests and two obligations; it does not send or
mark a payment paid. All new scenarios remain unexecuted.

The EVM binding API model separates stored consent from an executed binding.
It covers two requests, two successive effective claims, two deployments and
versions 0/1, with exact representatives for the 600-second submission margin,
90-day lifetime and one-hour slack. A challenge may discover the version;
authorization requires an explicit version. Same-key retries preserve the
first signature, while renewal appends a new expiry. Missing or invalid
readback cannot report authorization. Each request retains its captured time
and claim even if a later read would find them expired or replaced.

Typed signatures bind the chain, vault and payload. [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
does not itself provide replay protection; the application and contract also
check the expected version. The verifier and contract explicitly enforce
canonical low-S signatures. [EIP-2](https://eips.ethereum.org/EIPS/eip-2)
does not impose that restriction on the `ecrecover` precompile.

Stored-binding broadcasts now recheck authority after the retained nonce-budget
read. Previously, an authorized successor could replace the effective wallet
during that await and the old binding would still be offered to the node. The
new regression interleaves that read with a signed successor in the existing
migrated SQLite and Anvil workflow. It requires refusal while preserving the
signed bytes, budget and pending entry. The callback validates the actual
candidate bytes on every shared send path. A fee-wait fallback can suppress
transport uncertainty, but cannot suppress a failed authority check. Hosted
binding runs do not enable keeper fee replacement. This change closes the
identified ordering gap; the registry read and network send are not an atomic
transaction, and it does not guarantee unchanged authority at chain inclusion.
These models and the new regression have not been executed in this lane.

Solana binding completion and reuse now repeat the current-wallet check after
the final signature-status read, immediately before an actual send. The earlier
check could become stale while that RPC awaited. The existing executor workflow
now includes both completion and prepare-retry races with signed successor
claims, retaining the completed bytes while refusing submission. Its fixture
savepoints isolate the temporary successors from the later payment flow.

The journal model bounds two requests, one role/key, three expiry-height classes
and finalized height 0–6. It distinguishes retained bytes from replies, exact
expiry from strict expiry, overlapping quotes and admission, and archiving the
current co-signed row. A finalized failed keeper transaction has a separate
replacement path; attester and relayer failures require reconciliation. The
completion model bounds two calls and two generations. It preserves exact
message and authority bytes, first committed wallet signature, stale-generation
refusal, observed-signature recovery and independent clock/height expiry.

[Solana's RPC documentation](https://solana.com/docs/rpc/http/sendtransaction)
distinguishes an accepted send from confirmation. The models preserve that
distinction, use the [status history lookup](https://solana.com/docs/rpc/http/getsignaturestatuses),
and represent the [last valid block height](https://solana.com/docs/rpc/http/getlatestblockhash)
separately from wall-clock submission expiry. Neither model proves provider
truth, global journal-history retention, cryptographic correctness, or atomic
authority across D1 and chain submission. The models and new regression cases
remain unexecuted here.

Payout consent now owns each asynchronous operation for its committed account,
claim and payment context. Leaving the view, changing that context or explicit
sign-out invalidates its continuations. Fresh session reads precede wallet
prompts, API writes and success feedback; writes also carry the expected actor.
An observed account change clears the private payout view and aborts its pending
account refresh so an older read cannot restore it. Already admitted server
effects remain separate from local cancellation. The browser regressions hold
a connection across navigation and a signature across an account change.
They have not been run, and updated browser, accessibility and video evidence
for this UI change remains outstanding under the current skip-checks direction.

Earnings wallet steps now repeat the operation-ownership check in the caller
after each awaited account helper. A helper's successful result does not keep
an operation current across a later promise continuation; the
[ECMAScript Await operation](https://tc39.es/ecma262/2026/multipage/control-abstraction-objects.html#await)
resumes the caller through a separate promise reaction. Every account-clear
path also aborts the current account read, including access loss found by a
wallet step. Layout cleanup retires both the wallet operation and its account
read when the view unmounts. A previously captured successful session response
cannot restore the cleared account through that read. An ordinary successful
account switch can still publish its newly validated value in the same
synchronous callback.
The actor-binding model separates session observation, helper return and caller
effects, and separates a read's final observation from its publication. The
new scenarios and corresponding browser definitions remain unexecuted.

The lifetime model bounds two operations, two review contexts and actors, and
one concurrent parent read. It treats prepared-message and signature checks as
predicates. The Solana API model bounds two requests, two claim/attempt snapshots
and ordinary/private ledger scopes. It preserves ordinary lookup precedence,
reporter ownership and audit-before-private-read, captured context, opaque late
worker effects and current response-envelope rules. It does not strengthen the
trusted worker's string checks or turn a missing context dependency into a new
API refusal. Both models are source-only and unexecuted.

[React documents effect cleanup across changed dependencies and unmount](https://react.dev/reference/react/useEffect).
The consent controller uses [layout-effect cleanup](https://react.dev/reference/react/useLayoutEffect)
at the committed-context boundary, before a stale dialog can remain visible
through a paint. These lifecycle controls do not cancel an external wallet's
already displayed prompt or prove continuous session authority between reads.

Wallet discovery now rechecks EVM provider conflicts after the connection
promise returns. Solana text consent uses the same current-wallet checks as
byte-message signing, including a fresh legacy-wallet address observation.
Previously the text wrapper bypassed those checks. The browser fixture now
publishes its connected Wallet Standard account and tests withdrawal before
the consent prompt, rather than relying on that bypass.

Signing keeps private copies of the reviewed Solana transaction, the returned
transaction, and message/signature buffers. A wallet can sign in place or retain
its buffers without changing the bytes checked or later submitted by the page.
The message helper compares echoed bytes against a private original, not against
the mutable array passed to the provider. The transaction regression mutates
the returned array during the later session check; another fixture changes and
echoes its message input. These cases remain unexecuted.

The provider models bound two UUIDs and three EVM providers, one connection and
two subsequent calls; Solana uses one connection and two calls across two
account/chain representatives. The wire model uses one signing call and two
valid message identities. These are predicate abstractions of validation and
buffer ownership, not cryptographic proofs. Wallet requests already started
can finish after provider withdrawal. A returned signature or transaction ID
is not proof of finality, and the legacy interface has no signed-message echo.

[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) specifies provider discovery;
its self-reported names and domains do not authenticate a wallet. The
[EIP-1193 request contract](https://eips.ethereum.org/EIPS/eip-1193) defines
asynchronous results and refusals. The reviewed, lockfile-pinned Wallet Standard
interfaces expose mutable byte arrays, so the models distinguish provider-owned
arrays from the application's snapshots. Browser and UI video evidence for
these changes is still outstanding under the skip-checks instruction.

Solana history recovery now verifies both fresh and cached signatures against
the original payer and exact retained message before using them. A malformed
or invalid cached signature is a cache miss; a new invalid signature is never
saved. Valid cached proofs remain available after a failed history lookup.
The prior length-only acceptance could retain an invalid signature and reuse
it on every retry. The browser fixture now signs coherent messages with a
public deterministic test key instead of supplying arbitrary 64-byte arrays.

Recovery actions also own the case, revision, generation, payer and message
context. Closing the child or changing that context stops further prompts,
cache writes and verification requests, even if the parent remains mounted.
The action runner is local because the shared busy/error helper has no such
ownership contract. Callers recheck ownership after asynchronous authority
checks, including the payout-consent caller. Already submitted requests remain
separate effects; closing a view cannot roll them back.

The parent's fresh recovery read also compares the case revision, even when
the generation and messages are unchanged. A newer revision replaces the
displayed case and retires the old action before another prompt or POST. A
later attempt can reuse valid cached proofs with the new revision. A revision
change after this preflight remains subject to the backend's exact-revision
refusal; the preflight and database write are not one atomic operation.

The retirement model separates input/signature refusal, withheld challenges,
provider disagreement, found transactions, incomplete history and completed
retirement proof. It bounds two retained messages and two providers while
preserving the implementation's separate 64-message input limit. No new backend
acceptance policy was added. Solana's [transaction signatures](https://solana.com/docs/core/transactions)
and [signature-status lookup](https://solana.com/docs/rpc/http/getsignaturestatuses)
explain the distinction between a valid message signature and evidence of a
landed payment. The new scenarios and browser regressions remain unexecuted;
neither these models nor local signature verification prove provider history.

Public payment history now separates the boundary, count and page queries.
The rowid boundary excludes later appends but does not freeze membership
visibility or a later monthly attribution. The client rejects changed totals,
duplicates and incomplete collections before publishing. Direct disclosed
transfers intentionally have different membership rules from vault receipts.
The received-total model captures each table's boundary separately and keeps
the 20,000-row limit per table. It validates vault evidence before excluding
testnet rows, keeps other assets out of the reference-USD sum, and distinguishes
a failed build from an empty result and a later cache hit. Fixed valid prefixes
represent the large-count boundary; they do not prove every large dataset.

Generated skill publication models captured project and restriction reads,
template and file hashes, both rendered roles, and final path selection. A
failure in the second role does not expose the first role as a completed
package. Normal permanent admission is separate from reinstatement's pin
checks. The aggregate template digest and renderer coherence remain trusted
build inputs. A completed request can reflect an earlier captured revision;
the model does not claim atomicity with later D1 or deployment changes. Terms,
discovery filtering, unverified clearance, thrown dependency failures and
GET/HEAD behavior retain their separate source outcomes. These new models
and their named scenarios have not been executed.

Value disputes distinguish the current assessment lookup from a retained
digest-bound appeal. A joint successor takes precedence during current lookup;
an invalid joint record cannot silently fall back to an older single record.
Later corrections do not retarget a bound appeal. Eligibility separates joint
implementation claims, retained reviewed sources and current-head commit
authors. Triage records provider calls before returning its result; failed
usage writes can leave a durable prefix or a committed row with a lost reply.
The model keeps those outcomes separate from a returned draft. Missing source,
changed head/base and partial joint evidence cap confidence at 0.89. A draft
does not change scores, payments, penalties or pull requests. Existing worker
tests use synthetic providers and do not supply live-provider acceptance.

GitHub's [PR commits endpoint](https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request)
returns at most 250 commits. The dispute eligibility path now reuses the
existing complete-range reader for every commit-author lookup, including short
lists that could change after their metadata was read. It checks the current
PR identity and head before collecting authors and
requires the comparison to reconcile the full count and observed commit IDs.
Incomplete evidence remains an error that can retry, rather than an unaffected
actor result. The authored worker regressions include an author whose only
commit is number 251; they have not run.

The cycle archive now normalizes unavailable URL filters against the current
published options and schedules the next review or staleness deadline. A
validated historical record can open without a live leaderboard. Historical
project lookup is limited to cycle routes; retired records link back to the
filtered archive. An unavailable index cannot silently substitute a live
allocation, and a newly published record discovered during a permitted live
fallback takes precedence over recomputation. The archive model bounds two
projects/records, two index generations, one snapshot bundle and four clock
positions. Browser regression definitions cover these transitions but remain
unexecuted. The separate risk-flag component is unmounted; its local model does
not establish an available UI flow.

The archive model preserves its pending boundary on same-route navigation.
`useRoute` keeps the archive component mounted, and `useTimeBoundary` cleans up
only when its timestamp changes or the component unmounts. The earlier model
cleared the timer without a render on `openArchive`, an impossible source
transition that violated `deadlineDeliveryProperty`. The two same-archive
navigation scenarios retain the timer before and after its deadline. The
temporal property, fairness assumption and concrete browser code are unchanged.

Setup status preserves a successful installation observation when the
repository or steward identity is known to mismatch. That result asks for
maintainer action rather than reporting an installation outage. Write routes
retain their existing 422 refusal. Unexpected provider failures remain retry
states. The setup panel retires request ownership during layout cleanup, before
an old preflight can send a new request after committed departure. Its server
model separates access, identity, scan, queue and activation observations, with
one check, two revisions and a concurrent restriction. It does not turn those
observations into an atomic provider snapshot or require funding for activation.

A submission transition returns only the exact next revision and state it
committed. A newer row observed after the batch cannot become an older sender's
claim. The [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
covers the SQL transaction; a later read and provider POST are separate effects.
The recovery model retains two sender slots, two attempts/copies and twelve
revisions. A lost reply or absent changes metadata does not erase a committed
row, event or external copy. An observed empty listing is not proof that no
copy will arrive later. Existing route-level regression definitions now delay
the claim readback across uncertain, reconciled and replacement-claim states;
they remain unexecuted. No exactly-once external delivery is claimed.

Retained-copy binding separates same-author reopening from an authenticated
acceptance comment, and exact edits from manifest or ancestor-hunk matches.
Multiple candidates and competing originals can return a partial map together
with limitations; that is not permission to publish. The import model keeps
HTTP admission, source collection, optional reconstruction, refreshed source
and registry checks, and journal insertion separate. Joint source, claim and
predecessor indexes commit atomically with their record. A later lost receipt
does not undo that commit; a retry can return the first stored result. These
models bound two originals/candidates and two import requests respectively.
Existing tests cover selected promotion and publication boundaries; direct
HTTP-to-RPC import conformance remains missing.

Vault registration now checks the exact creation transaction while selecting
each reviewed factory or program. A valid first candidate that did not create
the transaction cannot hide a matching later candidate. Candidate mismatch
continues the search; an unavailable RPC remains a 503, a matching failed
transaction remains a 422, and a pending transaction remains pending. If no
candidate matches, the first transaction-verification error is retained. The
resolution model covers both rails, two candidates and one captured wallet
claim. Registry attachment, continuous wallet authority and chain truth remain
separate boundaries. The EVM and Solana API/adapter regression definitions are
unexecuted.

Project lookup now has separate models for its authenticated routes and cache,
actor resolution, owned-repository pagination, and repository/branch/license
reads. Cache hits still require a current site session; owned lists use the
captured actor ID as their cache key. A returned list is discovery data, not
proof of present repository authority. Failed pages never publish a partial
list. Unknown license facts stay distinct from a failed repository lookup,
and strict branch-head reads never guess a commit. The models represent two
actors, two repositories and representative first/final page classes rather
than every provider record or real clock.

Repository lookup now binds branch and license-object reads to the captured
global node ID using GitHub's documented [direct node lookup](https://docs.github.com/en/graphql/guides/using-global-node-ids).
Every page must return the same numeric and node identity and public visibility.
Repeated or missing cursors, partial GraphQL errors and incomplete branches
refuse the lookup. Separate pages can still observe changing branch heads;
identity binding does not make GitHub reads an atomic snapshot.
Repository-fact cache entries use a new namespace, so a pre-change named-read
result cannot bypass the new lookup checks after deployment. Owned-repository
list cache keys remain tied to the authenticated actor.

License verification keeps the exact commit and byte contract. The captured
repository node supplies the root LICENSE blob OID at the observed commit;
the REST license response must name that blob, and its decoded bytes must hash
to the same Git object. A changed name cannot supply unrelated license bytes.
Only then are the existing SPDX classification and SHA-256 published. Failure
in this optional stage leaves the license unknown; it does not fabricate one.
These source changes and their regression definitions remain unexecuted.

Repository authority reads now request an installation token scoped to the
expected immutable repository ID, with metadata read permission only. A name
reused by another repository in the same installation cannot supply its
collaborator permission through that token. GitHub documents both
[token repository and permission limits](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app)
and the [metadata permission for collaborator reads](https://docs.github.com/en/rest/collaborators/collaborators?apiVersion=2022-11-28#get-repository-permissions-for-a-user).
These are provider assumptions; the authored internal-route regression does
not establish live enforcement. Public lookup and vetting reads use the
separate public-only read token required by the PRD. The installation-token
public-content relay and its internal route have been removed. A configured
token's actual scope remains a deployment boundary; its name does not prove
that it lacks private access. No read failure upgrades to installation access.

Saved-payment verification passes its child action owner through the parent's
private reads and the final POST preflight. Closing or replacing the child
retires that owner during layout cleanup, before any later continuation can
rewrite the candidate cache or start verification. Solana history recovery
uses the same parent gate. A request already sent remains a backend operation;
view departure prevents later work and publication, not its committed effects.

The evidence reader now retires its active attempt in layout cleanup and checks
that ownership after each awaited identity helper. A departed object cannot
start a grant, body read or download, or replace a newer error/busy state.
Native and buffered download regression definitions hold the final session
response until the object's committed removal. A native click still means
only that a download was requested; it does not prove saved bytes.

Buffered evidence delivery rechecks the current run and operator after storage
and the final read audit, immediately before constructing the body response.
Revoked sessions and expired retention refuse delivery while the consumed grant
and durable audit rows remain. Native streaming checks each part separately;
cancellation prevents later enqueue without claiming that an in-flight bounded
R2 read was aborted. Neither path provides continuous authority after dispatch.

Verified part reads own the R2 body before inspecting its metadata. Every later
failure attempts cancellation and releases the reader; a cleanup rejection
preserves the original read or integrity error. Only complete, length-checked
and digest-checked parts feed the ordered whole-file hash. Releasing a reader
does not prove that a failed underlying cancellation closed its source. The
model bounds one part or two ordered parts; hash and storage contracts remain
assumptions, and actual workflow regression definitions are unexecuted.

Native download responses no longer change the grant cookie, so a delayed old
response cannot clear a newer same-object grant. [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.1)
describes the concurrent-response cookie race. The cookie keeps its original
15-minute maximum lifetime or is replaced by a new grant; D1 consumption,
actor/object binding and expiry still refuse replay. The browser regression
keeps the exact saved-byte check and separately expects replay refusal.

Project creation and revision editors now retire publication ownership in
layout cleanup. A session preflight that completes after committed departure
cannot start a write for the departed form. The publication model separates
session observation, helper return and caller consumption, including successful
and failed responses. The server's expected-actor check remains necessary
because a browser cookie may change after its earlier observation. The two
authored browser regressions hold a parsed session response until DOM removal;
they have not run.

Private authorization now keeps a callback from deleting a newer flow cookie.
The encrypted flow retains its original ten-minute expiry; state, PKCE, account
and grant binding remain required. One-use provider codes are an external OAuth
assumption. The model separates request capture, exchange, identity, encryption
and response delivery across two flows. A later successful callback can still
replace the shared grant cookie, so another report may need authorization again.
The route regression definitions include stale callbacks, overlapping success
and failure, consumed codes and expiry. They have not run.

Renewing authorization for an in-progress, uncertain or submitted report no
longer requires approval or R2 content for a new forward. The route first
settles its current state and refuses a completed or abandoned submission.
The send route still checks the current saved report and forwarding approval
before a new attempt. This preserves reconciliation when a human requests
more information after a send or when the saved body is unavailable.
The wrapper model bounds two requests, actors and request keys, one optional
retained row and two fresh candidate IDs. It separates idempotent replay from
a concurrent same-key insert, enforces the ban guard at insertion, and retains
a committed draft after a lost readback, flow or response. Four migrated-route
regression definitions cover uncertain and submitted reports across human
holds and storage outages. They remain unexecuted.

Receipt verification models direct reports and Slop submissions separately.
Missing routing contacts records a submission event without creating an
ownerless case. Legacy case creation commits its dependent rows together;
durable intake links the existing case. Concurrent verification can return the
same receipt, but an unrelated advisory case remains private. Pre-commit failure
and a lost response after commit have different recovery states. This model
bounds two requests, five revisions and one competing case. Parsed provider
facts, authorization, SQL atomicity and live GitHub behavior remain assumptions
or separate conformance boundaries.

The owner-vault API model separates access observations, immutable policy
history, chain evidence and revision publication across two requests and three
project revisions. Existing transaction replay precedes expected-revision and
chain validation. A stale registration may use a compatible old creation policy;
a stale review cannot. Publication retains the captured current policy and
checks its revision and enforcement generation. A committed vault survives a
lost response. Neither the model nor a prior access read provides a continuous
GitHub or wallet lock. These models and scenarios remain unexecuted.

Contributor lock publication and evidence publication distinguish committed
state from cleanup failure. Failed compensation retains recovery inputs.
These operations do not provide crash-atomic multi-path publication or proof
against every unrelated filesystem writer. Evidence TLS success requires an
observed socket close; the probe deadline is not a deadline for DNS or the
whole recorder. Direct-child cleanup is not process-tree containment. Backup
objects, readback verification, completion records and queue acknowledgment
remain separate states.

Admin revision, delisting and enforcement forms retire request ownership
during layout cleanup. The admin mutation model has 20 scenarios over two
actors, requests and lifetimes, with three draft values. The clearance reader
uses a layout generation fence while its request and status updates stay in
the passive effect. Its departed continuation cannot start a private read or
invalidate the replacement view's session. Four additional browser regression
definitions cover these preflight-at-removal cases. They have not run.

Admin vetting forms also retire request ownership during layout cleanup.
A session preflight that returns after committed departure cannot start a scan,
an exemption write or a parent refresh. The request model has 32 scenarios over
two reads, actors and parent lifetimes, and one mutation. It separates session
observation, helper return and caller use, and keeps historical passive-cleanup
failures outside the corrected transition relation. Two browser regression
definitions hold preflight through DOM removal. They have not run.

Evidence registration preserves canonical manifest identity and commits the
run, its object references and the registration audit in one D1 batch. Its 29
scenarios bound two requests with one retry each, two run IDs, two canonical
manifests, two objects and three parts. Readback can recover a committed request
after a lost reply. Stored-part hints can become stale and do not prove a whole
file or completion. The inventory model has 20 scenarios over one request and
retry, one run, two objects and clock values 0 through 2. Inventory now checks
the same operator again after its list audit. Per-object observations can
straddle expiry; the result is not an atomic storage snapshot. A route regression
definition revokes the real session while the committed list audit reply waits.

Migration 0119 binds new evidence rows to immutable physical generations.
Registration reserves or selects the active generation in the same batch as
the run, objects and audit. Replaying a run preserves its original generation;
it cannot borrow a later generation's bytes. Legacy rows keep their recorded
locations and remain distinct from new generated storage.

`vetting_generation_storage` has 32 authored scenarios over two callers, two
generations, two exact part descriptors per generation and four physical
targets. Every generated write reserves its immutable target before R2 I/O.
Initial upload and corruption repair are both create-only. A repair writes a
fresh candidate and compares the complete descriptor and previous pointer
before publishing. Losing or uncertain publication rereads and verifies the
current winner. Unpublished and failed candidates remain in the inventory.
The model separates database commit/reply, conditional PUT settlement, current
pointer observations and the final active-generation check. These observations
are not atomic response delivery or continuous authorization.

The collector freezes the generation before traversing every reserved target,
including earlier layouts and repair candidates. Backed bytes are replaced by
permanent non-evidence markers. Missing targets first compete with a create-only
marker: a late body that wins must be backed before replacement. This preserves
backup ordering as well as blocking writes that finish after retirement.
Supplemental backup receipts bind newly observed targets to the completed
snapshot. Ordinary readers refuse markers, including for empty originals.
The reader model now has 22 scenarios covering ownership, marker refusal,
primary errors and cancellation. Its bounds remain one part or two ordered
parts with zero/two byte units and bounded fragments.
The separate observed-body model has 18 scenarios over one body with zero/two
byte units, invalid size classes and an overflowing third unit. The retirement
model has 28 scenarios over two references, two declared slots, three reserved
targets, two retries and one successor-generation target. It distinguishes
backed, changed and missing data and retains the historical unsafe-marker trace
outside the current transition relation.

Legacy same-key repair remains conditional on its observed ETag, and missing
copies retry create-only. The 27-scenario upload model covers those legacy
rows; ETags can repeat and are never unique generation identifiers. The old
physical DELETE counterexamples are retained as historical negative models.
The new collector holds legacy storage instead of using a claim or absent
HEAD as proof that an earlier writer has stopped. Old receipts are not upgraded
to the new guarantee. Legacy writer quiescence and migration recovery remain
separate operational acceptance work.

Storage generations change no retention duration or permanent-admission policy.
Backups bind the bytes actually observed, including changed raw content.
Changed content remains distinct from a valid declared part and cannot satisfy
a complete per-run evidence deletion receipt. Unreadable storage, ambiguous
outcomes and missing declared slots remain explicit. A complete generation retirement is distinct from a
complete per-run backup/deletion receipt. The new D1/R2/API workflow is wired
into the integration runner, but it and the authored route regressions have
not run. No new model has been parsed, simulated or verified in this lane.

This branch includes the changes from merged PR
[#2432](https://github.com/SlopDotCash/slopdotcash/pull/2432) through development
commit `ac9da9e7`. Its independently collected results cover their named source
heads, not this later source-only combination. The user instruction to skip
checks remains in force for this lane; application-wide state assurance is
incomplete.

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

Suggested work uses `ui_project_work`: finite counts of 0–12 issues and 0–12 review requests, a ten-item initial view, explicit expansion, and retained expansion during stale refresh. `tests/e2e/project-work.spec.ts` exercises expansion by keyboard at desktop and mobile widths, including long-title reflow at 200% text size.

`ui_setup_check_lifetime` combines two actors, projects, request slots and lifetimes with one Suspense hide/reveal cycle. It retires old responses, restarts an automatic empty check on reveal, and preserves actor/project checks. Parent removal uses the existing departure transition: the management UI unmounts its setup child before the remote removal outcome is known, and delayed setup work cannot restore it. `tests/e2e/project-setup-resume.spec.ts` exercises the held lazy-vault chunk and a pending setup response after removal; `tests/e2e/registry.spec.ts` covers actual Pages/D1 setup, removal and cancellation. A manual check of a supplied initial result is not automatically restarted on reveal; that retained busy state remains an explicit model limitation. These finite abstractions do not establish source refinement.

Private-case selection uses `ui_security_case_selection`: two valid case targets, two actors and two focus returns. Explicit case-list/Open-case events update their URL target; filter and Back clear it. Identity revalidation hides details before a current actor can load the remembered target. A URL supplies no access. Existing `ui_inbox` and `ui_private_case_revisions` own request lifetime and actor checks; the focused model treats an admitted detail reply as current only under those checks. The synthetic focus/clear regression in `private-case-ordering.spec.ts` and the Pages/D1 bounty workflow in `security-bounty.spec.ts` provide implementation evidence. Legacy asynchronous creation callbacks remain local; their retired-instance completions do not mutate browser history.
