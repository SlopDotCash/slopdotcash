# Heir Elements SDK evidence rubric

Proof must let a reviewer confirm the claimed hardening, fix, or validator
behavior without trusting the summary. Attach evidence to the issue or PR; do
not commit captured logs or traces to the repository.

## Every claim carries

- the workspace and the exact surface (`sdk` sandbox, permissions, host API,
  `ElementValidator`, CLI, types, React bindings, or templates);
- the inheritance-app path it protects (for example wallet signing, encrypted
  storage, notifications, or inter-element messaging);
- the exact commands with every flag, and the commit SHA they ran at;
- a failing test or validator case that existed before the fix, then the
  passing result on the same head;
- for permission or sandbox work: both the allowed path and the denied path;
- what remains untested or unenforced.

## What makes a change material

The change must close a real capability hole, restore a broken build/validate
path, or add a check that rejects unsafe input. Breadth is not progress.
Widening a permission, mocking the sandbox, or loosening a validator to make
CI green is not a contribution.

## Reviewing someone else's result

Reproduce the changed path in an isolated environment. Rerun the stated
commands. Trace the claim from the test or validator output to the summary.
Check that host APIs still fail closed when the matching permission is false.

## Reject or hold

- a claim with no command, commit, or failing-then-passing check;
- permission widening or a new host API without a deny-by-default test;
- a sandbox, validator, or CLI replaced by a mock that cannot fail;
- edited or deleted tests that previously rejected unsafe packages;
- dependency or lockfile smuggling, lifecycle hooks, or CI permission growth;
- documentation-only, rename, or format-only diffs;
- Eliza runtime, mission-ready, or other-project work submitted here;
- a PR presented as accepted before `awidearray` merges it to `main`.

## Negative results are results

A reproduction that shows a reported hole does not exist, or that a validator
already rejects the unsafe package, is worth crediting when it is specific and
tied to a public issue or PR.
