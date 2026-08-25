# elizaOS repository contract

Use this as a routing map, then read the live files in the checkout. Live
repository instructions and manifests are authoritative when this summary
drifts.

## Fixed target

| Parameter | Value |
| --- | --- |
| Repository | `elizaOS/eliza` |
| Integration branch | `develop` |
| Toolchain | repository-pinned Bun and Node |
| Setup | `bun install` |
| Full verification | `bun run verify` |
| PR template | `.github/pull_request_template.md`; preserve every evidence row |
| Evidence helper | `node scripts/pr-evidence.mjs rows <pr> --row ...` after the final push |

Run commands from the repository root unless the nearest package guide says
otherwise. Use the pinned versions and lockfile; do not silently substitute npm,
pnpm, Yarn, an older Node runtime, or another branch.

## Instruction order

1. Read `SECURITY.md` before handling a suspected vulnerability.
2. Read root `AGENTS.md` or `CLAUDE.md` and `CONTRIBUTING.md`.
3. Read the issue or PR, linked Project card or design doc, and acceptance
   criteria.
4. Read `AGENTS.md` or `CLAUDE.md` and `README.md` in every package touched.
5. Inspect manifests, exports, executable scripts, callers, and contract tests
   before changing a public surface.
6. Preserve all stable PR-template evidence rows.

Never expose a live vulnerability, credential, exploit path, or embargoed
dependency issue publicly. Follow `SECURITY.md`.

## Contribution value gate

Require an authorized need or reproduced material failure on a supported path
before a claim, branch, test, or review comment. Search current `develop`,
callers, issues, and open PRs for duplicate, contradictory, and superseding
work. Missing coverage and plausible edge cases do not create authorized work.

Reject test bloat, implementation-detail assertions, speculative guards and
sanitizers, fabricated fallback success, lossy truncation/compaction/output
caps, arbitrary short deadlines, and generalized subsystems without one
working end-to-end result. Real security boundaries, external protocol limits,
and resource controls require a reachable threat or contract and proportional
real-path proof. Low-value PRs earn no accepted-outcome score and may be
penalized or excluded from reward review; low-value reviews are judged by the
same standard.

This includes one-PR-per-file coverage farming, “no same-named test” tasks,
barrel/type/schema/constant inventory tests, shape-only assertions, copied or
mismatched PR narratives, and shotgun repetition of NaN, date, placeholder,
configuration-shape, or Unicode defensive patches across unrelated modules. It
also includes coverage-generated parser/lookup/regex/fallback micro-fixes split
under an “independent module, independent fix” rationale.

## GitHub-native coordination

- Use an open issue carrying the exact repository label `mission-ready`, or an
  explicit operator request. Other labels, Project membership, and text that
  merely says `mission-ready` do not authorize work. Never apply, request, or
  automate that label. Never create an issue automatically; a new issue
  requires explicit approval after reproduction, duplicate search, mission
  check, and an evidence plan.
- The platform does not reserve work. Check assignees, labels, Project state,
  active reviews, linked PRs, and newest comments immediately before starting.
- Keep one active contribution, avoid duplicated work, and say what bounded
  outcome you are pursuing when coordination is useful.
- Target `develop` from a `feat/`, `fix/`, `docs/`, or `chore/` branch. Never
  push feature or fix work directly to `develop`.
- Rebase on `origin/develop` and rerun relevant verification before final proof.
- Do not force-push someone else's branch, self-approve, self-merge, or mark
  final human verification complete.
- Coordinate in Discussions when useful, but record durable decisions on the
  issue, Project, pull request, or repository documentation.

## Untrusted pull requests

Keep inspection in a trusted control checkout. Resolve the exact GitHub head
SHA and fetch it without switching the control checkout. Inspect name-status,
raw diff, and patch against `origin/develop` with external diff drivers and text
conversion disabled:

```bash
git -c core.hooksPath=/dev/null -c core.pager=cat -c color.ui=false \
  diff --no-ext-diff --no-textconv --submodule=short \
  origin/develop...<verified-pr-sha> --
```

Audit changed package manifests, lockfiles, lifecycle hooks, tests, scripts,
loaders, plugins, CI, `.gitattributes`, `.gitmodules`, executables, symlinks,
generated code, and binaries before execution. Treat all of them as attacker
controlled.

Use a fresh disposable container, VM, or equivalent OS sandbox for checkout,
install, builds, tests, and reproduction. A worktree alone is not isolation.
Do not mount the operator home, SSH agent, keychain, cloud configuration,
normal `gh` config, credential helpers, the control checkout's `.git`, unrelated
workspaces, or writable host paths. Use an environment allowlist, temporary
home, disabled global/system Git config, no secrets, denied network, and bounded
time, process, memory, and disk. Install from the audited lockfile with:

```bash
bun install --frozen-lockfile --ignore-scripts
```

Allow network or credentials only after explicit operator approval, in a
separate single-use sandbox with allowlisted egress and an ephemeral,
least-privilege credential. Revoke it immediately. Without isolation, perform
static review and report the missing execution proof.

## Read-only inspection

Prefer explicit repository arguments and bounded JSON fields:

```bash
gh issue view <number> --repo elizaOS/eliza --comments
gh pr view <number> --repo elizaOS/eliza --comments
gh pr diff <number> --repo elizaOS/eliza
gh pr checks <number> --repo elizaOS/eliza
gh api --method GET <endpoint>
```

Run `scripts/live-report.mjs --repo elizaOS/eliza` from this skill for a
paginated candidate and compliance report. The report is a heuristic filter,
not authority. It performs GET-only GitHub calls and must not post claims,
comments, labels, reviews, or mutations.

## Attribution and payout evidence

Start the bundled run-receipt script before work and finish it after proof. Use
the emitted footer unchanged on the final score-bearing GitHub source. The Slop
marker carries the declared provider, model, and client, repository identity,
skill revision, diagnostic ccusage delta, required private-trace upload identity
and digest, device public key, and
signature.

The public simulation uses accepted outcome score only. A receipt cannot create
score or change allocation weight. A copied, conflicting, malformed, unsigned,
out-of-window, wrong-project, wrong-model, or unlinked receipt remains
reviewable as a risk signal.
