# Slop referral-accrual Worker

`slop-referral-accrual` files the project-referral accruals of each closed UTC
month under [PRD section 11, "Referral program"](../../docs/slop-product-requirements.md#referral-program).
The owner approved the program on 25 October 2026; posting activation remains separate. The program is run by Slop Cash S.P. beside the
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
   their SHA-256, the Merkle root, the tree total and the leaf count. Save the
   rows, file and new wallet pins in one D1 transaction under the run's lease.
   If any insert fails or the lease is no longer valid, save none of them.
   A restart reads the committed files before it resumes. Months file in
   epoch order and a filed month never changes. A paid event observed after
   its month was filed joins the month it was observed in.

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

The initial values in `wrangler.toml` are approved in PRD section 11. Every
value is required once the mode is not `off`; the code has no fallback.

| Var | Meaning | Initial value |
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

1. Check that the journal matches the configured distributor and token before
   any recovery. Reconcile each send by exact transaction hash, canonical
   block and transaction position below the finalized head. A successful post
   must carry the exact distributor `RootPosted` event, epoch, root and total.
   Only a canonical finalized revert is failed. An absent receipt with an
   advanced nonce remains held: the nonce alone does not identify the winner.
   If the nonce is still free, rebroadcast the stored bytes unchanged.
   A nonfinal owner void holds the run without changing the journal; only a
   canonical finalized `RootVoided` event makes the post permanently voided.
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

The finalized header and canonical receipt/event evidence establish finality.
State reads use `latest` for preflight and conservative holds; latest state
alone cannot establish a terminal journal result. The poster key can post a
capped root that the owner can void for seven days; it holds no tokens
(`docs/security/referral-distributor-ai-review-2026-10-25.md`). Incident
order: pause the distributor, rotate the poster, void, unpause.

The signer uses the estimated gas limit plus 30% and quoted EIP-1559 fees.
There is no configured native-currency transaction or daily gas budget. The
program-token pool and epoch caps do not limit native gas. Keeper and fee
converter gas limits do not apply to this separate key. This repair does not
select a gas budget or activate posting.

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

The normal checked `main` release installs this private Worker through
`scripts/release-referral.ts`, after the shared `slop-private` migrations.
No manual Worker shell or separate release flag is needed. The helper verifies
the exact source tag and one active version after deployment. In live mode it
checks secret names without reading the poster key into CI.

The owner requested full integration and activation on 25 October 2026, then
confirmed that the program token is not deployed yet. Keep the reviewed mode
Off until the actual token, funded distributor and required operating controls
are verified. The November start and program amounts remain unchanged. A
deployed Off Worker does not file accruals, sign roots or spend gas.

### Independent root watch

`scripts/check-referral-roots.ts` reads the public accrual API and Robinhood
RPC without a key. The main-only `referral-root-watch.yml` job runs hourly.
Its checked configuration names the distributor, token, deployment block and
runtime-code hash. With Off mode and no deployment, it reports inactive; that
is not qualification. Any configured deployment requires complete evidence.

The checker verifies exact file hashes, ordered months, accrual arithmetic and
caps, cumulative totals, wallet pins, tree roots and proofs. It compares the
ordered nonempty files with canonical `RootPosted` and `RootVoided` receipts,
checks event coverage against the contract, and distinguishes pending from
finalized evidence. Unposted files are pending. Event scans use the network's
bounded block ranges, including the poster's delayed void reconciliation.
Contract epochs include voided posts; file epochs include
empty files. The recorded period mapping is derived from the poster's ordered
file sequence, because the contract does not store periods. Repeated roots
remain separate ordered records.

A month must appear by 02:00 UTC after it closes; the filing cron runs at
01:23. Before that deadline a missing new file is pending. Missing, stale,
changed or unavailable evidence after the deadline fails the job. GitHub
Actions records the failure and summary. Configure and verify the operator's
workflow-failure notification before activation; a passing job does not prove
notification delivery. This watcher verifies the public file-to-root boundary.
It does not independently re-decide private payout authority, holds or bans.

The existing Anvil workflow exercises the watcher through the real public API
handler and distributor. It proves good files and receipts, pending/final voids,
and refusal of changed file bytes, roots, totals, wallets, missing events,
noncanonical receipts, stale months and provider failure.
The client fixture rejects ranges above Robinhood's 9,000-block limit and
reconciles a posted and voided root after that range has elapsed.

