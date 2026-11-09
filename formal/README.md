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
