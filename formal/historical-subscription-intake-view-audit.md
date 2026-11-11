# Historical subscription intake safety VIEW

This private PRD section 12 experiment starts from
`4066e7b41a1054a808ccf7c140cdb48aa826988d`. Its frozen parent
`24080eb471dbb976a082d79a646e9c9db9fe8989` changes TLC fingerprints only.
The concrete model, domains, actions, invariant, scenarios and mapped runtime
sources remain unchanged. This private child grants that same graph 600 seconds
for a hosted diagnostic and adds the reviewed manual model/shard selectors.
The earlier hosted full-state run exhausted 180 seconds; its last report had
4,957,800 distinct states, 3,973,534 queued and depth 8. That result remains incomplete. No bigger queue
estimate, sampled trace or native control is a completed finite graph.

## Exact observation

`historical-subscription-intake-terminal-safety-v1` binds the complete model
SHA-256 `cbc8d18d11f2c13246d83dfb9c2d6aefc5345bfa20b248e82f172258b4ee6f22`.
The unchanged complete production TLA is
`10224d70eb2cdae0311f4a59a054299aa94675042c0e3ea7f7f58b020735f93c`.
Inserting only `SlopHistoricalSubscriptionIntakeViewV1` before its full module
terminator gives
`3892a0a58951dbdcce177098fc4d562d3952f831d1ca7b6e909d596f4dcc6c2d`.

Every global stays exact: source and registry revisions, active/installation
and selected-source flags, tip, all four journal records and all source,
claim and parent indices. Every live request field stays exact except
`received`, which is write-only. For unused, response and done phases, retain:

1. Exact phase and attempt count.
2. Exact mode/key/parent/payload/bundle when `0 < attempt < 2`; otherwise an
   empty envelope observation.
3. Exact status-is-200 truth and exact returned row and payload references.
4. Three independent raw truths: `status > 0 implies noStore`,
   `refreshed subseteq collected`, and `collected subseteq members`.

No domain, slot index, row index or action argument is renamed or removed.
The three local truths are computed from the original representative,
including false values. They are not trusted constants or one conjunction.
All non-success status codes and received diagnostics are outside this
VIEW's output guarantees. The original scenarios continue to inspect their
complete values without a VIEW.

## Whole future-read and successor audit

| Action or helper | Dependency and projected successor |
| --- | --- |
| sourceChanges, registryChanges, pause, removeSource, revokeInstallation | Read and write exact globals only. No hidden terminal request field is read. |
| begin | Requires unused/done phase and attempt less than two. When attempt is positive it compares the complete original envelope; therefore all five fields remain exact for a retryable request. At nonpositive attempts that equality guard is vacuous. At attempt two or more begin is disabled forever. The action fully replaces the request with idle plus original arguments, exact incremented attempt and mode-derived members. |
| headers, session, body, envelope, installation | Their required live phases and all branch inputs remain exact. Respond writes a positive status and noStore true, so its new no-store truth is known true. No discarded received output is read. |
| collect, reconstruct, capture, refresh, prepare | Every live member set, source revision, registry revision and collected/refreshed set remains exact. Rejection transitions compute the raw terminal observations; successful transitions keep complete live captures. |
| preflight, appendRecord | Exact keys, mode, parent, payload, members, captured revision and global authority/records preserve replay, predecessor and commit checks. All journal/index writes stay concrete and exact. |
| readback | Exact rowOf inputs and global records determine the same result. Success writes status 200/noStore true and exact returned row/payload; refusal writes non-success/noStore true. |
| failure | Only its original live phases are enabled. It writes non-success/noStore true and otherwise carries request data into its exact terminal observations. |
| send | Only response phase is enabled; it changes phase to done and writes erased received. Attempt, envelope, references and all three truths carry unchanged. |
| explicit stutter | The observation is unchanged. |

The only actions on a terminal request are send and begin. Every other action
excludes unused/response/done; no other ID reads this request's hidden fields.
Do not merge response with done: send is response-only and retries are
unused/done-only. Do not erase a retryable envelope: begin requires exact
equality with its original five fields. Attempt never decreases; only begin
increments it, and that action is disabled once exhausted. A nonpositive
attempt's old envelope cannot affect begin, whose arguments supply every new
field. These arguments do not assume the initial invariant holds or that a
terminal request resembles idle.

Begin resets status to zero and noStore false, so its new no-store implication
is true and its success flag is false. It resets collected/refreshed to empty
and derives members from the new mode, making both subset truths true.
Discarded source snapshots, registry capture, received output and return
references are also fully reset. Thus dirty unused and false terminal classes
have exact, determined reset successors.

