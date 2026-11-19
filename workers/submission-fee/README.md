# Submission-fee Worker

`slop-submission-fee` runs the chain side of the refundable submission fee
(PRD section 6, "Submission fee deposits"; operator decision, 18 November
2026). An outside contributor deposits a small fee into the
`SubmissionDeposits` contract before Slopbot reviews their pull request. A
merge sends it back. A pull request closed without a merge keeps it: a
stablecoin goes to Slop's fee wallet, SLOP goes to the burn address.

The Worker reads the contract, records each deposit, judges whether it pays
for its pull request, marks that pull request paid, and sends what Slopbot's
row says is due. It decides nothing about merges or closes.

**It is `off`.** Record-only (`dry_run`) was switched on at 18:06 UTC on
19 November 2026 and off again the same hour: each scheduled run on Cloudflare
reported `submission_fee_operation_failed` on both networks (Base after its
finalized scan had advanced, Robinhood Chain before it recorded a position),
while the same run reads both chains cleanly from outside Cloudflare. The
cause is not known yet. A failed network's run result now carries a `reason`
naming the step that failed and the error classes, HTTP status and JSON-RPC
code behind it (`failureReason` in `core.ts`), never an error message or a
URL, so the next record-only run says where it fails. The contracts were deployed on 19 November 2026 and their
addresses and start blocks are in `src/lib/submission-fee.mjs`
(`contracts/DEPLOY-MAINNET.md`). Their resolver is this Worker's address,
`0xB3a6E36f23B74C870b56fE3CCE425a78a0a8f525`, and the Worker holds its key as
`SUBMISSION_FEE_RESOLVER_KEY`. In `dry_run` both networks are read and the key
is not loaded.

The default Base endpoint is `https://base-rpc.publicnode.com`:
`mainnet.base.org` refuses `eth_getLogs`. On 19 November 2026 a local
record-only run of this Worker read both real chains cleanly with it and
failed on Base with `mainnet.base.org`. A public endpoint is enough for
record-only. Before `live`, set a keyed Base endpoint as the optional secret
`RPC_URL_SUBMISSION_FEE_BASE`: the Worker acts on what its endpoint reports.

## What runs

| Cron | Job |
| --- | --- |
| `*/5 * * * *` | Read deposits on each served network, judge, mark paid, send what is due |
| `7 * * * *` | Read the SLOP price once, store the hour's reading, keep the SLOP rate |

There is no HTTP route. The public reads are served by the site:
`GET /api/v1/submission-fee/rate` and
`GET /api/v1/submission-fee/items/<repositoryId>/<pullNumber>`
(`backend/submission-fee/handler.ts`).

## One run on one network

1. **Check the chain id.** Another chain behind the endpoint reads nothing.
2. **Finalized events.** From the stored cursor (first run: the contract's
   start block) through the finalized block, at most ten pages a run. Each
   page's rows and the cursor are one atomic write, and the cursor never
   moves back. `Deposited` is recorded. `Resolved` and `Reclaimed` set the
   deposit's final state (`refunded`, `kept`, `reclaimed`) and the pull
   request's outcome. A `Resolved` event of an accepted token is recorded
   only after its finalized receipt shows the token's own `Transfer` of the
   deposit's exact amount from the contract to the payer (refund) or to the
   deposit's `keptTo` (kept). The Worker never resolves a deposit of any
   other token, and such a deposit is never income; if the resolver role is
   ever used by hand for one, its event is recorded as the contract emitted
   it.
3. **Confirmed deposits.** `Deposited` events above the finalized block that
   already have the network's confirmation count on top (30 blocks on Base,
   1,200 on Robinhood Chain) are recorded with `finalized_at` null. If a
   reorganisation removes or changes one before it is finalized, the row is
   removed or replaced and the pull request stops being paid.
4. **Judge.** Each deposit without a judgement is checked by
   `submissionDepositCounts` (`src/lib/submission-fee.mjs`). One that counts
   marks its pull request paid (`paid_at`, `paid_network`,
   `paid_deposit_id`), then is recorded as accepted. Anything else is
   recorded as refused with a reason.
5. **Parked deposits.** In `live`, up to five deposits parked more than a
   day ago are simulated again (see "A payout the token refuses" below).
6. **Send.** Only for finalized deposits of an accepted token. A refused
   deposit is refunded. An accepted one is refunded when its pull request's
   row says `refund_due`, and kept only when that row says `kept_due` and
   names this deposit as the one that paid. One `resolveMany` transaction
   carries at most twenty deposits. A deposit of a token outside the table
   is never resolved.

## When a deposit counts

