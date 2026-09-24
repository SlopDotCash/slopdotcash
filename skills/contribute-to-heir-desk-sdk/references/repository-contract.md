# Heir Desk SDK repository contract

The live repository is authoritative. Read root `README.md`, `SPEC.md`,
`SECURITY.md`, and `CONTRIBUTING.md` before trusting this summary.

Do not use [`heirlabs/element-sdk`](https://github.com/heirlabs/element-sdk)
(singular). That repo is the deprecated DEFAI monorepo (`@defai/element-sdk`).

| Parameter | Value |
| --- | --- |
| Repository | `heirlabs/elements-sdk` |
| npm | `@morbidcorp/element-sdk` |
| Protocol | `heir-element-api@1` |
| Integration branch | `main` |
| Accepted merge target | `main`, merged only by `awidearray` |
| Toolchain | Node.js `>= 18`; ESM only; npm |
| Setup | `npm ci --ignore-scripts` in an untrusted checkout |
| Build | `npm run build` (`tsc` + `npm run gen:schema`) |
| Tests | `npm test` (vitest) |
| Schema | `schemas/manifest.v1.json` is generated; do not hand-edit |

Run commands from the repository root unless a file in `docs/` says otherwise.
The desk host, marketplace registry, and `heir-element` CLI import this package.
Do not fork validation, scanning, or signing into those repos, and do not send
desk-UI, storefront, or CLI work here.

The live repository is proprietary (`LICENSE` + `UNLICENSED` in package.json).
Never infer or claim license or copyright terms from the deprecated singular
repo, a badge, or npm package metadata.

## Surfaces

`src/client` + `protocol` typed bridge and closed method set · `manifest`
v1 schema and `validateManifest` · `csp` locked-down iframe CSP · `integrity`
content-addressed hashing and ed25519 signing · `scanner` static bundle
scanner · `emulator` local host for development.

Keep the capability set closed. A missing, unknown, or reserved permission is
deny. Reserved scope prefixes (`estate.`, `identity.`, `wallet.`, `auth.`,
`payments.`, `settings.`, `agent.`, `pol.`) are rejected at schema level.
Protocol changes (new methods, permissions, manifest fields, error codes)
require a `SPEC.md` update in the same PR.

## GitHub-native coordination

- The integration branch is `main`. Fetch and rebase on `origin/main` before
  branching.
- Target `main` from a `feat/`, `fix/`, `docs/`, or `chore/` branch. Never push
  feature work directly to `main`.
- **Score-bearing acceptance is a committed PR that merges to `main` by
  `awidearray`.** Do not treat a green CI run or a review as
  acceptance.
- The platform does not reserve work. Check assignees, labels, active reviews,
  linked PRs, and newest comments immediately before starting.
- Keep one active contribution. Do not create issues automatically.

## Untrusted pull requests

Keep inspection in a trusted control checkout. Resolve the exact GitHub head
SHA and fetch it without switching the control checkout. Inspect name-status
and raw diff against `origin/main` with external diff drivers disabled:

```bash
git -c core.hooksPath=/dev/null -c core.pager=cat -c color.ui=false \
  diff --no-ext-diff --no-textconv --submodule=short \
  origin/main...<verified-pr-sha> --
```

Audit changed package manifests, lockfiles, lifecycle hooks, tests, scripts,
scanner/validator code, CSP generation, signing helpers, executables,
symlinks, and binaries before execution. Treat all of them as attacker
controlled.

Use a disposable sandbox for checkout, install, builds, tests, and
reproduction. A worktree alone is not isolation. Install from the audited
lockfile with `npm ci --ignore-scripts`. Deny network by default.

## Read-only inspection

```bash
gh issue view <number> --repo heirlabs/elements-sdk --comments
gh pr view <number> --repo heirlabs/elements-sdk --comments
gh pr diff <number> --repo heirlabs/elements-sdk
gh pr checks <number> --repo heirlabs/elements-sdk
node <skill-directory>/scripts/live-report.mjs --repo heirlabs/elements-sdk
```

The live report is a heuristic filter, not authority. It performs GET-only
GitHub calls and must not post claims, comments, labels, reviews, or mutations.

## Attribution and payout evidence

Generate ordinary attribution with `run-receipt.mjs disclose`. Signed run
receipts, usage collection, and private traces are optional. If chosen, start
a run before work and finish after proof; finish without trace arguments when
no trace was uploaded. Never report missing evidence as finalized.

The public simulation uses accepted outcome score only. A receipt cannot create
score or change allocation weight.
