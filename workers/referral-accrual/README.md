# Slop referral-accrual Worker

`slop-referral-accrual` files the project-referral accruals of each closed UTC
month (PRD section 11, "Referral program", a proposal by the operator that the
owner has not approved). The program is run by Slop Cash S.P. beside the
product, from its own token allocation. It is not a points feature, not a
protocol change and not a contributor referral program: no manifest field, no
scorer change, no cycle file, no creator transfer, and contributors and
sponsors see no difference.

The Worker is off by default. `off` and `dry_run` hold no key and never sign,
post or pay. `live` adds the poster described under [Live mode](#live-mode):
after filing, it signs at most one `postRoot` per run from the poster hot key.
Live mode is refused unless the owner's program flag, the distributor address,
the token address and the network are all set; the shipped `wrangler.toml`
keeps the flag `"false"` and the addresses empty, and nothing in the code sets
them. The Worker has no HTTP route.

## What a referral is

- A maintainer who submits a project at `/projects/new` may name the signed-in
  Slop account that referred the project (`?ref=<login>`). The API records it
  once at submission, approval copies it to the project, and neither row can
  change it afterwards (migration `0055_project_referrer.sql`). The applicant,
  the project steward, admins and moderators cannot be named.
- A referral accrues only when a finalized payout on that project is recorded:
  a `payment_obligations` row in state `paid` whose `paid` event is in
  `payment_events`. Listings, pledges, deposits, reserved awards and points
  accrue nothing. Private bounty payouts live in a separate ledger and are not
  read.

## What one run does

The cron fires once a day. A run files every UTC month that has ended and is
not filed yet, oldest first, starting at `REFERRAL_FIRST_PERIOD`.

1. Take the single lease in D1 (`referral_accrual_locks`, 10 minutes). A
   second run exits with `locked`.
2. For each pending month, read every paid obligation on a project with a
   referrer whose `paid` event was observed inside that month and that no
   earlier run has judged. Judge them in observation order:
   - `asset_not_eligible`: the payout asset is not a reference stablecoin of
     its network with six decimals (`src/lib/escrow-policy.mjs`). A
     project-token payout has no fixed dollar value without an oracle and
     accrues nothing.
   - `referrer_excluded`: the referrer is a team account
     (`REFERRAL_EXCLUDED_GITHUB_IDS`, the admin ids or the moderator ids), or
     has an active participation ban (`project_maintainer_bans` without a
     reinstatement, the same query the monthly payment uses).
   - `held`: the project has a `referral_holds` row without `lifted_at`. The
     hold's id and reason go into the row and the public file.
   - `window_closed`: the paid event is `REFERRAL_WINDOW_MONTHS` calendar
     months or more after the project's first paid event on any obligation,
     including payouts before the program's first period.
   - Otherwise `computed = gross_base x REFERRAL_RATE_BASE_PER_MICRO`, then
     `accrued = min(computed, project cap remaining, pool remaining)`. A row
     limited by the project cap is `project_cap`; one limited by the pool is
     `pool_cap`; an unlimited one is `accrued`. A capped row may accrue zero.
3. Append the rows to `referral_accruals` (permanent, one row per obligation)
   and publish the month's file to `referral_accrual_files`: the exact bytes,
   their SHA-256, the Merkle root, the tree total and the leaf count. Months
   file in epoch order and a filed month never changes. A paid event observed
   after its month was filed joins the month it was observed in.

The file (`schema: slop-referral-accrual-file-v1`) lists the parameters, every
judged accrual with its obligation id and paying transaction, the pool total,
every referrer with a counted accrual and its cumulative total across all
filed epochs, the referrer's current authorized Robinhood Chain wallet
(`wallet_claims` tip on chain `robinhood` with a `payment_wallet_authorizations`
row), and the Merkle tree over `(wallet, cumulative)` leaves for referrers with
a wallet and a positive total. A referrer without a wallet is carried in the
file and enters a later tree once a wallet is registered; nothing is lost by
binding late. The wallet a referrer first enters a tree with is pinned
(`referral_claim_wallets`) and every later file keeps it, whatever the
registry says afterwards: the distributor tracks claims per address, so a
moved leaf would pay a cumulative twice and a dropped leaf would strand it. A
referrer who loses that wallet's key needs a manual case. Two accounts on one
wallet keep one leaf, the pinned or earlier account's, and the run logs
`referral_wallet_shared`.

Leaf and tree shape, shared with `contracts/evm/test/ReferralDistributor.t.sol`
through fixed vectors in the test suite:
`keccak256(bytes.concat(keccak256(abi.encode(address, uint256 cumulative))))`,
pairs hashed in sorted order, leaves sorted by address, an odd node promoted
unchanged. Anyone can rebuild the root from the file.

The files are public at `GET /api/v1/referrals/accruals` (index) and
`GET /api/v1/referrals/accruals/<YYYY-MM>` (exact bytes, `x-slop-sha256`).
There is no page, link or copy for them yet.

## Parameters

All of these are operator proposals in `wrangler.toml`. The owner decides the
rate, pool, caps and window before anything posts. Every value is required
once the mode is not `off`; the code has no fallback.

| Var | Meaning | Proposed |
| --- | --- | --- |
| `REFERRAL_RATE_BASE_PER_MICRO` | Program token base units per one stablecoin micro-unit | `3000000000000` (3 tokens per USDC at 18 decimals) |
| `REFERRAL_POOL_BASE` | Lifetime pool, base units | 2,000,000 tokens |
| `REFERRAL_PROJECT_CAP_BASE` | Lifetime cap per referred project | 250,000 tokens |
| `REFERRAL_WINDOW_MONTHS` | Months from a project's first paid event | 12 |
| `REFERRAL_FIRST_PERIOD` | First month the job may file | `2026-11` |
| `REFERRAL_EXCLUDED_GITHUB_IDS` | Accounts that never accrue as referrers | lalalune, drew-dot-com |

A rate change applies to months filed after it, never to a filed row: each
row records the rate applied to it.

## Holds

A hold excludes a project from future accruals with a public reason, in the
shape of a held cycle row. There is no route for it. The operator writes it
with `wrangler d1 execute` as a `referral_holds` row (`rhold_` id, project,
reason, actor), and lifts it once by setting `lifted_at` and `lift_reason`.
Rows already filed are unchanged.

## Local checks

```sh
bun run test:referral-accrual
bun run test:referral-accrual:anvil
bun run referral-accrual:dry-run <fixture.json> [<as-of ISO time>]
```

The dry run builds an in-memory D1 from every migration, loads the fixture
and prints the run result and each filed file. It touches no hosted database.

## Live mode

Live mode runs the accrual step exactly as `dry_run` does (files say
`"mode": "live"`), then `postNextRoot` in `core.ts`:

1. Reconcile every recorded send in `referral_root_posts` (migration 0087)
   through the chain: a receipt in a finalized block with the filed root at
   that epoch is `finalized`; a reverted receipt or a nonce taken by another
   transaction is `failed` (the next run signs again); a send the node never
   saw is rebroadcast from the stored bytes, never re-signed. A finalized
   post the owner later voids on chain becomes `voided`.
2. Refuse while a send is in flight, and refuse after an owner void until the
   operator acknowledges it: set `void_acknowledged_at` and
   `void_acknowledgement` on the voided row with `wrangler d1 execute` after
   recording the correction (a `referral_holds` row, for example). The next
   period's file carries the corrected cumulative totals; a voided period is
   never reposted.
3. Read the distributor: chain id, `token()`, `poster()`, `paused()`,
   `nextEpoch()`, `hasPendingRoot()`, `epochCap()`, `activeTotal()`,
   `totalClaimed()` and the token balance. Stop on any disagreement with the
   configuration or the journal (wrong chain, wrong token, the key is not the
   poster, the chain has more epochs than the journal), while paused, or
   while a root is pending.
4. Pick the earliest filed file with a root that is later than the last
   posted period. Files with no leaves are never posted and the contract
   index counts only posts, so the journal maps `period` to the contract
   `epoch`; the poster always uses `nextEpoch()`, never a month number.
5. Precheck what the contract will check (total not below the last finalized
   total, growth within `epochCap`, balance plus claimed covers the total),
   simulate the call at the latest block, sign it, record the signed bytes
   and nonce in the journal, then broadcast. A broadcast error leaves the
   row `unknown` for the next run to resend unchanged.

Finality is read from the `finalized` block header, which the public
Robinhood RPCs serve; state reads use `latest`. The poster key can post a
capped root that the owner can void for seven days; it holds no tokens
(`docs/security/referral-distributor-ai-review-2026-10-25.md`). Incident
order: pause the distributor, rotate the poster, void, unpause.

Local proof: `bun run test:referral-accrual:anvil` starts Anvil on chain id
46630, deploys the compiled contract and mock token with public fixture keys,
files one epoch from an in-memory D1, posts its root in live mode, reconciles
the finalized receipt, and claims from the referrer wallet with the file's
proof. It touches no hosted database and no public chain.

Live configuration (`wrangler.toml` vars, plus the `REFERRAL_POSTER_KEY`
secret set by the key custodian): `REFERRAL_PROGRAM_ENABLED` (`"true"` is the
owner's activation), `REFERRAL_DISTRIBUTOR_ADDRESS`, `REFERRAL_TOKEN_ADDRESS`,
`REFERRAL_POST_NETWORK` (`robinhood-testnet` or `robinhood-mainnet`), and an
optional `RPC_URL_REFERRAL`.

## Deployment

There is no release step for this Worker in `deploy.yml`. Nothing deploys it
until the owner approves the program and adds a gated release in the shape of
the fee converter's (`SLOP_FEE_CONVERTER_RELEASE`). Its tables come from the
shared `slop-private` migrations (`0086_referral_accruals.sql`).
