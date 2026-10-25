# Slop fee-converter Worker

`slop-fee-converter` converts project tokens that a network fee wallet has
already received into that network's Circle USDC (PRD section 6, TOK-07,
MVP-07c; owner decision of 18 October 2026). The 2% fee is in the reward
token (TOK-06). Both current EVM and Solana vaults retain accrued fees until
a permissionless claim sends them to the configured fee recipient. EVM uses
`claimFees()`; Solana uses `claim_fees`, which pays only to a token account
of the vault mint that the fee recipient owns.
This Worker claims those fees on both families (issue #905) and sells the
tokens soon after they arrive, inside the same wallet. USDC is the only
target: a network without a verified Circle USDC address converts nothing, and
no other stablecoin or token named "USDC" stands in for it.

It is a narrow exception to "Slop holds no keys" (PRD TOK-07, PAY-04,
MVP-07c). It holds one hot key per
network for the fee wallet only. On a vault it only reads the fee counters
and calls `claimFees()` (EVM) or `claim_fees` (Solana). It never reads or
writes payment obligations,
contributor balances or payment state. No payout waits on it,
and a failed conversion leaves the fee in the wallet.

The owner approved using the same fee-wallet key for permissionless claims
on reviewed vaults on 24 October 2026 (PRD section 6). Claims may move only
accrued fees to that same fee wallet. This approval does not authorize free-fund
withdrawals, contributor payments or access to reserved awards. The Worker
implements EVM and Solana claims. It verifies the reviewed deployment and
that its fee recipient is this fee wallet (on Solana, that the destination
token account is owned by it), reconciles uncertain sends before retrying, and
verifies receipt before conversion. Solana claims are covered by unit tests
only; qualification against a validator running the reviewed program remains
required before Solana activation.

The Worker is off by default.

**Solana signing is blocked until activation is verified.** The revised Solana
program pins an independent rotation-confirmation authority, separate from the
fee recipient and identity authority. The rotation key must never be installed
in this Worker. Earlier program layouts gave the fee recipient that power.
The current live-mode block remains until the reviewed deployment uses the
separated layout and the converter verifies that boundary. Key generation
alone does not establish safe activation. A Solana claim verifies the pinned
Config, including its independent rotation authority, before it signs, but
that check does not lift the live-mode block: Solana still runs in `dry_run`
only (PRD section 11, "Solana live conversion waits for the separate attester
role").

## What one run does

The Worker has no HTTP route. A cron trigger runs it every minute. Most runs
are **receipt** runs: they convert only tokens whose fee-wallet balance
differs from the `token_balance_before` of that token's latest record, which
is how a newly received fee shows up. Each fifteenth minute
(`RECOVERY_SCAN_MINUTES` in `index.ts`) the run is a **recovery** scan that
re-evaluates every candidate, so a token left behind by a failed quote, route,
price check or prepare is retried. A conversion therefore starts within about
a minute of the fee transfer being visible at the RPC's `latest` block, unless
a check below skips it.

For each enabled network:

1. Take the network lock in D1 (`fee_converter_locks`). A second run on the
   same network exits, so two runs never sign with one nonce. The lease lasts
   14 minutes and a run renews it at a chunk boundary every 7 minutes, so a
   run that needs longer than one lease keeps the lock instead of losing it to
   the next cron tick. A renewal that fails means the lease lapsed or another
   run took it over: that run starts no further send and logs
   `fee_conversion_lock_lost`. Releasing a lease that already lapsed leaves the
   row for `acquireLock` to reclaim, so a late run never disturbs a successor.
2. Reconcile every unresolved live send (`submitted`, `unknown`) before
   anything new. See [Idempotency](#idempotency).
3. A network without a verified USDC target stops here with status
   `route_pending` and logs `fee_conversion_route_pending`. It quotes and
   signs nothing and loads no key; its fees stay in the wallet.
4. Recovery scans only: claim vault fees. For each ordinary
   `escrow.deployments[].vault` and bounty
   `securityBounty.settlement.deployments[].vault` on the network's escrow
   keys in D1 project manifests, read the accrued fee. Skip a vault with
   nothing accrued or with another fee recipient. Value the fee in USDC (a
   quote, or the amount itself for a USDC vault) and price the claim's own
   network fee. Claim only when the fee value reaches
   `FEE_CONVERTER_MIN_VALUE_MICRO` and `FEE_CONVERTER_GAS_MULTIPLE` times that
   network fee; a smaller fee keeps accruing in the vault. `dry_run` logs
   `fee_claim_quoted` and signs nothing. `live` signs one claim, waits for it
   and logs `fee_claim_included`. A claim is a transfer to the fee wallet
   itself, so it does not count against the conversion caps. The step runs
   before the balance reads, so the claimed fee converts in the same run.
   Receipt runs skip this step. Recovery scans verify each deployment before
   they read its fee counter or price its claim.
   - **EVM.** Uses the shared escrow verifier to check the manifest's network,
     runtime and implementation hashes, factory, roles, asset, delays and
     payout purpose at one current block. Missing or changed reviewed values
     stop the claim. It repeats this check before signing `claimFees()`, and
     signs only when no earlier fee-wallet transaction is pending. At the
     receipt block it verifies the deployment again. Transfers of the reviewed
     token must show the same net debit from the vault and credit to this fee
     wallet, at least equal to the fee read before the claim. This permits fees
     that accrued while the claim was pending. Receipt status alone is not
     proof. An included claim with incomplete receipt data is not reported as
     verified; the next run reads the current counter before any new claim.
   - **Solana.** Builds the escrow config from the manifest's reviewed
     deployment record (the cluster genesis comes from the escrow network
     registry) and refuses a record whose fee recipient is not this fee wallet
     or whose vault is not the project's vault PDA. It then verifies, at
     finalized commitment, the cluster, the program bytes against
     `codeSha256`, the upgrade authority, the pinned Config (identity, fee
     recipient and rotation authority) and every project authority, delay,
     purpose and mint (`verifySolanaDeployment`), and reads `accrued_fees` from
     that verified project. Unknown or mismatched state throws, logs
     `fee_claim_error` and signs nothing. The claim network fee is
     `FEE_CONVERTER_SOLANA_FEE_MICRO`. Before signing, a claim reconciles
     earlier sends: it refuses while the confirmed `accrued_fees` is already
     zero (an earlier claim awaits finality) or any project transaction is
     confirmed but not finalized. A send lost before confirmation expires with
     its blockhash long before the next recovery scan, and the program moves
     only the counter's current value, so a repeat never pays twice. The
     transaction holds exactly two instructions, signed only by the fee
     wallet: idempotent creation of the fee wallet's associated token account
     for the vault mint, and `claim_fees` paying into that account. It is
     simulated first and must credit at least the accrued fee. After the claim
     confirms, the receipt must show the fee wallet credited at least the
     accrued fee and exactly what the vault lost.
5. List candidate tokens from D1 project manifests: a `rewardAsset` of kind
   `token` on that network, and the `escrow.deployments[].asset` of each
   deployment on the network's escrow key (`base-mainnet`, `ethereum`,
   `robinhood-mainnet`, `solana-mainnet`). Add the `FEE_CONVERTER_ALLOWLIST`
   entries. It never discovers tokens from the wallet, so an airdropped token
   is never sold.
6. Read the fee-wallet balance of each candidate. Skip USDC and empty
   balances. A receipt run also skips a balance unchanged since the token's
   latest record.
7. Get a quote. If the quoted value is above the remaining per-run or per-day
   cap, scale the amount down (at most three requotes, aiming at 98% of the
   remaining cap).
8. Record the token as `pending`, with the reason, when the quoted value is
   below `FEE_CONVERTER_MIN_VALUE_MICRO` or below `FEE_CONVERTER_GAS_MULTIPLE`
   times the estimated network fee. This is the dust threshold (PRD section
   11): the fee accumulates in the wallet until a later receipt lifts it over.
   Record it as `skipped`, with the reason, when the quote has unknown price
   impact or impact above `FEE_CONVERTER_MAX_PRICE_IMPACT_BPS`, has a minimum
   output outside `FEE_CONVERTER_MAX_SLIPPAGE_BPS`, or does not fit the
   remaining caps.
9. `dry_run`: record the quote as `quoted` and stop. No key is loaded.
10. `live`: build, check, simulate and sign the swap. Record the signed bytes
   as `submitted`, then broadcast. A finalized state is set only by a later
   reconciliation that reads the finalized chain.

An unchanged `pending` or `skipped` record (same token, amount, reason and
mode) is recorded once, not
on every run. A network startup or storage failure is logged, and the other
networks are still attempted. After those attempts, the scheduled promise
rejects so the cron failure remains visible; it does not publish a successful
`fee_converter_run` event with missing networks.

## Routes per network

| Network | Target | Route | Why |
| --- | --- | --- | --- |
| Base (8453) | Circle USDC `0x8335…2913` | KyberSwap Aggregator API | No API key, one integration for all three EVM chains, the router is the same audited `MetaAggregationRouterV2` (`0x6131…37b5`) on each. Its calldata carries the receiver, the input amount and the minimum output, so the Worker can check them before signing. |
| Ethereum (1) | Circle USDC `0xa0b8…eb48` | KyberSwap Aggregator API | Same router address and code on chain. AGENTS.md requires verifying this address from Circle's primary source before activation. |
| Robinhood Chain (4663) | **Pending.** No verified Circle USDC. | KyberSwap Aggregator API once a target exists | The PRD supersedes the earlier USDG target. On 18 October 2026 there was no Circle USDC on 4663, and the tokens named "USDC" in KyberSwap's list were unrelated clones flagged as honeypots. The network runs as `route_pending` until a reviewed change sets `usdc` in `config.ts` to an address verified from Circle's primary source and a route to it is proven. |
| Solana | Circle USDC `EPjF…Dt1v` | Jupiter Swap API v1 | The standard Solana router. Uses `lite-api.jup.ag` without a key, or `api.jup.ag` when `JUPITER_API_KEY` is set. |

0x Swap API v2, 1inch and the Uniswap Trading API all need an API key.
Robinhood's support pages name 0x and LI.FI for swaps on Robinhood Chain,
and Uniswap lists a Universal Router deployment on 4663; this Worker did not
verify those routes. Any of them can replace KyberSwap behind
`ChainClient` in `evm.ts` if the owner prefers a keyed provider.

### Checks before an EVM swap is signed

- The route and build name the pinned router; the build carries no native value.
- The calldata decodes as `swap` or `swapSimpleMode`, with the exact input
  token and amount, the network USDC as output, the fee wallet as
  receiver, and no extra fee receivers.
- The signed minimum output is at or above the recorded quote minimum. The
  build uses half of the slippage budget, so normal drift between quote and
  build passes and a larger move fails as "price moved".
- An `eth_call` of the exact calldata from the fee wallet returns at least the
  signed minimum.
- The approval is for the exact order amount to the pinned router, never
  unlimited.

### Checks before a Solana swap is signed

- The fee wallet is the only signer and the fee payer.
- Every top-level program is Compute Budget, Associated Token or Jupiter v6.
  System and token programs cannot run at top level, so no direct transfer
  can be added.
- The signed minimum (`otherAmountThreshold`) is at or above the recorded
  quote minimum.
- `simulateTransaction` credits the fee wallet's USDC associated account with
  at least the signed minimum.

## States

| State | Meaning |
| --- | --- |
| `quoted` | Dry run: a quote that passed every check. Live: a quote not yet signed; closed as `failed` after one hour if the run ended. |
| `pending` | Below the dust threshold; the fee stays in the wallet until a later receipt lifts it over. `reason` names the threshold (migration `0076`). Records written before that migration keep `skipped`. |
| `skipped` | A price, slippage or cap check refused the token; `reason` says which. |
| `no_route` | The aggregator has no route for this token. |
| `submitted` | Signed bytes recorded and broadcast; not yet final. |
| `unknown` | Signed bytes recorded, but the broadcast result is unknown. |
| `finalized` | Included in a finalized block; `amount_out` is the measured USDC credit to the fee wallet. |
| `failed` | Proven unable to complete: reverted, expired or a prepare check failed. |

Each record also keeps the fee-wallet balances in base units: the input token
and USDC when quoted (`token_balance_before`, `target_balance_before`) and
USDC when finalized (`target_balance_after`), with the observed times
(`created_at`, `submitted_at`, `finalized_at`). Reconciliation measures the
credit of the record's own `target_token`.

Rows cannot be deleted. `pending`, `skipped`, `no_route`, `finalized` and `failed` rows
cannot change.

## Idempotency

A token with an unresolved send gets no new attempt; a unique D1 index allows
at most one `submitted` or `unknown` row per network and token. Reconciliation
decides each unresolved row:

- **EVM.** A receipt in a finalized block settles the row. With no receipt and
  no pending transaction, the row fails only when another transaction used its
  nonce in a finalized block, or the router deadline (20 minutes) has passed,
  after which the swap reverts even if mined. Otherwise the Worker
  rebroadcasts the recorded bytes unchanged. Only the node's "not found"
  answer counts as no receipt or no transaction. A failed lookup (HTTP 429,
  timeout or another RPC error) logs `fee_conversion_reconcile_error` and
  leaves the row open for the next run.
- **Solana.** A finalized signature status settles the row. With no status,
  the row fails only when the finalized block height is past the recorded
  `lastValidBlockHeight`. Otherwise the Worker rebroadcasts the recorded bytes.

The Worker never signs a second transaction for a send that could still land.

## Configuration

Vars in `wrangler.toml` (reviewed by pull request). The conversion limits
have no fallback in code: in `dry_run` and `live` a missing limit refuses the
run. `off` reads none of them.

| Var | Checked-in value | Meaning |
| --- | --- | --- |
| `FEE_CONVERTER_MODE` | `off` | `off`, `dry_run` or `live`. |
| `FEE_CONVERTER_NETWORKS` | empty | Subset of `base,ethereum,robinhood,solana`. |
| `FEE_CONVERTER_ALLOWLIST` | empty | JSON object of extra tokens per network. |
| `FEE_CONVERTER_MIN_VALUE_MICRO` | `5000000` (owner decision, 24 October 2026) | Minimum quoted USDC output. `0` converts every fee. |
| `FEE_CONVERTER_GAS_MULTIPLE` | `10` (owner decision, 24 October 2026) | Output must be at least this many times the fee estimate. `0` disables the check. |
| `FEE_CONVERTER_MAX_SLIPPAGE_BPS` | `100` | Quote minimum within 1% of the quote. |
| `FEE_CONVERTER_MAX_PRICE_IMPACT_BPS` | `200` | Price-impact cap (2%). |
| `FEE_CONVERTER_RUN_CAP_MICRO` | `1000000000` | Per-run, per-network value cap (1,000 USDC). |
| `FEE_CONVERTER_DAILY_CAP_MICRO` | `5000000000` | Rolling 24-hour live value cap per network (5,000 USDC). |
| `FEE_CONVERTER_SOLANA_FEE_MICRO` | unset (`2000`) | Solana fee estimate used for the gas multiple; an estimate, not policy. |

The PRD sells fees when they arrive and leaves open whether tiny balances may
accumulate to avoid gas waste. The two dust-threshold values stay empty, so
the converter cannot run, until the owner records that decision. The
slippage, impact and cap values are the earlier reviewed values; the PRD
still lists conversion limits as an approval item.
| `FEE_WALLET_<NETWORK>` | Base and Solana set | Public fee-wallet address. A network without one is refused. |
| `KYBERSWAP_CLIENT_ID` | `slop-fee-converter` | Client id header for KyberSwap. |

Secrets (set only by the key custodian, never in D1, CI or the repository):

| Secret | Format |
| --- | --- |
| `FEE_WALLET_KEY_BASE`, `FEE_WALLET_KEY_ETHEREUM`, `FEE_WALLET_KEY_ROBINHOOD` | `0x` + 64 hex characters. |
| `FEE_WALLET_KEY_SOLANA` | Solana CLI keypair JSON (64 numbers). |
| `RPC_URL_<NETWORK>` | Optional private RPC URL. Error text strips URLs, so a provider key in the URL never reaches D1 or logs. |
| `JUPITER_API_KEY` | Optional. |

In `live` mode the Worker refuses a network when its key is missing or does
not derive the configured `FEE_WALLET_<NETWORK>` address. `dry_run` never
reads a key.

## Key custody

AGENTS.md (owner decision of 18 October 2026) approves one fee-wallet hot key
per network that signs only this conversion. The owner decision of 24 October
2026 (PRD sections 6 and 11) confirms that model for launch: one dedicated
conversion-only key per network, held as a Worker secret, bounded by the
per-run and daily caps, with owners manually sweeping USDC proceeds to separate
owner-controlled software wallets. The owner chose local `.env` custody for
the sweep keys; those wallets are not cold storage. A
remote signer may replace it later. Signing stays narrow: only `live` mode on a
network with a verified USDC target loads a key; the key signs only an exact
approval to the pinned router, the checked swap, `claimFees()` (no
arguments, no value) to a vault named in a D1 project manifest, and on Solana
`claim_fees` for a verified manifest vault into the fee wallet's own token
account; errors and logs never include it.

The fee-wallet key can sign any transaction from the fee wallet. Treat its
balance as hot funds and keep the balance small.

**Option A: Cloudflare Worker secrets (or Secrets Store).** The key is an
encrypted Worker secret, readable only by this Worker at run time. Wrangler
and the dashboard cannot read it back. Cloudflare Secrets Store adds
account-level secrets with separate access control and audit logs; bind the
secret to this Worker only. This is the simplest option and fits the small,
bounded balance. Risks: anyone with Workers edit rights on the account can
deploy code that uses the secret; Cloudflare is in the trust boundary.

**Option B: external KMS or MPC signer.** The key stays in AWS KMS / GCP KMS
(secp256k1 for EVM; Solana needs an Ed25519-capable KMS or an MPC provider
such as Fireblocks, Turnkey or Privy server wallets). The Worker sends the
exact transaction bytes to the signer over an authenticated call. The signer
can enforce its own policy (allowed contract, allowed program, value caps).
This removes the raw key from Cloudflare and adds an independent policy
check, at the cost of another provider and more latency. `prepare()` in
`evm.ts` and `solana.ts` is the one place to replace with a remote signer.

Recommendation: start with Option A and a small balance; move to Option B
before the daily converted value is material.

### Rotation

1. Generate the new key offline. Record only the new public address.
2. Land a pull request that changes `FEE_WALLET_<NETWORK>` to the new address.
   The escrow fee recipient does not change automatically; record the new fee
   wallet through the reviewed escrow and manifest path first.
3. Set `FEE_CONVERTER_MODE = "dry_run"` or remove the network, so no send is
   open during the switch. Wait until the admin route shows no `submitted` or
   `unknown` row for the network.
4. `wrangler secret put FEE_WALLET_KEY_<NETWORK> --config workers/fee-converter/wrangler.toml`
   with the new key, then deploy through the workflow.
5. Move the remaining balance from the old wallet with a human-signed
   transaction, then destroy the old key.

## Sweep to treasury

The Worker never sends funds out of the fee wallet. Proceeds accumulate as
USDC. The owner selected separate EVM and Solana software wallets for manual
sweeps. Their keys stay in the owner's local `.env`, outside this Worker; do
not describe them as cold storage. See the [owner decision](https://github.com/SlopDotCash/slopdotcash/issues/905#issuecomment-6379777455).
Sweep on a fixed schedule, such as weekly or above a threshold. Keep only
a small gas balance (ETH, or SOL) in the fee wallet. A
sweep is a human-signed transfer outside this Worker.

## Turn on live mode

1. The owner approves MVP-07c, the fee wallet per network, and the dust
   threshold (`FEE_CONVERTER_MIN_VALUE_MICRO`, `FEE_CONVERTER_GAS_MULTIPLE`). On 19 October
   2026 the owner chose the Base fee wallet
   `0x8f77C37D8650776bFe73c9b12B15209eE15D9b86` for Robinhood Chain and
   Ethereum too. `FEE_WALLET_ROBINHOOD` and `FEE_WALLET_ETHEREUM` are set in
   `wrangler.toml`. Each network still runs only when it is enabled.
2. Create the Worker shell once: `wrangler deploy --config
   workers/fee-converter/wrangler.toml` from a trusted machine with mode `off`.
3. Set the secrets for each network you will enable (key custodian only).
4. Set the repository variable `SLOP_FEE_CONVERTER_RELEASE` to `enabled`.
5. Land a pull request with `FEE_CONVERTER_MODE = "dry_run"` and the network
   list. Watch `GET /api/v1/admin/fee-conversions` for at least a day: quotes,
   skip reasons, price impact and minimum outputs should look right.
6. Fund each fee wallet with a small gas balance.
7. Land a pull request with `FEE_CONVERTER_MODE = "live"`. That reviewed
   pull request is the activation record MVP-07c requires. The release step
   refuses live mode when an enabled network lacks its key, and while Solana
   is enabled.
8. Check the first `finalized` rows against the explorer: input debit, USDC
   credit to the fee wallet, no other transfer.
9. To stop at once, land `FEE_CONVERTER_MODE = "off"`, or set the repository
   variable to anything but `enabled` and remove the cron trigger in the
   dashboard. Unresolved sends are reconciled again when the Worker runs in
   any mode other than `off`.

## Admin view

`GET /api/v1/admin/fee-conversions` (admin GitHub session) returns the 100 most
recent records, exact per-token totals of finalized live conversions as
decimal base-unit strings, state counts for the last 24 hours, and each
network's USDC target with status `usdc` or `pending`. It never
returns signed transaction bytes. There is no public page.

## Tests

```bash
bun run test:fee-converter
```

Unit tests cover the release gates, the required dust threshold, pending USDC
routes, receipt and recovery runs, every skip reason, cap scaling, the daily
cap window, unknown-send reconciliation, the network lock, D1 constraints,
the pending migration and the admin route. Solana claim tests cover the
reviewed-deployment checks, the claim transaction's signer, programs and
accounts, refusal while an earlier send is unfinalized, receipt verification,
dry-run reporting, the dust threshold and an idempotent rerun. They stand in
for the RPC and for `verifySolanaDeployment`, the shared check the payment
executor and funding paths also use; these unit tests do not exercise it.

```bash
bun run fee-converter:dry-run <base-wallet> <base-token> <solana-wallet> <solana-mint>
```

A read-only dry run against mainnet RPCs and the live KyberSwap and Jupiter
APIs. Any public holder address can stand in for the fee wallet. Set the
`FEE_CONVERTER_*` limits in the environment first; the script has no
defaults.

```bash
bun run test:fee-converter:fork
bun run test:fee-converter:solana
```

Full live cycles with throwaway keys: an Anvil fork of Base (port 28545)
covering an ordinary send, a send lost before delivery, a send whose
response was lost, a below-minimum skip, a refusal when the price moved
between quote and signing, a token no aggregator can route, and a vault fee
claim (the reviewed EscrowFactory and ProjectEscrow deployed on the fork, a
real 2% fee accrued, refusal of incomplete or changed deployment pins, a
reviewed implementation upgrade, no claim by a receipt or dry run, refusal of
an incomplete transfer receipt, then a live claim, sale and finalized
reconcile). The fee claim leaves both free principal and a reserved award
unchanged. `SLOP_TEST_FEE_PORT` selects another local port. To run only this
claim flow, use `bun run test:fee-converter:fork --fee-claim-only`.
The Solana check uses a local
`solana-test-validator` (port 28899) that clones the mainnet Jupiter and
Whirlpool programs and one JUP/USDC route. The Solana harness lifts the
Solana block with a local-only option that the hosted Worker never sets.
They need `anvil` and `solana-test-validator` on `PATH` and never touch a real
chain.

The registry discovery includes ordinary `escrow.deployments` and private
bounty `securityBounty.settlement.deployments`. Both supply fee assets and
vaults. A bounty-only project does not need an ordinary vault or reward token
entry for its fees to be claimed and converted.
