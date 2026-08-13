# ASI repository contract

Read the live root `CLAUDE.md`/`AGENTS.md`, `RESEARCH_STATUS.md`, and the
runbook for the lane you touch first. They are authoritative.

| Parameter | Value |
| --- | --- |
| Repository | `elizaOS/asi` |
| Integration branch | `main` |
| Toolchain | Python 3.12+, JAX 0.4+ |
| Install | `pip install -e .` from the repository root |
| Routine validation | focused `pytest` on the touched surface, then the lane's required checks |
| Evidence registry | `alberta_framework/evaluation/` validators and `outputs/` artifacts |

The framework layout: `alberta_framework/core/` (learners, optimizers such as
IDBD/Autostep/SwiftTD/UPGD, Horde, world models, options), `streams/`
(synthetic prediction and control streams), `evaluation/` (strict evidence
artifacts and validators), `benchmarks/` (IPMNIST and forager campaign lanes),
`utils/`, and `steps/` (Alberta Plan Step 1–12 kernels), with ~450 test files
under `tests/`.

Evidence rules are fail-closed. Stored campaign artifacts and receipts under
`outputs/` are immutable: never edit, regenerate in place, or delete them to
make a claim pass. Development-grade measurements are permanently
nonpromoting; promotion requires the reproducibility gates described in
`RESEARCH_STATUS.md`. Record negative results in
`NEGATIVE_RESULTS_LEDGER.md` conventions rather than deleting failed lanes,
and check that ledger before re-trying an idea.

Keep `requires-python >= 3.12` and the `numpy >= 1.26` floor intact. Use
seeded, deterministic experiment configurations; a result that cannot be
reproduced from the stated seed, config, and commit is not evidence.

Treat Python modules, configs, notebooks, generated code, and tests from an
untrusted PR as executable attacker content. Resolve and inspect the exact
head from a trusted checkout, then execute only in a bounded credential-free
sandbox with network denied by default. Do not mount the control checkout's
`.git`, host home, agent sockets, normal `gh` config, or unrelated writable
paths.

The platform does not reserve issues or research lanes. Inspect current
issues, PRs, runbooks, and newest discussion before starting. A contribution
may earn credit for a merged change, substantive review, checked test or
validator, reproducible refutation, or reused evidence artifact — acceptance
is always a maintainer decision.
