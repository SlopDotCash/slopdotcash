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
| `perRun` | Maximum funded-award checks per vault in one run. |
| `gas.perTransaction` | Operator-approved native reservation per transaction. |
| `gas.perDay` | Operator-approved native base units per UTC day, including unknown sends. |
| `gas.additionalFeeReserve` | Base L1-data and operator-fee allowance per transaction; zero on other supported rails. |

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

The keeper uses the existing finalized scanner and exact amount, token, fee and
destination verifiers. A successful send is `submitted`, not paid. Only a
verified finalized payment receipt updates its local payment index; Slop's
independent scanner updates the site. A walletless or blocked award waits while
other awards continue. Project restrictions and opt-out prevent new monthly
admission. Already funded awards and admitted Solana months can still finish.
Private bounty vaults stay separate and use their 75/25 payout policy; the
keeper does not submit a discretionary bounty award.

The EVM monthly scalability gap remains open in #902 and #904. At the current
500,000-gas mainnet ceiling, three new ordinary awards exceed the padded limit.
This command preserves that refusal. It does not raise the limit, split the
current atomic contract call, or claim that large months are launch-ready.
