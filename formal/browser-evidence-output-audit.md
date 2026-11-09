# Keep browser runs in separate evidence directories

This follow-up starts from `a8b0f8226` and is separate from the frozen
corrective PR. The source change and its model are unexecuted in this lane.

The registry browser job runs its normal selection, then an opt-in private
intake selection. `run-e2e.mjs` forced `SLOP_E2E_OUTPUT=registry` for both.
Playwright therefore reused `test-results/registry` and
`playwright-report/registry`. The second run replaced the first report and
its saved diagnostics before the workflow uploaded the artifact.

The completed `42528920892` registry-1 artifact confirms the effect: its only
`results.json` reports the later 24 passing and four skipped private-intake
cases. The job log separately records the earlier normal run's 34 passing
and 15 skipped cases. Passing logs establish those execution summaries, but
they do not recover the overwritten report, screenshots or recordings.
`evidence/final-22b/hosted/browser-coverage.json` records this boundary in the
independent proof worktree. This is an evidence-retention defect, not a
fabricated application test failure.

The retained private-intake JSON has SHA-256
`42574c9a281a3ad79e89a6bf38d5d68a0f14d70941f17c30a5f6152d0b62dfe8`.
Its start time is `2026-11-08T22:23:07.634Z`. The containing artifact has no
separate normal registry `results.json`. The root lane independently read
this artifact; it did not execute the browser tests.

The runner now honors its existing `SLOP_E2E_OUTPUT` setting, with `registry`
as the unchanged default. The private-intake workflow explicitly selects
`private-intake`. Its output stays under the existing `test-results` and
`playwright-report` roots, both already included by the artifact upload.
No new permission, upload destination, browser selection or test gate changes.

`ci_browser_evidence.qnt` models two sequential executions replacing their
selected directories and archiving the available reports. It distinguishes
successful execution from complete retained evidence. Separate directories
retain both reports even when one run fails. Intentionally choosing the same
output still replaces the earlier report; the model records that limit rather
than claiming globally unique directories. Missing reports also remain
incomplete even if test execution itself passed. Its six scenarios are unexecuted.

Required conformance is a normal registry run followed by private intake on
the same checkout, then inspection of both JSON reports and diagnostic paths
inside the uploaded artifact. Prior job success is not evidence that the
changed runner preserved those files. No checks were run here.