All of these, at the deposit's block time:

- Slop asked a fee for that pull request (a `submission_fee_items` row with
  the deposit's `item`), and it is not already paid or decided.
- The token is the network's stablecoin (USDC on Base, USDG on Robinhood
  Chain) or SLOP on Robinhood Chain.
- `keptTo` is the fee wallet for a stablecoin, the burn address for SLOP.
- The amount is at least the amount due: the fee the pull request was first
  asked for, or for SLOP the amount at the rate in force (or the previous
  rate, for 48 hours after a change).

Refusal reasons: `token_not_accepted`, `wrong_kept_to`, `unknown_item`,
`item_fee_invalid`, `no_slop_rate`, `amount_below_due`, `item_already_paid`,
`item_already_decided`. A deposit for a pull request with no row waits 24
hours after it is finalized, in case the request is still on its way, and is
then refused as `unknown_item`. A refused deposit of an accepted token is
always refunded, never kept. Paying more than the fee counts; the whole
deposit is refunded or kept.

**A token outside the table is never resolved.** Such a deposit is recorded
as refused with `token_not_accepted` and left alone: the resolver makes no
call into a token nobody reviewed, spends no gas on it and never puts it in a
batch. Its row stays `open`. Its payer takes it back from the contract with
`reclaim` after 30 days, and the Worker records that as `reclaimed`.

## Sending

The resolver key can do one thing: mark an open deposit "refund" (its amount
goes to its payer) or "kept" (it goes to the `keptTo` fixed when the deposit
was made). It cannot send a deposit anywhere else, holds no tokens, and is
never the contract's owner.

- Before a deposit is put in a transaction, the contract's own
  `deposits(id)` record is read. Only a deposit that is still open on chain
  and equals the stored row is sent. A stored row that differs stops the
  network's run.
- The transaction is simulated, then signed, then **recorded in
  `submission_fee_sends` with its signed bytes before it is broadcast**. A
  run that dies after signing leaves a row; the next run resends the same
  bytes and signs nothing new.
- One send per network is in flight at a time. The next is signed only after
  the last is finalized or has failed. A unique index refuses a second
  recorded send, so two overlapping runs cannot both broadcast.
- A reverted send, or one whose nonce another finalized transaction used, is
  recorded as `failed`. The deposits stay due and are read from the contract
  again before the next send.
- Final states come from the contract's finalized events, never from the
  Worker's own send.

### A payout the token refuses

`resolveMany` is all or nothing: one deposit whose payout cannot go through
would fail every batch it is in, and every later deposit on that network
would wait behind it. USDC refuses a transfer to a blacklisted address, for
one, so a refund to such a payer can never succeed while the block stands.

- When the simulation reverts with the contract's `PayoutFailed(id)`, that
  deposit is **parked** (`submission_fee_parked`, reason `payout_failed`,
  log event `submission_fee_parked`) and the rest of the batch is simulated
  again and sent. Nothing is signed for a batch that fails its simulation.
- When the revert names no deposit (an endpoint that drops the revert data),
  each deposit of the batch is simulated alone. Those that fail are parked
  (`reverted_alone`) as long as at least one other goes through. When none
  goes through and the contract blames none, nothing is parked: that is a
  fault of the key or the contract, not of a deposit (a key that is not the
  resolver, say). The run reports `reverted` and logs
  `submission_fee_send_reverted`.
- A send that passed its simulation and then reverted on chain is recorded
  as `failed`; the next run simulates again and parks the deposit then.
- A parked deposit keeps what is due on its row (`refund_due` or `kept_due`)
  and is left out of every batch. Once a day it is simulated alone, at most
  five parked deposits a run. It returns to the queue when its payout would
  go through, or leaves the list when it is no longer open on chain (log
  event `submission_fee_unparked`). Its payer can reclaim it from the
  contract after 30 days where the token allows that transfer.
- `dry_run` holds no key and simulates nothing, so it parks nothing.
- Gas: a transaction whose signed maximum fee is above
  `SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI`, or that would take the UTC day's
  signed total above `SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI`, is not signed.
  On Base the separate L1 data fee is outside the signed maximum.

Anyone can make a deposit of an accepted token that does not count (a wrong
amount, a wrong destination, a pull request nobody asked a fee for), and the
resolver then spends gas to refund it. The daily ceiling bounds that cost. A
deposit of any other token costs the resolver nothing. A deposit that is not
refunded can be reclaimed by its payer after the contract's 30 days.

## The SLOP rate

One platform number: whole SLOP per 1.00 of stablecoin. A project's SLOP fee
is half its stablecoin fee at that rate, rounded half up to two significant
digits (2.00 at 75.47 SLOP a dollar is 75 SLOP).

