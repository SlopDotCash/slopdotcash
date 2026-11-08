# Automation, vetting and contributor-tool state review

Target: `origin/development` at `e3d7dea64f1171f5761033069b98de4fd5cc1e77`.
This is an in-progress review. Source links identify the abstraction's subject;
they do not prove every function in a linked file refines that abstraction.

| Model | Source obligations reviewed | Bounds and implementation evidence |
| --- | --- | --- |
| `bot_review_lease` | `startReview`, `ownsReviewClaim`, `finishReview`; new/skipped/failed/completed states; expired tokens; immutable provider-cost recording | Three token generations, five clock instants. `workers/slopbot/formal-state.test.ts` replays actual Quint output through production D1 methods and migrated SQLite |
| `bot_value_request` | Durable request claim, lease expiry/takeover, blocked versus transient retry, parked/unparked and terminal outcomes | Two generations, eight instants. Existing `value-retry-backoff.test.ts` checks actual SQL behavior and backoff timing; this abstraction does not prove every queue interleaving |
| `bot_value_budget` | Capped versus alerts-only reservations; no reused attempt; known versus unknown provider charges; conservative outstanding reservations | Two attempts, six-unit cap. Actual provider overcharge is representable and is not incorrectly ruled out by the invariant. Real provider billing remains external evidence |
| `bot_closure_membership` | Closed account versus active membership; retained run history; exact PR and maintainer exclusions | One account/PR. Added real account-close HTTP regression with migrated SQLite; old membership history survives while automatic-closure eligibility is removed |
| `bot_moderation` | Global qualification/consent, member/maintainer/assignment gates, uncertain seven-day hold, confirmed GitHub closure, debit, maintainer reopen/reversal | One immutable PR revision, normalized deadline. Existing maintainer-hold and penalty/appeal workflows test actual handler effects against controlled provider responses. They do not qualify model inference |
| `bot_appeal` | Open, first draft, escalate, human/appellant resolution, immutable resolved state, debit reversal and publication | One appeal. Existing appeal workflows cover durable decisions and publication recovery. Separate funds/Points models cover economic consequences |
| `vetting_disposition` | Acquisition and model-review gaps, independent confirmation, artifact release, clean/incomplete/malicious outcomes, exemption distinct from passed scan | Two reviewer identities. Hash validation, source acquisition, all scanner surfaces and real model quality still require their implementation tests |
| `vetting_flag_reinstatement` | Distinct flaggers, duplicate flags, withdrawal, fresh scan binding, new flag after scan request, ban versus quarantine, exemption versus enforcement | Three reporters, two source revisions. Existing signed vetting/flag workflows exercise actual SQL triggers and handler behavior |
| `vetting_publication` | Prepare/approve/retain, durable reserve before sending, accepted/rejected/unknown response, no blind second POST | One assessment/result. Existing publication-journal workflows exercise signed API and loss recovery. Trust in approved reviewer observations is explicit |
| `vetting_retention` | Shared content references, permanent admission evidence, case-age eligibility, verified backup, durable deletion fence, late reference race | Three references to one object. It abstracts physical deletion safety; it does not model every backup page, cursor, missing-part outcome or interrupted restore |
| `skill_installation` | Immutable source bytes, generated D1 policy binding, arbitrary template commit, monotone ordinary policy update, explicit rollback, lock and atomic activation | Two templates and two policy revisions. Existing installer integration suite exercises real generated scripts/archives. Windows handles and all hostile ZIP cases are implementation obligations |
| `skill_run_local` | Optional usage/trace, local start/finish, immutable replay, server run/event/finalization order | One run. Current policy allows optional evidence; this model does not copy the old checkout's compulsory-upload or live-start authorization rules |

## Confirmed implementation correction

`isMember` previously selected any retained `points_members` row. The account
closure API deactivates membership with `closed_at` instead of deleting history,
so closed accounts remained eligible for Slopbot's member-only automatic closure.
The membership query now requires `closed_at IS NULL`. The regression executes
the actual account-close endpoint, checks closure eligibility afterward, and
confirms both retained history and an unrelated active membership.

## Evidence so far

- Real account-close and closure eligibility regression: passed.
- Quint-generated lease takeover trace through real D1 methods and SQLite: passed.
- Existing retry, closure and maintainer-hold tests plus the bridge: 31 passed.
- Root model types and named scenarios: checked as written; full-suite results
  are captured separately and must be repeated after later model edits.
- Source-wide TypeScript check and dependency audit: passed on this worktree.

## Still required

The source inventory is the authoritative list of pending review paths. Important
remaining groups include full source-lease overlap, valuation/work-unit history
and publication, batched scanner scheduling and evidence acquisition, backup
page chaining and restore, contributor receipt/progress/usage branches, wallet
tools, publication generators and release orchestration. None is implicitly
complete because a neighboring family has a passing model. The remaining
frontend, backend and money groups have separate review records.

## Further reviewed families

- `unsigned_owner_plan`: program/genesis/config identity, legacy layout migration,
  separate role for rotation confirmation, and unsigned output. On-chain
  timelocks, balances and replay checks remain contract obligations.
- `deployment_artifact`: exact source/run/image/bytes admission, atomic program
  file replacement, separate receipt write, local validator lifecycle and
  diagnostic failure that never replaces the failing test exit code.
- `qualification_resources`: protected staging authorization, creation-response
  uncertainty, exact resource ownership, private bindings, and cleanup completion.
- `acceptance_run`: same-source/same-role resumption, test-network refusal,
  durable signed bytes before broadcast, canonical finality before success.
- `evm_upgrade_qualification`: old vault inventory, late vault recovery before
  completion, factory/template order, preserved storage and qualified later
  payments. Two vaults; concrete slot layouts remain implementation evidence.
- `evm_proxy_lifecycle`: instantiated UUPS proxy initialization and authorized
  compatible upgrades. Unused vendor beacon/admin branches are not covered.
- `vetting_backup_chain`: two immutable pages, replay, predecessor checks,
  complete receipt before cleanup, and exact unique-object restore.
- `isolated_execution`: verified artifact, fresh container, enforced restrictions,
  timeout/output-limit completion and descendant/container cleanup. Native
  seccomp and container guarantees remain explicit external assumptions.
- `github_census`: immutable identity/count reconciliation, cursor progress,
  duplicate-source boundaries and complete publication.
- `ingestion_retry`: one complete census retry, retained API cost, atomic output,
  write failure retains the published snapshot. A TLC temporal property checks
  visible termination under fair progress of this bounded machinery.

These are finite abstractions of the listed transitions. A file link does not
certify every function in a large source file. Full hydration, all external
provider behavior and all crash points remain separate review obligations.

## Verification source binding

An actual Quint subprocess regression changed a mapped implementation file
after the typecheck while leaving the model unchanged. The prior runner
reported success and exit status zero. It now records the source hashes with
each stage and checks the original model/source set before finishing. The
same model still passes its scenario; the runner refuses to report the changed
implementation as stable evidence. This is source identity checking, not an
automatic proof that the implementation refines the model.

## Further confirmed correction

GitHub Search and open-reference collection did not detect repeated pagination
cursors. A provider returning the same cursor could trigger repeated requests
without progress. Search's regression failed before the correction by reaching
a third request, and passes afterward by refusing after the second response.
Both collectors now reject repeated cursor identities. Existing complete Search
collection still reconciles the 1,072-record burst; broader source-recovery
tests retain prior published bytes after failures. Fixtures establish handling
of these provider responses, not an observation of a live GitHub outage.
