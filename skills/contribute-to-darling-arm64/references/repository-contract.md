# Repository contract — xchemtina/darling-arm64

What the repository contains, what runs where, and which invariants a contribution must
not break. Read this before choosing work; read
[evidence-contract.md](evidence-contract.md) before deciding what proof it needs.

## The two-host split

This is the fact that determines everything else.

| Host | Architecture | Runs |
|---|---|---|
| **VM** | aarch64 **Linux** | Darling itself, the ladder, every probe and gate |
| **Host** | arm64 **macOS** | Corpus construction and native ground-truth capture |

Darling is a translation layer, not a CPU emulator: the host architecture must match the
binary architecture. An x86_64 machine cannot produce a valid result for this project at
all — not a weaker one, none.

The Darling **source tree lives inside the VM**, not in this repository. Do not clone the
Darwin sources on the macOS side: APFS is case-insensitive by default and the Darwin tree
has case-colliding filenames. This repository sits *beside* the source tree and measures
it.

## Layout

| Path | Runs on | What it is |
|---|---|---|
| `tools/` | VM | Measurement harnesses. Named for the finding that produced them (`fNNN-*`), so a number in `FINDINGS.md` leads directly to the tool that measured it. |
| `scripts/` | host | Staging: VM setup, corpus construction, native ground-truth capture, staged builds. Numbered by stage (`00-`, `10-`, `30-`…). |
| `evidence/` | — | Raw measurement output cited by specific findings. |
| `report/` | — | Written reports and figures. |

## Ordered entry points

```sh
scripts/00-vm-setup.sh              # VM:   dependencies + the arm64 source tree
scripts/10-make-corpus.sh           # host: build corpus, capture native ground truth
scripts/30-build.sh [configure|core|all]   # VM: staged build
scripts/20-run-corpus.sh            # VM:   run the corpus, score against ground truth
tools/reproduce.sh                  # VM:   ladder -> Silver gates -> leak short-cycle
```

`REPRODUCE.md` maps every headline claim to the exact harness that regenerates it. Start
there rather than guessing which tool to run.

## Invariants a contribution must not break

1. **Never commit Apple-owned assets.** The dyld shared cache, application bundles, the
   Swift toolchain and all corpus binaries stay on the machine that captured them.
   `scripts/10-make-corpus.sh` rebuilds the corpus locally. Do not add a test that
   requires any of them to be published.
2. **Never edit a gate, a checksum, or a threshold to make something pass.** The gates are
   the measurement. Changing one to obtain a green result destroys the only thing this
   repository sells.
3. **Never vendor from a fork that strips upstream GPL-3.0 attribution.** One such fork
   was evaluated and rejected on exactly that ground.
4. **A tool must be named for its finding.** `fNNN-*`, matching the number in
   `FINDINGS.md`. An unnamed harness is unreachable from the record.
5. **Retractions stay in place.** If you overturn a recorded claim, cite it and leave the
   correction next to the evidence that falsified it. Do not silently reword.

## Traps that will cost you hours

`STATE.md` §Traps documents them, each of which already cost real time. The most expensive:

- **`git-lfs` is required.** Without it, Swift libraries stage as 130-byte pointer files
  and every downstream number is meaningless (F104, trap 53).
- **Submodule contamination.** A north-star checkout can silently pick up the *unpatched*
  upstream submodule; verify what you actually built.
- **Environment flags contaminate gates.** Flags must be flipped in the probe **and all
  seven launchd plists together**, or the test measures the mismatch rather than the
  change. `tools/f109-thread-bridge-discriminator.sh` shows the pattern: flip in a
  temporary copy, verify the count at every site, refuse to run a contaminated arm.
- **Long operations really are long.** Dependency installation, the ~149-submodule clone,
  and builds run tens of minutes to hours. Run them in the background and poll; silence
  is not failure.
- **Capture the first error, not the tail.** CMake and make bury the root cause above
  hundreds of follow-on lines.

## Evidence is kept since F108

The Silver gate writes probe stdout to a fixed `/tmp` path every run, and the real-runtime
drivers used to `rm -rf` the artifact directory before each iteration — so `iterm2-job.err`,
where a crash is actually visible, died seconds after every failure. Since F108,
`tools/f103-stage18-ab.sh` and `tools/f101-realworld.sh` keep a failing run's artifacts as
`run<N>-artifacts/` plus `run<N>-probe.log`. Follow that pattern in any new driver: a run
may never destroy the evidence of the previous one.

## Where fixes belong

A defect in Darling belongs **upstream** in `darlinghq/*`. The pattern this project
follows: prove it here with a harness, send the fix upstream, and link the upstream pull
request from the finding. Three fixes have gone that route —
[`darling-cocotron#70`](https://github.com/darlinghq/darling-cocotron/pull/70) (merged),
[`#71`](https://github.com/darlinghq/darling-cocotron/pull/71), and
[`darlingserver#17`](https://github.com/darlinghq/darlingserver/pull/17).

Respect the upstream repository's own contribution policy when you get there; it is not
this one.
