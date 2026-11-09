# Browser ownership at normal exit

This corrects a reproduced success-path leak in the browser test supervisor
under PRD sections 1 and 12. It changes no product UI, wallet flow or policy.

## Defect and choice

At `4262a6da72b0e2adc31c5ee02a7cb7c1f429e583`, the supervisor recorded detached
process groups only when interrupting a browser launcher. A launcher could start
a detached server with ignored output, exit zero and return success while that
server continued listening. An intermediate launcher could also exit first,
reparenting its server before the outer launcher completed. The same leak
occurred after a nonzero exit. Cleanup diagnostics did not always force a failed
result.

A periodic process-table scan cannot close this race: a short-lived parent may
disappear between samples. Increasing the interrupt grace cannot help an
ordinary successful exit. Killing by port, name or a new scan of unrelated
orphaned processes would not establish ownership. The correction therefore uses
an explicit cooperative checkpoint only for the known Node browser launcher.

## Ownership protocol

`run-e2e.mjs` opts browser phases into `browserOwnership`. Other setup, proof and
integration phases retain their existing process-group scope. Windows retains
its task-tree implementation. On POSIX, the browser receives a private temporary
directory and the `browser-process-ownership.mjs` preload appended to its existing
`NODE_OPTIONS`. Existing options remain intact; no browser assertions or normal
Playwright cleanup are disabled.

Each Node process registers at startup, before running application code, and in
its synchronous `exit` listener, covering natural and explicit `process.exit`.
Each registration waits for its own stage-specific acknowledgement. Worker
threads share a PID and do not register independently; the process's main thread
owns its checkpoints. Acknowledgements are written separately and renamed into
place, so a requester cannot observe an empty, partly published response.

The supervisor reads the process table while the requester is held alive. It
accepts a requester only if its current identity descends from the live launcher
or an already observed process whose PID and start identity still match. It
retains all observed descendant identities, including intermediate Node
launchers, and only records a detached group when its leader is an observed
descendant. Possession of the directory or an arbitrary PID is insufficient.
An uninstrumented server still belongs to its observed parent at that parent's
final checkpoint; it does not have to load the preload itself.

After the launcher exits, the existing bounded cleanup rechecks captured group
identities before signaling them, then waits for the launcher group and captured
detached groups. A missing final launcher acknowledgement, rejected ownership,
or cleanup failure prevents a zero result. An earlier nonzero child exit remains
nonzero. Unknown groups are never acquired by command name, port or orphan scan.
The private protocol directory is removed when the phase settles.

## Source and execution bounds

This is a protocol for controlled Node launchers, not arbitrary POSIX containment.
Node intermediate launchers must inherit the preload. A native program that
double-forks into a new session and loses its observed parent before any
checkpoint is outside this guarantee. So is code that strips the preload from
an intermediate, removes the exit listener, or starts new processes from a later
exit listener. The finite model explicitly permits server creation only before
the final checkpoint. These are assumptions, not ownership inferred after exit.

The lockfile resolves Playwright 1.62.1. Its process-host children inherit the
parent environment; its process-launcher exit handler kills retained processes
and does not launch new ones. Browser native children retain their observed
process-group ownership. These reviewed paths support the opt-in boundary;
the protocol does not claim to constrain arbitrary test code or native daemons.

Process-table start identities retain the platform's timestamp resolution and
snapshot limitations. Missing or changed identity causes refusal, not a wider
kill. Supervisor SIGKILL, OOM and host death cannot run this cleanup. On systems
where a dead unreaped group still cannot be distinguished from a running group,
the bounded cleanup may refuse success after the server has stopped.

## Evidence and model

The real-process regressions use short-lived Node launchers, ignored stdio,
uninstrumented detached TCP servers and unrelated sibling listeners. They cover
direct and intermediate-parent completion, exit zero and exit seven, missing
preload acknowledgement, a forged unrelated-process checkpoint, and a Node
worker thread. The pre-fix control reproduces four retained listeners and the
false-success missing-handshake result. Every control cleans up its own recorded
server in a `finally` block. Exact source hashes, command results and logs are
retained under ignored `evidence/normal-exit-cleanup/`.

The final Node 24.15.0 / Bun 1.3.14 run of the runner and LemmaScript-cancellation
files passes all 20 tests and 71 assertions. A separate pinned run of the final
test bytes against the original supervisor fails all five selected controls:
four listeners remain bound and missing ownership still returns zero. The
control harness then stops its own retained children. An intermediate run on
Node 24.5.0 / Bun 1.4.2 passed 19 tests and failed one readiness check; the next
pinned focused run exposed empty acknowledgements and failed four of seven
tests. Those failures remain recorded. Atomic acknowledgement publication fixes
that observed race; they are not relabeled as passing runs.

`formal_process.qnt` adds the opt-in mode, final acknowledgement and rejected
checkpoint transition. Its new scenarios cover normal detached cleanup, missing
acknowledgement, ownership refusal and a changed group identity at normal exit.
The invariant still requires no remaining modeled server before success. Its
17 named scenarios and 500 seeded simulations of up to 60 steps pass. Pinned
Node 24.15.0, Quint 0.33.1, Apalache 0.62.4 and Java 21.0.10 completed the finite
graph in 3,029 ms: 4,375 generated states, 454 distinct states, zero queued states
and depth 11. The receipt confirms unchanged inputs and no cancellation. This
model uses no safety view and declares no temporal property; TLC deadlock
checking remains disabled.

An initial new scenario incorrectly continued after `action.fail()`, leaving
Quint's next-state variable unset. The refusal witness now ends at that assertion
and a separate scenario checks the cleanup result. The original QNT502 receipt
is retained. One inventory refresh also stalled in its formatter; the exact owned
processes were stopped, and the direct canonical retry passed. Neither attempt
is reported as successful.

The refreshed inventory has 843 sources, 318 models and 1,577 named scenarios.
LemmaScript accounts for 687 files, 9,876 function bodies, 168 selected contracts
and 9,708 unproved bodies. Real Playwright acceptance and combined-head checks
remain parent-run gates; these subprocess and finite-model results do not prove
browser or arbitrary-process coverage.
