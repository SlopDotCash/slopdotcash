# LemmaScript checker cancellation

This separate follow-up starts from `a8b0f8226`. It was prepared by source
inspection. The parent-signal orphan was not reproduced, and no parser,
tests, prover or process probes were run for this change.

The earlier `check-lemmascript.mjs` started every command in a detached POSIX
process group and killed that group on its own timer/output limit. It had no
SIGINT, SIGTERM or SIGHUP listener. Those signals could terminate the checker
itself without passing through its local timer or writing the final receipt.
The independent validation owner therefore had to stop the verified owned
prover group directly when asked to stop a new retry. That observation found
the missing normal cancellation path; it is not a runtime reproduction of
all possible orphan behavior.

The checker now uses the existing `runE2ePhase` supervisor and one shared
AbortController. Parent signals cancel its active phase, prevent subsequent
commands and leave a failed/canceled receipt after cleanup. The original
180-second ordinary command limit, 3,600-second full Jupiter limit, 16 MiB
output cap, source/proof integrity checks and selected function set remain.

The common supervisor adds an optional exit observer. It does not choose or
change process control. The checker uses it to retain the child's actual exit
code and signal separately from the supervisor's result. A child failure
observed before later cancellation stays identified as the earlier failure.
Raw command output and supervisor cleanup diagnostics remain in the phase log.
The receipt records cancellation, the requested parent signal and the phase
result; cancellation can never make an incomplete proof pass.

`formal_process` now also maps the LemmaScript caller to its existing owned
process-group cleanup contract. `formal_toolchain` permits a partial failed
or canceled run to publish a failure receipt without pretending all selected
obligations ran. Its existing success invariant remains unchanged. Two added
scenarios are unexecuted.

Required conformance is a real checker process with a controlled long-running
command and inherited descendant: deliver each parent signal, observe a failed
receipt and no live owned descendant, and confirm no later command starts.
Also test successful launcher exit with a surviving child, output/deadline
refusal and an earlier child failure followed by cancellation. Existing
supervisor probes qualify that shared helper's earlier behavior; they do not
prove this new caller has been exercised.

SIGKILL, OOM or host death cannot run a JavaScript signal handler. Processes
that escape the owned group remain outside the supervisor's cleanup promise.
This change does not repair or classify the separate Jupiter prover crash.

Three unexecuted subprocess regressions in
`scripts/lemmascript-cancellation.test.ts` exercise the actual Node checker
with a controlled long-running version command and its real descendant
server. Each signal must produce a canceled failure receipt, release the
server port and prevent later checker commands. The stand-in proves process
lifetime behavior only; it performs no theorem verification. Windows does
not receive these POSIX signal cases and retains the supervisor's separate
native process-tree tests.
