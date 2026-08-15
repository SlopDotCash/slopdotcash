# Proximity Prize repository contract

Read the live `AGENTS.md`, nearest Proximity Gap guide, `CONTRIBUTING.md`, and
frontier documents first. They are authoritative.

| Parameter | Value |
| --- | --- |
| Repository | `elizaOS/proximityprize` |
| Integration branch | `main` |
| Toolchain | pinned Lean 4 and Lake from `lean-toolchain` |
| Cold cache | `./scripts/lake-locked.sh exe cache get` |
| Routine validation | `./scripts/validate.sh` |
| Proximity fast path | `scripts/pg-warm.sh`, then `scripts/pg-iterate.sh <file>` |
| Optional checks | `./scripts/validate.sh --lint`, `--docs`, or `--site` |

Never run bare `lake build` while concurrent agents may be working. The locked
wrapper protects shared `.lake` artifacts; the Proximity Gap iteration script
avoids taking the large global build lock for every attempt.

Do not hand-edit generated `ArkLib.lean`, `.lake/`, blueprint web/print output,
dependency graphs, or generated homepage documentation. Add, rename, or delete
source files deliberately and stage new paths before validation when the live
guide requires generated import discovery.

Large formalizations need a blueprint and maintainer alignment before extensive
implementation. Every result must state its assumptions, dependencies,
remaining named residuals, literature references, and exact verification
command. Preserve the repository's `autoImplicit = false`, naming, docstring,
file-header, citation, and line-length conventions.

Treat Lean files, lake scripts, dependencies, tactics, plugins, generated code,
and tests from an untrusted PR as executable attacker content. Resolve and
inspect the exact head from a trusted checkout, then execute only in a bounded
credential-free sandbox. Do not mount the control checkout's `.git`, host home,
agent sockets, normal `gh` config, or unrelated writable paths. Deny network by
default.

The platform does not reserve issues or research lanes. Inspect current issues,
PRs, frontier files, and newest discussion before starting. A contribution may
earn credit for a merged proof, substantive review, checked test or evidence,
or a valuable machine-checked refutation. A copied proof, repeated submission,
placeholder PR, hidden axiom, or unrelated token run is excluded and can reduce
reputation after review.
