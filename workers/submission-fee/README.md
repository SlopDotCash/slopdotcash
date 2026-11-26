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

The same contract on Robinhood Chain also holds the refundable SLOP deposit
on a private security report (PRD section 8; operator decision, 21 November
2026). The Worker treats it the same way: it marks the report's row paid and
sends what that row says. It decides nothing about a report. See "Report
deposits" below.

**It runs record-only (`dry_run`) since 19 November 2026.** It was first
switched on at 18:06 UTC that day and off again within the hour: each
scheduled run on Cloudflare failed its log reads on both networks (see
Endpoints below). It went back on once the Worker held keyed endpoints and a
preview pass on Cloudflare read both chains. A failed network's run result
carries a `reason` naming the step that failed and the error classes, HTTP
status and JSON-RPC code behind it (`failureReason` in `core.ts`), never an
error message or a URL. The contracts were deployed on 19 November 2026 and their
addresses and start blocks are in `src/lib/submission-fee.mjs`
(`contracts/DEPLOY-MAINNET.md`). Their resolver is this Worker's address,
`0xB3a6E36f23B74C870b56fE3CCE425a78a0a8f525`, and the Worker holds its key as
`SUBMISSION_FEE_RESOLVER_KEY`. In `dry_run` both networks are read and the key
is not loaded.

**Endpoints.** From Cloudflare both public endpoints refuse this Worker's
log reads: one record-only pass run as a preview on Cloudflare's network on
19 November 2026 reported `chain.events/LimitExceededRpcError:code--32005`
for Base and `chain.events/RpcRequestError:code-429` for Robinhood Chain.
The Worker therefore reads through two keyed endpoints, held as the secrets
`RPC_URL_SUBMISSION_FEE_BASE` and `RPC_URL_SUBMISSION_FEE_ROBINHOOD`. The
operator stored both on 19 November 2026 (a pay-as-you-go provider plan: free
plans cap a log read at 10 to 100 blocks, below this Worker's 2,000 and 9,000
block pages). With them, two record-only passes run as a preview on
Cloudflare's network read both chains cleanly. The release can also bind
them from the `PAYMENT_RPC_URLS` map when the Worker lacks one
(`scripts/release-submission-fee.ts`); on 19 November that map named
neither network. To replace one, store the secret again.

The default Base endpoint is `https://base-rpc.publicnode.com`:
`mainnet.base.org` refuses `eth_getLogs`. On 19 November 2026 a local
record-only run of this Worker read both real chains cleanly with it and
failed on Base with `mainnet.base.org`. The defaults are a fallback for a
run outside Cloudflare only.

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

## Report deposits

A private security report can need a refundable deposit of SLOP. The backend
(`backend/security/`) writes one row per report in `security_report_deposits`
(migration 0145), decides when the deposit is due back or kept, and holds the
report until the deposit is recorded. This Worker does the chain side only.

**The row.** `item` is `reportDepositItem(caseId)`
(`src/lib/security-report-deposit.mjs`), a different hash from any pull
request's. `mode` is `asked` or `recorded`. Only an `asked` row is a request
for a deposit. A `recorded` row was written by the backend's record-only mode
and asks for nothing: the Worker never reads it, never marks it paid, and a
deposit that names it is an unknown item like any other. The backend can turn
an unpaid `asked` row back into `recorded` when the deposit stops applying;
the write that marks a row paid checks the mode again, so such a row is not
marked paid even when the Worker read it a moment earlier.

**When a deposit pays a report** (`reportDepositCounts` in `report.ts`). All
of these:

- its `item` is the `item` of an `asked` row;
- the network is Robinhood Chain;
- the token is SLOP from the table in `src/lib/submission-fee.mjs`;
- `keptTo` is the burn address `0x000000000000000000000000000000000000dEaD`;
- the amount is at least the row's `slop_amount`, which the backend fixed
  when it asked;
