# Browser runtime selection and saved-draft navigation

The hosted run for `1f0dafd45` exposed two test-boundary errors. The preview
matrix selected Firefox tests but installed Chromium only. Eighteen Firefox
tests failed before a page opened. The preview lanes now install both selected
engines. The existing real selector regression checks that requirement, and
`ci_browser_runtime` models selection, installation, download refusal, missing
binaries and launch across four lane kinds and two engines.

Both Chromium viewports also reloaded immediately after changing the automatic
closure checkbox, while its new durable draft write still showed Saving.
The reloaded value was the prior committed choice. The test now checks the
actual saved value through the existing acknowledgement-aware helper before
reloading, then retains the original restored-choice assertion. This does not
promise that a browser departure waits for an uncommitted write. The draft-slot
and save-progress models retain that interruption boundary.

The original hosted failures are retained under ignored `evidence/formal/ci-1f0/`.
The corrected exact-head hosted run remains required. Model scenarios do not
prove browser installation, browser execution, or persistence in a real browser.
