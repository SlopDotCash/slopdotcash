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
- Slopbot decides routine cases under published rules; humans decide
  exceptions, escalated disputes, bounty awards, and confirmed-malicious bans.
- Projected, under-review, approved, scheduled, paid, unclaimed, held, and
  excluded are different states.
- Any provider, model, and agent client may participate when its exact identity
  is disclosed.
- Slop never infers copyright ownership, legal capacity, assignment, wallet
  control, or payment authority.
- Slop never holds keys, signs transactions, broadcasts payments, or claims
  success before public evidence proves it, except for the two narrowly scoped
  kinds of key below. No other exception exists.
  - The escrow identity attester key (PAY-05, approved by the repository owner
    on 14 October 2026). It only attests the authenticated GitHub actor for a
    destination binding that the destination wallet also signs, and it submits
    only that binding transaction. It cannot choose an amount or reach free
    funds. A binding activates immediately and the award delay is zero (#1086,
    #1100), so a stolen attester key with a wallet it controls can redirect and
    pay any matured unpaid award before the owner can cancel. Protection rests
    on custody of this key (`docs/security/red-team-2026-10-24.md`). A rotation
    by the registrar replaces the key, and the attester cannot block it. Owner decision of 24 October 2026: after the reviewed contract
    change, it also signs each funded project's monthly
    allocation root (the owner waived the independent audit, PRD section 11
    "External reviews"). The contract limits that commitment to the owner's
    monthly cap, one commitment per period, and the owner's opt-out; the
    attester still cannot withdraw, redirect, or pay funds.
  - One fee-wallet hot key per network (PRD TOK-07, MVP-07c, owner decision
    of 18 October 2026). It controls only the network fee wallet. It signs
    only the conversion of fees received in that wallet to USDC, through allowlisted routes, within the slippage limit,
    with output to the same wallet. Owner decision of 24 October 2026: it may
    also submit permissionless fee claims on reviewed vaults, moving only
    accrued fees to that same fee wallet. It holds no vault role and cannot
    withdraw free funds or touch contributor principal, reserved awards or payments. Per-run and
    daily caps bound it. Owners manually sweep USDC proceeds to separate
    owner-controlled software wallets, with sweep keys held in their local
    `.env`, not by the Worker (PRD sections 6 and 11, 24 October 2026).
    The job runs in dry run until a
    reviewed activation record enables signing.
- Humans create, store and rotate these keys and deploy mainnet contracts.
  Agents never handle key material or deploy to mainnet. The vote-only Squads
  project vault key is removed with Squads.
- Never publish secrets, prompts, responses, source files, credentials, session
  identifiers, private trajectories, or signing material.

## MVP scope and phase gate

The [canonical Slop PRD](docs/slop-product-requirements.md) defines
product scope, acceptance, and completion.
The Google Docs version mirrors the repository PRD. The repository governs.
Read the PRD before selecting work, proposing a change, reviewing a PR, or
implementing a feature. In every implementation PR, cite the PRD section that
the change serves (for example "PRD section 5, Slopbot") and the acceptance
result that it proves. The PRD defines no work-package IDs; cite an older
requirement or package ID only where existing records already use it, and do
not ask maintainers for IDs that the PRD does not define. Existing code, an
open issue, a model suggestion, or a PRD entry marked Future does not approve
implementation.

Work must correct a demonstrated defect in the MVP, fulfill a missing approved
MVP requirement, or prove a relevant improvement to that required behavior.
Do not invent work from coverage gaps, preferences, or hypothetical failures.
Reuse existing implementations and simplify the affected code. Explain the
useful result and why the selected implementation is needed.

A new requirement must first be discussed with humans and added to the PRD.
Maintainers must approve its scope, phase, and delivery requirements in the PRD
before implementation starts. Unresolved choices in the PRD are decision gates,
not authority for an agent to choose economic,
security, or product policy. Keep proposals distinct from approved work.

Do not start the rest of the PRD until maintainers explicitly confirm that the
whole MVP is finished, verified, tested, and validated. The confirmation must
be a reviewed completion record in the PRD. It must cover every MVP requirement
and release gate with exact tested revisions, real end-to-end
results, deployment/provider/chain evidence where applicable, and resolution
of blocking defects. A merged PR, a local test pass, partial rollout, or an
agent's statement cannot close the MVP. After that record is approved, humans
select and approve the next PRD phase before agents implement it.

### Contributor bounty rules

This repository is a Slop project with a $1,000 monthly contributor pool. Follow
CONTRIBUTING.md "Before you start" and "Slop bounty: what is accepted":

- Star and fork the repository first. Slop uses this to track participation.
- Accepted: reproduced real bugs, security, verification, settlement, vault and
  scoring correctness, and measured improvements inside approved MVP scope.
- Not accepted: UI, style, or copy changes, except a fix to a broken user flow
  with before and after video.
- Prove model-backed behavior with real LLM calls. Configure `.env` from
  `.env.example` and Worker `.dev.vars`; never commit values.
- Test the affected workflow in the agent clients that use it (Claude Code,
  Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS, Cursor).
  Install other clients and drive them with computer use when needed. Record
  each client, version, provider, model, and result.

## Issues: owners and maintainers only

Only project owners and maintainers open issues. This rule applies to this
repository and to every target project where contributors work through Slop.
An issue is a maintainer decision about what work the project wants.
Contributors do not open issues, and an issue opened by a contributor earns no
Slop score, review credit, reward or listing.

Contributors work from existing open issues and approved PRD requirements.
To report a defect, open a pull request that fixes it and proves the defect
with evidence, or comment on an existing related issue. Report security
vulnerabilities only through the project's private vulnerability reporting.
Never report them in a public issue.

An agent that works for a contributor must not open, draft for submission, or
submit an issue by any path: UI, API, CLI, script, browser automation,
prefilled issue URL or another agent. Owners and maintainers may use tools to
prepare and file issues. They remain responsible for each issue they file.

Every issue states the affected requirement, the evidence and the expected
result. An issue that proposes anything new links the existing PRD requirement
or the proposed PRD addition and its human discussion. An issue is never
feature approval. Missing requirements must be added to the PRD and approved
before implementation.

This rule applies to issues opened on or after 2026-10-19T00:00:00Z. Issues
opened before that date keep their state and credit. A decision under this
rule needs objective evidence and carries the appeal path in the eligibility
policy.

## Source of truth

The D1 project registry (`projects`, `project_revisions`, and
`project_applications` in `slop-private`) is the only project and repository
inventory. Never hardcode a project, repository, reward, steward, status, or
funding route elsewhere. Every manifest change appends an immutable revision.
`bun run projects:sync` snapshots the registry from `GET /api/v1/projects` and
`GET /api/v1/project-revisions` into `src/lib/project-registry.generated.mjs`
and `src/lib/project-revisions.generated.json`; generated registries and
public pages derive from that snapshot. Never edit the snapshot by hand.

Projects listed before the registry were removed with their manifests and
history records. `src/lib/legacy-projects.json` keeps only their ids and
repository ids so contributor points and profiles still validate. It is never
listed, collected, scored, or paid. Unit tests use the frozen fixture registry
under `tests/fixtures/`, loaded by `bunfig.toml`.

Project skills are generated, never stored per project (PRD SKL-03, owner
decision of 18 October 2026). The repository keeps one canonical generic
contributor template and one canonical generic reviewer template. Slop
renders each project's skills from its approved D1 revision (scope,
contribution guide, supported tasks, required tests, review expectations,
security contact, closure policy and maintainer notes) and those templates.
The same template revision and D1 revision produce the same bytes. Maintainer
notes cannot weaken a template rule. Do not add per-project skill folders or a
second skill copy. `scripts/prepare-site.mjs` builds raw Markdown endpoints
and downloadable `.skill` archives from the generated output and publishes the
cycle index.

