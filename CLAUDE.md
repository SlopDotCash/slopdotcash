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
  success before public evidence proves it, except for one key on the opt-in
  `squads-project-vault` instrument (RFC #500, `funding/README.md`). For that
  instrument only: Slop holds one of three keys on a project vault. That key
  can vote on a payout the creator proposed. It cannot propose a transfer,
  execute one, change the signers, or act alone. Slop holds no customer
  balance, takes no fee from the vault, and never broadcasts a transfer of
  vault funds.
- Never publish secrets, prompts, responses, source files, credentials, session
  identifiers, private trajectories, or signing material.

## MVP scope and phase gate

The canonical product requirements are
[Slop Product Requirements](docs/slop-product-requirements.md). The only current
implementation scope is [Slop MVP Delivery Plan](docs/slop-mvp-plan.md).
Read both before selecting work, proposing a change, reviewing a PR, or
implementing a feature. Link the exact PRD requirement and MVP work-package ID
in every implementation PR. Existing code, an open issue, a model suggestion,
or a PRD entry marked Future does not approve implementation.

Work must correct a demonstrated defect in the MVP, fulfill a missing approved
MVP requirement, or prove a relevant improvement to that required behavior.
Do not invent work from coverage gaps, preferences, or hypothetical failures.
Reuse existing implementations and simplify the affected code. Explain the
useful result and why the selected implementation is needed.

A new requirement must first be discussed with humans and added to the PRD.
Maintainers must approve its scope and phase, and update the MVP plan when it
changes the current phase, before implementation starts. Unresolved choices
in the PRD are decision gates, not authority for an agent to choose economic,
security, or product policy. Keep proposals distinct from approved work.

Do not start the rest of the PRD until maintainers explicitly confirm that the
whole MVP is finished, verified, tested, and validated. The confirmation must
be a reviewed completion record linked from the MVP plan. It must cover every
MVP requirement and release gate with exact tested revisions, real end-to-end
results, deployment/provider/chain evidence where applicable, and resolution
of blocking defects. A merged PR, a local test pass, partial rollout, or an
agent's statement cannot close the MVP. After that record is approved, humans
select and approve the next PRD phase before agents implement it.

## Human-responsible outside issues

This rule covers Slop participation issues: issues in this repository, and
issues on a target project or any other tracker that claim Slop participation
or carry `Made via @slopdotcash`. Slop decides eligibility for its own score,
review and listings; it does not govern unrelated activity on third-party
trackers.

Banned: unattended generation of issue text, bulk or batch issue creation,
delegated submission (an agent, bot, script, API call, CLI, browser automation
or prefilled issue URL opening or submitting the issue), and submitting a
report the human has not read, verified and understood. A human clicking
Submit on text they did not review does not satisfy this rule.

Allowed under human control: reading existing issues, inspecting the PRD and
MVP plan, investigating defects, outlining, explaining findings to the
contributor, translation, grammar and spelling correction, accessibility
tools, and checking sources. The human chooses the claims, verifies the
evidence, settles the final text and submits it personally on the website.
This restriction concerns issue authorship and creation; it does not prohibit
authorized PR work or review of existing issues. Future private
security-report automation requires its separately approved phase and is not
an exception for public issues.

Writing style, language fluency, model attribution on other work, or the use
of editing or translation tools is not evidence of a breach. An adverse
decision (hold, exclusion, restriction) needs objective evidence of a banned
act, such as automation records, bulk patterns or delegated submission,
states that evidence, and carries the appeal path in the eligibility policy.

This rule applies to issues opened on or after 2026-10-15T00:00:00Z. Issues
accepted before that date keep their state and credit.

Before writing an issue, the contributor must review the PRD and MVP plan,
check for existing work, and state the affected requirement, evidence, and
expected result. An issue that proposes anything new must link the existing
PRD requirement or the proposed PRD addition and its human discussion. Missing
requirements must be added to the PRD and approved before implementation.
An issue is never feature approval. Include the visible attribution line
`Made via @slopdotcash` on Slop participation issues and PRs; humans add it to
their own issue text. Branding is not permission for agents to create issues.

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

Operational guides under `backend/`, `cycles/`, `disclosures/`, `evaluations/`,
`funding/`, `protocol/`, and `workers/` define subsystem contracts. Keep them focused and
current.

## Repository map

```text
projects/       reviewed manifests and project policy
skills/         canonical contributor and CI reviewer skills
evaluations/    reviewed awards for otherwise-unscored useful work
cycles/         append-only reward lifecycle records
funding/        append-only direct-funding evidence
disclosures/    payouts sent outside the verified settlement flow
protocol/       public attribution and privacy contracts
backend/        private trace storage boundary
workers/        narrowly scoped Cloudflare services
src/            React product and strict browser/domain contracts
scripts/        ingestion, packaging, rewards, settlement, and evidence
tests/e2e/      real-browser end-to-end, accessibility, and Pages coverage
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

New projects begin paused. A paused project is registered and listed, but none
of its repositories is collected, so nothing on them reaches the ledger or the
leaderboard. Public contribution access may open independently
when missing authority and terms remain explicit, receipts stay pending, and
payments stay disabled. Verify immutable repository and actor IDs, repository
license facts, GitHub stewardship, integration branch, reward policy, and
failure paths before activating receipts or money states. Stewardship is a
GitHub identity only.

The contributor skill must inspect live GitHub, select bounded unblocked work,
follow the target repository’s rules, test the result, prepare evidence, and
emit the required attribution. It must not claim platform authority over an
issue or create placeholder submissions.

The current reviewer skill is separate and advisory. The PRD specifies optional
Slopbot closure and security-vetting enforcement as gated MVP additions. A
document merge alone does not enable those powers; implement and review the
versioned protocols and explicit permissions first.

It measures its own run, checks
correctness, tests, security, evidence, duplication, abuse signals, scope, and
usefulness, and places the machine review before the signed attribution footer.

## Installer and attribution

The public checksum detects corruption only. GitHub is the independent trust
root. The generated installer may authorize:

1. current `main`;
2. a `main` ancestor whose canonical skill tree is unchanged, or a successful
   approved published revision not listed in `protocol/skill-revocations.json`; or
3. an open, non-draft, same-repository PR head into `main` with the
   maintainer-controlled `slop-release-candidate` label applied after the exact
   current-head commit event.

Reject candidates behind or divergent from `main`, missing or extra files,
working-tree provenance, stale label events, mutable redirects, and byte
mismatches. Preserve immutable sibling version directories, the process-bound
kernel lock, atomic relative-symlink activation, prior verified versions, and
explicit rollback reauthorization. Tests may inject only deterministic
`file://` authorities through the generator’s test option.

Every contribution discloses exact provider, model, and client. Ordinary GitHub
submission does not require a measured run, device key, policy acknowledgement,
private trace, usage collection, or payout registration. Optional signed receipts
bind their actual evidence; missing evidence never earns a trace bonus. A device
signature proves byte continuity, not provider billing truth. Token evidence is
diagnostic and never changes score, rank, share, or payment.

## Private traces

Contributors may opt into the minimized contribution-specific trace defined by
`protocol/private-trace-v1.md`. Declining or failing upload never blocks submission. The contributor inspects and
redacts the selected file; the uploader stores its exact bytes and performs no
automatic redaction.

Trace bodies are permanent private R2 objects. D1 stores only safe metadata and
digests. Contributors, project owners, and the public have no read route. Only
designated Slop operators may obtain a short-lived audited read grant through a
separate operator-controlled path.

The contributor upload route is write-only, bounded, authenticated,
checksum-verified, and fail-closed. Public artifacts contain only safe metadata
and the trace digest. Only optional trace collection depends on the independently renewed private
request status. Website deployment and GitHub contribution remain independent.

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

## Participation points

Slop Points are nonfinancial participation records governed by
`protocol/points-v1.md`. Welcome and verified X-connection awards are not accepted-work score.
Verified payout recognition is fixed per recipient/project/cycle, never per dollar
or transfer. X control never confers GitHub, organization, or payment authority.
Never feed points into rewards or settlement. Preserve the append-only journal,
source coverage, original contribution dates, and distinct recording dates.
Generated points projections are build outputs; do not edit them by hand.

## Rewards, funding, and settlement

Closed cycles live only at `cycles/<project>/<YYYY-MM>/` and bind exact source
snapshot bytes and scoring-rule version. The trusted first-of-month automation
runs from `main`, is idempotent, refuses partial cycles, and records
zero-award months.

Monthly allocations use integer USDC micro-units and largest remainder. The 1%
fee applies to approved principal only. Never use floats for money or let
rollover increase a later monthly cap.

A review budget is an optional additive cash line. Review events remain in the
shared pool unchanged; a committed review line may pay them only on top of that
treatment, with separate public arithmetic and evidence.

Proposal review lasts 14 days. Project owners may adjust awards within the cap
with a public reason; only such amount changes reset review. Wallet changes
append a successor; a wallet observed after proposal generation applies to the
next cycle and never touches the current proposal. History is never edited.
Missing wallets remain unclaimed. Related-party money requires separate
approval.

Each monthly-pool project has one settlement network, `reward.chain`: Solana
(default) or Base (RFC #472). A proposal freezes that network for its cycle; a
network change lands by PR between cycles. Only a wallet claim on the cycle
network is payable; otherwise the row stays unclaimed. Settlement tools create
unsigned USDC plans only: Solana mainnet transfers from the frozen Squads vault,
or Base mainnet EIP-681 transfers from the frozen Base Sablier stream recipient.
The fee is a separate transfer on the same network. `paid` requires finalized
Solana evidence, or Base evidence under the 2-of-3 RPC quorum and 12
confirmations, whose exact source and destination deltas reconcile every
immutable intent and fee. Reject replay, wrong mint or token, wrong owner,
partial, duplicate, failed, or overpaid state. Delta Star publishes
external-prize shares only and never enters the platform payment lifecycle.

Committed funding uses reviewed immutable third-party instruments: Squads v4
multisig vaults on Solana and Sablier Lockup v4 streams on Base or Ethereum.
Slop has no admin or fee position in any instrument and no key in the 2-of-2
vault or a stream. On a 2-of-3 project vault Slop holds one vote-only key, and
a payout is approved for payment only once the creator's on-chain proposal is
bound in `funding/executions/ledger.json`. A project vault activates payments
only with its exact reviewed fresh-cycle policy; its release needs current
capability reports from the creator and the independent signer, and Slop's
key never attests. A positive committed amount requires an active reviewed
instrument and deterministic verifier evidence. Never call funds “escrow” or
“guaranteed.”

## Project authority and IP

Publish repository license facts as SPDX plus immutable LICENSE URL, commit, and
digest. Do not turn GitHub stewardship into an ownership claim. `unknown` and
`mixed` copyright terms with null legal fields are valid terminal states.

`sponsor-owned` remains schema-supported only when the project provides the
complete signed instrument set; otherwise fail closed. Legal arrangements are
executed outside Slop. External-prize shares allocate payout only and never
claim copyright.

## Deployment

`development` deploys to `staging.slop.cash`. Promote changes through a reviewed
PR from `development` to `main`. Only `main` deploys to `slop.cash`.
Staging has a separate Pages project, D1 database, private R2 bucket, identity
Worker, and secrets. Staging login and writes never use production storage.
Both branches require the full CI and trusted policy checks. The temporary
`develop` compatibility branch has no deployment authority.

Production deploys through the checked-in GitHub Actions workflow only. Never
deploy from a package script, local working tree, PR, feature branch, fork head,
or tag.

Required protected-environment secrets are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; Actions supplies `GITHUB_TOKEN` for ingestion. The
`eliza-army-production` environment allows only `main` and disallows
administrator bypass. Successful protected merges deploy automatically. Repository rules
require a pull request, resolved threads, and non-fast-forward history with no
bypass actors.

Code releases use the main-only `eliza-army-production` environment. Scheduled
refreshes use `slop-data-refresh`. No separate manual release approval is
required. Publication credentials must never be exposed to pull-request runs.
Both release paths use the shared publication lock.

Scheduled refreshes build the currently published GitHub-approved ancestor of
`main`, compare the complete bundle against a successful retained baseline,
and may change only allowlisted data. Recheck the deployed revision under the
shared publication lock before publishing; discard superseded refreshes.
Code releases still require current main equivalence. Every Pages deployment
is bound to its actual tested source SHA, not the schedule event SHA.

The separate hourly health workflow authenticates GitHub private-reporting
status and renews a D1 observation. It never publishes code or holds the site
publication lock. Status older than 24 hours blocks optional trace collection
only. Failed renewals are explicit operational failures.

The workflow installs lockfile-pinned Wrangler without lifecycle scripts.
Verify deployment identity, custom-domain DNS, TLS, redirects, headers, and
served bytes separately.

Claim the deploy/DNS lever on the issue before changing environment allowlists,
Pages, zones, nameservers, DNSSEC, custom domains, registrar state, or release
credentials.

## Working rules

- Preserve unrelated user changes and untracked files.
- Use a scoped branch from current `origin/development`; rebase before final
  review.
- Prefer deterministic scripts and strict schemas over duplicated prose or
  fallback success.
- Reject one-PR-per-file coverage farming, “no same-named test” tasks,
  barrel/type/schema/constant inventory suites, and shape-smoke assertions
  that prove only existence, type, finiteness, length, literals, export
  identity, or mocked calls.
- Reject copied or mismatched PR narratives and shotgun defensive series such
  as repeated NaN comparator fallbacks, CE year 0–99 handling,
  placeholder/config-shape guards, or Unicode truncation refinements. Fix the
  one demonstrated canonical boundary instead.
- Coverage discovery does not authorize theoretical parser, lookup, regex,
  word-boundary, or fallback micro-fixes per occurrence.
- Missing coverage, green tests, mutation counts, and plausible edge cases are
  not accepted outcomes. Low-value PRs and reviews earn no score and may be
  penalized or excluded from reward review.
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
bun run build
bun run test:e2e
bun run verify
```

## Definition of done

Every PR must show a useful result and its PRD/MVP references. New features
remain blocked by the scope and phase gate above. For documentation-only
changes, validate links, instructions, scope consistency, and policy mirrors;
explain why application acceptance does not apply to the prose itself. Keep
required repository checks. Do not fabricate UI or deployment evidence.

Rebase onto current `origin/development`, install the lockfile, run `bun run
verify`, and run real-browser E2E against the exact head. UI changes require
desktop and mobile review, keyboard and 200% zoom checks, WCAG AA, working copy
feedback, raw Markdown and archive downloads, valid GitHub links, zero
first-party request failures, and zero application console errors.

Attach exact-head evidence to the issue or PR: screenshots, accessibility
results, console/network logs, uploaded UI walkthrough and evidence videos, detailed
test steps and expected results, generated skill archive/checksum,
live GitHub snapshot, deploy log, immutable deployment URL, deployed-byte
comparison, DNS, TLS, redirects, and security headers. Use `N/A - <reason>`
only when genuinely inapplicable. Captured evidence is not committed.

A local test is not proof of merge. A merge is not proof of deployment. A
deployment is not proof of provider, device, identity, wallet, or settlement
availability. Report each boundary precisely.


## Escrow payout migration

The maintainer-authorized escrow MVP is defined in `docs/payouts-mvp.md` and
`docs/base-solana-payout-plan.md`. Its scoped contract, identity attestation and
relayer services may execute isolated test-chain transactions under those rules.
This supersedes the legacy unsigned-only model for that protocol only. Never
use production credentials or move mainnet funds during testnet qualification.
New gross awards deduct 2% before contributor earnings are displayed or paid.
Unused-fund withdrawals deduct 10%; funded obligations cannot be withdrawn.
Historical v1 records retain their original fee and authority rules. No project
activates escrow merely because the new code is present. Keep project deployment
bindings in the canonical manifest, never in a second project inventory.
