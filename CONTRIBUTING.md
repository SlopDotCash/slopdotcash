# Contributing to Slop

Slop rewards accepted open-source outcomes, and this repository should be held
to the same standard. Keep changes focused, reviewable, evidence-backed, and
safe under hostile input.

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

## Before you start

1. Star and fork `SlopDotCash/slopdotcash` on github.com with your own GitHub
   account, and work from your fork. An agent stars and forks only when it
   can use computer use or browser use (PRD section 4). Without these tools,
   it asks before it creates a fork. Stars and forks are never scored or paid.
2. Read `README.md`, `AGENTS.md`, and the canonical PRD sections that your
   change affects.
3. Check existing issues and pull requests for overlapping work. Link the relevant
   issue and PRD section. Do not open an issue to begin work.
   Only project owners and maintainers open issues.
4. Fetch the latest `origin/development` and create a scoped branch from it.
5. Re-read live GitHub before acting; issue assignment, review, and project
   state may have changed.

Pull requests target `development`. Promote accepted changes through a PR to `main`.
See [release environments](docs/release-environments.md). Do not push directly to `development` or `main`,
self-approve, bypass required review, or expose production credentials to
feature-branch code.

## Slop bounty: what is accepted

This repository has a $1,000 monthly Slop contributor pool. Slopbot scores
accepted merges, and maintainers may correct a score. Payment follows the
project's monthly payment process. The pool is pledged, not escrowed or
guaranteed.

The PRD is binding. Accepted work, inside approved MVP scope:

- a real bug, reproduced first, then fixed and proven fixed end to end;
- security defects in authentication, authorization, identity, private traces,
  the installer, or signer and vault boundaries, with a demonstrated reachable
  path;
- verification and settlement correctness: scoring, monthly allocations,
  project vault execution tracking, and on-chain reconciliation;
- tests that prove a real product path failed and now works;
- hill climbing: a measured improvement to a required behavior, with the same
  method run before and after the change.

Not accepted (maintainers close it, and it can be penalized):

- UI, visual, layout, style, or copy changes. The only exception is a fix to a
  broken user flow; that PR must include before and after video of the flow;
- new features or scope that the PRD does not approve;
- preference refactors, renames, and items in the anti-slop gate below;
- proof that uses mocked or recorded LLM output instead of real calls;
- placeholder code, TODOs, unverified claims, and duplicate work.

### Test with real LLM calls

Evidence for model-backed behavior (for example the slopbot triage route in
`workers/slopbot/models.ts`) must come from real provider calls. Record the
provider, exact model, request count, and the result. Do not paste prompts,
responses, keys, or private traces into public GitHub content.

Copy [`.env.example`](.env.example) to `.env` for local scripts. Put Worker
secrets in `workers/<worker>/.dev.vars` for `wrangler dev`. Git ignores both
files. Never commit a value. Use test or staging credentials only.

