# LemmaScript checker cancellation

This separate follow-up starts from `a8b0f8226`. It was prepared by source
inspection without parser, test, prover or process execution in this root
lane. Later independent caller evidence is recorded below. The old checker's
post-exit orphan behavior has not been separately measured.

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

Three subprocess regressions were initially authored in
`scripts/lemmascript-cancellation.test.ts` exercise the actual Node checker
with a controlled long-running version command and its real descendant
server. Each signal must produce a canceled failure receipt, release the
server port and prevent later checker commands. The stand-in proves process
lifetime behavior only; it performs no theorem verification. Windows does
not receive these POSIX signal cases and retains the supervisor's separate
native process-tree tests. Their later execution is recorded below.

## Independent caller regression

The three signal cases were subsequently executed independently on
`124f672d4b4deb94ed7d13e36fa6ed2cadf3653c`: all three pass, with 30 assertions.
Each exercises the actual Node checker and inherited descendant server,
observes a reusable port after cancellation, and reads the failed/canceled
receipt. The controlled command runs no theorem.

An isolated comparison replaced only the checker with its parent version.
All three cases then fail at natural signal exit codes 130, 143 and 129,
before the expected receipt assertions. That comparison does not independently
measure post-exit orphan survival; its cleanup still stops owned fixture groups.
An earlier accidental fixed-source control was retained as a redundant run,
not counted as a failing baseline.

The receipt is `evidence/lemma-cancellation-validation/result.json`, SHA-256
`e219e912ae79572ee6b703eced1dbe1bf32b33f09c6f37050c2f7f70192bee44`.
Its checker/test hashes match this branch. Shared-supervisor deadline/output
and earlier-failure probes, full prover execution under this caller, and
finite model checks remain separate requirements. This root lane only read
the independent evidence; it ran no checks.
