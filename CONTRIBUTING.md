# Contributing to Slop

Slop rewards accepted open-source outcomes, and this repository should be held
to the same standard. Keep changes focused, reviewable, evidence-backed, and
safe under hostile input.

## Before you start

1. Read `README.md` and `AGENTS.md`.
2. Open or claim a GitHub issue for non-trivial work.
3. Fetch the latest `origin/develop` and create a scoped branch from it.
4. Re-read live GitHub before acting; issue assignment, review, and project
   state may have changed.

Pull requests target `develop`. Do not push directly to the protected branch,
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
- produce tests, evidence, and a signed attribution receipt;
- upload only the contributor-reviewed minimized private trace through the
  authenticated write-only path;
- never claim an issue, publish a placeholder PR, handle keys, or move money.

The reviewer skill is separate and advisory. It checks correctness, tests,
scope, security, duplication, evidence, and usefulness. Automation may propose
a score or hold; a human decides acceptance, exclusions, and money.

Run at minimum:

```bash
bun run projects:check
bun run test
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

## Quality gate

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
results, console/network logs, and a short walkthrough. Installer or skill work
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
