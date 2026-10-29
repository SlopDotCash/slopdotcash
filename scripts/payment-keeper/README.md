# Project-operated payment keeper

PRD section 6 requires a project-operated or permissionless executor. This
command reads the public D1 registry and signed monthly authorizations. It
submits monthly commitments and pays funded awards through the contract's
current wallet binding. It has no Slop account database, owner key, identity
key, fee key, or upgrade role. It does not approve an award or select a wallet.

Run one instance for one network and one dedicated gas signer. The operator
supplies the machine or scheduler, RPC, persistent journal, signer and native
spending budget. Slop does not host this key. Install the pinned repository
runtime and dependencies. Use the reviewed source and contracts for the
network. A network with `mainnet-execution.mjs` set to false remains unavailable.
This command does not activate a network or deploy a contract.

Create a private JSON configuration with these fields:

| Field | Value |
| --- | --- |
| `apiOrigin` | The current Slop registry API origin, normally `https://api.slop.cash`. |
| `network` | One network name from `ESCROW_NETWORKS`. |
| `projectIds` | The project IDs this operator serves. Deployments come only from D1. |
| `signer` | The dedicated operator gas wallet's public address. |
| `rpcUrl` | That network's RPC URL. |
| `perRun` | Maximum funded-award checks per vault and examined EVM monthly leaves per period in one run. |
| `gas.perTransaction` | Operator-approved native reservation per transaction. |
| `gas.perDay` | Operator-approved native base units per UTC day, including unknown sends. |
| `gas.additionalFeeReserve` | Base L1-data and operator-fee allowance per transaction; zero on other supported rails. |
| `monthlySchedule` | Optional. The deployment's `MONTHLY_PAYMENT_SCHEDULE` object. Omitted, the keeper serves the PRD schedule from 2026-11. |

