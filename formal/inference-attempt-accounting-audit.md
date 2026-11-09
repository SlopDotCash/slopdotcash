# Inference attempt accounting

This source-only series began after `ff160e903`; the completion follow-up starts
from `3e48400e6`. No tests, parsers, simulations, verifiers, type checks,
applications or browsers were run. The seven scenarios in
`bot_inference_retention`, fourteen in `bot_inference_reservations`, and eight
in `bot_value_attempt_recovery` are authored but unexecuted. The regression
definitions below are also unexecuted. No new runtime or model validation is
claimed.

The prior `bot_inference_retention` incremented its limited attempt count at
admission. `admitValueAttempt` actually counts only admitted IDs that also have
a budget reservation. It excludes an ID once persisted cost records show that
every call was a structured provider spending denial. No recorded calls, missing
usage and mixed non-free/free calls remain counted conservatively. An unused
admission row remains immutable but consumes no paid-attempt slot.

The model now separates admitted identities, reservation, call classification,
usage recording, validation and retained-result publication. It preserves both
original scenario names and adds unreserved retries, four free denials followed
by three counted attempts, unknown reserved attempts, the pre-recording boundary
and a mixed-call denial. This matches the source distinction exercised by the
existing `value-attempt-limit.test.ts` spending-denial workflow; that test was
read, not run for this change.

Eight distinct attempt IDs bound one inference key and one active caller.
Complete call lists are reduced to no recorded call, all recorded calls free,
or at least one other call. The model does not prove usage parsing, provider
truth, cost reconciliation, callback authority or concurrent attempt admission.

## Concurrent reservation correction

`value-inference.ts` admits an attempt before `value-budget.ts` inserts its
reservation. Previously, two IDs could both be admitted while two earlier
reservations counted; both later reserved and produced four counted
reservations. A source-owner handover can realize this with the old worker's
reservation delayed. Its subsequent `mayCall` still refuses provider use. This
is a source-confirmed fourth-reservation race, not evidence of a fourth paid
request. Unknown reservations are not released on a timer.

`reserveValueInferenceBudget` now requires the inference key and limit from
`runValueInference`. Its conditional INSERT checks the exact admitted
attempt/key and repeats the paid-attempt count at write time. Admission and
reservation use the same `countedValueAttemptsSql` expression: unreserved
admissions and calls whose persisted records are all free denials do not count;
no recorded call, unknown usage, and any non-free call do count. The generic
`reserveValueBudget` keeps its single-statement boolean API and its existing
budget behavior.

Both immutable admission and reservation pair their INSERT with a refusal
SELECT in one required D1 batch. Success comes from the INSERT's exact
`attempt_id` RETURNING row. A full count becomes terminal `attempts` only if
three distinct reserved attempts each have an explicit completion and a
recorded non-free call. Otherwise it is `attempts-pending`, which uses the
consumer's existing transient `retry` schedule. Missing/mismatched admission or
duplicate reservation cannot authorize a call; absent a proven terminal count,
these also remain retryable. A reservation refused only by the money allowance
is `budget`. Each classification belongs to the same transaction as its refused
write. A late receipt may change future capacity, but does not rewrite the
earlier decision. Missing transactional storage or malformed result rows throw
before a provider call; there is no non-atomic fallback. The pure input refusal
where the configured maximum exceeds the configured monthly allowance remains
an immediate `budget` result.

