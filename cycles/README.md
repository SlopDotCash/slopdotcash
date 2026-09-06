# Reward cycles

Reward state is a public, append-only Git workflow. Each closed cycle lives at
`cycles/<project-id>/<YYYY-MM>/` and starts with:

- `source-snapshot.json` — the exact validated leaderboard bytes used to make
  the proposal;
- `proposal.json` — deterministic suggested amounts or external-prize shares.

The trusted first-of-month workflow runs `rewards:close-month` for every active
project and opens these files in a review PR. It records an empty proposal when
no work qualified, so a zero-award month is auditable and unused funding can
roll forward without raising the next cap. Existing complete cycles are left
untouched; a directory containing only one required file is refused as partial.

New monthly proposals freeze `fundingBasis` (cycle ID, stable instrument ID,
funding state, applicable committed amount, and monthly cap). Positive new
principal requires exactly one unreplaced reviewed instrument whose
`monthlyCommitment.cycleId` equals the proposal cycle. An instrument for an
earlier or later month contributes zero, not retroactive or advance funding.
The stable ID binds Squads kind/network/multisig/vault index/vault, or Sablier
kind/network/contract/stream ID; an unfunded cycle records a null instrument ID.
Their new shared-pool allocation is the smaller of committed
funding and the cap when funding is committed, and zero otherwise. Accepted
events, scores, evidence, and previously reviewed carry remain recorded even
when this month's allocation is zero. A zero-funded proposal with no carry
does not prevent the next snapshot or close and contributes no monetary carry.

The existing July 2026 cap-based proposal is the grandfathered unfunded trial.
Its original snapshot, score table, suggestions, and review dates remain intact;
the old suggestions never become carry, even when a reviewed allocation exists.
Cycle validation uses the cap recorded in the historical artifact through July,
not the current project cap; the trusted transition gate forbids changing that
recorded cap. From August onward,
new cycle artifacts must include their frozen funding basis. The cycle index
identifies the historical trial as unfunded without rewriting its artifacts.

The trusted project-transition gate executes from the immutable base commit.
For each newly added monthly proposal it requires the frozen funding basis to
equal that base commit's reviewed project manifest. Changes to that project's
reward policy or instrument inventory must land separately before a proposal;
the proposal cannot authorize its own funding. Historical funding bases remain
unchanged when later manifests evolve. This migration activates that gate for
subsequent proposal PRs and adds no proposal itself.

After two consecutive closed unfunded months, the site suppresses project pool
promotion and the skill install CTA until positive committed funding for the
explicit display cycle resumes. A commitment for another month cannot reopen
promotion; each caller uses its snapshot-derived project view cycle, not the
wall clock or a raw policy balance.
This affects discovery only: the project page, score history, snapshot writing,
cycle closing, and existing reviewed balances remain available. Missing cycle
history cannot authorize promotion.

Later funding supports a new reviewed allocation; retained scores create no
automatic claim on it. Re-proposing an old cycle would need a separate reviewed
append-only revision mechanism and a fresh 14-day review. The current CLI does
not overwrite a closed proposal, and this migration does not add that mechanism.

For a platform-funded monthly pool, the creator edits `proposal.json` during
the 14-day review. The creator may set any contributor amount, including zero,
or raise it above the deterministic suggestion while the cycle total remains
within the published cap. Every changed amount records a public reason and
updates `review.lastMaterialChangeAt`, which resets `review.endsAt`. Wallets
are cut off at `generatedAt`: a wallet observed after the proposal was
generated applies to the next cycle and never modifies the current proposal
or its review clock. The row stays `unclaimed` and carries forward. Only a
creator amount change moves `review.lastMaterialChangeAt`. The normal
progression then adds, without replacing earlier files:

Transfers have a 2 USDC minimum. Smaller awards remain
`held-below-minimum`, retain their exact integer micro-USDC amount, and accrue
without being discarded or redistributed. A later proposal publishes the
carried amount; settlement may proceed only when the combined approved intent
is at least 2 USDC. The 1% fee applies only to principal actually approved for
payment.

The next proposal derives carry only from the immediately preceding reviewed
cycle. `held-below-minimum`, `unclaimed`, and authenticated unsafe-destination
holds carry even when the actor did no new work; approved payout intents stay
in their original cycle, while excluded and ordinary manually held rows never become new payment proposals
automatically. An unfinished review or unresolved proposed row fails the next
cycle closed instead of guessing a reviewed balance; an unfunded record with
no carried amount is exempt because it contains no monetary allocation.
For line-aware rows, only `lines.sharedPool.suggestedMinor` carries; additive
review awards never become shared-pool principal. Rows without lines retain
the historical `accruedMinor ?? suggestedMinor` interpretation.

The public cycle index carries `carriedMinor` separately from the new cycle's
cap. Shared-pool approvals may total at most cap plus carry. An additive review
line publishes its own `reviewBudgetCapMinor`, the smaller of its committed
amount and cap; shared-pool carry never increases that separate limit.

### Unsafe destination reports

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
structural validation; `cycles:verify` additionally checks public finalized Solana
transactions, not GitHub signatures. These packaging checks do not authorize a
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

Safety history is independent of money carry. Proposal preparation and snapshot
verification read every earlier immutable project cycle, including approved,
paid, excluded, and zero-participation history. Every report must trace to its
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

- `allocation.json` — reviewed and approved payout intents;
- `execution-plan.json` — an unsigned, exact Solana USDC transfer plan;
- `transactions.json` — submitted public transaction signatures;
- `settlement.json` — generated only after finalized on-chain balance changes
  reconcile every contributor transfer and the 1% platform fee charged when
  the approved payout is paid.

Delta Star uses only `source-snapshot.json` and `proposal.json`; it publishes a
provisional contribution percentage and never represents the external prize as
money owed by this platform.

Use the repository commands rather than hand-authoring lifecycle transitions:

```bash
bun run rewards:propose --project eliza --cycle 2026-07
bun run rewards:close-month -- --cycle 2026-07
bun run rewards:approve --project eliza --cycle 2026-07
bun run rewards:plan-settlement --project eliza --cycle 2026-07 \
  --source-wallet <CREATOR_SOLANA_ADDRESS> \
  --fee-wallet <PLATFORM_SOLANA_ADDRESS>
bun run rewards:verify-settlement --project eliza --cycle 2026-07
bun run cycles:verify
```

No command reads a private key or signs a transaction. Keep seed phrases and
private keys out of Git, issues, CI, skills, prompts, and local telemetry.

For an allocation with a frozen funding basis, a Solana execution plan must
use that exact Squads vault as `sourceOwner`. The same check applies when
reading a stored plan; another valid wallet is not a substitute. A pledged or
Sablier/EVM basis cannot produce a Solana plan without a separately reviewed
funding transition. Historical allocations predating the funding-basis schema
retain their existing validation; this does not migrate or rewrite records.
Source binding does not prove current backing, signing capability, transaction
retirement, or safe carry, and does not enable payments.