- **Source.** The official SLOP / USDG pool on Robinhood Chain (Uniswap v4,
  pool id `0x18f3778f93a34c08d41a03e6b3a466a37ec0fd1b019e43f622927ba0c339838b`,
  USDG as currency0 and SLOP as currency1), read through Uniswap's StateView
  at `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` with `getSlot0(poolId)` at
  the latest block. Both values were read on a fork of Robinhood Chain on
  18 November 2026 and returned 75.97 SLOP per 1.00.
- **Readings.** One per UTC hour, stored in `submission_fee_price_samples`.
- **First rate.** Set once 24 hourly readings exist, from their average.
- **Weekly.** When the rate is seven days old it is reset from the average of
  the last seven days' readings, if at least 84 of those hours were read.
- **Early.** Before that, it is reset from the 24-hour average when the SLOP
  fee at the rate in force is worth less than 35% or more than 65% of the
  stablecoin fee at that average (at least 12 readings in the 24 hours).
- **Averages** are taken over the SLOP price, not over SLOP per dollar.
- **Effect.** A new rate takes effect at the start of the next UTC hour, so
  every deposit is judged against a rate that was already published. The
  previous rate still counts for 48 hours after that.
- **Source unavailable.** No reading is stored for that hour and the last
  rate stays in force. With too few readings nothing changes. Before the
  first rate exists, SLOP is not accepted and a SLOP deposit is refunded.

The hourly readings are spot prices. One reading can be moved by a large
trade in that block; the averages limit what one reading can do, and the fee
is refundable and worth about one dollar.

## Modes

`SUBMISSION_FEE_MODE` in `wrangler.toml`:

| Mode | Reads | Writes | Signs |
| --- | --- | --- | --- |
| `off` | nothing | nothing | nothing |
| `dry_run` | deposits, price | deposits, judgements, paid marks, the rate, and the list it would send (`submission_fee_sends`, `mode = 'dry_run'`) | nothing; no key is loaded |
| `live` | the same | the same, with signed sends | the resolver's `resolveMany` |

In every mode a network whose contract address is `null` is skipped and
logged as `submission_fee_contract_unset`. Without Slopbot's table
`submission_fee_items` (its own migration) the deposit run reads nothing and
logs `submission_fee_items_table_missing`.

## Kept fees are fee income

A kept stablecoin fee reaches the fee wallet as a plain transfer from the
contract. `workers/fee-converter/buyback-store.ts` counts it in `feeIncome`
from this Worker's record: a deposit in state `kept`, accepted, finalized,
with its resolve transaction, whose `kept_to` is that fee wallet and whose
token is the asset asked about. Kept SLOP goes to the burn address and is not
income. Refunds and reclaims are not income.

## Going live (steps 1 to 3 done 19 November 2026; each step is the operator's)

1. Done. `SubmissionDeposits` is deployed on Base and Robinhood Chain
   (`contracts/DEPLOY-MAINNET.md`).
2. Done. Both addresses and their deployment blocks are in
   `SUBMISSION_FEE_CONTRACTS` and `SUBMISSION_FEE_START_BLOCKS`
   (`src/lib/submission-fee.mjs`).
3. Done. The resolver key is the Worker secret
   `SUBMISSION_FEE_RESOLVER_KEY`, set through a hidden prompt and never
   passed to CI. Its address `0xB3a6E36f23B74C870b56fE3CCE425a78a0a8f525`
   holds a little ETH on each network, and the owner named it with
   `setResolver` on both contracts.
4. Set the mode to `dry_run` once its reads work from Cloudflare (see the
   top of this file), and read a few days of `submission_fee_sends` rows.
5. Set a keyed Base endpoint as `RPC_URL_SUBMISSION_FEE_BASE`, then set the
   mode to `live` in its own reviewed change, together with Slopbot's mode
   and `SUBMISSION_FEE_SWITCHED_ON`. The release refuses
   `live` unless both contracts and start blocks are set and the Worker holds
   the key.

## Checks

```sh
bun test ./src/lib/submission-fee.test.ts ./workers/submission-fee \
  ./backend/submission-fee ./workers/fee-converter/submission-fee-income.test.ts
bun run test:submission-fee:anvil
```

The second command deploys the compiled contract and a test token to a local
Anvil chain and runs the Worker against it. With `SLOP_FEE_FORK_BASE` and
`SLOP_FEE_FORK_ROBINHOOD` set to RPC URLs it runs on private forks of both
chains with the real tokens, fee wallet, burn address and price pool.
