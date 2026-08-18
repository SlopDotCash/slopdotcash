# Slop repository instructions

Slop is a GitHub-native incentive network for open-source work. The public
product promise is **make money shipping open source**: contributors use any
agent or model to ship useful work, maintainers accept outcomes in the project’s
own repository, and Slop publishes the score, review state, and verified
settlement record.

This is a private application, not a library. Cloudflare Pages serves the
static site at `slop.cash` and `slop.tech`; `eliza.army` is a compatibility
alias only.

## Product principles

- Score accepted outcomes, not activity.
- GitHub is the work, review, and policy authority.
- Automation proposes; maintainers decide.
- Projected, under-review, approved, scheduled, paid, unclaimed, held, and
  excluded are different states.
- Any provider, model, and agent client may participate when its exact identity
  is disclosed.
- Slop never infers copyright ownership, legal capacity, assignment, wallet
  control, or payment authority.
- Slop never holds keys, signs transactions, broadcasts payments, or claims
  success before public evidence proves it.
- Never publish secrets, prompts, responses, source files, credentials, session
  identifiers, private trajectories, or signing material.

## Source of truth

`projects/*/project.json` is the only project and repository inventory. Never
hardcode a project, repository, reward, steward, status, or funding route
elsewhere. Generated registries and public pages must stay synchronized from
those manifests.

Each `project.skill.sourcePath` is the one canonical contributor-skill source.
Do not maintain a second skill copy. `scripts/prepare-site.mjs` validates the
tree, copies raw Markdown endpoints, builds downloadable `.skill` archives,
and publishes the cycle index.

Generated files under `public/brand/`, `public/downloads/`,
`public/projects/`, `public/protocol/`, and `public/data/cycles/` are build
outputs. Never edit them by hand.

Operational guides under `backend/`, `cycles/`, `evaluations/`, `funding/`,
`protocol/`, and `workers/` define subsystem contracts. Keep them focused and
current.

## Repository map

```text
projects/       reviewed manifests and project policy
skills/         canonical contributor and CI reviewer skills
evaluations/    reviewed awards for otherwise-unscored useful work
cycles/         append-only reward lifecycle records
funding/        append-only direct-funding evidence
protocol/       public attribution and privacy contracts
backend/        private trace storage boundary
workers/        narrowly scoped Cloudflare services
src/            React product and strict browser/domain contracts
scripts/        ingestion, packaging, rewards, settlement, and evidence
skill-tests/    executable tests for bundled skill behavior
tests/          unit, integration, accessibility, and browser coverage
```

## Add a project

The public `/projects/new` route is the preferred starting point. It drafts a
manifest and agent brief, then hands the proposal to GitHub. The website does
not activate a project or create a private admin state.

A complete proposal adds:

```text
projects/<project-id>/project.json
skills/contribute-to-<project-id>/
skills/review-<project-id>-contributions/
```

New projects begin paused. Verify immutable repository and actor IDs, repository
license facts, GitHub stewardship, integration branch, reward policy, and
failure paths before activation. Stewardship is a GitHub identity only.

The contributor skill must inspect live GitHub, select bounded unblocked work,
follow the target repository’s rules, test the result, prepare evidence, and
emit the required attribution. It must not claim platform authority over an
issue or create placeholder submissions.

The reviewer skill is separate and advisory. It measures its own run, checks
correctness, tests, security, evidence, duplication, abuse signals, scope, and
usefulness, and places the machine review before the signed attribution footer.

## Installer and attribution

The public checksum detects corruption only. GitHub is the independent trust
root. The generated installer may authorize:

1. current `develop`;
2. a `develop` ancestor whose complete canonical skill tree is byte-identical
   to current `develop`; or
3. an open, non-draft, same-repository PR head into `develop` with the
   maintainer-controlled `slop-release-candidate` label applied after the exact
   current-head commit event.

Reject candidates behind or divergent from `develop`, missing or extra files,
working-tree provenance, stale label events, mutable redirects, and byte
mismatches. Preserve immutable sibling version directories, the process-bound
kernel lock, atomic relative-symlink activation, prior verified versions, and
explicit rollback reauthorization. Tests may inject only deterministic
`file://` authorities through the generator’s test option.

Every project-skill contribution carries a
`slop-contribution-attribution:v1` marker binding project, repository, run ID,
timestamps, exact provider/model/client, skill revision and digest, aggregate
pinned-ccusage figures, the private trace digest and upload identity, and an
Ed25519 device signature. A device signature proves byte continuity—not
provider billing truth. Raw token volume never changes score. A finalized
private trace adds a fixed 15% evidence bonus and outcome-matched exact or
bounded usage adds 10%, capped at 25% combined.

## Private traces

Every run uploads the minimized contribution-specific trace defined by
`protocol/private-trace-v1.md` before submission. The contributor inspects and
redacts the selected file; the uploader stores its exact bytes and performs no
automatic redaction.

Trace bodies are permanent private R2 objects. D1 stores only safe metadata and
digests. Contributors, project owners, and the public have no read route. Only
designated Slop operators may obtain a short-lived audited read grant through a
separate operator-controlled path.

The contributor upload route is write-only, bounded, authenticated,
checksum-verified, and fail-closed. Public artifacts contain only safe metadata
and the trace digest. Production activation remains blocked until the verified
private request intake required by the protocol is publicly available.

