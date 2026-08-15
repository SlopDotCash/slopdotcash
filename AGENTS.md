# @elizaos/slopdotcash

Standalone Vite site and Git-backed incentive protocol for Slop. The public
authorities are `slop.cash` and `slop.tech`; `eliza.army` remains a
compatibility alias.

## Purpose

This package publishes project discovery, installable contributor skills,
separate CI reviewer skills, signed aggregate usage receipts, a live work queue,
project and global leaderboards, permanent contributor profiles, monthly reward
proposals, and verified settlement records. `projects/*/project.json` is the
source of truth for project policy. The generated project and repository
registries must be synchronized from those manifests; never hardcode a project
or target repository elsewhere. This is a private application, not a library.
Cloudflare Pages serves the static build; GitHub Actions refreshes public data
and deploys only after package checks pass.

Each `project.skill.sourcePath` is the one canonical contributor-skill source.
Never maintain a second skill copy. `scripts/prepare-site.mjs` validates every
tracked tree, copies raw Markdown endpoints, builds downloadable `.skill`
archives, and publishes the validated cycle index.

The public checksum is only a corruption check. The generated installer uses
GitHub as an independent trust root: the revision must be current `develop`, a
`develop` ancestor whose complete canonical skill tree is byte-identical to
current `develop`, or an open, non-draft, same-repository PR head into `develop`
with the maintainer-controlled `slop-release-candidate` label. It
recursively
requires the label event to follow the exact current-head commit event, rejects
candidates behind or divergent from current `develop`, and compares the bounded
canonical Contents API file set and immutable raw bytes with the archive.
Working-tree provenance, extra files, and missing files fail closed. Local
versions are immutable sibling directories behind an atomic
relative symlink; a process-bound kernel lock survives interrupted commands
without leaving a stale denial. Updates require an ancestor relationship and
retain the prior verified version. Rollback is explicit: both active and target
trees are byte-verified against GitHub, and the requested target is
reauthorized against current GitHub state immediately before activation. A
canonical per-version authorization receipt preserves the entry-time candidate
PR identity needed to verify a later squash-merge transition; it neither
authorizes rollback nor replaces source-byte verification. Never weaken the
fixed production GitHub origins, the concurrency lock, or the version/symlink
invariants. Tests may inject only deterministic `file://` authorities through
the generator's test option, never environment variables.

## Layout

```text
assets/               repository-owned elizaOS brand assets
projects/             reviewed project manifests and reward policy
skills/               canonical contributor and CI reviewer skills
evaluations/          reviewed awards for useful otherwise-unscored work
cycles/               append-only reward lifecycle records
skill-tests/          bun tests for the bundled skill scripts
src/                  React UI and strict domain/browser contracts
public/               Pages headers/redirects plus generated site assets
scripts/              ingestion, packaging, rewards, settlement, evidence
tests/                unit and real-browser coverage
PRODUCT.md            users, purpose, principles, accessibility
DESIGN.md             visual system and interaction rules
wrangler.toml         Cloudflare Pages Direct Upload contract
```

Generated files under `public/brand/`, `public/downloads/`, `public/projects/`,
`public/protocol/`, and `public/data/cycles/` are produced by `prepare:site`.
Do not edit them by hand.

## Commands

Run from the repository root:

```bash
bun run dev
bun run leaderboard:generate
bun run projects:check
bun run evaluations:check
bun run cycles:check
bun run rewards:close-month -- --cycle YYYY-MM
bun run test
bun run typecheck
bun run lint:check
bun run format:check
bun run build
bun run test:e2e
bun run test:e2e:record
bun run test:e2e:record:production
```

`leaderboard:generate` reads GitHub through the authenticated `gh` CLI or
`GITHUB_TOKEN`; it fails loudly when live data cannot be loaded. The UI keeps
loading, empty, stale, and error states distinct. Never fabricate an empty or
zero leaderboard after an ingestion failure.

