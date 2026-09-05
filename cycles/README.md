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

New monthly proposals freeze `fundingBasis` (funding state, committed amount,
and monthly cap). Their new shared-pool allocation is the smaller of committed
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
funding state, committed amount, or cap must land separately before a proposal;
the proposal cannot authorize its own funding. Historical funding bases remain
unchanged when later manifests evolve. This migration activates that gate for
subsequent proposal PRs and adds no proposal itself.

After two consecutive closed unfunded months, the site suppresses project pool
promotion and the skill install CTA until positive committed funding resumes.
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
cycle. `held-below-minimum` and `unclaimed` balances carry even when the actor
did no new work; approved payout intents stay in their original cycle, while
excluded and manually held rows never become new payment proposals
automatically. An unfinished review or unresolved proposed row fails the next
cycle closed instead of guessing a reviewed balance; an unfunded record with
no carried amount is exempt because it contains no monetary allocation.

The public cycle index carries `carriedMinor` separately from the new cycle's
cap. Shared-pool approvals may total at most cap plus carry. An additive review
line publishes its own `reviewBudgetCapMinor`, the smaller of its committed
amount and cap; shared-pool carry never increases that separate limit.

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