Generated files under `public/brand/`, `public/downloads/`,
`public/projects/`, `public/protocol/`, and `public/data/cycles/` are build
outputs. Never edit them by hand.

Operational guides under `backend/`, `cycles/`, `disclosures/`, `evaluations/`,
`funding/`, `protocol/`, and `workers/` define subsystem contracts. Keep them focused and
current.

## Repository map

```text
skills/         general Slop skill and canonical generic project-skill templates
evaluations/    reviewed awards for otherwise-unscored useful work
cycles/         append-only reward lifecycle records
funding/        project vault funding guide; legacy records stay in git history
disclosures/    payouts sent outside the verified settlement flow
protocol/       public attribution and privacy contracts
backend/        project registry API and private trace storage boundary
workers/        narrowly scoped Cloudflare services
src/            React product and strict browser/domain contracts
scripts/        ingestion, packaging, rewards, settlement, and evidence
tests/e2e/      real-browser end-to-end, accessibility, and Pages coverage
```

## Add a project

Projects are added on the website, never by pull request. The PRD now requires
self-service setup: verify current GitHub authority, complete project terms,
install Slopbot, and obtain malicious-code clearance before automatic activation.
PRD section 8 permanently exempts the existing projects captured by migration
`0075_vetting_grandfathered_projects.sql` from normal scan clearance, including
future executable changes. Later projects require scans. Record exemption
explicitly, never as a passed scan; flags, pauses, confirmed-malicious bans
and fresh-scan reinstatement requirements still apply.
Funding is optional and has a separate readiness state. Owners publish immutable
revisions; admins handle restrictions and disputes, not routine approval.
Two distinct contributor flags pause the project. A clean fresh scan reinstates
a project that flags alone paused; a moderator decides only after a confirmed
malicious result. Contributor skills must not install or work on flagged
projects.

