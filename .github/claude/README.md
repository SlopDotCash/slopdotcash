# Claude PR triage pipeline

`.github/workflows/claude-pr-triage.yml` runs Claude against every opened,
reopened, updated, or ready-for-review pull request (and on demand via
`workflow_dispatch` with a PR number).

## Outcomes

| Verdict | Action (deterministic workflow steps, not the model) |
|---|---|
| `malicious` | Close the PR, label `flagged-malicious`, comment, and block the author org-wide (requires `PR_TRIAGE_ADMIN_TOKEN`; otherwise warns for a manual ban). |
| `auto_merge` | Comment approval and squash-merge via GitHub's auto-merge queue (falls back to direct merge; if blocked, labels `claude-approved` for a human). |
| `needs_research` | A deeper Claude pass researches the implementation against the base branch, posts a review; if it confirms correct + non-controversial it merges under the same gates, else labels `needs-human-review`. |

## Setup

1. Repo secret `CLAUDE_CODE_OAUTH_TOKEN` — required for both Claude steps.
   This uses your Claude subscription (Pro/Max) instead of API billing:
   run `claude setup-token` locally, then save the printed token as the
   secret. Tokens expire after roughly a year; re-run `claude setup-token`
   to rotate.
2. Repo secret `PR_TRIAGE_ADMIN_TOKEN` (optional) — an org-owner PAT with
   `admin:org`, used only for `PUT /orgs/{org}/blocks/{username}` when a PR
   is flagged malicious. Without it the PR is still closed and labeled.
3. Repo settings: enable **Allow auto-merge** so approved PRs queue behind
   required checks; keep branch protection with required status checks on
   `main` so nothing merges on red CI.

## Safety properties

- PR head code is never checked out, built, or executed; only the base
  branch is checked out, and the diff is fetched as data.
- The prompts treat PR title/body/diff as untrusted; verdicts are parsed
  from strict JSON, and a missing/invalid verdict fails safe to
  `needs-human-review`.
- Changes under `.github/`, `funding/`, `migrations/`, `CLAUDE.md`,
  `AGENTS.md`, `package.json`, or `bun.lock` are never auto-merged,
  enforced by a bash gate independent of the model.
- Merges go through GitHub's auto-merge / branch-protection machinery, so
  required checks still gate every merge this workflow performs.
