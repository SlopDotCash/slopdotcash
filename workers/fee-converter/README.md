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
conversion target on Base, Ethereum and Solana; an unverified asset never
stands in for it. The owner decision of 25 October 2026 exempts Robinhood
from conversion: keep received assets unchanged in the fee wallet and show
"not converted". USDG stays USDG. Do not convert project-token fees to USDG
or bridge them. The Worker and private admin report return `not_converted`.
This does not activate claims, conversion or replacement transactions.

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
verifies receipt before conversion. Local fork and validator evidence must
identify the exact source and reviewed program. Local proof does not activate
production signing.

The checked-in configuration sets `live` mode on Base, Ethereum and
Robinhood. The Worker deploys only when the `SLOP_FEE_CONVERTER_RELEASE`
repository variable is `enabled`.

Owner decision, 27 October 2026: Solana fee conversion is conditionally approved,
but live activation is deferred while owner vault setup is on another computer.
Keep Solana out of `FEE_CONVERTER_NETWORKS` until an independently operated
full-history recovery RPC and the first registered Solana vault are verified,
and all existing readiness checks pass. Activate only through a later reviewed
`main` release. The controls release and approved 0.05 SOL gas top-up are complete
(#905); do not repeat the top-up or the existing program upgrade. Merging this
prepared work does not activate signing or prove live conversion.

**Solana signs only against the separated program layout.** The deployed
Solana program pins an independent rotation-confirmation authority, separate
from the fee recipient and identity authority. The rotation key must never be
installed in this Worker. Earlier program layouts gave the fee recipient that
power. A finalized read of the mainnet Config on 26 October 2026 showed three
distinct identity, fee-recipient and rotation keys. A Solana claim verifies
the pinned Config, including its independent rotation authority, before it
signs.

## Staging

The normal `development` release deploys `slop-fee-converter-staging` with
`wrangler.staging.toml`. Its minute cron runs receipt and recovery checks on
all four networks in `dry_run`, with the isolated `slop-staging` D1 journal.
It uses public read-only RPCs and never loads a signing key. Production owns
live sends for the shared fee wallets; staging must not sign concurrently
against a separate journal. Staging quotes and skips establish staging
behavior only; finalized production transactions remain separate acceptance.

Reconciliation reads only `live` rows. In every mode except `off`, it can
rebroadcast their recorded signed bytes, and a rebroadcast needs no key.
Staging writes only `dry_run` rows, so its journal has no send to rebroadcast.
Never copy production `fee_conversions` rows into `slop-staging`, and never
point a `live` converter at it.

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
3. A network configured without a conversion target stops here with status
   `not_converted` and logs `fee_conversion_not_converted`. Robinhood retains
   each received asset unchanged: USDG stays USDG and project tokens stay in
   their original token. It requests no quote, starts no new claim or send,
   and loads no key. The private admin report shows the same state. Existing
   uncertain sends still reconcile in step 2; their history is not rewritten.
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
   itself, so it does not count against the conversion caps. Claims remain
   pending until a later run verifies the finalized receipt. That token cannot
   convert while its claim is unresolved, including during receipt runs.
   Receipt runs skip this step. Recovery scans verify each deployment before
   they read its fee counter or price its claim.
   - **EVM.** Uses the shared escrow verifier to check the manifest's network,
     runtime and implementation hashes, factory, roles, asset, delays and
     payout purpose at one current block. Missing or changed reviewed values
     stop the claim. The fee wallet must not be the vault owner, registrar,
     upgrade authority, or current or proposed identity authority. It must
     not be a proposed upgrade authority. A rotation to a separate identity
     authority remains valid. It repeats these checks before signing `claimFees()`, and
     signs only when no earlier fee-wallet transaction is pending. At the
     receipt block it verifies the deployment again. Transfers of the reviewed
     token must show the same net debit from the vault and credit to this fee
     wallet, equal to the vault's `FeesClaimed` event. For ETH, the canonical
     receipt must bind the exact zero-value `claimFees()` transaction and
     event to the reviewed implementation. That code emits the event only
     after checking its exact native debit and recipient credit; balances
     across a whole block include unrelated transactions and are not claim
     evidence. The earlier read is a
     quote estimate: fees can accrue or another caller can claim before this
     transaction lands. Receipt status or nonce advancement alone is not
     proof. Before broadcast, the existing send journal stores the signed
     claim, nonce, expected fee and reviewed deployment. A missing or incomplete
     receipt keeps the claim open. The next run checks that same transaction;
     if it was not sent, it sends the stored bytes unchanged. It does not sign
     another claim or convert that token until the claim is resolved.
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
     confirmed but not finalized. The fee wallet cannot be the program upgrade
     authority. The transaction holds exactly two instructions, signed only by
     the fee wallet: idempotent creation of its associated token account for
     the vault mint, and `claim_fees` paying into that account. It is simulated
     first. Before broadcast, the shared journal records the signature, exact
     bytes, blockhash expiry and reviewed deployment. A finalized receipt must
     bind that signature and slot to the reviewed program's `FeesClaimed`
     event. The event amount must equal the vault's debit and fee wallet's
     credit. The current program must still prove the code used at that slot;
     a later deployment leaves execution unverified. Missing or partial
     receipts remain pending, even after blockhash expiry. Recovery sends
     unchanged recorded bytes only while valid, after checking the deployment
     again. That token cannot convert until the receipt is verified.
5. List candidate assets from D1 project manifests: a `rewardAsset` of kind
   `token` or `native` on that network, and the `escrow.deployments[].asset` of each
   deployment on the network's escrow key (`base-mainnet`, `ethereum`,
   `robinhood-mainnet`, `solana-mainnet`). Add the `FEE_CONVERTER_ALLOWLIST`
   entries. It never discovers tokens from the wallet, so an airdropped token
   is never sold.