The local evidence command builds and records the local preview, but refuses a
missing, empty, malformed, or older-than-eight-hours live ledger. The
production command never rebuilds: it records only the existing `dist`, targets
exactly `https://slop.cash`, byte-compares the deployed skill and ledger
artifacts with that directory, and records DNS, TLS, redirect, and security
header checks. Both modes capture into a fresh sibling staging directory,
validate every artifact and digest, and publish the evidence directory only as
one complete transaction.

## Contribution scoring contract

- Score accepted outcomes, not raw activity.
- Collect and deeply verify the complete rolling 35-day window so a
  first-of-month job can freeze every event in the prior UTC month. Publish the
  exact bounds and record counts; never silently sample.
- Keep rules versioned, public, and deterministic.
- Deduplicate by immutable GitHub IDs.
- Exclude bots, self-review, post-merge review, and repeated low-value comments.
- Give every accepted merge positive diminishing credit with no scoring cap.
  Apply declared limits to the other categories by contributor, project, and
  UTC month. Input order must not select which outcomes receive higher marginal
  credit or survive a limit.
- Permit unusual useful work only through a strict `evaluations/` manifest whose
  public Slop PR is the human decision. Never score a source already rewarded
  by the ordinary GitHub ledger.
- Model and token disclosure are supporting provenance, not proof. Token
  receipts are diagnostic only and never change score, rank, or simulated
  share.
- Every public snapshot records its repository registry with per-item
  repository attribution, the primary repository, window, rule version,
  generation time, source cutoff, and any staleness.
- Refuse reward proposals when deep evidence verification is incomplete or
  suppressed by a bound.

## Work-candidate selection contract

The snapshot retains every open issue and PR for source-count integrity, but
each item publishes a deterministic `selection` decision. The UI advertises
only bounded, unblocked candidates and always links back to live GitHub. There
is no platform claim or reservation authority. Existing assignees, maintainer
claim labels/comments, drafts, active review requests, approvals, changes
requested, security-sensitive labels, human-gated work, and epics are
fail-closed selection signals. Users and agents must re-read live GitHub before
acting.

## Model attribution

Contributions made through a project skill must carry the machine-readable
`slop-contribution-attribution:v1` marker. It binds project, repository,
run id, timestamps, exact provider/model/client, skill revision and digest,
aggregate pinned-ccusage figures, optional local trajectory digest, and an
Ed25519 device signature. Validate signatures and all joins at ingestion. A
device signature proves byte continuity, not provider billing truth. Never
publish chain-of-thought, secrets, raw prompts/responses, source files, private
trajectories, credentials, or session identifiers. A human-only contribution
must say so explicitly.

Any provider, model, and agent client may participate when their exact
self-reported identity is posted. Model or client allowlists must not gate
eligibility, scoring, review, or payment. Supported usage adapters may add
diagnostic token provenance; unavailable usage never blocks a contribution and
tokens never change its score or payout.

Every agent run must upload its raw trace before a contribution is submitted.
Trace objects are permanent, private platform records: store immutable bytes in
private R2, store only metadata and digests in D1, and never publish or expose
the object to contributors or project owners after upload. Only designated
Slop operators may retrieve a trace through short-lived, audited authorization.
The contributor upload path is write-only, bounded, authenticated, checksum
verified, and fail-closed. Public artifacts may contain only the trace digest
and safe metadata, never the trace body.

## Reward and settlement contract

- Closed cycles live only at `cycles/<project>/<YYYY-MM>/` and bind to exact
  immutable source-snapshot bytes and a scoring-rule version.
- The monthly automation runs trusted `develop` only, is idempotent, refuses a
  partial cycle, and records zero-award months explicitly.
- Monthly allocations use integer USDC micro-units, largest remainder, and the
  published cap. The 1% fee applies to approved principal. Never use floats for
  money or let rollover increase a later monthly cap.
- Proposal review lasts 14 days. A project owner may set any contributor award,
  including zero or an amount above the deterministic suggestion, while the
  cycle total remains within the published cap. Every adjustment needs a public
  reason. Wallet changes reset the review deadline. Missing wallets stay
  unclaimed; suspicious rows stay visible as held or excluded. Related-party
  money needs separate approval.