## Scoring and work selection

Snapshots retain every open issue and PR for source-count integrity. Each item
publishes a deterministic selection decision, and the UI advertises only
bounded unblocked candidates. Existing assignees, maintainer claims, drafts,
active review requests, approvals, changes requested, security labels,
human-gated work, and epics fail closed. Re-read live GitHub before acting.

The rolling ledger covers a complete 35-day window, publishes exact bounds and
record counts, and deduplicates immutable GitHub IDs. Exclude bots, self-review,
post-merge review, and repeated low-value comments. Every accepted merge gets
at least one-third point. Group split or related pull requests into one work
unit; do not apply account-level caps or diminishing credit.

Unusual useful work may score only through a strict reviewed `evaluations/`
manifest. Never double-score a source already rewarded by the ordinary ledger.
An LLM may recommend a hold or award but cannot autonomously ban, approve,
exclude, or move money.

## Rewards, funding, and settlement

Closed cycles live only at `cycles/<project>/<YYYY-MM>/` and bind exact source
snapshot bytes and scoring-rule version. The trusted first-of-month automation
runs from `develop`, is idempotent, refuses partial cycles, and records
zero-award months.

Monthly allocations use integer USDC micro-units and largest remainder. The 1%
fee applies to approved principal only. Never use floats for money or let
rollover increase a later monthly cap.

Proposal review lasts 14 days. Project owners may adjust awards within the cap
with a public reason. Wallet changes append a successor and reset review;
history is never edited. Missing wallets remain unclaimed. Related-party money
requires separate approval.

Settlement tools create unsigned Solana mainnet USDC plans only. `paid`
requires finalized evidence whose exact source and destination deltas reconcile
every immutable intent and fee. Reject replay, wrong mint, wrong owner, partial,
duplicate, failed, or overpaid state. Delta Star publishes external-prize
shares only and never enters the platform payment lifecycle.

Committed funding uses reviewed immutable third-party instruments: Squads v4
multisig vaults on Solana and Sablier Lockup v4 streams on Base or Ethereum.
Slop has no key, admin, or fee position. A positive committed amount requires
an active reviewed instrument and deterministic verifier evidence. Never call
funds “escrow” or “guaranteed.”

## Project authority and IP

Publish repository license facts as SPDX plus immutable LICENSE URL, commit, and
digest. Do not turn GitHub stewardship into an ownership claim. `unknown` and
`mixed` copyright terms with null legal fields are valid terminal states.

`sponsor-owned` remains schema-supported only when the project provides the
complete signed instrument set; otherwise fail closed. Legal arrangements are
executed outside Slop. External-prize shares allocate payout only and never
claim copyright.

## Deployment

Production deploys through the checked-in GitHub Actions workflow only. Never
deploy from a package script, local working tree, PR, feature branch, fork head,
or tag.

Required protected-environment secrets are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; Actions supplies `GITHUB_TOKEN` for ingestion. The
`eliza-army-production` environment allows only `develop`, requires the
designated reviewer, and disallows administrator bypass. Repository rules
require a pull request, resolved threads, and non-fast-forward history with no
bypass actors.

Push, schedule, and manual releases use the exact checked-out `develop` SHA.
The workflow installs lockfile-pinned Wrangler without lifecycle scripts,
deploys the verified build selected by `wrangler.toml`, and waits for a new,
clean Cloudflare production deployment bound to that SHA. Verify custom-domain
DNS, TLS, redirects, headers, and deployed bytes separately.

Claim the deploy/DNS lever on the issue before changing environment allowlists,
Pages, zones, nameservers, DNSSEC, custom domains, registrar state, or release
credentials.

## Working rules

- Preserve unrelated user changes and untracked files.
- Use a scoped branch from current `origin/develop`; rebase before final
  review.
- Prefer deterministic scripts and strict schemas over duplicated prose or
  fallback success.
- Keep UI loading, empty, stale, invalid, and error states distinct.
- Never fabricate an empty leaderboard after ingestion failure.
- Do not leave TODOs, placeholders, dead controls, or silent fallback success.
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

Run from the repository root:

```bash
bun run leaderboard:generate
bun run projects:check
bun run evaluations:check
bun run funding:check
bun run cycles:check
bun run typecheck
bun run lint:check
bun run format:check
bun run test
bun run build
bun run test:e2e
bun run verify
```

## Definition of done

Rebase onto current `origin/develop`, install the lockfile, run `bun run
verify`, and run real-browser E2E against the exact head. UI changes require
desktop and mobile review, keyboard and 200% zoom checks, WCAG AA, working copy
feedback, raw Markdown and archive downloads, valid GitHub links, zero
first-party request failures, and zero application console errors.

Attach exact-head evidence to the issue or PR: screenshots, accessibility
results, console/network logs, walkthrough, generated skill archive/checksum,
live GitHub snapshot, deploy log, immutable deployment URL, deployed-byte
comparison, DNS, TLS, redirects, and security headers. Use `N/A - <reason>`
only when genuinely inapplicable. Captured evidence is not committed.

A local test is not proof of merge. A merge is not proof of deployment. A
deployment is not proof of provider, device, identity, wallet, or settlement
availability. Report each boundary precisely.