6. Read the fee-wallet balance of each candidate. Skip USDC and empty
   balances. A receipt run also skips a balance unchanged since the token's
   latest record. On Solana the balance is the fee wallet's canonical
   associated token account, the only holding a reviewed route can debit.
   A fee paid to another token account of the fee wallet stays there.
   For ETH and SOL, cap the amount by finalized claim receipts less prior
   conversion inputs and recorded gas costs. Keep the next transaction's
   full native cost ceiling. Gas topups and direct transfers add no fee
   credit and are never sold.
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

| Network                | Target                    | Route                    | Why                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base (8453)            | Circle USDC `0x8335…2913` | KyberSwap Aggregator API | No API key, one integration for all three EVM chains, the router is the same audited `MetaAggregationRouterV2` (`0x6131…37b5`) on each. Its calldata carries the receiver, the input amount and the minimum output, so the Worker can check them before signing. |
| Ethereum (1)           | Circle USDC `0xa0b8…eb48` | KyberSwap Aggregator API | Same router address and code on chain. AGENTS.md requires verifying this address from Circle's primary source before activation.                                                                                                                                 |
| Robinhood Chain (4663) | No conversion target      | None                     | The owner chose unconverted retention on 25 October 2026. Keep each received asset unchanged; USDG stays USDG. No swap or bridge. The Worker and private admin report return `not_converted`. A USDC route is no longer a release requirement for this network.  |
| Solana                 | Circle USDC `EPjF…Dt1v`   | Jupiter Swap API v1      | Uses `api.jup.ag` with or without `JUPITER_API_KEY`. An explicit `JUPITER_API_URL` overrides this default.                                                                                                                                                       |

