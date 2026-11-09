# Reproduced discrepancies

This index lists defects corrected during the current-development review,
including failures reproduced in intermediate review candidates and test
infrastructure. It does not attribute every row to the original development
revision. The area audits identify the source checkpoint, bounds, before/after
evidence and model links.
The tests below use application entry points, real local databases or browser
flows as appropriate. A local provider fixture does not establish live service
availability. The full combined validation remains incomplete; this is not a
claim that all application state errors have been eliminated.

| Boundary | Incorrect transition | Corrected behavior / regression |
| --- | --- | --- |
| Account closure | Retained closed membership still authorized automatic closure; removing all participation also blocked advisory review | Require active membership for closure while retaining recorded participation for advisory routing; `workers/slopbot/closure-eligibility.test.ts` |
| Identity expiry | Delayed OAuth completion or persistence outlived its authorization | Check expiry at completion and persistence; `workers/identity/expiry-boundary.test.ts` |
| Local migrations | Schema commit could survive without its migration marker | Schema, foreign-key check and marker commit together; `scripts/dev-migrations.test.ts` |
| Independent API configuration | Malformed payment configuration broke unrelated account requests | Parse payment configuration at the payment boundary; `scripts/api-config-isolation.test.ts` |
| Bot source context | Review context could use content inconsistent with its claimed Git blob | Verify content before inclusion; `workers/slopbot/value-context-integrity.test.ts` |
| Usage uncertainty | A later known cost erased an earlier unknown cost | Preserve unknown aggregate cost; `workers/vetting/review-plan.test.ts` |
| Publication authority | A pause or quarantine could occur after the last read but before insertion | Check current policy in the insert transaction; `workers/slopbot/value-publication-fence.test.ts` |
| Publication lease | A worker could publish after losing its processing or source lease | Check token and lease at database execution time; `workers/slopbot/value-pipeline.test.ts` |
| Stream completion | Cancellation during a pending completion write recorded two terminal outcomes | Record one terminal outcome; `scripts/vetting-api.test.ts` |
| Stream authority | Sign-out during an object read could still release the bytes | Recheck live session and actor before each part and before enqueue; `scripts/vetting-api.test.ts` |
| Evidence registration | Competing identical registrations could turn a successful write into an internal error | Read back the atomic winner, accepting identity and refusing conflict; `scripts/vetting-api.test.ts` |
| Private report revision | A decision based on an old report could succeed after the report changed | Advance case and report revisions together; `backend/security/report-intake.test.ts` |
| Session response | An incomplete session object was accepted as authenticated | Validate the identity fields; `tests/e2e/ui-state-boundaries.spec.ts` |
| Session return | Admin or owner controls retained an earlier tab's authority | Revalidate on focus, visible return and page restore, fencing older replies; `tests/e2e/ui-session-focus.spec.ts` |
| Passive deadlines | Freshness, wallet registration and award review could remain open without user input | Refresh at the deadline, including a late passive effect; `tests/e2e/ui-state-boundaries.spec.ts` |
| Calendar transitions | Review, recovery and monthly views could retain earlier time labels | Refresh the relevant deadline or UTC calendar boundary; `tests/e2e/ui-clock-transitions.spec.ts` |
| Discarded image | A late bitmap could restore and persist a discarded draft | Invalidate the departed decode and close its bitmap; `tests/e2e/project-save.spec.ts` |
| Published cycle | An unpaid state could display a paid timestamp and settlement file | Refuse the contradictory public record; `tests/e2e/ui-state-boundaries.spec.ts` |
| Payout exclusion identity | Two node-ID encodings for one actor could overlap inconsistently | Compare the validated numeric actor identity; `scripts/project-self-service.test.ts` |
| Token metadata network | A wrong-network Solana RPC could admit mainnet-labeled metadata | Verify genesis before mint metadata; `scripts/project-registry-api.test.ts` |
| Readiness evidence | Empty EVM finality data or invalid Solana slots could look ready | Require the actual finalized shape and safe integer slot; `scripts/payout-readiness-proof.test.ts` |
| Payment successor | A stale failure update reopened a newly submitted successor | Refuse reopening while any active attempt remains; `workers/payments/reconcile.integration.ts` |
| Gas cost parsing | Scientific notation could understate gas and admit an uneconomic quote | Parse supported decimal notation exactly; `workers/fee-converter/fee-converter.test.ts` |
| Fee-wallet handoff | An old wallet's valid conversion could be finalized with zero output | Keep the retained wallet binding and hold incompatible configuration; `workers/fee-converter/native-gas.test.ts` |
| Missing receipt | An advanced nonce alone could permanently fail a successful conversion | Hold until canonical receipt evidence identifies the outcome; `workers/fee-converter/native-gas.test.ts` |
| GitHub pagination | A repeated cursor could spend requests without making progress | Refuse the repeated cursor; `scripts/leaderboard-search-slices.test.ts` |
| Development shutdown | A delayed health failure could spawn a child after server closure | Fence child startup after shutdown; `scripts/dev-backend-lifecycle.test.ts` |
| Main branch CI | An empty PR file list could select only smoke checks on a main push | Require full checks for that release path; `scripts/ci-scope.test.ts` |
| Formal evidence | An unchanged model could pass while its mapped source changed | Bind and recheck source hashes; `scripts/formal-source-binding.test.ts` |
| Historical Points | A later explicit zero could be undone by retained-history recovery | Record the maintainer's zero as an explicit provenance decision; `scripts/points-import.test.ts` |
| Forwarded report | A reporter could erase a maintainer's forward decision by revising a held report | Close that revision window until an authorized request for information; `backend/security/report-intake.test.ts` |
| Payout presentation | Attempt uncertainty hid a held queue and suggested progress without a wallet or owner commitment | Preserve queue precedence and show the required next action; `backend/security/handler.test.ts` |
| Payout hold recovery | A cron pre-step could reopen a hold while an old wallet attempt was still active | Keep the hold until the prior attempt is retired; `backend/security/handler.test.ts` |
| Attempt history | Equal timestamps could select a retired attempt, and a new attempt without a hash could hide an earlier submitted transaction | Use append order to break ties and retain the most recent known transaction; `backend/security/handler.test.ts` |
| Duplicate retirement | A delayed second cancellation reopened a successor's submitted or held outbox | Reopen only when the same atomic batch retired the old attempt; real SQLite and native D1 workflows in `formal/unsigned-retirement-audit.md` |
| Provider-call ownership | A GitHub check or queued ownership read could outlive the worker lease and still start paid inference | Recheck ownership after remote checks and at database execution time; actual consumer/provider traces in `formal/value-precall-audit.md` |
| Queued allocation cutoff | A pre-deadline allocation check could commit a queued edit after the automatic cutoff | Enforce the cutoff in the INSERT using database execution time; real SQLite and native D1 evidence in `formal/monthly-cutoff-audit.md` |
| Feed deadline | A native HTTP body could fulfill after timeout with partial JSON and take the integrity-error path | Retain the request deadline through headers and body classification; 200-request before/after HTTP reproduction in `formal/feed-deadline-audit.md` |
| Verifier network boundary | A localhost client option still started a wildcard gRPC listener | Use the pinned local parser command and TLC without a server; `formal/local-verifier-audit.md` |
| Verifier literal meaning | The upstream fold rewrite could change a string and accept a false invariant | Preserve lexical string/comment boundaries; a real initial-state counterexample is required by the translator regression |
| Verifier child lifetime | Parent-only timeouts could leave Java running | Supervise and stop the owned process group, retain failure and clean its stage directory; `formal/local-verifier-audit.md` |
| Signed Points totals | Accepted large negative adjustments could publish an inexact number | Sum signed buckets exactly and refuse an unsafe final total; `formal/aggregation-audit.md` |
| Close capacity | Concurrent reviews could both pass the daily repository or new-author cap | Reserve capacity in the database before an external close; retain uncertain attempts and release only confirmed refusals; `formal/bot-audit.md` |
| Close recovery | A late close response or failed follow-up could lose completion or let an old worker publish | Retain immutable attempt evidence and require the current review claim for follow-up work; `workers/slopbot/penalty-appeal.test.ts` |
| Reopen circuit breaker | A maintainer reversal could trip the breaker while a close waited for its reservation write | Recheck the same seven-day reversal predicate in the reservation statement; `workers/slopbot/penalty-appeal.test.ts` |
| Project draft ownership | A delayed publication in one tab could erase a newer draft in another | Give each live editor a locked durable slot; clear only its own slot and retain closed-tab recovery; `formal/draft-storage-audit.md` |
| Draft save feedback | An older saved status could describe a newer pending payload, and early wizard steps hid storage failures | Bind acknowledgement to the rendered payload and show backup feedback at every step; `tests/e2e/project-draft-storage.spec.ts` |
| Private-report reflow | Enlarged text made the native action selector overflow a narrow viewport | Let the selector shrink within its label; `formal/private-intake-reflow-audit.md` |
| Private-report navigation | Long report text was not keyboard-scrollable; an intermediate focus fix gave two open regions the same name | Focus the scroll region and bind its name to the individual report headings; `tests/e2e/security-bounty.spec.ts` |
| Email editor composition | A same-account background identity check destroyed a private-session user's email draft | Retain only the actor-bound email subtree while blocking writes; clear it on confirmed identity change or sign-out; `formal/email-editor-audit.md` |
| Report filter reflow | The real paid-flow mobile check found that enlarged filter text widened the page beyond its viewport | Allow the filter label and native selector to shrink; `formal/private-intake-reflow-audit.md` |
| Browser engine preparation | New preview Firefox cases were selected without installing Firefox | Include both engines in the preview plan; `formal/ci-browser-audit.md` |
| Validator cancellation | An intermediate contained launcher could finish cleanup before an outstanding create or ready-receipt write | Await owned mutations and serialize receipt writes; refuse a ready result after cancellation; `formal/solana-container-audit.md` |
| Wallet evidence correction | An unobserved user-entered transaction ID became fixed and could not be corrected after reload | Retain the pending intent while keeping user-entered evidence editable; preserve the separate explicit-user-reset boundary; `formal/solana-callers-audit.md` |
| Live fixture wallet writes | A second runtime changed wallet rows while Pages had the same local D1 database open | Seed before Pages starts and use the real registration/challenge/authorization API afterward; `formal/fixture-wallet-audit.md` |
| Fixture calendar | Wallet workflows assumed the default month still selected September 2026 | Select the retained fixture month through the actual calendar controls before commitment checks; `tests/e2e/award-month.ts` |
| Release proof gate | The newly added standalone proof jobs did not block the publish workflow's quality result | Require both same-SHA proof jobs in that workflow's dependency graph and quality result; `formal/release-proof-gate-audit.md` |
| Referral history | Voiding a lower latest root lost an earlier higher live total and incorrectly tightened later posting capacity | Restore the per-epoch prior maximum; `formal/referral-control-audit.md` |
| Local acceptance finality | A confirmed project was read as finalized and the local acceptance run failed before dispatch | Wait resumably for the commit to finalize; `formal/local-solana-acceptance-audit.md` |