| Variable | Used by | When you need it |
| --- | --- | --- |
| `GITHUB_TOKEN` or `GH_TOKEN` | ingestion, leaderboard, live GitHub checks | Required for `leaderboard:generate` and live checks. Read-only public scope is sufficient. |
| `SOLANA_RPC_URL` | `fee-converter:dry-run` | Optional. Defaults to public mainnet RPC; set a private RPC for heavy use. |
| `OPENAI_API_KEY` | slopbot fallback model (`.dev.vars`) | Required to test the slopbot model route. |
| `SURPLUS_API_KEY`, `SURPLUS_BASE_URL` | slopbot primary model (`.dev.vars`) | Required to test the primary slopbot model route. |
| `SLOPBOT_WEBHOOK_SECRET`, `SLOPBOT_APP_ID`, `SLOPBOT_APP_USER_ID`, `SLOPBOT_APP_PRIVATE_KEY` | slopbot GitHub App (`.dev.vars`) | Only with your own test GitHub App. See `workers/slopbot/README.md`. |
| `IDENTITY_STATE_KEY`, `IDENTITY_ASSERTION_KEY`, `TRACE_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | identity Worker (`.dev.vars`) | Only for local identity and trace-upload tests. Generate your own random values and use your own OAuth app. |
| `VITE_SLOP_ENVIRONMENT`, `VITE_IDENTITY_PUBLIC_ORIGIN` | browser build | Optional. Point a local build at staging identity. |
| `SLOP_E2E_PORT`, `SLOP_E2E_WORKERS` | `bun run test:e2e` | Optional. Change the browser test port or worker count. |

### Test in more than one agent client

Contributors use Slop through agents, so test the affected workflow in the
agent clients that use it. Install other clients yourself and drive them with
computer use when needed. This is required evidence, not an optional extra:

- Claude Code;
- OpenAI Codex and ChatGPT;
- Hermes Agent (Nous Research);
- OpenClaw;
- Muse;
- Grok bot;
- an elizaOS agent;
- Cursor, or another client that the change affects.

For each client, record the client name and version, provider, exact model,
the steps, and the result. If a client cannot run the workflow, write what
failed. Do not claim a client was tested when it was not.

## Add a project

Add a project on the website, not by pull request. Sign in with GitHub and
complete setup at [`slop.cash/projects/new`](https://slop.cash/projects/new).
PRD section 4 defines the target flow: a project becomes ready without routine
admin approval after complete setup, verified GitHub authority, Slopbot
installation, and a passed malicious-code scan. Funding is optional and has a
separate status. Owners publish later changes as append-only D1 revisions.
Outside the permanent existing-project exemption, one successful admission scan
covers routine later changes to the same immutable registered repository. Keep
its original assessed revision and complete evidence;
do not describe later content as scanned. Explicit investigations, flags, pauses,
confirmed-malicious decisions and fresh reinstatement scans remain required under
PRD section 8. Where the deployed site still
shows an admin approval step, that step is implementation to migrate. Do not
open a pull request to add or update a project, and do not add project JSON or
a per-project skill folder to this repository.

Slop generates the project's contributor and reviewer skills from its D1
revision and the one canonical generic template in this repository (PRD
SKL-03). In the form, write the scope, contribution guide, supported tasks,
required tests, review expectations, security contact, closure policy, and any
maintainer notes. The generated skills are previewed during setup.

The manifest must use immutable GitHub repository and actor IDs, a reviewed
license URL/commit/digest, a concrete integration branch, a verified steward,
and explicit reward and funding states. Payment and contribution receipts
stay disabled until the corresponding authority and production paths are
independently verified. GitHub stewardship is not a claim
of copyright ownership, legal capacity, assignment, or wallet control.

The contributor skill must:

- inspect live GitHub before selecting work;
- respect the target repository’s instructions and contribution policy;
- allow any provider, model, and client with exact disclosure;
- test the result and disclose the exact provider, model, and client;
- put the visible `Made via @slopdotcash` line once in every PR it opens;
- offer signed receipts and private traces as optional evidence, never as a
  submission prerequisite; upload only contributor-reviewed traces through the
  authenticated write-only path;
- after the PR exists, record a `pull_request_opened` event that names the PR
  node ID through the contributor's own authenticated Slop session;
- never claim an issue, publish a placeholder PR, handle keys, or move money.

The current reviewer skill is separate and advisory. The PRD requires free Slopbot on registered
repositories. Bot closure and security enforcement still need reviewed
protocol/permission changes before activation. It checks correctness, tests,
scope, security, duplication, evidence, and usefulness. Slopbot may score,
apply the published penalty table, label uncertain findings after the 7-day
maintainer window, and triage appeals. A human decides merges, escalated
disputes, exclusions, bounty awards, and any money outside the automatic
monthly distribution.

Run at minimum:

```bash
bun run projects:check
bun run build
bun run test:e2e
```

## Change the product or protocol

Preserve these boundaries:

- The D1 project registry is the sole project and repository inventory.
- Score accepted outcomes, not activity or token volume.
- Keep projected, under-review, approved, scheduled, and paid states distinct.
- Never infer ownership, legal capacity, wallet control, or payment authority.
- Never expose secrets, raw prompts/responses, private traces, credentials,
  session identifiers, or signing material.
- Settlement tooling never signs or broadcasts a vault transfer or a payment.
  The only Slop signers are the PAY-05 identity attester, the TOK-07 fee-wallet
  key, and the referral root-posting key, within the limits in `AGENTS.md`.
- Generated public assets come from `bun run prepare:site`; do not edit them by
  hand.

Schema, installer, scoring, identity, trace, funding, cycle, settlement, or
deployment changes require focused success and failure-path tests.

## Anti-slop contribution gate

Slop scores accepted outcomes, not PR, line, test, mutation, assertion, or
coverage counts. Low-value work earns no accepted-outcome score and may be
penalized or excluded from contribution-quality and reward review. Reviews that
reward bloat are judged by the same standard.

Do not submit or reward:

- one-PR-per-file coverage farming, “no same-named test” tasks, or tests of
  helpers, hooks, barrels, schemas, types, constants, exports, and test helpers
  without a reproduced material product failure;
- shape-smoke assertions that only check existence, type, finiteness, length,
  literal metadata, export identity, or mocked calls;
- copied, templated, or mismatched PR descriptions and evidence that describe
  another diff or substitute counts for a causal explanation;
- speculative guards, sanitizers, coercions, fallback success, exhaustive edge
  matrices, lossy caps, compaction, bounded reads, or arbitrary short deadlines;
- shotgun series that replicate NaN-sort fallbacks, CE year 0–99 handling,
  placeholder-key/config-shape checks, Unicode truncation refinements, or the
  same defensive patch across unrelated modules; or
- coverage-generated parser, lookup, regex-state, word-boundary, or fallback
  micro-fixes split under an “independent module, independent fix” rationale; or
- generalized systems and large harnesses that do not first deliver one
  working end-to-end product outcome.

Real security, authorization, protocol, and resource boundaries remain valid
when reachability and material impact are demonstrated. Enforce them once at
the canonical boundary and prove the real path.

## Pull request scope and writing

Every PR must cite its PRD section, explain the actual problem and useful
result, and state the acceptance result and the evidence that proves it.
Compare reasonable alternatives and explain reuse or simplification. New types,
dependencies, or systems need a concrete requirement existing code cannot meet.
Keep descriptions specific to the actual diff; tests and line counts alone do
not establish value.

Write issues and PRs in ASD-STE100 Simplified Technical English. Use short,
active sentences and consistent terms. Define technical abbreviations. State
what the user does, what occurs, and why it matters. Include detailed test steps,
expected results, actual results, the exact tested revision, and limitations.
Include `Made via @slopdotcash` on PRs without replacing required model
attribution. Owners and maintainers write issues; contributors write PRs.

The attribution rule (the recorded decision in PRD section 11; sections 4 and 5) has two
levels:

| Purpose | Required evidence |
| --- | --- |
| Ordinary submission | The visible `Made via @slopdotcash` line and the exact provider, model, and client. A signed run receipt is optional and never blocks submission. |
| Automatic closure or penalty | The author is a slop.cash member, matched by immutable GitHub ID, and has a `trace_runs` row from their own authenticated Slop session for this project with a `pull_request_opened` event that names this PR node ID. |

A copied marker or footer alone never proves membership or skill use. Usage
totals and traces are diagnostic only; they never set a reward and never gate a
submission.

## Definition of done

A PR is done when it cites its PRD section, the affected flow produces the
stated acceptance result at the exact head (including its failed, unavailable,
and uncertain paths where they apply), new behavior has focused success and
failure-path tests, the checks below pass, and the evidence for the affected
surface is attached. A merge does not prove deployment, and a deployment does
not prove provider, chain, or payment availability.

Release checks are engineering checks. Deployment identity, deployed-byte
comparison, DNS, TLS, redirects, and security headers belong to the release
PR from `development` to `main` and to the deployment workflow. Other PRs mark
those rows `N/A - not a release`.

For documentation-only changes, verify instructions, links, PRD
consistency, and the identical AGENTS/CLAUDE files. Application end-to-end
evidence is not proof of prose correctness; explain its applicability and
retain required checks. Do not add artificial application tests for prose.

## Quality gate

Install the pinned toolchain and run the complete repository check:

```bash
bun install --frozen-lockfile
bun run leaderboard:generate
bun run verify
bun run format:check
bun run test:e2e
```

For local pull-request checks without live GitHub ingestion, replace only
`leaderboard:generate` with the validated public-snapshot preparation in
[Local review checks](README.md#local-review-checks). Stop if preparation
fails; a leftover ledger is not valid evidence. The release workflow always
collects fresh GitHub data.

For UI changes, test the built site at desktop and mobile widths, keyboard-only
navigation, 200% zoom, WCAG AA, copy feedback, downloads, raw Markdown routes,
GitHub links, console output, and first-party network requests.

## Evidence

Attach current evidence directly to the issue and pull request. Evidence must
match the exact reviewed head; rerun it after a rebase or functional change.

UI work includes before/after desktop and mobile screenshots, accessibility
results, console/network logs, uploaded walkthrough and evidence videos, and
detailed test steps and expected results. Installer or skill work
includes the generated archive/checksum and a fresh real-repository forward
test. Release and deployment work includes the tested SHA, workflow and deploy
IDs, immutable Pages URL, deployed-byte comparison, DNS, TLS, redirects, and
security headers. Use `N/A - <reason>` only when an item genuinely cannot
apply.

Do not commit captured evidence unless a protocol explicitly requires the
artifact. A green local test is not proof of merge, deployment, provider
availability, device behavior, or payment.

## Security and privacy

Use private vulnerability reporting for sensitive findings. Never place
secrets, credentials, wallet keys, raw private trajectories, personal request
details, or exploitable vulnerability information in public GitHub content.

By contributing, you agree that your contribution is licensed under the MIT
License.
