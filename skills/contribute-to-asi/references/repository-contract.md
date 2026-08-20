# ASI repository contract

The live repository is authoritative. Read root `CLAUDE.md`/`AGENTS.md`,
`RESEARCH_STATUS.md`, and the runbook for your lane before trusting anything
below.

| Parameter | Value |
| --- | --- |
| Repository | `SlopDotCash/asi` |
| Integration branch | `main` |
| Toolchain | Python 3.12+, JAX 0.4+ |
| Environment | the project venv: `.venv/bin/python` |
| Lint | `.venv/bin/python -m ruff check .` (line length 100) |
| Types | `.venv/bin/python -m mypy` (strict, py312) |
| Focused tests | `.venv/bin/python -m pytest tests/<file> -q -o addopts=""` |
| Evidence registry | `.venv/bin/alberta-evidence-status` |

`addopts` defaults to `-v`; override with `-o addopts=""` for quiet runs.

## The open lane

`alberta_framework/benchmarks/ipmnist_screening.py` is where hill-climbing
happens. Verify every flag against `--help` and
`outputs/ipmnist_screening/RUNBOOK.md` at your commit before running a wave.

```bash
.venv/bin/python -m alberta_framework.benchmarks.ipmnist_screening run \
  --config-name <arm> --seed <int> [--n-tasks 60] [--task-length 5000] \
  --out <new path> [--progress-every 10] [--noise-mode {step,pool}]

.venv/bin/python -m alberta_framework.benchmarks.ipmnist_screening merge \
  --shards <paths...> [--control-name <arm>] --output <new path>

.venv/bin/python -m alberta_framework.benchmarks.ipmnist_screening validate-proxy \
  --shards <paths...> --output <new path>
```

`--config-name` accepts only arms registered in the screening registry; the
CLI rejects anything else. Adding an arm means adding its spec plus a
bit-exact reduction-pin test showing it collapses to an existing arm when its
mechanism constant is inert.

Cost is strongly arm-dependent — a 60-task shard ranges from seconds for the
cheapest arms to hours for the per-step-noise controls, and 200-task
confirmation runs are minutes per seed for cheap arms. Read the recorded
`wall_clock_seconds` in existing shards to budget before launching a wave, and
pin `OMP_NUM_THREADS=1` per worker when running them in parallel.

`micro_continual` is the cheap Gaussian inner loop with an analytic Bayes
ceiling; its ordering is calibrated on the input-permutation family only, and
a micro win promotes nothing. `rule_discovery` drives automated update-rule
search with explicit search and holdout seed and task separation.

`alberta_framework/core/` holds the learners those lanes exercise — IDBD,
Autostep, SwiftTD, UPGD, continual backprop, Horde, actor-critic, world
models, options, feature lifecycles.

Benchmark executions run through CLIs, never inside pytest. Tests stay
CI-cheap unless explicitly registered as a scientific lane.

## Lanes that consume permanent resources

Do not issue a plan, reserve a seed, or start a shard in these without an
explicit written maintainer request:

- **IPMNIST v3 frozen lifecycle** — a failed or partial worker consumes that
  learner and seed identity permanently and may never be retried. Seed IDs
  consumed by v1 are permanently rejected.
- **Label-permuted EMNIST, slowly-changing regression, continual-IA v2** —
  unissued and nonpromoting.
- **Forager matched-current and matched-v3** — currently fail closed on source
  drift; no external-baseline comparison is admissible, and several forager
  roots are quarantined or chmod-frozen and must never be resumed, imported,
  or compared against.

## Artifacts and their validators

A screening run writes a versioned shard carrying its evidence policy
(`development_only`, `scientific_promotion_allowed: false`), the arm name and
hyperparameters, seed, noise mode, protocol config, per-task accuracy, loss
and plasticity vectors, wall clock, and the JAX/NumPy/Python environment.
Merging produces a summary with per-arm mean and standard error, per-seed
values, late-window slope, and — for arms sharing seeds with the control — a
`paired_vs_control` block with per-seed diffs and whether every seed improved.

The in-band validators refuse: an unknown arm name, non-finite or wrong-shape
per-task vectors, a negative or non-integer seed, shards spanning multiple
protocol configs, shards spanning multiple noise modes, and duplicate
arm/seed pairs. Output paths are refused if already occupied and written
atomically, so a completed shard is never silently overwritten. Collapsed runs
are excluded by these checks by design — do not loosen them to get a number.

`.venv/bin/alberta-evidence-status` reports the registry: exit `0` accepted,
`1` valid rejection or missing, `2` invalid. Exit `2` because registered
sources changed after artifacts were pinned is the design working, not a bug
to silence.

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