This relies on Cloudflare's documented [transactional, ordered D1 batch
behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
and [per-statement result rows](https://developers.cloudflare.com/d1/worker-api/return-object/).
These are external storage assumptions, not newly executed platform evidence.
`tests/sqlite-d1.ts` now retains SELECT and RETURNING rows when executing batch
statements. It still executes the batch in one SQLite transaction; read-only
statements report zero changes rather than the previous write's `changes()`.
Generic writes keep their existing execution path. Source inspection found
production uses a transactional D1 binding, and existing inference fixtures
use this adapter or preserve its `batch` method through wrappers.

`bot_inference_reservations` separates admission, atomic reservation decision,
delayed reply, owner loss, first provider call, call classification and explicit
completion. It bounds one key to two existing counted IDs plus three new IDs,
limit three, one call-class summary per ID, and boolean budget/storage
availability. Fourteen scenarios cover both reservation orders, stale-owner
refusal, retained no-call reservations, budget refusal, a free receipt arriving
before the refusal reply, unknown and non-free holds, unavailable atomic storage,
immutable duplicate admission and completed-versus-incomplete exhaustion. It
does not model money arithmetic, individual cost-row persistence, all caller
paths, arbitrary provider behavior, or a distributed lock between a successful
`mayCall` and the HTTP send. In
`runStructuredRoute`, a spending denial ends the route; prior non-free calls
remain counted and are recorded before that final denial. The model's completed
call-class abstraction does not establish that implementation refinement.

Three source-authored regressions in `value-attempt-limit.test.ts` target:

- `concurrent admitted inferences cannot reserve the same final attempt slot`:
  real `runValueInference`, migrated SQLite and a local HTTP provider fixture;
  hold A's reservation batch, complete B's third reservation, revoke A's source
  ownership, and assert A has an immutable admission but no fourth reservation
  or provider call.
- `an atomic attempt refusal is retained when a free receipt arrives before its
  response`: migrated SQLite, real reservation helper and `recordCalls`; persist
  an all-free receipt after the refused batch but before returning its results,
  then assert the old `attempts-pending` receipt and capacity for a new ID.
  Its preexisting immutable admissions are explicit fixture state, not a claim
  about live provider responses.
- `inference without atomic reservation storage refuses before a provider
  call`: real inference entrypoint with the batch capability omitted; create no
  admission, reservation or cost record.

Existing paid-retry and spending-denial regressions remain. All new and existing
tests were read or authored only; none were run for this correction.

## Completion and worker recovery

A full cap previously became terminal even when the third attempt was still
running under an expired lease. Two completed non-free attempts plus a third
pending response are enough: a successor sees three reservations, records
`attempts-exhausted`, and stops scheduling. A late all-free denial then frees a
counted slot, but the old worker cannot finish with its expired claim. A second
window exists after non-free costs are stored but before a valid result is
retained: terminal exhaustion can strand the later reusable result. These are
source interleavings, not newly executed reproductions.

Migration `0118_slopbot_value_attempt_completion.sql` adds only an append-only
attempt ID and completion timestamp. It does not infer completion from existing
costs, reconciliations or results, and changes no historical row. The inference
path writes the marker after its exact expected number of call records and any
required retained result exist. A failed record/retention/marker write prevents
completion; a lost lease still permits immutable evidence from an already-sent
call to be retained, but not publication. The marker is independent of provider
amounts: completed non-free attempts with unknown actual cost may be terminal
without fabricating cost reconciliation. A completed zero-call attempt still
keeps its reservation and cannot prove non-free exhaustion. New requests that
encounter legacy reservations without completion markers remain pending;
historical completion is never inferred or backfilled. An already usable
retained result can still be read normally. Reservations never expire or refund.

Before returning terminal `attempts`, inference rereads the retained result.
When a result was absent at the first read but retained before the counted
completion, this second read reuses it. Its digest, schema and producer checks
remain unchanged. Only a complete non-free count with no usable retained result
returns terminal exhaustion; incomplete counts stay on the existing retry path.
No new queue state or retry interval is introduced.

`bot_value_attempt_recovery` composes two prior completed non-free attempts, one
in-flight third attempt, its lease loss, late cost/retention/completion writes,
and at most two successor attempts. Eight scenarios cover late free recovery,
snapshot-stable pending replies, terminal non-free control, retention before
completion, the second retained read, unchanged unknown holds, and stale-owner
publication refusal. Scheduler due time is an external transition representing
the existing retry delay. The one new successful provider call and journal write
are abstracted; provider grammar, value judgment, full multi-source validation
and all arbitrary lease schedules remain outside this model.

Four added real consumer/SQLite/local transport cases in
`value-pipeline.test.ts` define the handovers: `late-free-attempt`,
`late-retained-attempt`, `retained-before-admission`, and `confirmed-attempts`.
They retain the existing source group and journal assertions, bound the
successor by real processing/source leases, preserve all reservations, and
require no extra call when a valid result becomes available. The first three
prime two real invalid inference attempts; the terminal control primes three.
The `value-attempt-limit.test.ts` unknown-cost variant requires three completion
markers and terminal refusal with zero reconciliation rows. The populated
upgrade case in `value-migration.test.ts` preserves old admissions, reservations,
costs and retained bytes, proves no completion backfill, and specifies all three
append-only trigger refusals. None of these tests has been run in this series.