- the report is not already paid by another deposit, and not already decided.

Anything else is refused and follows the rules above. Reasons specific to a
report: `report_wrong_network` (a deposit on Base), `report_token_not_slop`
(a stablecoin), `report_amount_invalid` (the row holds no usable amount). The
shared reasons keep their meaning: `wrong_kept_to`, `amount_below_due`,
`item_already_paid`, `item_already_decided`, `token_not_accepted`. A refused
deposit of an accepted token is refunded once it is finalized, never kept. A
deposit of a token outside the table is never resolved. A deposit that names
a `recorded` row, or a report with no row, waits 24 hours after it is
finalized and is then refunded as `unknown_item`.

**What the Worker writes on the row.** `paid_at`, `paid_network` and
`paid_deposit_id` when a deposit that counts has the network's confirmation
count on top of it, before finality, as for a pull request. It clears them
again when that unfinalized deposit is reorganised away or replaced and the
row has no outcome; the report then waits for a deposit again. After the
contract's finalized `Resolved` or `Reclaimed` event it writes `outcome`
`refunded` or `kept` and `outcome_at`, the block time of that event. A
reclaim by the payer is written as `refunded`. `outcome_reason` is the
backend's and is never changed here.

**What is sent** (`reportResolveAction` in `report.ts`). For a finalized,
accepted deposit: a refund when the row it paid says `refund_due`; "kept"
only when that row says `kept_due`, names this very deposit as the one that
paid, and the deposit itself is SLOP on Robinhood Chain whose `keptTo` is the
burn address. Nothing else produces "kept": not a `recorded` row, not a row
that names another deposit, not a refused deposit, whatever a row says.
Kept SLOP goes to the burn address in the same `resolveMany` call. Finality,
the confirmation count, the one send in flight, parking, batches of twenty
and the native-fee ceilings are the ones described on this page; a report's
deposit and a pull request's fee can share one transaction.

**In `submission_fee_deposits`.** A report's deposit is an ordinary row. Its
`repository_id` and `pull_number` stay null: an accepted row with both null
is a report's deposit, and the report's row names it by `paid_network` and
`paid_deposit_id`. No column was added.

**Without the table.** Where `security_report_deposits` does not exist yet,
every statement is the one it was before report deposits, and a deposit that
names a report is an unknown item.

**The log** names a paid report only by its deposit
(`submission_fee_report_paid`, network and deposit id), never by its case.

## Standing deposits

A contributor can post one standing deposit of SLOP instead of paying a fee
on every pull request (operator decision, 23 November 2026; PRD section 5,
"Standing deposit", and section 6, FEE-08). It is held in a second
deployment of the unchanged `SubmissionDeposits` contract on Robinhood
Chain, with a 365-day reclaim delay. The website writes one row per account
and round in `standing_deposits` (migration 0149), Slopbot decides when the
deposit is due back or kept, and this Worker does the chain side only.

**A ledger of its own.** The second contract is read as the ledger
`robinhood-standing` (`STANDING_DEPOSIT_LEDGER` in
`src/lib/standing-deposit.mjs`). Its deposit, cursor, send and parked rows
are keyed by that name, so its deposit ids never meet the fee contract's.
Its token, burn address, chain id, confirmation count, log page and RPC
endpoint are Robinhood Chain's (`chain: "robinhood-mainnet"` in its
configuration). The ledger exists only once `STANDING_DEPOSIT_CONTRACT` and
`STANDING_DEPOSIT_START_BLOCK` are recorded; while they are null nothing is
read and nothing is reported for it. The standing contract may not be one of
the fee contracts.

**When a deposit pays a standing row** (`standingDepositCounts` in
`standing.ts`). All of these:

- its `item` is the `item` of a row in `standing_deposits`
  (`standingDepositItem(githubId, round)`);
