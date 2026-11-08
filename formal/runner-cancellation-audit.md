# Security and browser runner cancellation

This follow-up is based on `120c7a22` plus the source-only integration-runner
correction `8e93f95d6`. The user instructed us to skip checks and focus on
pushing. **No tests, syntax checks, formatting commands, simulations, model
verifiers, or browser runs were executed for this change.** All current code
and model claims below are source reasoning, not validation results.

`runner-cancellation.mjs` connects SIGINT, SIGTERM and SIGHUP to one
AbortController. It retains the first observed nonzero outcome, whether it
was a phase failure or a signal. Repeated signals cannot replace it. A
checkpoint yields to queued signal handlers before another process starts.
Listeners are removed only after the caller has awaited all jobs and cleanup.
The existing `runE2ePhase` remains the only process supervisor.

The security-payment pool retains its two workers, original scenarios,
arguments, environments and ten-minute phase deadlines. Port discovery
closes its temporary listener in `finally`. Cancellation before or between
port discoveries cannot start a phase. Each phase receives the abort signal;
startup failure aborts its sibling, and both workers are awaited. Ordinary
nonzero scenario results still allow the remaining scenarios to run unless
cancellation occurs.

The browser coordinator passes the signal to builds, migrations, manifest
verification and Playwright. Previously synchronous subprocess commands now
use the same phase helper and retain their original arguments and environment
policy. Fixture preparation accepts an injected command runner, so its build
and Git subprocesses also belong to this scope. Standalone callers keep their
original synchronous default.

The copied-workspace path no longer launches a second `run-e2e` coordinator.
It invokes the same selected preview/Pages Playwright phases directly, with
the copied workspace as cwd and the same fixture/prebuilt environment. This
removes a concrete ownership gap: immediately killing the outer coordinator
could previously leave its separately detached Playwright grandchildren.
Manifest verification and diagnostic copying remain in the workflow.

Registry startup assigns each returned GitHub, notification, Slopbot, EVM or
Solana resource before the next cancellation checkpoint. Thus a resource
returned after a signal remains reachable by `finally`. The coordinator starts
no later fixture or browser phase after observing cancellation. A failed
sibling does not abandon another sibling's cleanup. Wallet bridge operations
check cancellation before new writes/signing and pass the signal into their
API requests. Already submitted external operations cannot be retracted.

`runner_cancellation.qnt` models three queued jobs, two active jobs, startup
that completes after cancellation, direct phase ownership, cleanup, repeated
signals, cleanup failure and first-failure preservation. Settling a cleanup
attempt does not assert that a process/container disappeared. Its five named scenarios were authored
but **not run**. It abstracts the phase helper's process-group behavior rather
than proving it.

## Explicit limits

- Synchronous file copying, fixture overlay, diagnostic copying, existing
  wallet-fixture seeding subprocess helpers and small setup calculations
  cannot process a signal until the event loop resumes. A checkpoint occurs
  before the next coordinator-started command. Standalone calls to
  `prepareE2eFixture()` still use its original synchronous default; the abort-
  aware command runner is injected only by `run-e2e.mjs`.
- Existing fixture-start functions have opaque async internals and do not
  accept this signal. If a signal arrives after such a function starts, the
  coordinator awaits its existing timeout/result and then closes the returned
  resource. This change does not claim immediate interruption inside those
  helpers, or prove cleanup if a helper never returns a created resource.
- `runE2ePhase` bounds cleanup and reports errors; it cannot prove that an
  external container or a process that escaped its group is gone. This change
  does not add a second supervisor or a new container cleanup guarantee.
- First failure means the first nonzero outcome observed by this coordinator,
  not an ordering between simultaneous kernel events before callbacks run.
- Removing the nested coordinator and changing setup subprocess execution
  require real browser and cancellation regression evidence when checks resume.
