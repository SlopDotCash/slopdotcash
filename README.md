# Slop on Vibestack

Make money shipping and securing open source.

This branch contains the specification-first rebuild of Slop on Vibestack.
The product requirements and state machines begin at [spec/index.md](spec/index.md).
The [migration record](docs/migration.md) explains the source revisions,
domain ownership, acceptance requirements and external evidence boundaries.

## Current phase

The branch starts a new Git history from the Slop Vibestack template. It contains
product specifications, Quint models, proof files and verification evidence.
The template greeting application and examples demonstrate the toolchain.
Application implementation follows specification review.

The [formal inventory](formal/README.md) maps the complete retained PRD and
all 473 original models to the new spec tree. The pinned PRD is preserved in
[docs/slop-product-requirements.md](docs/slop-product-requirements.md).
New project automatic-closure consent starts unchecked, as the owner confirmed
for this migration.

## Set up

Use Node 26, pnpm 10.24.0 and Dafny 4.11 on PATH.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Read [AGENTS.md](AGENTS.md), [SPEC.md](SPEC.md), and the relevant skills before
editing the spec. The full [Vibestack guide](vibestack/README.md) explains the
framework and its examples. All commands below run from the repository root.

## Commands

| Command | Result |
| --- | --- |
| `pnpm check` | Parse, typecheck, simulate, replay, prove and review the spec tree, then run applicable tests and conformance checks |
| `pnpm gen` | Generate the core and machine adapters from the spec |
| `pnpm dev` | Open Studio and the retained template application |
| `pnpm studio` | Open Studio for specification editing and review |
| `pnpm verify` | Run the complete template engineering gate |
| `pnpm accept` | Record the user's reviewed specification after every required check passes |

The tools own `gen/`, `.spec-cache/`, `.studio/` and `spec/lock.json`.
The user signs off the specification with `pnpm accept` after reviewing its
prose, Quint, proofs and validation results.

## Structure

| Path | Contents |
| --- | --- |
| `spec/` | One product specification tree organized by domain |
| `formal/` | Source provenance, coverage mappings and verification records |
| `reference/slop-main/formal/` | Exact original Quint models and source inventories |
| `docs/` | Migration and pinned product-policy sources |
| `apps/app/` | The retained Vibestack greeting application |
| `packages/` | The template's shared React components and design system |
| `vibestack/` | The framework, Studio, examples and toolchain guide |

Slop's license is retained at [LICENSE](LICENSE). The framework's license is
retained at [vibestack/LICENSE](vibestack/LICENSE).
