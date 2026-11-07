# Vetting state refinements

This review covers the API evidence and clearance paths and scanner-library
states under PRD sections 5 and 8. Operational release, backup and sandbox
controller orchestration remain separately reviewed by their owners. Exact
`@source` comments are a source index, not proof that a whole module refines
its finite model.

| Model | Reviewed state boundary | Main abstraction |
| --- | --- | --- |
| `vetting_service_auth` | `signedServiceHeaders`, `signedVettingFetch`, `signedVettingRequest` | Exact method/path/query/body/key signature binding and bounded timestamp admission; signed replay is possible within the window and mutations need their own idempotency |
| `vetting_evidence_upload` | `VettingEvidence.register/upload/uploadChunk/finalize`, `stored/store`, chunk verification | Two ordered chunks, two runs sharing verified content, per-run finalization, repair with verified bytes only |
| `vetting_evidence_access` | Operator authorization, grant, consume, read and native download | Actor/object-bound one-use grant, expiry, attempt/read audits before release; failed read does not restore a grant |
| `vetting_scan_reuse` | `reusableCleanScan`, signed reuse/result endpoints | Original clean scan, same inventory/template/policy/report, post-restriction timing and active-flag coverage; reuse cannot lift a flag-only pause |
| `vetting_result_atomic` | `recordResult`, result-once SQL trigger, artifacts and notifications | One pending result becomes final with its artifacts and required enforcement in one batch; rollback preserves pending |
| `vetting_admission_lineage` | `manifestClearance`, `clearance`, live pin, exemption and automatic template replacement | Normal admission survives routine source changes but not a break in repository identity; explicit later investigation controls; owner grant is identity/steward-bound |
| `vetting_fixed_exemption` | Migration 0075 and clearance lookup | Fixed set of then-present projects, no later enrollment, confirmed malice overrides exemption |
| `vetting_review_batches` | `planReview`, cache read/write, `reviewInventory`, `reviewScan`, aggregate retry accounting | Three batches and synthesis; matching cache input/profile; bounded per-call retry, no success from partial coverage; unknown earlier usage/cost remains unknown |
| `vetting_execution_provenance` | Isolated runner client, evidence parser, inspection, filesystem phases and provenance binding | Bound artifact/interpreter/image, complete phase references, source content/mode identity; successful execution never releases quarantine |
| `vetting_flag_admission` | GitHub standing read, file/expire/withdraw, ban-at-write guard | Two eligible members, immutable account identity, no new flag after ban, expiry does not undo an existing pause |
| `vetting_disposition` (corrected) | `dispositionProblems`, `scanProblems`, result composition | Current v2 clean needs a primary and conditionally a specialist; legacy v1 consistency differs and its clean evidence path currently refuses |

The source evidence graph additionally checks the retained report, source and
final inventories, dependency locks, artifact parents, isolated execution
reports, exact execution items, classifications and rule-policy binding. The
finite upload/access models abstract this graph to valid/invalid predicates;
they are not a cryptographic or schema proof. The existing retention model
covers shared-object deletion fencing, backup and permanent admission evidence.
`backend/vetting/summary.ts` has an explicit stateless rationale because it only
maps supplied facts to safe locations and fixed messages.

## Corrections demonstrated

The old `vetting_disposition` model required two reviewers for every clean
scan. This was a model/source mismatch: current v2 uses one primary and requires
specialist review only for escalated cases. The model now separates v2,
conditional escalation and legacy consistency. The current legacy
`VettingEvidence.complete` returns false, so legacy consistency alone cannot
publish clean admission.

`review-plan.ts` previously treated an earlier retry's missing usage/cost as
zero when the last retry had evidence. A real `reviewInventory` transport
regression returned a known 100-input-token aggregate after an unreadable
503 attempt. The aggregate now stays null unless all attempts have usage/cost.
The full existing review-plan suite passes: 14 tests, 1,382 assertions. This is
an accounting/transport test with synthetic responses, not evidence of model
quality, security classification or real provider completion.

## SQL evolution and limits

- Migration 0025's result-once/quarantine tables map to result atomicity.
- 0034/0035/0036 add immutable evidence manifests, explicit chunk completion
  and assembly linkage; these map to upload/access graph state.
- 0075 captures its fixed exemption set at migration time, and does not turn
  the exempt project into a successful scan.
- 0099 preserves superseded pending assignments while allowing a new current
  pin; 0103 adds immutable explicit replacement provenance. A free-form retry
  reason alone does not confer exemption coverage.
- 0102 adds identity/steward-bound grants and separate immutable revocations.
- The retention/backup and publication-journal SQL retain their existing
  specific models. Empty-schema tests do not prove populated upgrade behavior.

No live scan, provider quality qualification, secret use, storage deletion,
key change, sandbox release, production deployment or activation is claimed.
The finite models do not exhaust the possible bytes, file formats, adversarial
source texts, runtime processes or external failures handled by these modules.

