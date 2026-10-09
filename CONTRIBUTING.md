# Contributing to Slop

Slop rewards accepted open-source outcomes, and this repository should be held
to the same standard. Keep changes focused, reviewable, evidence-backed, and
safe under hostile input.

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

## Before you start

1. Read `README.md`, `AGENTS.md`, the linked PRD, and the MVP delivery plan.
2. Check existing issues and pull requests for overlapping work. Link the relevant
   issue and exact PRD/MVP references. Only humans may write and submit issues
   on the website; agents must not create an issue to begin work.
3. Fetch the latest `origin/development` and create a scoped branch from it.
4. Re-read live GitHub before acting; issue assignment, review, and project
   state may have changed.

Pull requests target `development`. Promote accepted changes through a PR to `main`.
See [release environments](docs/release-environments.md). Do not push directly to the protected branch,
self-approve, bypass required review, or expose production credentials to
feature-branch code.

## Add a project

Start with the public proposal builder at
[`slop.cash/projects/new`](https://slop.cash/projects/new). It prepares the
manifest and an agent brief, then links to GitHub’s new-file flow. The website
does not activate a project or create private platform state.

A project pull request must add all three canonical surfaces:

```text
projects/<project-id>/project.json
skills/contribute-to-<project-id>/
skills/review-<project-id>-contributions/
```

Use an existing project only as a structural reference. Rewrite its mission,
work selection, repository rules, evidence requirements, and review policy for
the proposed project.

The manifest must use immutable GitHub repository and actor IDs, a reviewed
license URL/commit/digest, a concrete integration branch, a verified steward,
and explicit reward and funding states. New proposals stay paused with payment
and contribution receipts disabled until the corresponding authority and
production paths are independently verified. GitHub stewardship is not a claim
of copyright ownership, legal capacity, assignment, or wallet control.

The contributor skill must:

- inspect live GitHub before selecting work;
- respect the target repository’s instructions and contribution policy;
- allow any provider, model, and client with exact disclosure;
- test the result and disclose the exact provider, model, and client;
- offer signed receipts and private traces as optional evidence, never as a
  submission prerequisite; upload only contributor-reviewed traces through the
  authenticated write-only path;
- never claim an issue, publish a placeholder PR, handle keys, or move money.

The current reviewer skill is separate and advisory. The PRD's optional bot
closures and security enforcement need approved protocol/permission changes
before activation. It checks correctness, tests,
scope, security, duplication, evidence, and usefulness. Automation may propose
a score or hold; a human decides acceptance, exclusions, and money.

Run at minimum:

```bash
bun run projects:check
bun run build
bun run test:e2e
```

## Change the product or protocol

Preserve these boundaries:

- `projects/*/project.json` is the sole project and repository inventory.
- Score accepted outcomes, not activity or token volume.
- Keep projected, under-review, approved, scheduled, and paid states distinct.
- Never infer ownership, legal capacity, wallet control, or payment authority.
- Never expose secrets, raw prompts/responses, private traces, credentials,
  session identifiers, or signing material.
- Settlement and commitment tooling is read-only or produces unsigned plans;
  it never signs or broadcasts.
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

Every PR must identify its PRD requirement and MVP package, explain the actual
problem and useful result, and state the evidence that proves the result.
Compare reasonable alternatives and explain reuse or simplification. New types,
dependencies, or systems need a concrete requirement existing code cannot meet.
Keep descriptions specific to the actual diff; tests and line counts alone do
not establish value.

Write issues and PRs in ASD-STE100 Simplified Technical English. Use short,
active sentences and consistent terms. Define technical abbreviations. State
what the user does, what occurs, and why it matters. Include detailed test steps,
expected results, actual results, the exact tested revision, and limitations.
Include `Made via @slopdotcash` without replacing required model attribution.
Humans remain responsible for independently writing issue text.

## Quality gate

For documentation-only changes, verify instructions, links, PRD/MVP
consistency, and the identical AGENTS/CLAUDE files. Application end-to-end
evidence is not proof of prose correctness; explain its applicability and
retain required checks. Do not add artificial application tests for prose.

Install the pinned toolchain and run the complete repository check:

```bash
bun install --frozen-lockfile
bun run verify
bun run test:e2e
```

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
test. Deployment work includes the tested SHA, workflow and deploy IDs,
immutable Pages URL, deployed-byte comparison, DNS, TLS, redirects, and security
headers. Use `N/A - <reason>` only when an item genuinely cannot apply.

Do not commit captured evidence unless a protocol explicitly requires the
artifact. A green local test is not proof of merge, deployment, provider
availability, device behavior, or payment.

## Security and privacy

Use private vulnerability reporting for sensitive findings. Never place
secrets, credentials, wallet keys, raw private trajectories, personal request
details, or exploitable vulnerability information in public GitHub content.

By contributing, you agree that your contribution is licensed under the MIT
License.
