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
cycle closed instead of guessing what is owed.

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

`cycles:check` independently re-verifies every report against GitHub and fails
closed if its commit or signer cannot be verified. This path requires `gh`
authentication when reports are present. `unsafeDestinationReports` retains
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
