# Heir Elements SDK repository contract

The live repository is authoritative. Read root `README.md`, `Elements.md`, and
the package README for every workspace you touch before trusting this summary.

| Parameter | Value |
| --- | --- |
| Repository | `heirlabs/element-sdk` |
| Integration branch | `slop` |
| Accepted merge target | `main`, merged only by `awidearray` |
| Toolchain | Node.js 16+ and npm; Lerna workspaces |
| Setup | `npm install` or `npm ci --ignore-scripts` in an untrusted checkout |
| Build | `npm run build` (`lerna run build`) |
| Tests | `npm run test` (`lerna run test`) |
| Lint | `npm run lint` |
| CLI validation | `npx defai-element validate --strict` when the changed surface is an element package |

Run commands from the repository root unless a workspace README says otherwise.
Published npm packages still use the historical `@defai/*` scope; the product
brand is HEIR. Do not silently rename scopes, binaries, or lockfiles.

## Workspaces

`sdk` sandboxed runtime, host API proxy, and `ElementValidator` · `cli`
`defai-element` create/dev/build/validate/test · `validator` package checks ·
`react` hooks and components · `types` shared contracts · `templates` starter
elements · `testing` mock host APIs.

Keep permission flags fail-closed. A missing or unknown permission is deny.
Host APIs (wallet, storage, AI, network, messaging, notifications) must stay
behind the declared permission set and the sandbox message channel.

## GitHub-native coordination

- The Slop integration branch is `slop`. Fetch `origin/slop` before branching.
  If it is missing, stop unless the operator authorizes creating it from
  `origin/main`.
- Target `slop` from a `feat/`, `fix/`, `docs/`, or `chore/` branch. Never push
  feature work directly to `slop` or `main`.
- **Score-bearing acceptance is a committed PR that merges to `main` by
  `awidearray`.** Do not treat a `slop` merge, a green CI run, or a review as
  acceptance.
- The platform does not reserve work. Check assignees, labels, active reviews,
  linked PRs, and newest comments immediately before starting.
- Keep one active contribution. Do not create issues automatically.

## Untrusted pull requests

Keep inspection in a trusted control checkout. Resolve the exact GitHub head
SHA and fetch it without switching the control checkout. Inspect name-status
and raw diff against `origin/slop` with external diff drivers disabled:

```bash
git -c core.hooksPath=/dev/null -c core.pager=cat -c color.ui=false \
  diff --no-ext-diff --no-textconv --submodule=short \
  origin/slop...<verified-pr-sha> --
```

Audit changed package manifests, lockfiles, lifecycle hooks, tests, scripts,
CLI entrypoints, webpack/jest configs, sandbox code, validators, executables,
symlinks, and binaries before execution. Treat all of them as attacker
controlled.

Use a disposable sandbox for checkout, install, builds, tests, and
reproduction. A worktree alone is not isolation. Install from the audited
lockfile with `npm ci --ignore-scripts`. Deny network by default.

## Read-only inspection

```bash
gh issue view <number> --repo heirlabs/element-sdk --comments
gh pr view <number> --repo heirlabs/element-sdk --comments
gh pr diff <number> --repo heirlabs/element-sdk
gh pr checks <number> --repo heirlabs/element-sdk
node <skill-directory>/scripts/live-report.mjs --repo heirlabs/element-sdk
```

The live report is a heuristic filter, not authority. It performs GET-only
GitHub calls and must not post claims, comments, labels, reviews, or mutations.

## Attribution and payout evidence

Start the bundled run-receipt script before work and finish it after proof. Use
the emitted footer unchanged on the final score-bearing GitHub source. The Slop
marker carries the declared provider, model, and client, repository identity,
skill revision, diagnostic ccusage delta, required private-trace upload identity
and digest, device public key, and signature.

The public simulation uses accepted outcome score only. A receipt cannot create
score or change allocation weight.