## Qualification wrappers and fixed configuration

`vetting_merge_isolation` reviews the private `MergeVerifier`, its fixed bare-Git
job and local workflow wrapper. Inputs and bundle bytes must bind before fixed
reconstruction; result shape/count must match; `finally` must acknowledge
sandbox destruction before the RPC returns. This does not prove Git or
container isolation internally.

`qualification_fixture` reviews the flags build/queue harness and the backup
access harness. Its synthetic session/evidence effects are scoped to dedicated
qualification stores; a started-but-failed fixture cannot repeat partial
mutations as a fresh run, while cleanup remains available. The access harness
uses the real Pages factory and tests operator/session/expiry/object grants;
its output explicitly does not attest operational policy or live OAuth.
The wrapper's local run uses Workerd/D1/R2 and records zero outbound requests;
this audit did not execute hosted qualification or create/delete resources.

`runtime-static-stateless.json` contains explicit literal-configuration reviews
for the identity, notification, Slopbot, vetting backup and sandbox Wrangler
files. Each rationale names its runtime model and deployment limitation. A
static review of bindings, limits, schedule and disabled/default switches is
not evidence that a deployed Worker has those values.

## Peer model corrections

The cross-review also corrected two pre-existing abstractions. The value
budget model now counts a failed call's known local estimate via the same
`COALESCE(actual, estimate)` rule as SQL, while retaining an unknown receipt's
reservation. The appeal model distinguishes a moderator's escalated command
from a separate verified maintainer reopen. The value-ingestion model cannot
both classify a source unavailable and hydrate it within the same collection.
These corrections change models to match existing code, not application
policy.

Validation of this refinement completed with the repository's 30-second test
timeout: `bun test --timeout 30000 workers/vetting
scripts/vetting-api.test.ts scripts/vetting-exemptions.test.ts
scripts/vetting-queue.test.ts scripts/vetting-publication-journal.test.ts`
passed 177 tests and 2,768 assertions. The initial invocation used Bun's shorter
default timeout and timed out under concurrent verification load; repeating
with the repository timeout passed without test changes. The provider
accounting suite, API configuration-isolation and context-integrity
regressions, populated migration tests, TypeScript and scoped Biome checks
also passed. Quint named scenarios and 1,000 sampled traces of 40 steps per
new model passed; aggregate exhaustive finite TLC checking is run separately.

## Final qualification and recovery review

Seven final families cover the remaining operational boundaries without making
provider calls or changing external state:

- `vetting_malicious_reinstatement`: migration 0031 binds an immutable
  moderator decision to a clean same-revision scan requested strictly after
  each named malicious finding. A later finding remains unreviewed.
- `qualification_response_body`: one bounded response body is read and parsed
  before an exact replacement response is constructed for the SDK. Unknown
  cost is preserved. Overflow/read failure produces no usable replacement.
- `qualification_value_budget`: each value path has at most two requests
  (general review has one); an unknown result keeps the path blocked, even
  if another call might have cost zero. A reported overage is a failure,
  not a clamped amount.
- `qualification_screening_budget`: up to three bounded attempts. Unknown
  transport/receipt outcomes consume a worst-case allowance before an
  eligible retry. Missing receipts, overages, wrong decisions and permanent
  refusals stop the qualification. Its temporal termination property assumes
  continuing event-loop progress and the configured fetch timeout, not a
  successful provider response.
- `operator_appeal_recovery`: the original completed delivery, current author
  and unchanged comment must match, and no structured appeal may exist.
  Dry-run preview sends nothing. One opted-in queue attempt can remain
  ambiguous; this script grants no review authority and the consumer must
  still deduplicate and check current state.
- `operator_intake_renewal`: only a newer authenticated observation replaces
  the health row. A disabled observation is written before the command fails;
  an outage does not refresh old health. The read boundary's 24-hour expiry
  remains independent of the renewal command.
- `operator_staging_secrets`: all required values load before the first
  command, all destinations are fixed staging resources, and a failed or
  ambiguous command leaves partial state. Completion requires all three
  acknowledgments; retry reapplies the same intended set.

`workers/verified-policy.ts` is explicitly classified as pure decision and
arithmetic code. Its caller models retain authority, persistence, source and
result checks. The review did not alter that file or its Lemma annotations.
Existing deterministic release-wrapper tests passed: 19 tests, 125 assertions.
They cover transport and budget failure controls; they do not qualify live
provider/model behavior. All new models have named scenarios and sampled
invariant checks. Aggregate TLC validation remains in the combined runner.


## Download termination interleaving review