The owner creates and updates projects through `backend/projects/`. Preserve
permanent repository and actor IDs when checking current GitHub write/maintain
authority. A stored application can be published by its applicant through the
same checks; it does not need an admin decision.

A paused project is registered and listed, but none of its repositories is
collected, so nothing on them reaches the ledger or the leaderboard. It
publishes no skill until its revision has the maintainer-authored skill
fields. Verify immutable repository and
actor IDs, repository license facts, GitHub stewardship, integration branch,
reward policy, and failure paths before activating receipts or money states.
Stewardship is a GitHub identity only.

Registry rows cannot be deleted. Pause a project, or append a revision with
`listingTier: "retired"` to hide it from every page and list while its history
still resolves.

The contributor skill must inspect live GitHub, select bounded unblocked work,
follow the target repository’s rules, test the result, prepare evidence, and
emit the required attribution. It must not claim platform authority over an
issue or create placeholder submissions.

The current reviewer skill is separate and advisory. It measures its own run,
checks correctness, tests, security, evidence, duplication, abuse signals,
scope, and usefulness, and places the machine review before the signed
attribution footer.

Slopbot is required and always free, and runs only on registered repositories.
It scores PRs by perceived size and value, credits useful reviews, and applies
the published penalty table. Automatic closure is limited to verified
Slop-skill participants, excluding maintainers: a slop.cash member whose own
authenticated Slop run records a `pull_request_opened` event for that exact PR
(PRD section 11). A copied marker is never proof. An uncertain finding goes to
the maintainer first; after 7 days without maintainer action, Slopbot applies
its verdict as a label only and never closes. A Scam or malicious closure also
creates one idempotent moderator Inbox notice to review the account (PRD
section 11, D4). Slopbot triages each appeal first,
and a moderator decides escalated appeals. Do not charge project vaults for bot
reviews. The current global closure switch stays off until reviewed production
activation. Document changes alone do not activate closure, payments, or
security enforcement.

## Installer and attribution

