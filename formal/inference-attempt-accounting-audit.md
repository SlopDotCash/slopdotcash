# Inference attempt accounting

This source-only correction follows `ff160e903`. No tests, parsers, simulations,
verifiers, type checks, applications or browsers were run. The seven scenarios in
`bot_inference_retention` and ten in `bot_inference_reservations` are authored but
unexecuted. The three new regression cases below are also unexecuted. No new
runtime or model validation is claimed.

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

The inference INSERT and refusal SELECT use one required D1 batch. Success comes
from the INSERT's exact `attempt_id` RETURNING row; a failed INSERT is classified
as `attempts` for missing/mismatched admission, an existing reservation, or a full
count, otherwise `budget`. The classification belongs to the same transaction
as the refused write. A free denial recorded after that transaction may reopen
capacity, but does not change the earlier returned reason. Missing transactional
storage or missing/malformed result rows throw before a provider call; there is
no non-atomic fallback. The pure input refusal where the configured maximum
exceeds the configured monthly allowance remains an immediate `budget` result.

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

The new `bot_inference_reservations` separates admission, atomic reservation
decision, delayed reply, owner loss, first provider call and completed call
classification. It bounds one key to two existing counted IDs plus three new
IDs, limit three, one call-class summary per ID, and boolean budget/storage
availability. Ten scenarios cover both reservation orders, stale-owner refusal,
retained no-call reservations, budget refusal, a free receipt arriving before
the refusal reply, unknown and non-free holds, unavailable atomic storage and
immutable duplicate admission. It does not model money arithmetic, individual
cost-row persistence, all caller paths, arbitrary provider behavior, or a
distributed lock between a successful `mayCall` and the HTTP send. In
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
  then assert the old `attempts` receipt and successful capacity for a new ID.
  Its preexisting immutable admissions are explicit fixture state, not a claim
  about live provider responses.
- `inference without atomic reservation storage refuses before a provider
  call`: real inference entrypoint with the batch capability omitted; preserve
  its admission but create no reservation or cost record.

Existing paid-retry and spending-denial regressions remain. All new and existing
tests were read or authored only; none were run for this correction.
