# Delta Star evidence and review rubric

Proof must let a reviewer confirm the mathematical and executable outcome
without trusting the summary.

For every contribution, include:

- the exact theorem, definition, executable check, or refutation changed;
- the verified commit SHA and exact Lean/Lake commands;
- successful output from the narrow check and required repository validation;
- an assumption audit, including new axioms, admitted facts, named residuals,
  stronger hypotheses, and imported results relevant to the claim;
- the source files and declarations that carry the result;
- a reproducible counterexample or generated artifact when applicable;
- the exact model/client attribution and device-signed run receipt;
- an honest statement of what remains open.

For a PR review, independently read the statement and proof term, trace imports
and assumptions, reproduce the check in an isolated environment, inspect
changed build or code-generation paths, and compare the claim to the live
frontier. A green build does not prove the theorem states the intended result.

Reject or hold credit for new `sorry`/`admit`, hidden axioms, circular
dependencies, generated-output edits presented as source, non-reproducible
computations, a stronger unstated premise, copied work, unrelated token logs,
or a claim that the external prize is won without end-to-end independent
verification.
