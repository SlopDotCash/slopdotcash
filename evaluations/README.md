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

## Reviews that lead to closing a pull request

A substantiated review-led closure can be a useful evaluated outcome even when
no replacement has landed yet. Examples include demonstrating that an approach
cannot satisfy a required invariant or consolidating a duplicate implementation
after comparing the alternatives. A landed repair is stronger evidence, but it
is not a prerequisite when the closure decision itself prevents a concrete,
well-supported project risk or avoids material duplicate work.

Closure is never sufficient by itself. The evaluation pull request must let an
independent maintainer assess all of the following:

- the exact public review, recorded as a `source.kind` of `review` with its
  canonical `#pullrequestreview-...` URL;
- the specific technical finding or comparison that justified closure;
- public evidence tying that finding to the decision, such as a maintainer's
  closure explanation, a linked consolidation decision, or independently
  reproduced failure evidence; and
- why the outcome was useful enough for a discretionary 1–8 point award,
  including any uncertainty or credit shared with earlier reviewers.

Chronology, an author's acknowledgement, a matching closure reason, or the word
`CLOSE` in review text does not establish causation or value on its own. GitHub
has no `CLOSE` review state: a substantive `COMMENTED` review may be evaluated
here when the public evidence establishes its outcome. This is distinct from
ordinary formal-review scoring and does not change merge-based scoring.

Submit the request through the same one-file evaluation pull request described
above. The reviewing maintainer—not the reviewer, author, or an automated
evaluator—decides whether the closure produced a useful outcome and selects the
award, if any. Existing canonical-source deduplication, ordinary-ledger
deduplication, rolling-window limits, and the three-award contributor/project
cap still apply. Coordinated, repetitive, low-value, or unsupported closures
receive no automatic credit.

For example, a review that proves a proposed scheduler design loses queued work
may support an award when the maintainer closes the pull request on that basis,
links the exact review, and confirms the reproduced invariant failure. “The
pull request was closed after this review” is not an adequate reason.

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