There is no default spending budget. EVM execution keeps the existing reviewed
network gas ceiling and 10-gwei fee-price ceiling. Base also reserves the
operator's additional-fee allowance. Before signing it compares that allowance
with `getL1FeeUpperBound(unsignedSize)` plus `getOperatorFee(gasLimit)` at one
current block of the canonical Base oracle. An unavailable or larger quote
refuses signing. Final native costs include `gasUsed * effectiveGasPrice`,
the receipt's `l1Fee`, and `getOperatorFee(gasUsed)` at that canonical receipt
block. The oracle selects the active fork formula; a zero operator fee today
is not assumed to stay zero. The transaction's gas fields cap L2 execution, but do not cap a
future Base L1 charge. These are admission and accounting limits, not a promise
of a protocol-enforced total maximum. See the [Base fee documentation](https://docs.base.org/specifications/transactions/network-fees)
and [OP Stack fee oracle specification](https://specs.optimism.io/protocol/fjord/predeploys.html),
including the [Jovian operator-fee rule](https://specs.optimism.io/protocol/jovian/exec-engine.html#operator-fee). Solana reserves the quoted
signature fee and rent for missing writable accounts, using the largest account
created by the reviewed builders. It sends no priority-fee instruction. Rent
is part of this native spending budget. A final receipt that exceeds its reserve
stops further signing unless the operator's current per-transaction budget
covers that exact charge. The current daily budget must also cover recorded
costs and the next reservation. An approved budget increase can resume work;
it never deletes or changes the old reservation or receipt.

Start without a key or `--execute`:

```sh
bun run payments:keep --config /private/operator.json --journal /private/keeper.sqlite
```

Public reads send the website Origin from the existing deployment configuration.
The production registry uses its API host; public monthly authorization reads
use the website host required by the payment API. Both hosts come from the
existing deployment configuration. This does not authenticate an account or
grant access to a private route.

The dry run reads the registry, verifies deployed code and chain identity,
indexes finalized evidence in the local journal, and reports funded awards and
published authorizations. It sends nothing. A published authorization is not a
successful execution simulation. `ready` describes a funded award's binding;
transaction estimation can still refuse it.

For execution, the operator provides `KEEPER_EVM_PRIVATE_KEY` (0x-prefixed) or
`KEEPER_SOLANA_SIGNER_SEED` (32 bytes in lowercase hex) to this process only, then
adds `--execute`. The key is read only when a reviewed operation reaches signing.
The configured address must match it. Use a private environment supplied by the
operator's service manager; never put a key in the configuration, command line,
repository, report or issue. Run the command on the operator's scheduler. Each
invocation ends after its bounded work and reports unavailable or waiting work.

Keep the journal on a persistent private volume. Do not reuse the signer in
another process or start it with a new journal. The database binds the registry,
network and public signer. A second process with the same journal fails its
SQLite process lock. The operating system releases that lock after a crash.
Signed bytes, nonce allocation and gas reservations commit together before a
broadcast. An uncertain response keeps its gas reserve, even after midnight. Final expenses count on the canonical receipt block's UTC day, including a send signed the day before.
For a Solana send with no receipt, the keeper retains the signed bytes and
unknown actual charge. After finalized block-height expiry and an absent
signature status, it records the observation and charges the full reservation
on that observation day. Future days can then proceed. A later exact receipt
reconciles its actual cost without deleting the earlier conservative record.
This is budget accounting, not proof that the transaction never landed.
Retry reads the same journal. Never delete it to retry a payment.

An EVM send can stay pending because its max fee is below the network fee. The
keeper then replaces it automatically, in bounded steps (owner decision,
25 October 2026):

- It waits 10 minutes after it first finds the send unmined, and 10 minutes
  after each replacement. Before that, it only broadcasts the latest signed bytes.
- It replaces a send only when the latest block's base fee is more than the
  send's max fee. A lower effective priority fee alone does not block mining
  and does not trigger replacement.
- A replacement uses the same nonce, recipient, value, calldata and gas limit.
  Each step increases the max fee and the priority fee by 25%. The total
  limit is three times the original fees and the existing 10-gwei ceiling. Each
  step must also be at least 10% more than the previous attempt. At the limit,
  the keeper stops signing and reports
  `waiting`. It continues to broadcast the last attempt.
- The keeper reserves the replacement's worst-case cost in the same journal
  transaction as its signed bytes. The current per-transaction and daily budgets
  must cover it. If they do not, the keeper does not sign and reports `waiting`.
  Only one attempt for a nonce can land, so the daily budget counts the largest
  reservation of the nonce's unresolved attempts one time.
- The journal keeps the original and every replacement unchanged. Any one of them
  can land. The finalized receipt for that nonce records the actual cost. The
  same journal transaction sets the other reservations of that nonce to zero
  and records which receipt released them. The payment is recorded only from
  the finalized payment event, so it is recorded one time.
- A restart continues from the journal. The keeper does not sign a new nonce for
  the same work while an attempt for the old nonce is unresolved. The fee limit
  comes from the original signed bytes, so repeated runs cannot go above it.
- The budget signer accepts a second signature at a reserved nonce only when
  it names that nonce's journaled original. Any other second signature fails.
- If the registry gas ceiling falls below the journaled gas limit, or the fee
  read fails, the keeper signs nothing new. It rebroadcasts the latest verified
  attempt and reports `waiting` with the reason.
- A dry run signs nothing.

Hosted executors do not use this replacement.

The keeper uses the existing finalized scanner and exact amount, token, fee and
destination verifiers. A successful send is `submitted`, not paid. Only a
verified finalized payment receipt updates its local payment index; Slop's
independent scanner updates the site. A walletless or blocked award waits while
other awards continue. If the owner cancels a binding after the keeper signed
that award's payment, the keeper still sends the signed bytes. They revert, but
their nonce no longer holds the keeper's later sends. Project restrictions and opt-out prevent new monthly
admission. Already funded awards and admitted EVM V2 or Solana months can still finish.
Private bounty vaults stay separate and use their 75/25 payout policy; the
keeper does not submit a discretionary bounty award.

EVM V2 admits the whole funded month, then commits its awards in bounded calls.
The keeper retains every signed publication. Before admission, it can select a
later source sequence for the same frozen allocation. It preserves the original
legacy signature and reconciles any uncertain transaction before a successor
send. Once admitted, the chain selects the root to finish. The existing gas
ceiling still applies; large legacy calls need a reviewed V2 deployment.

For an operator-owned Cloudflare Cron deployment, use the
[Durable Object adapter](../../workers/operator-keeper/README.md). It runs this
same keeper with durable SQLite storage. The template is off. Do not run both
hosts with the same gas wallet.
