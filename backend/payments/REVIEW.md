# Review and owner commitment gate

The v2 proposal is not an approval. After a complete source-bound proposal is
published, maintainers add `decisions.json` in the same `escrow-v2` directory.
The file identifies the exact SHA256 of `proposal.json` and contains one explicit
decision for every proposed numeric GitHub actor:

```json
{
  "schemaVersion": "1",
  "proposalSha256": "SHA256_OF_EXACT_PROPOSAL_FILE_BYTES",
  "rows": [
    {
      "githubUserId": "123",
      "state": "approved",
      "approvedGrossMicro": "100000000",
      "adjustmentReason": null,
      "relatedParty": false
    }
  ]
}
```

The uppercase digest above is documentation notation, not an accepted digest.
Allowed states are `approved`, `held`, and `excluded`. Held/excluded rows have
zero approved gross. An amount change requires a public reason. Approved gross
amounts cannot exceed the proposal's gross cap in total. The project steward
must be marked related-party; maintainers must also identify other actual
related parties. An actor cannot disappear from the reviewed decisions.

Before emitting unsigned owner transactions, `prepare-escrow-commitments.ts`
checks exact archive bytes on this application's canonical GitHub origin and
`main`. It verifies the merged PR which published each file and uses GitHub's
`merged_at` timestamp for the review clock. The last publication among the
snapshot, identities, archived project policy, proposal, and financial decisions
starts the 14 days. A caller-supplied `generatedAt`, Git author date, local file
mtime, or edited review-end field cannot skip that period. Missing or ambiguous
publication evidence blocks the plan. Changes to financial decisions start a
new review period.

Only approved positive rows appear in the unsigned plan. Their approved gross
amount replaces the suggestion; the 2% fee is deducted on-chain. The plan
includes publication evidence, the decisions digest, and explicit network data.
The owner still reviews and signs. A plan does not prove approval, funding,
submission, or a completed transfer.

A related-party payment additionally needs `platform-approvals.json`:

```json
{
  "schemaVersion": "1",
  "proposalSha256": "SHA256_OF_EXACT_PROPOSAL_FILE_BYTES",
  "decisionsSha256": "SHA256_OF_EXACT_DECISIONS_FILE_BYTES",
  "approvals": [
    {
      "githubUserId": "123",
      "reviewerId": "456",
      "reviewer": "maintainer-login",
      "approvedAt": "2026-10-20T12:00:00Z",
      "pullRequest": 100,
      "reviewId": 200
    }
  ]
}
```

This separate file prevents approval bookkeeping from endlessly resetting the
financial review clock. Every approved related-party actor must have one entry.
The actual GitHub review must be APPROVED at the merged PR's exact head, occur
after the financial review deadline, and match the recorded numeric reviewer
and timestamp. The reviewer must be a human account with current write,
maintain, or admin permission in the platform repository and must differ from
both the beneficiary and project steward. The PR must include the exact reviewed
decisions. To establish explicit intent, the review body includes this complete
line with real digests and actor ID:

```
slop-related-party-approval:v1 PROPOSAL_SHA256 DECISIONS_SHA256 NUMERIC_GITHUB_ACTOR_ID
```

An unrelated review, bot approval, stale-head review, self-approval, unavailable
permission check, or unpublished approval artifact does not authorize payment.
No test creates public approvals. The gate integration tests use clearly labeled
HTTP response fixtures and real local archive files to test refusal, exact-byte
binding, and the trusted review clock; they are not live GitHub review evidence.