The forwarded-report and payout corrections reuse
[PR 2252](https://github.com/SlopDotCash/slopdotcash/pull/2252) and
[PR 2313](https://github.com/SlopDotCash/slopdotcash/pull/2313), including their
original commits and authors. Their regressions were reproduced against the
combined application before integration. The later integration also preserves
the account, recovery and calculation changes merged by
[PR 2403](https://github.com/SlopDotCash/slopdotcash/pull/2403).

Additional local-tool fixes keep Wrangler's update request from hanging test
setup, serve deterministic local avatar fixtures, and exclude generated native
validator/dependency trees from the proof source walk while still refusing
symbolic links in actual source. See [the archived validation record](https://github.com/SlopDotCash/slopdotcash/blob/22b0fd511aa8cc8c8e5810fdb979b40a03c5a5f9/docs/lemmascript-validation.md).

The source inventory and area audits also include reviewed transitions that
needed no implementation change. They remain bounded abstractions unless an
audit explicitly supplies stronger conformance evidence.

## Reviewed follow-up

The monthly recovery and runner defects below were first identified by source
inspection and then reproduced during independent review. Their earlier failed
runs remain separate from passing corrected runs.

- A pending lookup fixed an entered monthly-setting transaction ID across reload,
  hiding the correction input. Real desktop/mobile Anvil workflows now prove
  correction, finality, unchanged cap and send counts, and fixed wallet IDs.
- Integration, security-payment and browser cancellation did not own all cleanup.
  Actual process probes exposed and then verified the managed-browser-server
  correction, including timeout and first-failure preservation.

Model/source corrections and verification limits are recorded in
`backend-runner-review-audit.md`, `binding-veto-audit.md`,
`runner-cancellation-audit.md` and `direct-payment-composition-audit.md`.
Final combined-head checks remain separate from these scoped results.

The further local source review found an older private-case GET could overwrite
a newer action response because `useSecurityData.replace` did not advance its
read generation. The correction advances that generation. Its runtime evidence
is still pending; this is a source-confirmed pre-existing race, not a newly
executed reproduction. See `direct-payment-composition-audit.md`.

The same unvalidated local follow-up also addresses:

- Inbox focus reads could supersede a pending mutation and suppress its final
  readback; see `inbox-mutation-focus-audit.md`.
- Direct recovery could commit a captured successor wallet after a later wallet
  replacement; see `direct-recovery-completion-audit.md`. The prior result was
  stale recovery metadata, not a demonstrated unauthorized payment.
- A departed owner verification could clear a newer retry's marker; see
  `owner-recovery-lifetime-audit.md`. New attempt identity and exact-value
  removal preserve the newer marker and retain the existing user-reset boundary.

Inbox and owner-attempt paths remain source-confirmed corrections without
passing runtime regressions. Direct recovery has since been independently
reproduced and validated against the actual private API, migrated SQLite and
local Anvil; see `direct-recovery-completion-audit.md`. The original full
application branch has not been revalidated with these combined changes.

The continued source pass adds initial direct-payment preparation fencing,
revision-aware case responses with equal-revision refresh, owned vault and
monthly-setting recovery snapshots, and per-nonce direct-payment journal
merges. See `direct-preparation-completion-audit.md`,
`private-action-lifetimes-audit.md`, `owner-recovery-lifetime-audit.md`, and
`direct-bounty-journal-audit.md`. These are separate source-confirmed fixes;
their presence in this list does not claim passing browser or combined-head
evidence. Model authoring errors found by independent checks are retained in
their audits alongside their corrections.


## Separate X lifecycle corrections

Source-only review found that a failed flow deletion skipped the required
temporary-token revocation attempt. It also found that a shared cookie could
be cleared by an older callback or overwritten by a delayed start response.
The handler now attempts revocation in nested cleanup and uses per-flow
cookie names with an expiring legacy fallback. See
`x-connection-lifecycle-audit.md` for the29unexecuted scenarios, nineteen
added handler cases and remaining browser/provider acceptance. These are
source-confirmed corrections; no executed before/after result is claimed.

## Separate Points private-view correction

Source review found that a failed post-response identity check only showed an
error while retaining the earlier account's private award/form. The Points
view now clears cached private content before notifying the parent of known
identity loss, and clears before parent revalidation when the session or
access is unavailable. The extended browser workflow changes the real test
session while an accepted response is held. It and the26newmodel scenarios
are unexecuted in this lane. This is a source-confirmed correction, not a
claimed browser reproduction or a completed UI acceptance result.


## Separate operator evidence view corrections

Source review found that the first render after an actor change could show
previously loaded private inventory before its effect reset. Inventory is now
bound to both actor and lookup, and response-time identity is rechecked. A
departed EvidenceItem could also trigger a native or Blob download after its
grant/read completed. Its current actor and attempt now guard those effects;
body reads are canceled on departure. The grant service remains the authority.
The 32 new UI model scenarios and held-response browser regressions are unexecuted;
no server bypass or completed browser acceptance is claimed.

The operator expected-actor header was also previously ignored by the
evidence service. An already authorized different operator could receive an
inspection grant intended for the earlier account. The shared actor guard now
refuses that mismatch before grant creation or audit. Reader error paths also
clear on authoritative refusal and recheck identity before retaining other
errors. The new handler/SQLite assertions cover the refused write boundary;
they have not been executed here.

## Separate wallet lifetime and account corrections

Source inspection found that Earnings and owner vault setup could open a
wallet prompt after leaving their view. Their later callbacks could also
start another chain or replace a newer recovery record. The new lifetime and
record guards stop those continuations while retaining already accepted
server facts and owned transaction evidence.

Earnings also lacked an initiating-account check before registering a newly
connected wallet. If its session changed from A to B while connection waited,
the normal API could register and authorize B's new claim from A's old view.
Fresh browser observations and the API's optional expected-actor admission
now preserve that boundary. Existing per-claim signature checks remain in
force. The change does not cancel an already open prompt or reverse an
accepted A request.

Referral claims shared one localStorage recovery slot without serialization
or record ownership. A late wallet result could overwrite or clear a later
request. A per-key Web Lock, UUID ownership and exact-record cleanup preserve
cooperating browser views and refuse changed records. The source retains
legacy and unknown outcomes and does not activate a referral program.

Four new models contain 64 unexecuted scenarios. New or extended browser and
handler workflows are also unexecuted. These are source-confirmed corrections,
not passing runtime reproductions or a complete application-state proof.
The four area audits describe their finite bounds and remaining acceptance.

## Further private-view and flag-state corrections

Owner award mutation refusals retained the earlier private proposal after
clearing only drafts. Owner bounty-funds reads and pending-application reads
also lacked a response-time actor check. The corrected paths bind requests
to their initiating account, recheck identity, and remove private views on
known access loss. Departed callbacks cannot publish into another view.
Accepted writes remain backend facts even when their responses arrive late.

Flag admission used eligibility from a captured project but inserted against
the latest revision. The insertion now requires that captured revision and
manifest hash. A concurrent change returns the existing retry response.
Source review also corrected the reinstatement model: a withdrawn reporter's
new flag has a new immutable ID, and a clean scan resolves captured flags
even if it cannot reinstate the project. New model and regression definitions
remain unexecuted. The linked area audits retain these bounds and limits.

## Project publication, authority and setup

A publication could return a later writer's registry head as its own result.
The editor then treated an older local draft as based on that newer revision,
allowing a later save to overwrite the unseen change. Publication now returns
its own immutable committed revision. A new project and stored application
also use their own committed revision for setup and refuse a first write if
the checked enforcement generation changed.

The maintainer hook could attribute another account's successful access
response to the initiating account. Project creation, editor publication and
setup checks also lacked complete initiating-actor/response-lifetime guards.
Those requests now carry the expected actor and check response-time identity.
Late results preserve accepted backend writes and local draft ownership.
Five new models and refined registry models add 52 unexecuted scenarios.
New browser/handler definitions and fixture corrections are also unexecuted;
see the three project-publication/authority audits for exact boundaries.

## Notification ownership and resource deadlines

Notification completion already guarded its state transition, but retry timing
and destination writes used only the delivery ID. An old worker could therefore
alter successor metadata. Those writes now share the current-attempt predicate;
a lost attempt stops before a new provider call. The final local check remains
separate from the external send and cannot recall one already started.

Backup escalation checked an old acknowledgment snapshot before awaiting access.
Its insertion now requires the primary to remain unacknowledged and without an
existing backup. The consent model also now captures its revision when Verify
starts, matching the actual handler, and the fan-out model distinguishes a
notify-service request from individual provider acceptances.

A resource deadline previously only aborted a signal; loaders that ignored it
could publish later. Deadline, success and failure now share terminal settlement.
Admin list/fee reads bind their actor and recheck identity. Retaining a private
list after a transport failure requires a completed matching admin check;
timeout during that check clears the old data. New models and regression
definitions are unexecuted. The related audits state each external boundary.

## Admin intent, assessment access and value finish

Enforcement confirmation rebuilt a request from current inputs after showing
an older preview. The corrected control stores and confirms the reviewed
payload, including its project revision, sequence and resolved account IDs.
Admin writes and vetting reads/writes also bind the initiating actor, suppress
departed callbacks and invalidate the private parent on access loss. An
accepted editor write retains its exact-byte draft cleanup semantics.

Incomplete-assessment pagination removed only its own page when identity or
access changed, leaving the parent's earlier private notifications visible.
It now asks the parent to revalidate or report the known identity change.
The vetting handler also enforces the existing expected-actor header before
an admin request can read or write.

Value-request finish used its captured timestamp as the lease clock. A queued
statement could therefore complete after actual expiry. The final SQL fence
now requires the lease to exceed both the captured and execution clocks and
preserves every owner/sibling record when refused. Five new models and refined
worker scenarios add 67 unexecuted cases; the added browser, handler and SQLite
definitions are also unexecuted. Source review is not runtime acceptance.

## Explicit signout and inference reservation

Successful signout updated the header but left independent private consumers
and session hooks with their prior state. A local session revision and direct
consumer invalidation now hide those views, cancel owned reads and suppress
earlier callbacks. Already accepted writes, pending payment records and email
verification tokens keep their recovery semantics.

The inference model counted admissions that had no reservation and did not
represent free provider spending denials. Its refined accounting matches those
source distinctions. Source review also found that concurrent admitted attempts
could both reserve the final available attempt slot. Reservation now repeats
the shared count predicate inside its INSERT, and returns its refusal reason
from the same transaction. This fixes excess reservations; it is not evidence
that an extra paid provider call occurred.

The enforcement model now distinguishes a changed fingerprint before dispatch
from a changed fingerprint after server acceptance. Two new models and refined
existing models add 43 unexecuted scenarios. New browser and SQLite definitions
are also unexecuted; these changes await exact-source validation.

## Security settings, email continuation and worker completion

The active security settings view could accept a permission reply for an old
actor, publish that actor's loaded terms through a later actor's session, and
apply an old accepted response after its editor was replaced. The corrected
read/write boundaries retain actor and lifetime ownership. Confirmed identity
changes refresh the parent; ordinary access and transport failures retain an
explicit local retry.

Email preference continuations could start a session or preference reload
after departure, or apply a reply after their generation changed. Reads,
mutation statuses, postflight checks and error publication now share the
current-generation guard. Current destination-conflict feedback and editable
draft recovery remain.

A value worker checked local project/installation authority before a remote
membership wait, then checked only leases afterward. It now repeats local
authority before its final lease observations. A later change after those
observations remains outside an atomic transaction with the provider.

The inference cap also treated a pending response or pending result retention
as terminal exhaustion. An expired worker could then finish a free response or
retain a valid result after its successor had stopped retrying. Completion is
now an immutable fact separate from reservation, costs and publication. Full
unfinished capacity stays reserved and retryable; completed non-free exhaustion
rechecks retained results. Historical completion is not inferred or backfilled.
The four new models and 59 scenario additions, plus their browser/SQLite
definitions, are unexecuted source-review evidence.

## Image callbacks and current escalation triggers

An image decode retained its initial parent callback. After a successful
project revision, that callback could place the image in a draft based on the
previous revision. The field now calls the latest committed parent callback
and ends its lifetime during layout cleanup. Decoding, bitmap disposal and
retry are represented explicitly; leaving the wizard step still discards its
pending selection under the existing behavior.

A prepared backup escalation could survive reconciliation that removed its
trigger. The final INSERT now requires a current delivery failure or an overdue
action notice. A delivered informational receipt does not qualify. The model
retains the eligibility recorded at creation, because later delivery does not
erase a backup already committed.

The public profile identity selector and wallet lookup gained a dedicated
source model. No profile runtime defect was established in this pass. The
new model and added image/escalation regression definitions remain unexecuted;
their source mapping does not establish complete implementation refinement.

## Trace admission and private report receipt recovery

A trace intent could be created or renewed after a concurrent request finalized
the run. The intent writes now check the current owner, run state and digest;
existing-intent lookups use the same admission predicate. The upload route
already prevented a finalized trace overwrite. This correction prevents the
stale intent admission without inventing a disclosure claim.

An accepted private report could navigate under a later browser account.
The form now preserves its receipt and verifies the current actor before
navigation. Unknown identity hides the body while keeping the original
uncertain payload/key for session-only recovery. Late cleanup and validation
correction require exact ownership of the stored draft bytes.

Installer activation could commit before later verification or cleanup failed,
yet its diagnostic described a refused operation. Diagnostics now name the
commit boundary and preserve primary errors. Static and generated skill-role
admission are represented separately in the source-authority model. One new
model and 51 additional scenarios, plus all added regression definitions,
remain unexecuted source-review evidence.

## Clipboard completion, local receipts and trace composition

The project prompt changes in place when clearance loads. Its old clipboard
promise could then mark the new prompt as copied, and overlapping attempts
could replace the newer outcome. Shared feedback now belongs to the committed
text, component lifetime and latest copy request. It does not claim exclusive
control of operating-system clipboard contents. See
`clipboard-feedback-audit.md` for the finite model and unexecuted browser cases.

Contributor finish accepted a small backward clock change and published an
immutable receipt that its own reader rejected. It now refuses that clock
state and validates the complete candidate before publishing. Existing invalid
records remain explicit errors. Policy-document cache cleanup no longer turns
verified bytes or an ordinary cache miss into a failed policy check. The CLI
describes verified documents without claiming current contribution admission.

A contributor discovery helper could remove its command lease after a child
was launched but before failed bookkeeping had settled that child. It now
retains ownership through child completion and preserves the primary error
when cleanup also fails. The corresponding local receipt, policy and process
models distinguish these boundaries; their new regression definitions are
unexecuted.

The trace model previously conflated issuing a capability with the permanent
run/digest reservation. It now separates admission time, reservation, R2 outcome,
atomic attachment, concurrent requests, retries and lost responses. In
particular, expiry after request admission does not cancel an admitted upload.
The runtime was unchanged by that refinement; see
`trace-upload-lifecycle-audit.md`. Neither model mapping nor these source
corrections establish absence of other application state errors.
