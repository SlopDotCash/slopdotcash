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

## Contributions outside GitHub

A project may opt in to awards for useful work that never touches its
repository: a public explainer thread, a support answer that closed a recurring
question, a tutorial, or a video. The opt-in is one reward field in the
project manifest, and it is absent by default:

```json
"externalEvaluations": { "enabled": true }
```

External awards use the same one-file pull request, the same 1–8 point range,
the same reviewing-maintainer decision, the same newest-three cap per
contributor and project, and the same canonical-source deduplication. Nothing
about merge-based or review-based scoring changes. What differs is the source:

- `source.kind` is `external` and `source.platform` is one of `x`, `discord`,
  `youtube`, or `web`. The URL must be the canonical public address for that
  platform, with no query string or fragment. GitHub URLs are rejected here and
  must use the ordinary GitHub source kinds instead.
- `source.id` is `external-` followed by the lowercase SHA-256 of the exact
  URL, so the same URL can never be awarded twice under a different id.
- `source.evidence` is required: a `web.archive.org` capture of the exact URL
  (or an `archive.ph` snapshot), the lowercase SHA-256 of the captured content,
  and the capture time, which must fall between `occurredAt` and
  `review.reviewedAt`. The award stays auditable if the post is later deleted.
- There is no `source.number`, no run receipt, and no evidence bonus. An
  external source cannot carry a signed receipt because nothing was run
  against the repository.

Reach is not a reason. Likes, views, reposts, and follower counts are not
evidence of usefulness and are never cited in an award. The maintainer states
the concrete outcome: the question it answered, the migration it unblocked,
the guide that now links it. Coordinated posting, reposted documentation, and
promotional content receive no credit.

Example (do not copy placeholder identities into a real award):

```json
{
  "schemaVersion": "1",
  "kind": "evaluated-contribution",
  "id": "award_contributor_runtime_thread",
  "projectId": "eliza",
  "repository": "elizaOS/eliza",
  "actor": {
    "id": "GITHUB_GRAPHQL_NODE_ID",
    "login": "contributor",
    "avatarUrl": "https://avatars.githubusercontent.com/u/123?v=4",
    "url": "https://github.com/contributor",
    "kind": "User"
  },
  "occurredAt": "2026-09-01T10:00:00.000Z",
  "points": 2,
  "source": {
    "id": "external-<sha256 of the url>",
    "kind": "external",
    "platform": "x",
    "title": "Thread: migrating an eliza plugin to the v2 runtime",
    "url": "https://x.com/contributor/status/1830000000000000000",
    "evidence": {
      "archiveUrl": "https://web.archive.org/web/20260902120000/https://x.com/contributor/status/1830000000000000000",
      "contentSha256": "<sha256 of the captured content>",
      "capturedAt": "2026-09-02T12:00:00.000Z"
    }
  },
  "reason": "The thread documented the exact runtime migration steps three issue reporters had been missing; the plugin guide now links it.",
  "review": {
    "reviewer": "maintainer",
    "reviewedAt": "2026-09-03T10:00:00.000Z",
    "decisionUrl": "https://github.com/SlopDotCash/slopdotcash/pull/99"
  }
}
```

Never publish vulnerability details, secrets, raw private trajectories, or
wallet credentials in an award. Use the target repository's private security
reporting path for sensitive findings.
