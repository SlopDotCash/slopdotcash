# Evidence child-process settlement

This source-only refinement covers the existing evidence recorder's directly
spawned build, encoder and preview children. It repairs a concrete failure path
within the PRD section 12 state requirements; it adds no product or process-tree
policy. No process, application, browser, server, test, parser or model checker
was run for this change. The model and native regression definitions are
unexecuted. Only authorized source-metadata generators may be run separately.

## Concrete failure and correction

The recorder previously called TERM without catching a synchronous exception.
Such an exception left the helper before either its grace wait or KILL fallback.
The pinned [Node 24.15.0 implementation](https://github.com/nodejs/node/blob/v24.15.0/lib/internal/child_process.js#L486-L508)
has this throw path for unsupported underlying signal operations; other signal
failures emit an error instead. This is a source-reachable cleanup failure, not
a reproduced failure of this host. The revised helper catches a thrown TERM,
retains it if cleanup remains uncertain, and still permits the KILL fallback.

The earlier helper also treated an observed exit as completed cleanup, and the
command helper resolved on exit rather than explicitly awaiting close. The
new shared observer makes close the completion boundary. Current callers use
inherited stdio; this audit does not claim a reproduced stale-artifact or open
pipe failure in those callers.

An initially suspected failed-spawn timeout was not established. The pinned
[Node failed-spawn path](https://github.com/nodejs/node/blob/v24.15.0/lib/internal/child_process.js#L256-L288)
sets a negative `exitCode` before emitting the spawn error, so the earlier
`exitCode` guard already returned for ordinary ENOENT/EACCES failures. The new
observer still explicitly waits for close and the fixtures retain that
negative status without inventing an exit event.

Node documents that [`close`](https://nodejs.org/api/child_process.html#event-close)
follows either a process exit or the error from failed spawn, and represents
closed child stdio. An [`error`](https://nodejs.org/api/child_process.html#event-error)
does not guarantee a later exit event. An
[`exit`](https://nodejs.org/api/child_process.html#event-exit) can occur while
stdio remains open. [`kill`](https://nodejs.org/api/child_process.html#subprocesskillsignal)
reports whether a signal request succeeded; it is not evidence of termination.
Those are lifecycle assumptions, not proof of real OS behavior on every host.

`observeEvidenceProcess` now attaches immediately after spawn, records only the
first error and resolves one non-rejecting completion promise on `close`.
`completeEvidenceCommand` awaits that completion, then rejects the recorded
error or unsuccessful exit. A zero exit alone cannot return success. The
retained error listener consumes subsequent child errors without changing the
already settled command result.

`stopEvidencePreview` waits for close even when spawn failed or exit already
occurred. It sends TERM, then KILL after the first grace interval, only while a
PID exists and neither exit status nor signal status has been observed. Each
wait uses the same close promise. A missing production-mode preview and an
already closed preview return immediately. Observed close completes cleanup
even after a failed signal request. Two waits without close return an explicit
uncertain-cleanup error; stored asynchronous errors and synchronous signal
exceptions remain in the aggregate rather than being erased. A close delivered
after rejection updates the observation but cannot turn that settled failure
into success. Observed errors are retained at the signal boundaries, so a later
asynchronous KILL error does not replace an earlier thrown TERM error as cause.

## Source and abstraction map

| Source | Boundary represented by `evidence_process` |
| --- | --- |
| [`evidence-process.mjs`](../scripts/evidence-process.mjs), `observeEvidenceProcess` | Observer installed on the returned child; first error and independent close observation |
| `completeEvidenceCommand` | Command result only after close; recorded error wins over zero status |
| `waitForClose` | Close versus timeout, with one settlement for each wait |
| `isRunning` | No signal without a PID; no further signal after observed exit |
| `stopEvidencePreview` | Absent/closed no-op, TERM/grace/KILL/grace, success from close and explicit unresolved failure |
| [`record-evidence.mjs`](../scripts/record-evidence.mjs), `run` | Build and encoder commands use the same close-based completion |
| `assertPreviewRunning` | Preview admission/capture also refuse recorded errors, closed state or observed exit |
| Preview spawn and `waitForServer` call | Preview observer attached before readiness wait and startup cleanup |
| Final `withEvidenceCleanup(captureEvidence, ...)` | Preview shutdown and staging cleanup remain independently awaited before the success log |

The earlier [`evidence_capture`](models/evidence_capture.qnt) refinement retains
publication and independent cleanup outcomes. This model refines the child
observation supplied to that workflow; it is not a mechanical composition proof
of the entire recorder. Response/TLS ownership remains in
[`evidence_transport`](models/evidence_transport.qnt).

## Bounds and authored evidence

[`evidence_process.qnt`](models/evidence_process.qnt) has 23 named scenarios.
It has one child, one observer and either one command-completion call or one
preview-shutdown call. Spawn outcome fixes whether the child has a PID. An
ordinary close follows exit; failed spawn records negative status, then has an
error and close without an exit event. The `exited` field tracks the event for a
successfully spawned child, not the negative status from failed spawn.
The model separates error, exit, close, signal request, each timeout and final
promise settlement. Error strings abstract the first recorded failure; sets
retain the categories reported on unconfirmed shutdown, not JavaScript error
identity or array ordering. The scenarios retain positive cleanup after signal
failure as well as missing-close refusal, early/late observation and the
production-mode no-op. Late close cannot rewrite a timed-out shutdown result.

[`evidence-process.test.ts`](../scripts/evidence-process.test.ts) has 22 native
regression definitions. All children are in-process `EventEmitter` fixtures;
none starts a subprocess or contacts a service. Positive command and cleanup
tests hold close separately from exit and await the actual returned promise.
The failed-spawn composition test uses the real `withEvidenceCleanup` wrapper
to retain the original startup rejection after successful close. Other cases
cover nonzero/signal exits, first-error identity, late errors, absent/already
closed children, TERM/KILL escalation including KILL after thrown TERM,
false/throwing signal requests, missing close, aggregate causes, synchronous
TERM error before later asynchronous KILL error, and late close after a settled
timeout. Timeout cases
pass short grace intervals to the real helper rather than overriding native
process or global timer APIs. They are definitions, not executed evidence.

The two grace intervals bound waiting only when the JavaScript event loop
delivers timers; they are not a strict wall-clock theorem. A command with no
close remains pending: the command helper introduces no new build or encoder
deadline. Missing-close examples are intentional fault/uncertainty boundaries,
not a claim that a normal Node failed spawn omits its documented close event.
This refinement does not supervise grandchildren, promise cancellation,
process groups, host shutdown or peer PR #2432's runner. It also does not model
port reservation, build-byte integrity, readiness HTTP retries or browser
resource ownership. Native spawn/signal/stdio behavior and the full recorder
workflow still require their separate execution evidence.
