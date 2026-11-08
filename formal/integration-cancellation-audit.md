# Integration runner cancellation

The source review found that `run-integration.mjs` did not connect process
signals to `runE2ePhase`. That helper starts detached process groups on POSIX
and observes only the supplied abort signal. A signal sent to the parent can
therefore leave the current driver running outside its process group. The
runner also had no canceled state to prevent a later driver from starting.

The runner now connects SIGINT, SIGTERM and SIGHUP to one AbortController and
passes its signal to every phase. It keeps repeated signal handlers active
until the current phase has settled, stops before the next driver, and exits
with the first interruption's nonzero status. Normal driver failures retain
the existing behavior of collecting the remaining results.

`integration_pipeline` models three representative sequential drivers,
interruption before/between/during them, repeated signals, cleanup success or
failure, and aggregate completion. The phase helper's process-group behavior is
also covered by `formal_process`. A cleanup failure remains explicit; neither
model proves that an escaped external process has stopped.

This is a source-level correction. The user requested skipping further checks
and pushing. No new scenario, simulation, verifier, or executable cancellation
test has been run for this follow-up. Earlier integration runs were interrupted
with explicit external descendant cleanup; they do not validate this change.