- it is on the standing ledger, never the fee contract;
- the token is SLOP from the Robinhood Chain table;
- `keptTo` is the burn address;
- the row was not withdrawn before payment (`cancelled_at` is null);
- the amount is at least the row's `slop_amount`;
- the row is not already paid by another deposit, and not already decided.

Reasons specific to it: `standing_wrong_ledger`, `standing_token_not_slop`,
`standing_cancelled`, `standing_amount_invalid`. The shared reasons keep
their meaning. A refused deposit of an accepted token is sent back once it is
finalized, never kept. A deposit of a token outside the table is never
resolved. A deposit whose item no row has waits 24 hours after it is
finalized and is then sent back as `unknown_item`. A deposit on either fee
ledger never pays a standing row, and a standing deposit never pays a pull
request or a report.

**What the Worker writes on the row.** `paid_at`, `paid_network`
(`robinhood-standing`) and `paid_deposit_id` once the deposit has the
confirmation count on top of it, only if no other deposit paid the row and it
was not withdrawn. It clears them when that unfinalized deposit is
reorganised away or replaced and the row has no outcome. After the
contract's finalized `Resolved` or `Reclaimed` event it writes `outcome`
`refunded` or `kept` and `outcome_at`. `outcome_reason` and the strike
columns are Slopbot's and are never changed here.

**What is sent** (`standingResolveAction`). For a finalized, accepted
deposit: sent back when the row it paid says `refund_due`; kept, to the burn
address, only when that row says `kept_due`, names this very deposit as the
one that paid, and the deposit is SLOP on the standing ledger kept to the
burn address. Nothing else keeps a standing deposit.

**One key, one nonce.** The standing ledger and the Robinhood Chain fee
ledger sign with the same resolver key, so they share its nonce. Neither
signs while the other has a send in flight: the run reports
`sibling_in_flight` and waits, which is not an error, and the insert of a
live send repeats the check so two runs can never both hold a signed nonce.
The day's native-fee ceiling counts the sends of both ledgers, since one key
pays for them. On Base nothing changes.

**The log** names a paid standing row only by its deposit
(`submission_fee_standing_paid`, ledger and deposit id), never by its
account.

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

## Solana