- A wallet claim is one open issue authored by the contributor and bound to its
  exact GitHub identity and body snapshot. An immutable profile README marker
  or immutable, actor-bound D1 claim is a compatibility fallback. None proves
  cryptographic wallet ownership.
- Settlement tools create unsigned Solana mainnet USDC plans only. They never
  read keys, sign, broadcast, or claim success optimistically.
- `paid` requires finalized transaction evidence whose exact source and
  destination USDC deltas reconcile every immutable intent and the 1% fee
  charged when the payout is paid. Reject
  replay, wrong mint, wrong owner, partial, duplicate, failed, or overpaid state.
- Delta Star publishes external-prize shares only and never enters the platform
  payment lifecycle.
- An LLM may recommend a hold or award but cannot autonomously ban, approve,
  exclude, or move money.

## Deployment

Use Cloudflare Pages Direct Upload from the checked-in workflow. Required
repository/environment secrets are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; `GITHUB_TOKEN` is supplied by Actions for ingestion.
All production jobs use the protected `eliza-army-production` environment.
Its deployment-branch policy must use a selected-branch allowlist whose only
permanent entry is `develop`. It must require a designated release reviewer
and disallow administrator bypass. An active repository ruleset must require a
pull request, resolved review threads, and non-fast-forward history for
`develop`, with no bypass actors.
Access to the environment secrets and branch policy belongs only to designated
release operators. Claim the deploy/DNS lever on the issue before changing the
allowlist, Pages, zones, nameservers, DNSSEC, custom domains, or registrar
state.

Push, schedule, and manual releases are restricted to the exact checked-out
`develop` SHA; pull-request and feature-branch runs never deploy. Manual
dispatches must select `develop`. The workflow has no production-candidate
input or branch-admission path, so pull-request-controlled workflow code never
receives the protected environment's Cloudflare credentials. Keep `develop` as
the environment deployment-branch allowlist's only entry; never temporarily
allowlist a feature branch, wildcard, fork head, or tag.

Do not deploy production from a package script or a local working tree. The
workflow checks out the exact tested Actions SHA, installs the lockfile-pinned
Wrangler without lifecycle scripts, downloads the verified build, and lets
`wrangler.toml` select the Pages output directory before binding that deployment
to the same commit SHA. The release stays failed until Cloudflare's API reports
a new, clean, successful production deployment for that exact SHA; the workflow
records its deployment ID and immutable Pages URL.

The production domains are registered with Cloudflare Registrar in the same
account as the Pages project. The internal project slug remains
`eliza-computer`; the public authorities are `https://slop.cash` and
`https://slop.tech`. Do not claim that a Pages deploy proves custom-domain DNS
or TLS—verify each separately.

## Definition of done

The binding standard is root `AGENTS.md` and `CONTRIBUTING.md`. For this package:

- Rebase onto current `origin/develop`, run `bun install`, package checks, and
  root `bun run verify`.
- Test leaderboard pagination, deduplication, scoring caps, bot/self-review
  exclusion, model parsing, loading/empty/stale/error states, and skill archive
  integrity.
- Drive the built site in real Chromium at desktop and mobile sizes. Verify
  keyboard use, WCAG AA, install-copy feedback, raw Markdown, archive download,
  GitHub links, zero console errors, and zero failed first-party requests.
- Attach manually reviewed before/after full-page screenshots, OCR review,
  frontend console/network logs, an MP4 walkthrough, the generated `.skill`
  archive/checksum, live GitHub snapshot, deploy log, and production DNS/TLS/
  header response. Use `N/A - <reason>` only when a row truly cannot apply.
- Forward-test the skill with a fresh agent on real repository work and attach
  the model-named trajectory/output. A mock issue, fake review, or fixture in
  place of the real path is not launch evidence.
- Post evidence inline on the issue/PR; never commit captured evidence.
- Do not leave TODOs, stubs, placeholder content, dead controls, or silent
  fallback success.

Keep `CLAUDE.md` and `AGENTS.md` byte-identical.
