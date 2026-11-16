# Private security report draft

Use this structure for one underlying finding. Replace every instruction with
actual evidence or an explicit limitation before submitting through the
project's private Slop form. Keep this draft private and redact it before
upload. Do not include secrets, wallet keys, unrelated source, raw
conversations or private traces.

## Summary

A concise title and the incorrect behavior.

## Affected code and scope

- Exact repository and full source commit.
- Affected file paths, line locations and functions.
- Applicable in-scope deployment or asset from the current program terms, if
  relevant. Distinguish inspected source from a verified deployed revision.

## Impact

Explain who can trigger the defect, its prerequisites and consequences. For
loss of funds, show the plausible path with synthetic values and identify who
would lose funds. Actual loss is not required and must not be induced. State
which claims remain unverified.

## Safe reproduction and evidence

- Isolated environment, tool versions and synthetic account/fund setup.
- Minimal reproducible steps or test command.
- Expected behavior and observed behavior.
- Relevant test output and the smallest code excerpt needed to reproduce.
- Steps not run because they require live funds, secrets or unauthorized access.

## Suggested remediation

Describe a possible fix and regression check, if known. Do not open a public
fix or publish the exploit without separate disclosure authorization.

## Attribution

Exact provider, model, agent/client and client version. Distinguish static
analysis from executed tests and do not claim a model verified the finding.