Keep the readback references rather than one frozen receipt-truth bit. An
unused/response/done status-200 request may point at a currently absent row in
a hypothetical false prefix. Another live request's append can create that
row and heal the original invariant, depending on its exact returned row and
payload. All records and both references therefore remain exact, and
`status == 200 implies rowAt(returnedRow).exists and returnedPayload ==
rowAt(returnedRow).payload` is recomputed from them at every state. This
preserves both false classes and future healing without assuming successful
receipts are already valid. Do not normalize absent-record contents: even a
false-prefix mode or parent can affect a later original check.

Every global invariant operand remains exact. The four local request clauses
are either one of the three raw truths or that dynamically reconstructed
readback clause. Equal observations therefore imply equal original invariant
truth and, for the same original action parameters, equal enabledness and
projected successors. From the unchanged initial state, a completed quotient
would be exactly the projection of the reachable concrete graph. This is a
manual strong finite safety-congruence argument, not a machine-checked
refinement proof, SQL/producer/cryptographic conformance, exact HTTP output
equivalence, temporal progress or unbounded safety claim.

## Guards and qualification contract

`scripts/historical-subscription-intake-safety-view.test.ts` binds the full
source and complete schema/domain/helper/action/step/invariant prefix. New
received reads, terminal snapshot or set consumers, exhausted retries,
zero-attempt envelope consumers, exact status consumers, cross-ID reads and
new invariant observations require review. The helper also refuses changed
source/TLA/VIEW bytes, unknown definitions and temporal requests.

Under `SLOP_QUINT_TRANSLATOR_TEST=1`, controls derive complete production TLA,
validate actual applySafetyView on its full terminator, and reuse the actual
translated actions for reset, append/healing and send continuations. No ignored
local artifact is a committed test dependency. Negative controls use only
`q_inv == ~SlopControlWitness`, require a noninitial trace, and reject any
initial-state failure. They cover every global/local invariant class, separate
false/healing no-store and subset observations, dynamic row/payload healing by
another request, all five retry-envelope fields, exact attempts, dirty resets
and false observations carried by send. Each positive coalescing control
requires the paired raw graph to finish with two states and the VIEW graph
with one, both with an empty queue. They coalesce only reviewed
terminal/write-only data; a separate control confirms exhausted requests
cannot begin. The focused file is registered in `formal.yml`'s native step.
A no-VIEW future-consumer control demonstrates why a new read invalidates the
old source binding. These adapter/observation controls do not prove the manual
argument or replace a complete finite quotient. Native controls and the full
graph are separate qualifications; their exact frozen lineage follows.

## Frozen qualification and private hosted follow-up

At clean `24080eb471dbb976a082d79a646e9c9db9fe8989`, the corrected focused
native file passed 45 tests and 237 assertions, including all 34 native controls
and five paired raw-two/VIEW-one diagnostics. The unchanged ordinary typecheck,
28 named scenarios and 500×60 seeded traces passed with the original 90-second
stage limits. The earlier `4a67f1a5e382c72d708218528050632dc5857a55` native
attempt failed before exploration because nested test-fixture TLA constructors
reused a binder; that failed receipt remains separate. The model and VIEW did
not change. The corrected receipt is fresh, not a relabeled failed attempt.

The one canonical 180-second V1 full graph was INCOMPLETE. Its last progress
report recorded 6,302,502 generated states, 1,446,214 distinct states,
1,128,063 queued and depth 7. That report preceded the deadline by about
31 seconds; these are last-reported metrics, not final ending counts. The
receipt reports passed=false, inputsUnchanged=true and canceled=false. The
reviewed VIEW was applied and all source/tool plus six binary hashes stayed
stable. No full safety pass or empty queue is claimed.

The wrapper recorded SIGKILL, cleanup kill EPERM and cleanup-did-not-finish
warnings. Those warnings remain in the failed receipt. A separate post-exit
audit found all four captured PIDs (81208, 83728, 98647 and 15813) absent, no
exact owned process-group or module-path match, and both owned stage and TLC
temporary directories removed. No manual signal was sent. Cleanup evidence
is separate from graph completion and cannot turn this timeout into a pass.

This private child changes only the model-specific full-verifier allowance
from 180 to 600 seconds; ordinary stages retain 90 seconds. QNT, helper, VIEW
manifest, native-control, translator and adapter bytes stay exact. The manual
models/shards dispatch block is copied exactly from reviewed
`e8977c1add61ea87ec04c3f5f607e3c7cebeceba`. All three inventories are regenerated
against this child. The prior native and ordinary results are parent receipts,
not fresh qualification on the changed checker. The hosted 600-second probe
is PENDING until its own stable-source receipt reports completed finite
exploration with zero queued states. It adds no temporal, output-byte or
implementation-refinement claim, and relabels no failed receipt as passed.
