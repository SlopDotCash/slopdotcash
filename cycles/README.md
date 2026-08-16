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
within the published cap. Every changed amount records a public reason. Wallet
changes update `review.lastMaterialChangeAt` and reset `review.endsAt`. The
normal progression then adds, without replacing earlier files:

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
