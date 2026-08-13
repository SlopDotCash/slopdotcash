# ASI evidence and review rubric

Proof must let a reviewer confirm the research or engineering outcome without
trusting the summary.

For every contribution, include:

- the exact learner, stream, validator, benchmark, or claim changed;
- the verified commit SHA and exact commands, seeds, and configurations;
- successful output from the focused tests and the lane's required validation;
- the evidence tier of any measurement (development-grade vs promoted) and the
  gates it has or has not passed;
- the source files and modules that carry the result;
- a reproducible artifact — curves, receipts, or generated evidence — when the
  claim is empirical;
- the exact model/client attribution and device-signed run receipt;
- an honest statement of what remains open.

For a PR review, independently reproduce the changed path in an isolated
environment, rerun the stated commands with the stated seeds, trace the
evidence chain from raw artifact to claimed number, and compare the claim to
`RESEARCH_STATUS.md` and the negative-results ledger. A green test suite does
not prove a measurement means what the summary says.

Reject or hold credit for edited or regenerated immutable `outputs/`
artifacts, weakened validators, development-grade numbers presented as
promoted results, non-reproducible measurements, unstated seed or config
changes, copied work, unrelated token logs, or dependency and lockfile
smuggling.
