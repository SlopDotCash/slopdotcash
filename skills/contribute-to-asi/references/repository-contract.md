# ASI repository contract

The live repository is authoritative. Read root `CLAUDE.md`/`AGENTS.md`,
`RESEARCH_STATUS.md`, and the runbook for your lane before trusting anything
below.

| Parameter | Value |
| --- | --- |
| Repository | `elizaOS/asi` |
| Integration branch | `main` |
| Toolchain | Python 3.12+, JAX 0.4+ |
| Environment | the project venv: `.venv/bin/python` |
| Lint | `.venv/bin/python -m ruff check .` (line length 100) |
| Types | `.venv/bin/python -m mypy` (strict, py312) |
| Focused tests | `.venv/bin/python -m pytest tests/<file> -q -o addopts=""` |
| Evidence registry | `.venv/bin/alberta-evidence-status` |

`addopts` defaults to `-v`; override with `-o addopts=""` for quiet runs.

## Where the benchmarks live

`alberta_framework/benchmarks/` holds the lanes — the IPMNIST family
(`upgd_ipmnist`, `upgd_ipmnist_v3`, `ipmnist_screening`, `upgd_label_emnist`),
the forager family (`official_foragax`, the matched-current and matched-v3
campaign machinery, `foragax_open_screen`), and
`slowly_changing_regression`. `alberta_framework/core/` holds the learners and
optimizers those lanes exercise (IDBD, Autostep, SwiftTD, UPGD, continual
backprop, Horde, actor-critic, world models, options, feature lifecycles).

Benchmark executions run through console scripts and CLIs, never inside
pytest. See `[project.scripts]` in `pyproject.toml` for the current set; get
the exact invocation for a lane from that lane's runbook and its `--help`,
at the commit you are working on. Do not copy a command line out of an old
pull request.

Tests must stay CI-cheap unless explicitly registered as a scientific lane.

## Marker lanes

`unit` fast isolated behaviour · `integration` across components or process
boundaries · `scientific` frozen promoted-evidence protocols · `development`
calibration and exploration, never promoting · `replication` historical
replays · `slow` wall-clock heavy, excluded from the fast CI lane
(`-m "not slow"`).

A development-grade measurement is permanently nonpromoting. Saying so
plainly is required, not optional.

## Evidence promotion is fail-closed

- **Never auto-promote.** Passing tests, replays, or reruns do not upgrade a
  claim. Promotion requires a frozen preregistered protocol, untouched
  held-out seeds, a versioned artifact schema, and its strict validator
  accepting the artifact.
- **Frozen seeds stay frozen.** Calibration and development seeds, and
  consumed evidence seeds, can never be reused for promotion.
- **Pinned `outputs/` artifacts are immutable.** Never overwrite, edit, or
  delete pinned evidence, historical chains, sealed or quarantined roots, or
  chmod-frozen negative-result directories. New runs write to new paths and
  new schema versions. The active campaign directories are append-only.
- **Registered source hashes are load-bearing.** Editing a registered source
  file invalidates persisted evidence until the frozen protocol is rerun; the
  registry then reports `invalid` and exits `2`. That is the design working,
  not a bug to silence. Check which files a claim registers before editing.
- Thresholds are calibrated on development data with wide margins and then
  frozen. Retuning a threshold after seeing held-out results is disallowed.
- Library changes are failing-test-first; state is frozen chex dataclasses;
  RNG uses explicit `jr.key(...)` seeds.

Some documents are hashed into run provenance or asserted byte-for-byte by
tests, so edits to them change receipts or break the suite. Check before
editing a root document.

## Keeping the framework importable

The elizaOS robot track imports a subset of `alberta_framework.core` in
process. Keep `alberta_framework/__init__.py` importable, keep
`requires-python >= 3.12` and the `numpy >= 1.26` floor intact, and treat any
module deletion as a two-file change.

## Untrusted execution

Treat Python modules, configs, notebooks, generated code, and tests from an
untrusted branch as executable attacker content. Resolve and inspect the exact
head from a trusted checkout, then execute only in a bounded credential-free
sandbox with network denied by default. Do not mount the control checkout's
`.git`, host home, agent sockets, normal `gh` config, or unrelated writable
paths.

## Coordination

The platform reserves nothing. Inspect current issues, discussions, pull
requests, and runbooks immediately before starting, and say in the open what
you are about to run. Benchmark compute is the scarce resource here;
duplicated runs are the main way it is wasted.
