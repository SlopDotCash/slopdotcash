# Evaluated contribution awards

This directory is the only bridge from a review-agent recommendation to public
score. Review bots may post a `slop-review` record in project CI, but that
record is advisory and cannot score, exclude, ban, or pay anyone.

A maintainer may recognize useful work that did not otherwise score by opening
an `SlopDotCash/slopdotcash` pull request containing exactly one file at:

```text
evaluations/<project-id>/award-<stable-slug>.json
```

The pull request is the public human decision. Its URL goes in
`review.decisionUrl`; the reviewer, review time, exact GitHub actor identity,
source item, factual reason, and 1–8 point award are explicit. CI rejects extra
fields, unknown projects, non-canonical repositories or URLs, bots, duplicate
sources, duplicate ids, symlinks, oversized files, awards outside the rolling
window, and sources already rewarded by the ordinary GitHub ledger. The newest
three valid awards per contributor and project can score in a window.

Example (do not copy placeholder identities into a real award):

```json
{
  "schemaVersion": "1",
  "kind": "evaluated-contribution",
  "id": "award_useful_diagnosis_17",
  "projectId": "eliza",
  "repository": "elizaOS/eliza",
  "actor": {
    "id": "GITHUB_GRAPHQL_NODE_ID",
    "login": "contributor",
    "avatarUrl": "https://avatars.githubusercontent.com/u/123?v=4",
    "url": "https://github.com/contributor",
    "kind": "User"
  },
  "occurredAt": "2026-07-20T10:00:00.000Z",
  "points": 4,
  "source": {
    "id": "GITHUB_GRAPHQL_NODE_ID",
    "kind": "pull-request",
    "number": 17,
    "title": "Diagnose the scheduler race",
    "url": "https://github.com/elizaOS/eliza/pull/17"
  },
  "reason": "The unmerged patch isolated a real race and supplied the regression test reused by the accepted fix.",
  "review": {
    "reviewer": "maintainer",
    "reviewedAt": "2026-07-22T10:00:00.000Z",
    "decisionUrl": "https://github.com/SlopDotCash/slopdotcash/pull/99"
  }
}
```

Never publish vulnerability details, secrets, raw private trajectories, or
wallet credentials in an award. Use the target repository's private security
reporting path for sensitive findings.