The public checksum detects corruption only. The trust root of a project
skill is the pair (template revision on `main`, D1 revision digest) (PRD
SKL-04). GitHub is the independent trust root for the template revision. The
project registry API publishes the digest of the approved D1 revision; the
installer refuses bytes that do not match the rendering of that pair. The D1
digest binds the maintainer-authored fields to an approved revision; disclose
that those fields come from Slop's registry. The generated installer may
authorize this template revision:

1. current `main`;
2. a `main` ancestor whose complete canonical template tree is byte-identical
   to current `main`; or
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
at least 10 accepted-work points (one legacy credit-third). Group split or related pull requests into one work
unit; do not apply account-level caps or diminishing credit.

Unusual useful work may score only through a strict reviewed `evaluations/`
manifest. Never double-score a source already rewarded by the ordinary ledger.
Slopbot may assign scores, apply the published penalty table, label uncertain
findings after the maintainer window, close under PRD section 5, and triage
appeals and disputes. No LLM or automation may ban a person, decide an
escalated dispute, approve a bounty award, or move money outside the contract's
automatic monthly distribution.

## Participation points

Slop Points are the single contribution and participation unit governed by
`protocol/points-v1.md`. Welcome and X-connection points are discontinued
from 24 October 2026 (PRD section 11, D2): grant none, and exclude recorded
awards from every displayed total and ranking. Keep those records in the
append-only journal; never delete or rewrite them.
Verified payout recognition is fixed per recipient/project/cycle, never per dollar
or transfer. X or Telegram control never confers GitHub, organization, or payment
authority; a Telegram connection earns no points (PRD SOC-02).
Only accepted-work points for the project and period determine reward shares;
never feed historical participation or payout-recognition bonuses into rewards. Preserve
historical settlements and compatibility fields without exposing a separate
score metric. Preserve the append-only journal,
source coverage, original contribution dates, and distinct recording dates.
Generated points projections are build outputs; do not edit them by hand.

## Rewards, funding, and settlement

Closed cycles live only at `cycles/<project>/<YYYY-MM>/` and bind exact source
snapshot bytes and scoring-rule version. The trusted first-of-month automation
runs from `main`, is idempotent, refuses partial cycles, and records
zero-award months.

Monthly allocations use integer base units of the project asset and largest
remainder. Never use floats for money, assume six decimals, or let rollover
increase a later monthly cap.

New project setup uses one monthly pool. Preserve historical committed review
budgets and their terms; do not offer a second review budget for new projects.
Review credit follows the canonical scoring policy.

Automatic monthly payment is the PRD default for every project with funds
committed in its vault. Vault creation sets the monthly commitment with the
owner's monthly cap unless the owner opts out (PRD section 11, D1); the owner
can turn it on or off later, and can adjust allocations before execution; do
not show adjustment history or require public reasons. Distribute the current
allocations at the monthly cutoff if the owner has not done so. The period is
the calendar UTC month, starting with 2026-11, and the cutoff is 72 hours after
the month ends (PRD sections 6 and 11). Keep internal reconciliation and prevent
manual/automatic duplicate payments. Walletless funded awards remain reserved.
Private reports are automatic; bounty awards and payouts remain discretionary.
Slopbot triages disputes first, and a moderator decides escalated disputes.
Preserve already funded obligations.

Where payment code still applies older review rules, such as a 14-day review
window or a public reason for a changed amount, that is implementation to
migrate. Do not infer that this policy change has altered contracts or
authorized live transactions.

One funding mode exists: the project vault contract (PRD FND-01, owner
decision of 18 October 2026). Squads v4, Sablier, legacy direct and committed
instruments and the PAY-09 monthly-pool settlement rail are removed. Their
historical records stay in git history at their original revisions; they are
not an active funding route, balance or payment path. Each project has one
network (Base, Robinhood Chain, Ethereum or Solana) and one asset. Anyone may
deposit into a vault. All deposits share one bucket; there is no donor class.
All free funds are refundable only to the owner's refund destination, and the
deposit flow says so before signature. `paid` requires finalized evidence that
reconciles the exact vault, obligation, recipient, principal and fee. Reject
replay, wrong mint or token, wrong owner, partial, duplicate, failed, or
overpaid state. Delta Star publishes external-prize shares only and never
enters the platform payment lifecycle. Never call vault funds “guaranteed.”

