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

The [verification record](formal/verification.md) links checked proofs,
Quint replay evidence and remaining legacy equivalence and implementation
checks. Specification review and acceptance remain open.

## Set up

Use Node 26, pnpm 10.24.0 and Dafny 4.11 on PATH.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm install` also creates any missing project-relative skill links in
`.agents/skills/` and the other agent harness directories; `CLAUDE.md` is a
symlink to `AGENTS.md`.

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
| `pnpm verify` | Run the complete template engineering gate, including Knip, Madge and jscpd |
| `pnpm accept` | Record the user's reviewed specification after every required check passes |

The tools own `gen/`, `.spec-cache/`, `.studio/` and `spec/lock.json`.
The user signs off the specification with `pnpm accept` after reviewing its
prose, Quint, proofs and validation results.

## Contributing

Open every pull request against `develop`, Slop's default
branch. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md), including the
[TypeScript conventions](AGENTS.md#typescript-best-practices).

- Verify that the proposed merge fully implements and integrates the stories
  and models in the [top-level spec](spec/index.md) and its linked specs. Every
  change must match the owning stories, rules and models exactly.
- Show before-and-after results for every code change. For UI changes, attach
  before-and-after screenshots of the affected flow. Remove unused code,
  unnecessary files and temporary artifacts from the diff.
- Run the complete `pnpm verify --continue` suite for every pull request,
  including Quint, Dafny, Bombadil and all other required checks. Record the
  results and verify that every required check passes and all Vibestack
  requirements are met before merging.

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