Jupiter's [migration guide](https://developers.jup.ag/docs/portal/migration)
replaces the `lite-api.jup.ag` hostname with `api.jup.ag`; the endpoint paths
stay the same. Keyless access supports 0.5 requests per second. An optional
API key provides higher limits, as described in its
[setup guide](https://developers.jup.ag/docs/portal/setup). This hostname change
does not enable conversion or change the quote and signing checks.

0x Swap API v2, 1inch and the Uniswap Trading API all need an API key.
Robinhood's support pages name 0x and LI.FI for swaps on Robinhood Chain,
and Uniswap lists a Universal Router deployment on 4663; this Worker did not
verify those routes. Any of them can replace KyberSwap behind
`ChainClient` in `evm.ts` if the owner prefers a keyed provider.

### Checks before an EVM swap is signed

- The route and build name the pinned router. An ERC-20 build carries no
  native value; an ETH build carries exactly the recorded input amount.
  ETH uses the zero address in the journal and Kyber's native sentinel in
  its route and calldata.
- The calldata decodes as `swap` or `swapSimpleMode`, with the exact input
  token and amount, the network USDC as output, the fee wallet as
  receiver, and no extra fee receivers.
- The signed minimum output is at or above the recorded quote minimum. The
  build uses half of the slippage budget, so normal drift between quote and
  build passes and a larger move fails as "price moved".
- An `eth_call` of the exact calldata from the fee wallet returns at least the
  signed minimum.
- An ERC-20 approval is for the exact order amount to the pinned router,
  never unlimited. ETH needs no approval.

### Checks before a Solana swap is signed

- The fee wallet is the only signer and the fee payer.
- Token routes invoke only Compute Budget, Associated Token or Jupiter v6.
  Native SOL routes add one exact System transfer to the fee wallet's wrapped
  SOL account and one Token `SyncNative`, before the Jupiter route. This wraps
  only the journal-approved native fee input in the same transaction. Existing
  wrapped SOL remains unchanged. Other System or token instructions are refused,
  so no unrelated direct transfer
  can be added.
- The signed minimum (`otherAmountThreshold`) is at or above the recorded
  quote minimum.
- `simulateTransaction` credits the fee wallet's USDC associated account with
  at least the signed minimum.
- The native-cost checks in [Native fee budget](#native-fee-budget) pass, and
  the full transaction ceiling is reserved before the signature.

## States

| State       | Meaning                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quoted`    | Dry run: a quote that passed every check. Live: a quote not yet signed; closed as `failed` after one hour if the run ended.                                                                       |
| `pending`   | Below the dust threshold; the fee stays in the wallet until a later receipt lifts it over. `reason` names the threshold (migration `0076`). Records written before that migration keep `skipped`. |
| `skipped`   | A price, slippage or cap check refused the token; `reason` says which.                                                                                                                            |
| `no_route`  | The aggregator has no route for this token.                                                                                                                                                       |
| `submitted` | Signed bytes recorded and broadcast; not yet final.                                                                                                                                               |
| `unknown`   | Signed bytes recorded, but the broadcast result is unknown.                                                                                                                                       |
| `finalized` | Verified in a finalized block. `amount_out` is the received fee for a claim, or USDC proceeds for a conversion.                                                                                   |
| `failed`    | Proven unable to complete: reverted, expired or a prepare check failed.                                                                                                                           |

The journal's `kind` is `conversion` or `claim` (migration `0082`). Existing
rows remain conversions. Claims use the same pending-token and immutable-send
guards. Their bounded `quote` JSON holds the reviewed vault record; they have
no router deadline. Conversion totals, budgets and the admin conversion list
exclude claim rows.

Each conversion record also keeps the fee-wallet balances in base units: the input token
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

- **EVM.** A finalized receipt with verified token movement settles the row.
  A swap can fail when its nonce was consumed or its router deadline passed.
  A claim with missing hash lookups stays pending even when its nonce was
  consumed: the missing claim could be the transaction that consumed it.
  Only the node's "not found" answer counts as no receipt or transaction.
  A failed lookup logs `fee_conversion_reconcile_error` and leaves the row
  open. A valid unsent claim uses the recorded bytes after a fresh deployment
  check.
- **Solana.** A finalized signature with a verified receipt settles the row.
  A swap with no status fails after its recorded `lastValidBlockHeight`.
  A claim with no status remains pending after expiry, because expiry does not
  prove it was never included. Before expiry, recovery checks the deployment
  and rebroadcasts the recorded bytes.

The Worker never signs a transaction with a new nonce for a send that could
still land. The only other transaction it signs for that send is a same-nonce
fee replacement, described next.

### Same-nonce fee replacement (EVM)

Owner decision of 25 October 2026. EVM fee claims, finite approvals and conversion swaps are
signed with a fixed maximum fee. If gas stays high, the send can stay unmined.
The Worker then replaces it with a transaction that has the same nonce and a
higher fee, in bounded steps.

A replacement is signed only when all of these are true:

- The mode is `live` and the network has a fee-wallet key. A dry run
  reconciles but signs nothing.
- The send is not mined. A mined send that waits for finality is not
  replaced.
- The latest attempt (the original or the last replacement) was journaled at
  least 3 minutes ago (`REPLACEMENT_WAIT_MS` in `core.ts`).
- The latest block base fee is above the signed `maxFeePerGas` of the latest
  attempt. A clipped or lower suggested priority fee alone does not trigger
  replacement.
- The new fees fit the step and the cap. Each step raises `maxFeePerGas` and
  `maxPriorityFeePerGas` by 25%, rounded up. Neither field can go above three
  times the original send's value. Each step must raise both fields by at
  least 10%. When
  the cap does not allow this, the cap is reached. With these values, a send
  can have at most five replacements.
- The worst-case fee (the original gas limit at the new `maxFeePerGas`, plus
  on Base the L1 data fee of the replacement bytes from the GasPriceOracle
  `getL1Fee`), priced in USDC, multiplied by `FEE_CONVERTER_GAS_MULTIPLE`, is not more
  than the recorded USDC value of the send. This is the same approved
  gas-cost threshold that the original send passed. The gas limit does not
  change. A claim row records its quoted USDC value for this check. A claim
  recorded before this change has no value, so it is not replaced.
- A claim: the reviewed deployment is verified again, as for a rebroadcast.
- An approval: the token, pinned router and finite original amount match.
- A swap: its router deadline is more than 2 minutes away.

If one of these is false, the send waits. The run logs `fee_send_waiting`
with the reason, for example `fee replacement cap reached`. The send stays
`submitted` or `unknown`. The token stays blocked until the send is
reconciled.

The replacement copies the recipient, calldata, value, gas limit, access list
and nonce from the original signed bytes. Only the two fee fields change. The
Worker does not quote a swap again under the same nonce.

**Expired swap deadline.** A replacement keeps the calldata, so it also keeps
the router deadline (20 minutes after signing). After that deadline, a
same-nonce replacement would revert. The existing code has no zero-value
self-cancel transaction, and this change does not add one. A swap within 2
minutes of its deadline is not replaced; it waits. If it is mined later, it
reverts and the row closes as `failed`. If the node drops it after the
deadline, the row also closes as `failed`. A later run quotes and signs a new swap for
the token. The token balance stays in the fee wallet during the wait.

**Lease.** Claims, approvals, swaps and replacements recheck the current
network lease before EVM signing and broadcast. Their durable insert requires
the same live lease. Reconciliation also checks the lease before rebroadcast. The append also requires that same live
lease, the still-open original and the next attempt number. A lost lease
stops the run. Bytes already journaled remain available to its successor.

**Receipt.** A final outcome requires the requested transaction hash in its
exact canonical block position, at or below the finalized block. Missing or
mismatched block evidence leaves the send open, including reverted attempts.

**Journal.** Each replacement is stored in `fee_send_replacements`
(migration `0087`) before it is broadcast: the row, attempt number, nonce,
transaction hash, signed bytes and both fee fields. These rows cannot change
or be deleted. The original row in `fee_conversions` does not change.

**Reconciliation.** The original and every replacement share one nonce, so
at most one can be included. Reconciliation checks the receipt of each hash.
The included transaction decides the one outcome of the row, with the same
claim and swap receipt checks as before. `landed_tx_id` records which
transaction landed. A claim or conversion is counted once, whichever attempt
lands.

**Nonce floor.** A new claim, approval or swap never takes a nonce at or
below the nonce of an open journaled send (`submitted` or `unknown`) on that
network. A legacy approval hash also reserves its recorded nonce. A node, for example one behind a load-balanced RPC, can drop a
stuck send and report its nonce as free. Without this floor, a new send for
another token could take that nonce, and the two sends would outbid each
other through their replacements. The new send is refused before it is
signed; the refused conversion closes as `failed` with the reason, and a
later run tries again.

**Restart.** A run can stop after it journals a replacement and before the
node receives it. The next run sees that the latest attempt is not in the
node. It sends the journaled bytes again; it does not sign another
replacement. A restart tries those bytes first even when the three-minute
wait has elapsed. If the node explicitly refuses them because their maximum
fee is below its base fee, the run may sign the next bounded step. A transport
error or any other uncertain response keeps the same bytes and the row
`unknown`. The wait, the step and the cap come from the journal, so repeated
runs cannot pass the cap.

**Approval before swap.** Migration `0088` keeps the exact finite approval as a
separate immutable send in the same journal. Its bytes are stored before
broadcast. An uncertain send blocks another intent for that token; a restart
reuses its bytes. The receipt must be canonical and finalized, and the token,
router, amount and allowance must match before a later run prepares a fresh
swap. Approvals share the bounded replacement path but have no swap deadline.
They count as neither conversions nor fee receipts and do not consume the
conversion value caps. Those caps still apply to the later swap.

Older rows with only an approval hash keep their original state and history.
They hold the token and nonce until the exact approval can be verified. Missing
bytes or uncertain receipts never authorize a new approval or a replacement.
No raw bytes are fabricated for those rows.

## Configuration

Vars in `wrangler.toml` (reviewed by pull request). The conversion limits
have no fallback in code: in `dry_run` and `live` a missing limit refuses the
run. `off` reads none of them.

| Var                                  | Checked-in value                            | Meaning                                                                                                          |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `FEE_CONVERTER_MODE`                 | `live`                                      | `off`, `dry_run` or `live`.                                                                                      |
| `FEE_CONVERTER_NETWORKS`             | `base,ethereum,robinhood`                   | Enabled networks. Robinhood retains received fees without conversion.                                            |
| `FEE_CONVERTER_ALLOWLIST`            | empty                                       | JSON object of extra tokens per network.                                                                         |
| `FEE_CONVERTER_MIN_VALUE_MICRO`      | `5000000` (owner decision, 24 October 2026) | Minimum quoted USDC output. `0` converts every fee.                                                              |
| `FEE_CONVERTER_GAS_MULTIPLE`         | `10` (owner decision, 24 October 2026)      | Output must be at least this many times the fee estimate. `0` disables the check.                                |
| `FEE_CONVERTER_MAX_SLIPPAGE_BPS`     | `100`                                       | Quote minimum within 1% of the quote.                                                                            |
| `FEE_CONVERTER_MAX_PRICE_IMPACT_BPS` | `200`                                       | Price-impact cap (2%).                                                                                           |
| `FEE_CONVERTER_RUN_CAP_MICRO`        | `1000000000`                                | Per-run, per-network value cap (1,000 USDC).                                                                     |
| `FEE_CONVERTER_DAILY_CAP_MICRO`      | `5000000000`                                | Rolling 24-hour live value cap per network (5,000 USDC).                                                         |
| `FEE_CONVERTER_SOLANA_FEE_MICRO`     | `2000`                                      | Solana fee estimate used for the gas multiple; an estimate, not policy.                                          |
| `FEE_CONVERTER_NATIVE_BUDGETS`       | Base, Ethereum and Robinhood set            | Per-network JSON with exact decimal wei strings `perTransaction`, `perDay`, `additionalFeeReserve`. No defaults. |
| `FEE_WALLET_<NETWORK>`               | All four networks set                       | Public fee-wallet address. A network without one is refused.                                                     |
| `KYBERSWAP_CLIENT_ID`                | `slop-fee-converter`                        | Client id header for KyberSwap.                                                                                  |

The owner approved these limits on 24 October 2026. See [PRD section
11](../../docs/slop-product-requirements.md#11-source-delivery-and-acceptance).
Small balances accumulate until both minimums are met. These decisions do
not enable conversion: mode, network, route and release checks still apply.

Secrets (set only by the key custodian, never in D1, CI or the repository):

| Secret                                                                       | Format                                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FEE_WALLET_KEY_BASE`, `FEE_WALLET_KEY_ETHEREUM`, `FEE_WALLET_KEY_ROBINHOOD` | `0x` + 64 hex characters.                                                                                |
| `FEE_WALLET_KEY_SOLANA`                                                      | Solana CLI keypair JSON (64 numbers).                                                                    |
| `RPC_URL_<NETWORK>`                                                          | Optional private RPC URL. Error text strips URLs, so a provider key in the URL never reaches D1 or logs. |
| `JUPITER_API_KEY`                                                            | Optional.                                                                                                |

In `live` mode the Worker refuses a network when its key is missing or does
not derive the configured `FEE_WALLET_<NETWORK>` address. `dry_run` never
reads a key.

### Native fee budget

The token-value caps above do not bound gas. Live EVM signing also needs its
own native transaction and UTC-day limits. The owner selected them on 26
October 2026: Base 0.0001 ETH per transaction and 0.001 ETH per UTC day, with a
0.00005 ETH data/operator allowance inside the transaction ceiling; Ethereum
0.001 ETH and 0.01 ETH; Robinhood 0.0002 ETH and 0.002 ETH. This latest approval
supersedes the earlier values. They are set in `FEE_CONVERTER_NATIVE_BUDGETS`.
Base needs a positive allowance for data and operator fees; Ethereum uses
zero additional allowance. Robinhood remains retain-only and loads no key.
Solana has separate approved ceilings of 0.005 SOL per transaction and 0.02
SOL per UTC day, including account creation and priority fees (owner decision,
26 October 2026, #905). Its configuration uses 5,000,000 and 20,000,000
lamports. Migration `0094_fee_solana_native_gas.sql` preserves all EVM records
and extends the same durable journal to Solana; legacy `*_wei` SQL fields
store lamports for Solana. Each signature reserves its full transaction
ceiling until a canonical finalized receipt reconciles its actual cost.
A signed but expired or missing transaction retains that reservation until
both independent providers meet the owner-approved expiry policy (#905,
26 October 2026). The signer records the signed blockhash's actual slot.
Each provider must match mainnet genesis, retain history at least as old as
that anchor, verify the same finalized anchor blockhash, return false for
`isBlockhashValid` at finalized commitment, and return no full-history
signature or finalized transaction. Null indexes alone are insufficient: both
providers must also return every finalized block and its complete signature list
from a common expired horizon back to the signed anchor. Each parent slot and
blockhash must link, and none may contain the signed transaction. The scan
retains immutable page evidence and a durable cursor under the current lease,
processing up to 32 blocks per provider per run; restarts resume the fixed
horizon. Missing blocks or signature lists keep the hold. Both completed scans must
agree on the common horizon, block count and cumulative block/signature digest;
a disagreement keeps the reservation even when neither lists the target.
The journal and database enforce that agreement again at settlement.
Stale contexts, pruned history, unknown
or identical provider operators, receipt disagreement and provider failure
keep the hold. A null receipt alone never releases native gas.

An immutable `fee_solana_expiry_proofs` record and the zero-cost journal
settlement commit atomically under the current network lease. The claim or
swap is then marked failed before a later attempt; original signed bytes
remain unchanged. Earlier records without a slot anchor remain held. This
policy trusts two independent RPC history observations; it is not a
cryptographic proof of absence. The default secondary is Allnodes PublicNode
(`https://solana-rpc.publicnode.com`); a custodian may set
`SOLANA_RECOVERY_RPC_URL` to an independently operated supported endpoint.
Known operators are the Solana public service, PublicNode, Alchemy and Helius.
Do not disguise aliases of one operator as independent services.

Before signing, Solana prices the exact message with `getFeeForMessage`,
reserves rent for each admitted classic SPL or metadata-only Token-2022
associated-account creation even if the account exists, checks simulation
for unexplained wallet debit, and rechecks the 10-times-value rule using a
current wSOL/USDC quote. Jupiter requests V2 exact-input instructions and
permits versioned messages. It resolves every address lookup table at
finalized commitment, rejects inactive or not-yet-warm entries, and retains
the complete account order, table digests and message hash with the native
reservation (`0096_fee_solana_accounts.sql`).

The complete resolved route is reviewed before signing: every account is
read at finalized commitment, every token holding and its mint must use an
admitted token program and extension set, and the instruction must bind the
fee wallet, canonical input/output accounts, exact amount, minimum output
and bounded slippage. Simulation must show the exact input debit and minimum
output credit without changing the accounts' authority fields. For native SOL,
the exact wrap and swap leave any pre-existing wrapped SOL unchanged; the native
wallet debit must equal the input plus bounded network cost and account rent. This uses
the pinned minimal Jupiter wire schema in `jupiter-route-schema.ts`; the IDL
source digest records the schema source, not a program-code attestation.

Finalized swap receipts must match the signed bytes, retained loaded-account
order, token programs, exact input debit and minimum output credit. Recovery
loads the same immutable proof from D1. An expired journaled send with missing
history remains pending until independent retained histories prove absence.
Costs include priority fees, failed transaction fees and new account rent;
wrapped-SOL principal is excluded from rent. A live Solana record with a
signature but no journal record stops each whole Solana run, including status
reconciliation. Solana has no import path for such records. The value-only
`FEE_CONVERTER_SOLANA_FEE_MICRO` estimate supplies no native spending limit.
No keeper or referral budget supplies a default. These source changes do not
activate a network or qualify a deployed program or live aggregator route.

Before each approval, swap, fee claim or replacement, price the final gas
limit and fee fields, include Base's additional allowance, and recheck the
10-times-value rule. Refuse above either native ceiling. Base's oracle must
also fit the allowance before signing. Variable Base charges are not a hard
on-chain ceiling; an observed overrun stops further signing.

Migration `0092_fee_native_gas.sql` reserves exact wei under the network
lease. A revision fence prevents concurrent reservations from overspending.
The existing durable signed-attempt insert atomically commits its reservation;
an invalid or expired lease rolls back the whole insert. Broadcast happens
only after this commit and a fresh lease check. A successor can retire an
uncommitted prior-lease reservation because it cannot have reached broadcast.
Committed attempts are never released merely because a swap expired, an RPC
failed, or a business row says failed. Historical approval and swap hashes
are both reconciled, including older rows that hold both.

Same-nonce replacements reserve their largest maximum once. Unknown sends
carry that liability across UTC midnight. A swap that closes as failed while
its nonce is still unused, for example one dropped after its router deadline,
keeps its reserve. The next send takes that nonce and joins the same group,
so the nonce still reserves its largest maximum once until a receipt settles
it. Canonical finalized success and revert receipts settle the exact
execution cost plus Base data/operator fees; missing cost evidence keeps the
reserve. An advanced finalized nonce does
not identify the winning transaction or prove zero cost. If another send
consumed it, the reserve remains until a reviewed path can prove that winner;
no release path is implemented for that case. Actual costs are charged on the
UTC day finality is observed. A late receipt therefore does not erase today's
liability. The receipt block hash remains evidence of the chain event.

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
arguments, no value) to a vault named in a D1 project manifest, same-nonce fee
replacements of that swap, approval or claim, and on Solana
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
5. Move the remaining balance from the old wallet with an owner-authorized
   transaction, then destroy the old key.

## Sweep to treasury

The Worker never sends funds out of the fee wallet. Proceeds accumulate as
USDC. The owner selected separate EVM and Solana software wallets for manual
sweeps. Their keys stay in the owner's local `.env`, outside this Worker; do
not describe them as cold storage. See the [owner decision](https://github.com/SlopDotCash/slopdotcash/issues/905#issuecomment-6379777455).
Sweep on a fixed schedule, such as weekly or above a threshold. Keep only
a small gas balance (ETH, or SOL) in the fee wallet. A
sweep is an owner-authorized transfer outside this Worker. A human or an
owner-authorized agent may sign it under PRD section 11; this permission gives
the Worker no sweep power.

## Turn on live mode

1. Use the approved wallets and limits in `wrangler.toml` and PRD section 11.
   Verify the selected network's USDC route and current deployment evidence
   in [#905](https://github.com/SlopDotCash/slopdotcash/issues/905). Keep
   unavailable routes pending. Do not request the recorded choices again.
2. The key custodian checks installed secret names with `wrangler secret list
--config workers/fee-converter/wrangler.toml`. Keep existing valid secrets.
3. The key custodian installs any missing secret with `wrangler secret put
<NAME> --config workers/fee-converter/wrangler.toml`. Enter its value only
   at the private prompt. If the Worker does not exist, accept Wrangler's
   offer to create it. Publish application code only through the checked-in
   release workflow from reviewed `main`, not a local `wrangler deploy`.
4. Set the repository variable `SLOP_FEE_CONVERTER_RELEASE` to `enabled`.
5. Land a pull request with `FEE_CONVERTER_MODE = "dry_run"` and the network
   list. Watch `GET /api/v1/admin/fee-conversions` for at least a day: quotes,
   skip reasons, price impact and minimum outputs should look right.
6. Fund each fee wallet with a small gas balance.
7. Land a pull request with `FEE_CONVERTER_MODE = "live"`. That reviewed
   pull request is the activation record MVP-07c requires. The release step
   refuses live mode when an enabled network lacks its key or its dedicated
   native transaction/day limits. Solana uses the same atomic signing journal.
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
network's target with status `usdc` or `not_converted`. It never
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
reviewed implementation upgrade, refusal when the fee wallet is a current or
proposed attester, no claim by a receipt or dry run, and whole-run recovery
after a lost send, lost response, incomplete transfer receipt or missing hash
lookups. It also accepts the exact smaller fee after another caller claims
first. Each recovery uses the same journaled claim and verifies it before a
sale and finalized reconcile). The fee claim leaves both free principal and a reserved award
unchanged. The `bump-*` cases stop automatic mining and raises the base fee
above the signed fee. It proves that a stalled claim gets a +25% same-nonce
replacement only after the wait and never in a dry run, and that the
replacement lands; that the original can land after its replacement was
broadcast; that replacements stop at three times the original fee and a later
run does not pass that cap; and that a run that stops after it journals a
replacement sends the same bytes on the next run. `bump-nonce` drops a stuck
claim from the node and proves that a WETH conversion is refused instead of
taking the claim's nonce, and that the claim then lands on that nonce. Each
case runs on a fresh
fork and records one claim with the transaction that landed. To run only these
cases, use `SLOP_TEST_CLAIM_FAULTS=bump-replaced,bump-original,bump-cap,bump-restart,bump-nonce bun run test:fee-converter:fork --fee-claim-only`. `SLOP_TEST_FEE_PORT` selects another local port. To run only this
claim flow, use `bun run test:fee-converter:fork --fee-claim-only`.
`SLOP_TEST_CLAIM_FAULTS=before,lease bun run test:fee-converter:fork --local`
runs the same client, core, migrated SQLite and admin report against a private
Anvil chain with generated test keys. Harmless ERC-20/router fixtures and fixed
quote replies replace public assets and liquidity only. It proves actual
approval signatures, persisted bytes, database reopen, finality before a fresh
swap, matching token proceeds, lost-send recovery and refusal after a claim
loses its network lease. It is not live Kyber, Circle or production evidence.

The Solana check uses a local `solana-test-validator` (default port 28899).
It captures real Jupiter V2 quote and unsigned swap responses, resolves their
lookup tables at finalized commitment, and clones the route's public programs
and accounts. The default input is classic SPL JUP; run
`SLOP_FEE_TEST_TOKEN=pmup bun run test:fee-converter:solana` for the selected
Token-2022 mint. `SLOP_FEE_TEST_TOKEN=sol bun run test:fee-converter:solana`
loads the compiled local escrow, creates native fees by deposit and withdrawal,
and verifies the converter's own finalized claim, exact atomic wrap, USDC receipt,
unchanged vault principal and exclusion of gas topups from fee income.
`SLOP_FEE_TEST_PORT` selects another local port range.
The captured responses stay bound to the requested wallet and quote while
execution runs against the isolated snapshot. The harness selects stable
on-chain AMMs instead of expiring oracle-price routes. It retains the original
lookup evidence, rebases only table extension timing for the fresh local bank,
and normalizes fixture rent epochs; lookup addresses and authority stay intact.
Generated throwaway wallets
exercise a real local receipt, the normal native budget, signing journal,
finalized conversion, restart reconciliation and duplicate refusal.
These checks require `anvil` and `solana-test-validator` on `PATH`. Public
mainnet access is read-only; every signed transaction is sent only to the
local validator. Local results do not qualify a production deployment.

The registry discovery includes ordinary `escrow.deployments` and private
bounty `securityBounty.settlement.deployments`. Both supply fee assets and
vaults. A bounty-only project does not need an ordinary vault or reward token
entry for its fees to be claimed and converted.