Supported assets are the network stablecoin or any standard ERC-20 on Base,
Robinhood Chain (chain id 4663) and Ethereum, or any classic SPL token on
Solana, with any decimals (PRD TOK-01, TOK-03). Fee-on-transfer, rebasing and
Token-2022 tokens are unsupported. Circle USDC is the Ethereum stablecoin;
verify its address from Circle's primary source before activation.

Public pages never read chain or GitHub state live per page view (PRD ARC-01).
They serve cached D1 data and snapshots that background jobs refresh. Vault
totals come from finalized on-chain counters cached in D1 with their observed
time. A failed refresh shows the last value as stale, never zero.

## Project authority and IP

Publish repository license facts as SPDX plus immutable LICENSE URL, commit, and
digest. Do not turn GitHub stewardship into an ownership claim. `unknown` and
`mixed` copyright terms with null legal fields are valid terminal states.

`sponsor-owned` remains schema-supported only when the project provides the
complete signed instrument set; otherwise fail closed. Legal arrangements are
executed outside Slop. External-prize shares allocate payout only and never
claim copyright.

## Deployment

`development` is the default integration branch and deploys to `staging.slop.cash`.
Promote changes through a reviewed
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

Production releases use the main-only `eliza-army-production` environment.
No separate manual release approval is required. Publication credentials must
never be exposed to pull-request runs. Every production release uses the
shared publication lock.

GitHub runs schedules only on the default branch, so
`.github/workflows/scheduled-release.yml` dispatches the full release workflow
on `main` and `development` every 6 hours. Each dispatched run snapshots the
current D1 registry, ingests live GitHub data, passes the full quality gate,
and publishes through its branch's normal release job. A newly activated
project thus gets its collected data without a commit. Every production release
requires current main equivalence. Every deployment is bound to its actual
tested source SHA.

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
bun run cycles:check
bun run typecheck
bun run lint:check
bun run format:check
bun run build
bun run test:e2e
bun run verify
```

## Definition of done

Every PR must show a useful result and its PRD references. New features
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

The canonical PRD defines escrow requirements and delivery. The historical
`docs/payouts-mvp.md` and `docs/base-solana-payout-plan.md` records provide context.
The scoped contract, identity attestation, and
executor services may execute isolated test-chain transactions under those rules.
This supersedes the legacy unsigned-only model for that protocol only. Never
use production credentials or move mainnet funds during testnet qualification.
New ordinary public-work awards deduct 2% before display or payment.
Every new project draft uses the 2% fee (200 bps) and vault-custody wording,
including drafts without a vault; historical projects and revisions keep their
recorded terms (PRD section 11, D3).
Private security bounties use SEC-05 instead: 75% to the researcher and 25% to
slop.cash. Do not add the ordinary 2% fee to a private security bounty.
For a project-token reward (PRD TOK-06, owner decision of 14 October 2026),
the 2% is deducted in that token and paid in that token to the network fee
wallet at payout. No contract converts it. A scheduled backend job converts
fees already in the fee wallet to USDC (PRD section 6) inside that wallet
(TOK-07, MVP-07c); a network without a verified USDC route keeps the fee token
pending. It never blocks or touches a contributor payment.
Unused-fund withdrawals deduct the same 2%, `floor(gross / 50)`, enforced in the
contracts, and reach only the owner's refund destination; funded
obligations cannot be withdrawn.
Historical v1 records retain their original fee and authority rules. No project
activates escrow merely because the new code is present. Keep project deployment
bindings in the D1 project revision, never in a second project inventory.