`vetting_download_stream` adds the previously unmodeled asynchronous gap
between claiming server completion and committing its audit row. The native
stream formerly awaited `download-finished` before setting its terminal flag.
A cancellation in that interval wrote `download-cancelled` and then allowed
the pending finish write, creating two terminal outcomes for one request.
The new real-handler, local R2 and migrated SQLite regression reproduced two
rows before the correction and exactly one afterward. Completion now claims
the terminal slot before awaiting the audit. Cancellation still closes the
reader, but does not append another terminal outcome after that claim. An
unavailable final audit still errors the stream; it does not produce success.

The finite model covers two verified parts, finish/cancel/failure arbitration,
failed terminal audit, a spent read grant and reader cancellation during a
pending audit. Four named scenarios and 1,000 40-step sampled traces passed.
The new regression plus the existing large-evidence test passed 43 assertions;
the latter includes immutable completion, single-use grants, corrupt/missing
parts, cancellation and rejection when final auditing is unavailable. A server
finish is explicitly not proof that the browser saved the file.

The additional object/registration and asynchronous access compositions below
cover selected simultaneous writers and per-part authorization. Remaining
obligations include backup/restore interacting with in-flight grants and the
complete admission/exemption/investigation lineage across multiple template
revisions.
The existing models and tests cover selected interleavings, not automatic
refinement of every method or live Cloudflare/provider behavior. A terminal
audit can remain pending forever if its storage call never returns; no
unconditional liveness claim is made.


## Session revocation during native evidence I/O

The documented per-part authorization contract was not implemented by the
native stream: it authenticated only when consuming the grant. A real Pages
request consumed a grant, then a real Points signout deleted the session while
a local R2 read waited. The old stream still returned private bytes. The new
implementation resolves the current session and original operator before each
part read and again after R2 I/O, immediately before enqueue. It also reloads
the run's current access state for each part. Revocation, expiry or actor
change errors the stream, preserves the consumed grant, and records failure.
Already delivered bytes cannot be recalled and their history is not rewritten.

`vetting_stream_authority` composes grant consumption, in-flight I/O, actor
identity, session/evidence expiry and delivery for two parts. Five named
scenarios and 1,000 sampled 40-step traces pass. The real signout regression,
large-evidence test and finish/cancel regression pass 52 assertions together.
The test uses the actual Pages session resolver, Points signout and local
Workerd R2, not a fabricated authentication callback.

## Concurrent registration and shared-object lifecycle

Two concurrent `register` requests could both read an absent run. The winning
batch correctly created one immutable manifest, object inventory and audit;
the loser returned 500 for both an identical replay and a changed manifest.
The catch path now rereads a committed winner. It returns replay success for
the same canonical digest and conflict for a different digest. It does not
turn an absent winner or failed transaction into success. The real signed
handler/R2/SQLite race passes both cases, with one run and one registration
audit row in each.

`vetting_object_lifecycle` composes that registration race with three shared
run references, per-run completion, physical corruption/repair, logical
retirement of expired shared references, a durable cleanup claim, verified
backup, physical deletion and a later new reference. Seven scenarios cover
identical and conflicting registration, a live sibling, missing backup,
new-reference fencing and repair after deletion. It assumes non-permanent
exception evidence; permanent admission protection remains in
`vetting_retention`. The model does not claim that one R2 observation and one
D1 transaction form a cross-service atomic operation. Failed I/O may leave a
claim or missing-byte condition that retry must inspect.


## Permanent evidence and backup composition closure

The permanent-admission branch uses the same
`PERMANENT_ADMISSION_EVIDENCE_SQL` predicate for access expiry and physical
retention exclusion. It preserves raw evidence; it does not grant clearance
to a metadata-only historical result. `vetting_retention` covers the permanent
exception, `vetting_object_lifecycle` covers shared-reference cleanup, and
`vetting_backup_chain` covers page/receipt/restore ordering.

The existing full local workflow was rerun with pinned Bun 1.3.14 and Node
24.15.0 using `bun run test:vetting:recovery`. It passed with zero outbound
requests, 74 backed-up objects across three pages, and verified restored bytes.
Its 24 retention fixtures exercised 89/91-day boundaries, permanent admission,
open cases, missing/corrupt backup refusal, an interrupted physical deletion,
retry without changing deletion receipts, and the real scheduled audit prune.
Both snapshot and object restoration passed; disposable fixture buckets ended
empty. The access phase also exercised the real Pages session resolver and
single-use grants.

This closes the specific previously listed permanent-evidence/backup
application-flow review item without adding a duplicate suite. The exact
existing assertions are in `qualifyRetention` in
`workers/vetting-backup/qualification-retention.ts` and the local queue runner
`workers/vetting-backup/qualification-workflow.mjs`; the independent admission
boundary is `admission evidence stays usable after the ordinary 90-day closure
boundary` in `scripts/vetting-scan-flags.test.ts`. Aged fixtures do not prove
actual elapsed retention, live OAuth, deployed bucket policy or operational
qualification. Those remain external acceptance limits, not unmodeled local
transition families.