Operator decision, 25 November 2026 (PRD section 6, "Submission fee
deposits", "Solana, off chain"). The fee can also be paid in USDC on Solana,
into the `slop-submission-deposits` program
(`contracts/solana/README.md`, "Submission deposits"). The program was
deployed on Solana mainnet on 26 November 2026 and its upgrade authority
removed (`contracts/DEPLOY-MAINNET.md`, "Submission fee deposit program on
Solana"). Its id, `4St4KPBhaHZw29gEaqstU9TzYHRfXLq7aat932r1uzW7`, and the slot of its
`initialize` transaction, 474211652, are in `src/lib/submission-fee.mjs`.
The fee is switched on for Solana since 26 November 2026 (operator
decision): the mode below is `live` and `SUBMISSION_FEE_SOLANA_SWITCHED_ON`
is true. The endpoint secret `RPC_URL_SUBMISSION_FEE_SOLANA` and the resolver
secret `SUBMISSION_FEE_SOLANA_RESOLVER_SEED` are set on the Worker, and a
record-only pass against mainnet from Cloudflare read the program without
error on 26 November 2026. A kept (not refunded) deposit and a real pull
request payment have not yet been exercised on mainnet. SLOP stays payable
on Robinhood Chain only.

The Solana ledger's own configuration is read apart from the EVM ledgers'
(operator decision, 26 November 2026): when its mode is `dry_run` or `live`
and its endpoint or a lamport limit is missing or malformed, the run reports
`solana-mainnet` as a failed network (reason `config.solana/TypeError`) and
Base and Robinhood Chain still run.

The Solana ledger is `solana-mainnet`. It has its own switch,
`SUBMISSION_FEE_SOLANA_MODE` (`off`, `dry_run`, `live`), with the meanings of
the table under "Modes", independent of `SUBMISSION_FEE_MODE`. It is
`live`. `live` changes only together with `SUBMISSION_FEE_SOLANA_SWITCHED_ON`
in `src/lib/submission-fee.mjs`, which is what makes the pay page, Slopbot's
comment and the public reads list Solana; the release refuses one without
the other, and refuses a mode other than `off` unless the Worker's secret
names include the endpoint and, for `live`, the seed
(`scripts/release-submission-fee.ts`). The release reads names only and does
not bind either Solana secret; both are installed by hand.

What differs from the EVM ledgers (`solana-core.ts`, `solana.ts`,
`contracts/solana/submission-deposits.ts`):

- **Reads.** There is no event log. An open deposit is an account of the
  program, closed on its outcome. Each run reads the program's `Config` and
  then lists the open `Deposit` accounts with `getProgramAccounts` at a slot
  not before the `Config` read, all at `finalized` commitment. The endpoint
  filters the list: the record's size (169 bytes), its first eight bytes,
  the table's mint at byte 56 and the fee wallet as kept wallet at byte 88.
  Only the eight bytes of each record's id are returned. A deposit of
  another mint, or with another kept wallet, is therefore never fetched or
  recorded; its payer reclaims it from the program. The full records of the
  new ids are then read together, up to 100 in a run. A pull request is
  marked paid only by a finalized deposit; there is no earlier confirmed
  step. The cluster is authenticated by its genesis hash first.
- **Keys.** A deposit is keyed by the id the program stored in its record.
  The record's address follows from the payer and a nonce the payer picked,
  and the same payer and nonce can be used again after a settlement, so an
  address is never a key. The address is kept beside the row
  (`deposit_account`, migration 0155). The cursor row holds the next deposit
  id, not a block.
- **Nothing depends on an address's history.** Anyone can send a
  transaction that merely names an address for the base fee, so the Worker
  never needs the whole list of an address's transactions:
  - A deposit is recorded from its record alone: `block_time` is the cluster
    time the program stored, `block_number` the finalized slot the record
    was read at. For a deposit that names a pull request or report Slop
    asked a fee for (25 in a run), one page of the address's signatures is
    read and up to two transactions whose block time is the record's own; a
    successful `deposit` there whose payer, mint, item, amount, kept wallet
    and nonce are the record's is stored as `tx_hash`. Otherwise `tx_hash`
    is the record's address. Recording never waits on it.
  - A settlement the Worker sent itself is proven from that transaction,
    whose signature is in the send's row. The send in flight is reconciled
    before the scan, so this happens in the run that finds it finalized.
  - Any other settlement (the payer's own reclaim) is searched for only
    between the slot the record was last known open at and the slot it was
    first seen gone at (`submission_fee_solana_settlements`). Transactions
    after the second slot, and failed ones, are passed over without being
    read. A run reads at most 6 pages of signatures and 20 transactions for
    all searches together and stores where it stopped (`before_tx`,
    `candidate_tx`); the next run continues there. The oldest settlement in
    that span is the deposit's.
- **Settlement proof.** From the executed instructions of the finalized
  transaction, never from its logs. A refund or kept fee is recorded only
  when the transaction shows the program's own transfer of the exact amount
  of the deposit's mint into an account the right wallet owns, which rose by
  at least that amount.
- **One deposit never stops another.** Each outcome is its own write. A
  deposit that cannot be read, proven or sent is logged
  (`submission_fee_solana_set_aside`, with `read_failed`, `proof_failed`,
  `request_limit`, `not_found` or `record_differs`, never provider text),
  kept with that word where it has a row to keep it in, and tried again
  later. Every step of a run (reconcile, list, scan, judge, recheck, plan,
  send) runs by itself: one that fails is named in the result's `steps` and
  the run ends with `error`, after the other steps ran. A failed listing
  does not stop what is already due from being sent.
- **Deposits the Worker never resolves.** A recorded deposit whose amount is
  below its pull request's fee (`amount_below_due`, `item_fee_invalid`), like
  one of another mint or kept wallet, is final for the Worker: it leaves
  what is tracked and planned and is not read again. Its payer reclaims it
  after 30 days. This differs from the EVM ledgers, where such a deposit of
  an accepted token is refunded. A deposit of the right amount that paid for
  nothing (an unknown item after a day, a pull request already paid) is
  still refunded as a courtesy, after every deposit that paid a pull
  request, and only while less than half of the day's lamport limit is
  spent (`submission_fee_solana_courtesy_refunds_wait`).
- **Addresses** are base58 and compared exactly. USDC is the only accepted
  mint.
- **Sending.** One transaction carries up to five `resolve` instructions,
  each naming the id the Worker recorded, and is all or nothing. A planned
  or in-flight deposit's record address is always found, by id, however many
  deposits are recorded. Right before it builds the instructions the Worker
  reads the records again together at finalized commitment and builds from
  them; it builds nothing when a record is gone or holds another id, never
  for another mint, and a kept fee only to the fee wallet of the table.
  Before a refund it checks that the payer's associated USDC account exists,
  is of that mint, is still the payer's and is not frozen (the same for the
  fee wallet's before a kept fee); otherwise the deposit is parked as under
  "A payout the token refuses" and looked at again a day later. The Worker
  never creates a token account. Those destination accounts and the
  simulation are read at `confirmed` commitment, about a second old, not
  `finalized`; nothing is recorded from them.
- **A send that landed and failed** (operator decision, 26 November 2026).
  A payer can still close their token account between the simulation and
  the block, and the whole transaction then fails on chain with reason
  `resolve transaction failed`. Every deposit of such a send is from then on
  sent in a transaction of its own, the first in line each run, so it cannot
  fail another deposit's refund again. A deposit whose own single send
  landed and failed is parked (`submission_fee_parked`, reason
  `reverted_alone`) before the send is marked failed, looked at again a day
  later like every parked deposit, and from then on sent after every other
  deposit and only while less than half of the day's lamport limit is spent
  (`submission_fee_solana_failed_alone_waits`). Deposits that were in no
  failed send still go five to a transaction. One send is in flight at a
  time and a run starts at most one, so sending singly never raises the
  number of transactions a day (at most 288, one per run); a failed send
  pays its network fee and counts in the day's lamports.
- **The journal.** Sends are in `submission_fee_solana_sends`. The signed
  bytes are recorded before the broadcast and resent unchanged while their
  blockhash can still land. A send is failed only when the finalized chain
  is past its last valid block height and a node that has itself seen that
  finalized slot does not know its signature; the slot and height come from
  one answer (`getEpochInfo`), and a node behind it leaves the send in
  flight. Its deposits are then sent again in a new transaction. Such a
  send paid no fee and is not counted in the day's lamports.
- **Requests.** One run makes at most 300 requests to the Solana endpoint
  (`SOLANA_REQUESTS_PER_RUN`): the client counts every request and refuses
  the one after the last before it is sent. The steps' own limits add up to
  230 (`SOLANA_STEP_REQUESTS` in `solana-core.ts`, with the count for each
  step). The result reports `requests`, and `open`, the number of listed
  records; 1,000 or more is also logged (`submission_fee_solana_open_high`).
  The listing itself is one request whose answer grows by about 150 bytes
  for each open record of the table's mint and fee wallet; the endpoint
  offers no way to page it.
- **Limits and secrets.** `SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_TX` and
  `SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_DAY` bound the network fee. The
  secrets are `RPC_URL_SUBMISSION_FEE_SOLANA`, a keyed https endpoint that
  serves finalized reads, `getProgramAccounts` with filters and a data
  slice, `getMultipleAccounts`, `getSignaturesForAddress`, `getTransaction`
  and `getEpochInfo` (there is no public default), and for `live`
  `SUBMISSION_FEE_SOLANA_RESOLVER_SEED`, the resolver's 32-byte ed25519 seed
  as 64 hex digits. The resolver key pays only the network fee; a deposit's
  rent (2,067,120 lamports, the rent-exempt minimum of its 169 bytes)
  returns to its payer. A key that is not the program's resolver signs
  nothing (`submission_fee_solana_resolver_differs`).
- **Kept fees** are fee income of the Solana fee wallet under the same rule
  as below, by exact address.

The pay page's route, `POST /api/v1/submission-fee/solana`
(`backend/submission-fee/solana-pay.ts`), reads the Pages payment endpoint,
not this Worker's. It counts requests before reading anything: 20 a minute
from one address, 30 a minute for one pull request, 120 a minute in all,
and at most six reads a request. A payer's reclaim there needs no row of
this Worker: the wallet's open deposits for the pull request are found on
chain by payer and item.

Switching Solana on, each step the operator's and each its own reviewed
change. Done on 26 November 2026: the program is deployed and initialized
with its resolver `CuAMc2TYgLdzXRHEWSikzvdQQhWLyUBRbnGizQE2Xsxv`, its USDC
vault is open, its upgrade authority is removed
(`docs/submission-deposits-solana-deploy-runbook.md`), and the program id
and the slot of `initialize` are in the tables; the endpoint secret and the
resolver's seed are installed; a record-only pass against mainnet from
Cloudflare read the program without error; and the mode is `live` together
with `SUBMISSION_FEE_SOLANA_SWITCHED_ON`. Keep a little SOL on the
resolver's address for its network fees. Not yet exercised on mainnet: a
kept (not refunded) deposit and a real pull request payment.

The pay route runs in Pages, not here. In production it needs the Pages
secret `PAYMENT_RPC_URLS` to be a JSON object whose `solana-mainnet` key is
an https endpoint (`paymentRpcUrl` in `functions/api/v1/[[path]].ts`), and
the Pages secret `TRACE_AUTH_SECRET` of 32 or more characters for its
request counters. Without the endpoint the route answers 404 while the page
still lists Solana; without the counter secret it answers 503.

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
income. Refunds and reclaims are not income. A report's deposit is accepted
only when its `keptTo` is the burn address, so a kept one can never match a
fee wallet and is never income.

## Going live (steps 1 to 4 done 19 November 2026, step 5 on 21 November 2026; each step is the operator's)

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
4. Done. The mode was `dry_run` from 19 to 21 November 2026. Every scheduled
   run after the first hour succeeded; no deposit and no fee row was recorded,
   because no project had the setting on.
5. Done 21 November 2026 (operator decision). The mode is `live`, changed in
   one reviewed change together with Slopbot's mode and
   `SUBMISSION_FEE_SWITCHED_ON`. The release refuses `live` unless both
   contracts and start blocks are set and the Worker holds the key.

## Checks

```sh
bun test ./src/lib/submission-fee.test.ts ./workers/submission-fee \
  ./backend/submission-fee ./workers/fee-converter/submission-fee-income.test.ts \
  ./contracts/solana/submission-deposits.test.ts
bun run test:submission-fee:anvil
```

The Solana ledger's tests (`solana.test.ts`) run the real reader, resolver
and store against `fixtures/solana-fake.ts`, a small cluster that behaves like the
deposit program over JSON-RPC.

The second command deploys the compiled contract and a test token to a local
Anvil chain and runs the Worker against it. On Robinhood Chain (the local
chain's label) it also pays two reports' SLOP deposits beside a pull
request's fee and checks on the chain that one is back with its payer and
the other is at the burn address. With `SLOP_FEE_FORK_BASE` and
`SLOP_FEE_FORK_ROBINHOOD` set to RPC URLs it runs on private forks of both
chains with the real tokens, fee wallet, burn address and price pool.
