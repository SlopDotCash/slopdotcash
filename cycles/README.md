# Reward cycles

Monthly awards no longer create files here. The trusted monthly workflow
stores each funded project's proposed allocation privately in D1; the owner
changes amounts privately, and the owner or the automatic cutoff freezes the
final allocation (see "Monthly allocations and the automatic monthly
coordinator" in `backend/payments/README.md`). The public record of a month
is its final awards and their finalized payment evidence. No review pull
request, public decision or public adjustment reason exists for new months.

This directory holds no cycle records. The historical records were removed
with the legacy projects on 18 October 2026; Git history keeps them, and
`tests/fixtures/history/cycles/` keeps test copies. The notes below define
their format at `cycles/<project-id>/<YYYY-MM>/`, which `bun run cycles:check`
still validates.

## Historical escrow cycles

An escrow cycle directory holds only these files:

- `source-snapshot.json`: the exact validated leaderboard bytes;
- `project.json`: the exact bytes of the project's newest D1 revision when
  the cycle was prepared. Its SHA-256 is the proposal's `projectPolicySha256`
  and the revision's public `manifestSha256` at
  `/api/v1/project-revisions/<project-id>/<revision>`;
- `github-identities.json`: the numeric GitHub identities of the leaders;
- `proposal.json`: the deterministic gross proposal;
- `decisions.json` (optional): the owner's per-row decisions, each with a
  public reason for a changed amount, under the rules of that time;
- `platform-approvals.json` (optional): platform approvals bound to the exact
  proposal and decisions digests.

The escrow contract enforces reserved awards, the 2%
fee, and exact-once payment. No command in this repository reads a private key,
signs, or broadcasts.

`bun run cycles:check` validates every escrow cycle against its frozen
snapshot, policy, and identities. It reads no chain.

## Historical monthly-pool cycles

Cycles from the removed monthly-pool mode keep `source-snapshot.json`,
`proposal.json`, and, after approval, `allocation.json`. The cycle index
regenerates each proposal from its frozen snapshot and checks each approved
allocation against its reviewed proposal, so points, profiles, and the cycle
archive read the same scores. No new monthly-pool proposal is created, and no
settlement plan, transaction evidence, settlement record, or windup record is
accepted. Delta Star uses only `source-snapshot.json` and `proposal.json`; it
publishes a provisional contribution percentage and never represents the
external prize as money owed by this platform.

A historical proposal freezes `fundingBasis`. Its instrument ID is null and its
committed amount is zero, because no manifest instrument backs a monthly
commitment. The July 2026 cap-based proposal is the grandfathered unfunded
trial; cycle validation uses the cap recorded in that artifact.

`bun run cycles:sync` also generates `src/lib/project-promotion.generated.json`
from the validated cycle index. This compact funding history ships with the
application so homepage project cards never wait for the ledger or cycle fetch.
`cycles:check` rejects a stale copy; refresh timestamps are excluded so
unchanged history keeps the application asset bytes stable.
Existing immutable cycle files stay unchanged.

## Unsafe destination reports

A contributor may report the exact Slop wallet claim on an open proposal as
unsafe. The report is evidence; the maintainer chooses whether to hold the row
with a public reason. No report endpoint or background job changes an award.
The original wallet observation stays in the held row, `approvedMinor` becomes
zero, and the other rows and the review clock stay unchanged. A held amount is
carried, not owed. Ordinary `held` rows still do not carry.

The supported authentication path is a GitHub-verified commit signed by the
contributor's own registered signing key. Commit author email and login are
insufficient: verification checks `signature.isValid`, `signature.state`, and
the signature signer's immutable GitHub actor ID. Slop does not sign anything.
Only public report and wallet metadata appear in the commit message.

1. Generate the exact commit message from the published proposal using
   `bun scripts/unsafe-destination-hold.ts --message <proposal.json> <intent-id> <UTC-report-time>`.
   It includes the project, cycle, intent, exact suggested amount, report time, and complete original
   actor-bound Slop wallet claim. Profile-README claims are not supported by
   this reporting path.
2. The contributor signs a commit with that exact message in a public GitHub
   repository they control, then supplies its repository and immutable SHA.
   The maintainer's report JSON contains the message's JSON fields plus
   `kind: "unsafe-destination"`, `sourceRepository`, and `sourceCommit`.
3. During the existing review window, the maintainer runs
   `bun scripts/unsafe-destination-hold.ts <proposal.json> <signed-report.json> <public-reason>`.
   This fetches the signed commit, verifies the exact message and signer, and
   emits a candidate proposal on stdout. It writes no cycle file and grants no
   approval. The maintainer reviews and submits that proposal through GitHub.

The immutable trusted-base `pull_request_target` transition gate independently
re-verifies every unique report against GitHub and fails closed if its exact
commit, message, or signer cannot be verified. Only this trusted checker and the
maintainer's explicit hold command require `gh` authentication. Ordinary PR
`cycles:check`, index generation, `prepare:site`, and builds remain credential-free
structural validation. These packaging checks do not authorize a
new report or replace the required trusted transition gate. No contributor code
is executed with the gate's token. `unsafeDestinationReports` retains
the signed evidence through carry; `hold` identifies the report selected by
the maintainer for the original held row. The signed report binds the complete
suggested amount and an explicit `carryMinor` equal to the original shared-pool
line (or the full accrued amount without reward lines); both reward lines are
held with zero approved principal. Changing the split while keeping the total
unchanged invalidates the signed report.
The next cycle carries only the shared-pool amount exactly once. The additive
review-budget line stays in its original cycle and never becomes shared-pool
carry; this also applies to unclaimed and below-minimum rows. Until the registry supplies a different address in
a different actor-bound claim observed after report verification, the row is
`unclaimed` and continues carrying. Republishing the compromised address in a
new claim never makes it eligible. A safe successor starts a normal proposal
in the next cycle; it never substitutes a wallet within an existing review.

Safety history is independent of money carry. Snapshot verification reads
every earlier immutable project cycle, including approved, paid, excluded, and
zero-participation history. Every report must trace to its
original held row; repeated copies must have identical normalized bytes and
the same contributor. Approving a safe successor, paying its intent, exhausting
the balance, or omitting the contributor from a later cycle never clears an
unsafe claim or address. A zero-award cycle needs no synthetic allocation row:
the older immutable reports remain the source of truth for the next proposal.
The scan allows at most 1,200 project cycle directories, 32 MiB of prior proposal
and allocation bytes, 4,096 unique reports, and 32 reports per contributor. It
fails closed on missing originals, conflicting copies, symlinks, or exceeded
limits; it never truncates safety history. Money still carries only from the
immediately preceding reviewed cycle, with no review-budget carry.

`Trusted unsafe destination transition gate` closes the deletion boundary that
current-state validation alone cannot detect. Its `pull_request_target` workflow
checks out only the immutable base SHA, fetches the exact PR head as Git objects,
and runs only base-owned checker/schema code with read-only repository access.
It never checks out the PR, installs contributor dependencies, or executes head
code. Every existing `proposal.json` and `allocation.json` must retain its path
and regular-file mode. Existing unsafe-report arrays must keep their exact
normalized prefix in the same contributor row. An accepted hold keeps its hold
reference, original wallet and amounts, held state, and zero approval. Removing
the entire history field cannot reset this protection. Later safe-successor
cycles append new records without changing the held origin. New and changed
rows also inherit every applicable unsafe report found in the trusted base,
so adding a new cycle alongside weakened contributor-side validation cannot
omit the block. External-prize share manifests retain their separate schema.

The transition check bounds each tree to 2,400 cycle manifests, each decoded
blob to 8 MiB, all decoded base/head blobs to 32 MiB, and unique signed reports
to 4,096 (each verified once per run); malformed UTF-8 and
duplicate JSON keys fail closed. Merge this trusted checker before relying on
it for later PRs and require its named check through repository-controlled
policy. It supplies no review, merge, or deployment authority. Maintainer
changes to the enforcement workflow or repository policy remain a separate
GitHub trust boundary, not permission granted by this report mechanism.

## October review payment basis

For #683, October and later payment proposals use the source snapshot's
`paymentReviewBasis` (`scr-05-payments-production-v1`) when present. Ordinary
reviews submitted before `2026-10-09T23:21:35.388Z` retain the previous payment
rule. The public Score and Points ledger remains separate. When the window has
no formal review before that cutoff the publisher omits the basis and writes
`paymentReviewBasisOmitted` (`no-pre-policy-reviews`) so payment can use the
score ledger without treating legacy or incomplete snapshots as equal (#1411
S3). When a basis is present it must drive identity and wallet collection,
allocation and frozen-source verification; never substitute the score ledger
for a published basis, and never accept a missing field as proof of omission.
Earlier closed cycles are unchanged. This changes eligibility weights only, not
funding, approval or settlement.

The payment basis stores changed ledger and attribution records plus removed
record IDs. Reconstruct it with `paymentReviewSnapshot`; its `ledger` field
alone is not a complete ledger. The source snapshot hash binds both views.
Proposal `score` values are payment allocation weights. Cycle-index score
values still come from the public score ledger, so closing a cycle does not
add grandfathered payment weight to Score or Points.
