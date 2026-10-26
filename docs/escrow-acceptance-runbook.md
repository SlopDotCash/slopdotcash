# Escrow acceptance runbook (PRD section 21)

This runbook runs the PRD section 21 funded-award scenario on one test
network and writes a machine-readable evidence file. A human or owner-authorized
agent runs the reviewed plan with funded test keys under PRD section 11. Keep
credentials private. Test assets are not real funds, and a test run is not
mainnet evidence.

Networks: `base-sepolia`, `ethereum-sepolia`, `robinhood-testnet`,
`solana-devnet`. The runner refuses the Base, Ethereum and Robinhood Chain
mainnet chain ids (8453, 1, 4663) and the Solana mainnet genesis hash before
any key signs.

## What one run does

For each asset in `ESCROW_ACCEPTANCE_ASSETS`, in a new vault:

1. The owner deposits 900 units and a third party deposits 100 units.
2. The owner commits 100 units for a registered actor and 50 units for a
   walletless actor. A simulated withdrawal of 851 units must fail.
3. The first actor registers a payout wallet through the account API
   (`handlePaymentsApi`) and signs the binding. The payments worker cron
   (`workers/payments/index.ts`) indexes the finalized reserve and dispatches.
   The identity attester binds and the relayer pays 98 + 2.
4. Only then the second actor registers. The cron pays 49 + 1.
5. Replay: `dispatchPayment` again for both awards, the executor again with the
   same attempt, the same signed payment bytes again, and one new mined
   payment transaction. No replay moves tokens.
6. The owner withdraws the 850 free units. The fee must be
   `ceil(gross / 50)` (2%), and only the rest reaches the owner. A simulated
   withdrawal of 1 more unit must fail. On EVM, anyone then claims the fees.
7. After finality, the cron writes `vault_snapshots`. The runner compares that
   row with a fresh finalized `readVaultTotals` read, with the scenario
   figures, with the vault token balance, and with the ledger.
8. The runner then reads the two public API responses that the site uses,
   through the production handler (`backend/payments/handler.ts`):
   `GET /api/v1/payments/projects/<id>/vault` (the vault totals panel) and
   `GET /api/v1/payments/projects/<id>/totals` (the indexed award totals).
   Each counter must equal the finalized chain counter. The panel's
   "Reserved for committed awards" figure (`reservedGross`) must equal the
   chain reserve. A counter that the vault type does not have must stay
   `null`, not `"0"`. A project that the cron never indexed must be
   unavailable: `/totals` returns HTTP 503 `project_payments_not_indexed`
   and `/vault` returns an empty snapshot list. Zero totals for missing data
   fail the run. The evidence keeps these results under
   `reconciliation.publicApi`.

The executor and attester are the production code (`PaymentSignerJournal` with
test keys). The backend is a SQLite file with every D1 migration, kept beside
the evidence.

At least one asset must have other than six decimals. An asset that is not
the network reference stablecoin (test USDC, or Paxos test USDG on Robinhood
Chain Testnet) is allowed, but the evidence records a deviation and the run is
not stablecoin evidence.

## Prerequisites

EVM networks:

- An `EscrowFactory` from `contracts/evm/script/Deploy<Network>.s.sol`
  (`DeployBaseSepolia`, `DeployEthereumSepolia`, `DeployRobinhoodTestnet`).
  The registrar and the identity authority are test keys that you hold. See
  [Robinhood Chain Testnet escrow runbook](robinhood-chain-testnet-runbook.md)
  sections 4 and 5 for the deployment and its checks.
- A token with other than six decimals, for example
  `forge create test/WideToken.sol:WideToken --constructor-args 18` from
  `contracts/evm`. Record its address.
- Gas on the registrar, owner, depositor, identity and relayer keys. The
  actor keys need no gas.
- 900 units of each asset on the owner and 100 units on the depositor.
- An RPC URL that serves account state at the `finalized` tag. The public
  Robinhood Chain Testnet RPC does not (see
  [testnet funding](testnet-funding.md)); use an archive RPC there.
- The relayer refuses a fee above 10 gwei (`workers/payment-executor/core.ts`).

Solana devnet:

- The program deployed with `contracts/solana/scripts/deploy-testnet.sh`. Keep
  its `deployed_code_sha256` and the upgrade authority.
- The program Config, written once by the upgrade authority
  (`contracts/solana/scripts/config-plan.mjs`). Its identity authority must be
  your identity test key.
- `npm ci --ignore-scripts --legacy-peer-deps` in `contracts/solana`.
- SOL on the owner, depositor, identity and relayer keys; 900 units of each
  mint in the owner's associated token account and 100 in the depositor's.

## Environment

Never put a key in a command line, a file in the repository, or the evidence.
Load keys from a secret store into the environment of one shell.

| Variable | Networks | Value |
| --- | --- | --- |
| `ESCROW_ACCEPTANCE_RPC_URL` | all | RPC URL. The evidence keeps only its host. |
| `ESCROW_ACCEPTANCE_ASSETS` | all | Comma list of token addresses or mints. |
| `ESCROW_ACCEPTANCE_OWNER_KEY` | all | Project owner and refund destination. |
| `ESCROW_ACCEPTANCE_DEPOSITOR_KEY` | all | Third-party depositor. |
| `ESCROW_ACCEPTANCE_IDENTITY_KEY` | all | Identity authority (attester). |
| `ESCROW_ACCEPTANCE_RELAYER_KEY` | all | Gas payer for payments. |
| `ESCROW_ACCEPTANCE_ACTOR_A_KEY` | all | Registered actor's wallet. |
| `ESCROW_ACCEPTANCE_ACTOR_B_KEY` | all | Walletless actor's wallet. |
| `ESCROW_ACCEPTANCE_REGISTRAR_KEY` | EVM | Factory registrar. |
| `ESCROW_ACCEPTANCE_FACTORY` | EVM | Factory address. |
| `ESCROW_ACCEPTANCE_FACTORY_CODE_SHA256` | EVM, optional | Reviewed runtime digest; the run stops on a mismatch. |
| `ESCROW_ACCEPTANCE_PROGRAM_ID` | Solana | Program id. |
| `ESCROW_ACCEPTANCE_PROGRAM_CODE_SHA256` | Solana | `deployed_code_sha256`. |
| `ESCROW_ACCEPTANCE_PROGRAM_UPGRADE_AUTHORITY` | Solana | Upgrade authority, or `none`. |
| `ESCROW_ACCEPTANCE_BINDING_DELAY_SECONDS` | Solana, optional | Default 3600. |
| `ESCROW_ACCEPTANCE_ROTATION_DELAY_SECONDS` | Solana, optional | Default 7200. Must be shorter than four binding delays, as the project registry requires. |
| `ESCROW_ACCEPTANCE_UNIT_DIVISOR` | optional | Power of ten. Scales every figure down when a faucet cannot supply 1,000 units. The evidence records a deviation. |
| `ESCROW_ACCEPTANCE_MAX_WAIT_SECONDS` | optional | Time to wait in one run. Default 600. |
| `ESCROW_ACCEPTANCE_POLL_SECONDS` | optional | Default 15. |

EVM keys are `0x`-prefixed 32-byte hex. Solana keys are 64-character
lowercase hex Ed25519 seeds. Every role needs its own key.

## Run

```sh
bun run escrow:acceptance base-sepolia evidence/escrow-acceptance/base-sepolia
```

Add `--suite extended` for the #902 scenarios (see [Extended suite](#extended-suite-issue-902)).

Exit code 0 means every asset passed. Exit code 75 means the run waits for a
binding delay (48 hours on EVM factories from the deploy scripts) or for
finality; the evidence file states the reason and, when known, the time. Run
the same command again later to continue. The runner saves each signed
transaction before it broadcasts it, so a rerun never signs a second
transaction for the same step. Exit code 1 means the run failed; the
evidence file lists the error.

Resume with the exact source commit recorded in the evidence. A different
source must use a new evidence directory. Keep the prior directory and its
results. This check runs before a transaction is signed or sent.

Attach `evidence.json` to the issue. Do not commit it: `evidence/` is ignored.
The directory also holds `projection.sqlite`, the signer journals, and
`registry.sqlite`. The journals contain signed transactions but no key.
`registry.sqlite` is the project registry that the payments Worker reads as
`REGISTRY_DB`: each vault is one paused test project whose manifest records
that vault as its escrow deployment.

## Evidence file

`evidence.json` (`slop-escrow-acceptance:v1`) records the network, the mode
(`public-testnet` or `local`), the RPC host, the chain id or genesis hash, the
source commit, every role address, and for each asset: the vault, every
transaction with status and block, the deposit events, the award ids, the
payment and fee movements, the replay results, the withdrawal fee, the
`vault_snapshots` row, the finalized chain totals, the ledger totals, and the
list of mismatches (empty on success).

## Extended suite (issue #902)

```sh
bun run escrow:acceptance base-sepolia evidence/escrow-acceptance-extended/base-sepolia --suite extended
```

The extended suite runs the #902 scenarios that section 21 does not cover.
It uses the same role keys and the same reviewed factory or program, with its
own evidence directory. Each scenario creates its own vault (EVM) or project
(Solana) for the owner key.

| Scenario | What the run proves |
| --- | --- |
| `bounty` | In a bounty vault, a 100-unit private award pays 75 to the researcher and 25 to the fee recipient, in exact base units, with no other fee. An ordinary award and an amount that is not divisible by four are refused. Nothing is left to withdraw. |
| `walletless-lifecycle` | An award without a wallet cannot pay. A wallet signature for another network or another vault is refused. A replacement wallet activates at once, a stale version cannot bind or pay, and the owner cannot cancel at the deployed zero binding delay. A recovered wallet is paid in the next transaction; the earlier wallets get nothing. With a review-window deployment, the owner cancels (EVM) or vetoes (Solana) a binding, the cancelled version cannot pay, and a new version is paid. |
| `monthly` | Monthly commitment is off at vault creation. A zero cap is refused. Only the open period is accepted (the 72-hour cutoff). An allocation changed after signing, a total over the owner's cap, and an opted-out vault are refused. The owner commits and pays one award by hand first. Then the project-operated keeper reserves and commits the allocation through V2 (`keeper-v2`), or the production executor submits the legacy commitment (`/v1/commit-monthly`, `executor-v1`); see below. The manual award is counted once (EVM) or released (Solana), a changed manual award fails closed, a second commitment is refused, and no award is paid twice. |
| `interrupted-send` | The production payments Worker cron pays through the production executor. A loopback fault proxy forwards the first payment broadcast to the node, discards the answer, and fails the next status lookup. The signer instances restart. The cron recovers the journaled attempt: one attempt, one transaction, one payment. |
| `failed-recipient` | One of three recipients rejects the token (blocked on EVM, frozen token account on Solana). The other two are paid in the same cron run. The failed award stays reserved and is paid with the same attempt after the block ends. |
| `frozen-fee-destination` | While the fee recipient rejects the token, the fee claim fails, a mined claim reverts, and a waiting payout still pays. After the block ends, one claim moves every accrued fee. |
| `key-recovery` | The identity authority key is replaced, as the key recovery runbook in `contracts/evm/README.md` prescribes. EVM: the registrar proposes the recovery key on the factory and anyone executes the rotation. Solana: the owner proposes the recovery key for the project, the Config rotation authority confirms it, and anyone executes it. Then the old key cannot bind (`Unauthorized` on EVM, `ConstraintHasOne` on Solana), a binding made before the rotation still pays, and the recovery key binds a new wallet that is paid. On EVM the registrar then rotates the factory back to the configured identity authority. |

The `monthly` scenario has two paths. The run selects the path from the vault
logic that the factory creates (`monthlyReserveVersion()` of
`vaultImplementation()`) and records it as `checks.monthlyPath`:

- `keeper-v2`: the factory has the V2 monthly reserve (#1170, after the
  upgrade in [Factory upgrade qualification](#factory-upgrade-qualification-evm)).
  The identity test key signs the reservation that
  `prepareEvmMonthlyReservation` returns, and the run publishes it in the
  payments database. The project-operated keeper (`scripts/payment-keeper`,
  `runKeeper`) reads it through the unchanged public registry and payment
  routes. The keeper sends `reserveMonthly`, then one `commitMonthlyLeaf` per
  unfunded award, and pays each award after its wallet is bound. The relayer
  key is the keeper's gas signer; it has no vault role. The manual award stays
  out of the reserve. A keeper rerun signs nothing, and a second
  `reserveMonthly`, `commitMonthly` or leaf is refused. The keeper serves the
  PRD schedule, from period 2026-11, unless
  `ESCROW_ACCEPTANCE_MONTHLY_SCHEDULE` names the deployment's
  `MONTHLY_PAYMENT_SCHEDULE` with an earlier first period. Without it, a
  public test network run waits, with no transaction, until the 2026-11
  window opens at 2026-12-04T00:00Z. With it, the run commits the period
  whose contract window is open now and records a deviation: that is
  prelaunch automation qualification, not the 2026-12-04 calendar
  observation. The keeper's gas budget is the network's
  reviewed gas ceiling at 10 gwei per transaction and 40 such transactions
  per day.
- `executor-v1`: the factory has no V2 reserve (the factories now on the
  public test networks). The production executor submits the legacy
  `commitMonthly` (`/v1/commit-monthly`), as before.

The `key-recovery` scenario on EVM changes the factory identity authority for
every vault of that factory while it runs. Run no other acceptance run against
the same factory at the same time. A run interrupted while the recovery key is
in force runs `key-recovery` first on resume and rotates the factory back
before any other scenario binds. The Solana rotation changes only the
scenario's own project.

Additional environment for the extended suite:

| Variable | Networks | Value |
| --- | --- | --- |
| `ESCROW_ACCEPTANCE_ASSETS` | all | Assets for the bounty scenario, one bounty vault each. |
| `ESCROW_ACCEPTANCE_SCENARIO_ASSET` | all | Asset for the monthly, lifecycle and interrupted-send scenarios. |
| `ESCROW_ACCEPTANCE_BLOCKABLE_ASSET` | all | EVM: a `TestDollar` (`contracts/evm/integration/TestDollar.sol`), whose `blockAddress` models a blocked USDC destination. Solana: a classic mint whose freeze authority is the owner key. |
| `ESCROW_ACCEPTANCE_REVIEW_FACTORY` | EVM, optional | A factory from the same source with the same roles and a nonzero binding delay, for the cancellation window. |
| `ESCROW_ACCEPTANCE_REVIEW_DELAY_SECONDS` | Solana, optional | Binding delay of the review-window project. |
| `ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY` | EVM | `key-recovery`: the replacement identity authority. A separate test key with gas; it signs the new binding. |
| `ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY` | Solana | `key-recovery`: the Config rotation authority (64-character hex seed). The run derives the replacement identity key in memory; the relayer pays its fees. |
| `ESCROW_ACCEPTANCE_KEEPER_ADDITIONAL_FEE_RESERVE` | Base Sepolia, `keeper-v2` | Base L1 and operator fee reserve per keeper transaction, in wei. Required on Base Sepolia; `0` elsewhere. |
| `ESCROW_ACCEPTANCE_MONTHLY_SCHEDULE` | EVM, `keeper-v2`, optional | The `MONTHLY_PAYMENT_SCHEDULE` JSON the keeper serves. Omitted: the PRD schedule. |

The owner key needs 500 units of the scenario asset for the monthly scenario,
100 for each lifecycle vault, 50 for the interrupted send and 150 for key
recovery, 100 of each bounty asset, and 250 of the blockable asset. The run derives the destination
wallets in memory from the second actor key, so no new key is stored. On
Solana, the recorded run ID also binds each derived wallet. A new run must
use a new run ID; resume with the same evidence directory and source to keep
the same wallets and signed attempts. The Config fee account remains shared:
serialize runs that use the same blockable mint and verify its state before
starting. The runner does not thaw an earlier run's recipient account. The
blockable asset and the review-window deployment are test fixtures: the
evidence names their addresses, and a review-window result is not evidence
for the deployed zero-delay configuration.

The monthly commitment window is the contract's: the run uses the period
whose window is open on the chain at run time. That can precede the first
period of the production schedule (2026-11). The owner's monthly settings in
the account and the coordinator's freeze are not part of this run; the
executor receives an authorization that the identity test key signs over the
same digest (EVM) or message (Solana) as the attester.

If the EVM executor refuses its gas ceiling, a direct permissionless send can
prove the contract checks only. The evidence records that path separately and
keeps the monthly scenario pending. It does not prove automatic execution.
Earlier evidence with that fallback does not prove automatic execution. After
an approved executor repair, use a new run to prove automatic submission; the
previous period has already committed. Do not increase limits to obtain a pass.

The monthly test uses the legacy creation call, which starts Off, to test
owner opt-in and opt-out. It does not prove the website's default-On atomic
creation flow. The direct bounty tests prove contract settlement, not private
API access or ledger isolation.

A scenario passes only after its recorded transactions are finalized. A run
that waits for finality retains the completed execution and checks the same
receipts on resume. It does not repeat the financial steps.

Use a new run after repairing a failed frozen-recipient scenario. The failed
run can already have thawed the fee account and claimed earlier payments.
Its saved failure must not become evidence that a later payment occurred
while the account was frozen.

The evidence file has a `scenarios` object: per scenario its status
(`passed`, `pending` or `failed`), the reason, its vaults, every
transaction, and its checks. The run exits 0 only when every scenario passed.

## Factory upgrade qualification (EVM)

This step qualifies the V2 upgrade of `contracts/DEPLOY-MAINNET.md` section 4
on a public test network factory, with the checks of
`contracts/evm/integration/mainnet-upgrade-rehearsal.ts`. The implementations
are the CREATE2 addresses of section 4.3, the same on every chain.

```sh
(cd contracts/evm && forge build)
bun scripts/escrow-acceptance/evm-upgrade.ts plan    base-sepolia evidence/escrow-upgrade/base-sepolia
bun scripts/escrow-acceptance/evm-upgrade.ts execute base-sepolia evidence/escrow-upgrade/base-sepolia
bun scripts/escrow-acceptance/evm-upgrade.ts verify  base-sepolia evidence/escrow-upgrade/base-sepolia
```

- `plan` uses no key. At one finalized block it records the factory roles,
  the current factory and vault implementations and their code digests, every
  vault from the factory's `VaultCreated` logs with its storage slots 0 to 20
  and the award, source, wallet-binding and month records named by its events,
  and the ordered unsigned transactions: deploy both implementations through
  the CREATE2 deployer, upgrade each vault, upgrade the factory, select the
  new vault logic. It prints the factory's `upgradeAuthority()`. The supplied
  deployment block must be the first block with factory code. Missing historical
  state or an incomplete log request stops the check; it is not an empty inventory.
- `execute` signs those transactions with
  `ESCROW_ACCEPTANCE_UPGRADE_AUTHORITY_KEY`. It refuses a key that is not the
  authority in the plan and on chain. It skips a step that is already in its
  target state, saves each signed transaction before broadcast, and upgrades
  any vault created after the plan and before the new template (a
  straggler). It saves each straggler's state before its upgrade, including on retry.
- `verify` uses no key. After finality it checks the new implementation slot
  and template, the reviewed code digests, unchanged proxy code, unchanged
  factory slots except the template slot, unchanged roles, unchanged vault
  storage and initializer versions, `monthlyReserveVersion() == 2` on every
  vault, and that another account cannot upgrade and no initializer can run
  again. A provider error is not proof of a contract refusal. It checks the full
  creation inventory and its factory mapping again, and records `supersededAtBlock`
  (section 4.7).

`verify` records a fixed preservation block from the canonical finalized
completion receipts, including template selection and stragglers. It compares
all original storage there. A separate current finalized observation checks
runtime, roles and complete inventory. Payments of already funded awards after
the preservation block are reconciled from exact canonical receipts, stored
fees, actual token balance deltas and allowed storage changes. Other event
classes and all unexplained writes remain unqualified. Keep the upgrade
interval free of unrelated activity; this verifier does not infer per-transaction
preservation from ambiguous same-block state.

Exit code 75 means a transaction waits for finality; run the same command
again. Evidence is `upgrade.json` in the directory. To qualify an explicitly
reviewed plan from an older runner without changing its source or journal, use
the read-only companion from the reviewed repaired source:

```sh
bun --no-env-file scripts/escrow-acceptance/upgrade-verify.ts base-sepolia \
  <original-upgrade.json> <reviewed-original-source-sha> \
  <reviewed-original-file-sha256> <new-private-report.json>
```

It requires the existing RPC and factory configuration, never a signing key.
The new report binds original source and input bytes separately from verifier
source. The original status, history, snapshots and signed transactions remain
unchanged. Preserve the original failed verification and the compatibility
review. Hold the original network lock while qualifying a live journal.

The test network upgrade authority is the address that `plan` reads from
`upgradeAuthority()`. The deploy scripts set it from
`ESCROW_UPGRADE_AUTHORITY` at deployment time. The repository does not record
which key holds it for the current test factories (the 24 October 2026
factories in #902). That key is an owner input. Supply it only to the
`execute` shell.

After `verify` passes, use a new evidence directory for the extended suite.
The `monthly` scenario then takes the `keeper-v2` path. Earlier evidence
recorded the old implementations and cannot resume.

## Commands per public test network

Load the keys from the owner's secret store into one shell. Never put a value
on the command line. The table names the variables only.

| Network | Section 21 and extended suite | Upgrade qualification |
| --- | --- | --- |
| `base-sepolia` | Common keys below, `ESCROW_ACCEPTANCE_REGISTRAR_KEY`, `ESCROW_ACCEPTANCE_FACTORY`, `ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY`, `ESCROW_ACCEPTANCE_KEEPER_ADDITIONAL_FEE_RESERVE` | `ESCROW_ACCEPTANCE_RPC_URL`, `ESCROW_ACCEPTANCE_FACTORY`, `ESCROW_ACCEPTANCE_FACTORY_DEPLOYMENT_BLOCK`; `execute` also `ESCROW_ACCEPTANCE_UPGRADE_AUTHORITY_KEY` |
| `ethereum-sepolia` | Common keys below, `ESCROW_ACCEPTANCE_REGISTRAR_KEY`, `ESCROW_ACCEPTANCE_FACTORY`, `ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY` | As Base Sepolia |
| `robinhood-testnet` | Common keys below, `ESCROW_ACCEPTANCE_REGISTRAR_KEY`, `ESCROW_ACCEPTANCE_FACTORY`, `ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY`. Use an RPC that serves the `finalized` tag. | As Base Sepolia |
| `solana-devnet` | Common keys below, `ESCROW_ACCEPTANCE_PROGRAM_ID`, `ESCROW_ACCEPTANCE_PROGRAM_CODE_SHA256`, `ESCROW_ACCEPTANCE_PROGRAM_UPGRADE_AUTHORITY`, `ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY` | Not applicable: the Solana program upgrade follows `contracts/DEPLOY-MAINNET.md` section 2. |

Common keys: `ESCROW_ACCEPTANCE_RPC_URL`, `ESCROW_ACCEPTANCE_ASSETS`,
`ESCROW_ACCEPTANCE_OWNER_KEY`, `ESCROW_ACCEPTANCE_DEPOSITOR_KEY`,
`ESCROW_ACCEPTANCE_IDENTITY_KEY`, `ESCROW_ACCEPTANCE_RELAYER_KEY`,
`ESCROW_ACCEPTANCE_ACTOR_A_KEY`, `ESCROW_ACCEPTANCE_ACTOR_B_KEY`. The
extended suite also needs `ESCROW_ACCEPTANCE_SCENARIO_ASSET` and
`ESCROW_ACCEPTANCE_BLOCKABLE_ASSET`, and optionally
`ESCROW_ACCEPTANCE_REVIEW_FACTORY` (EVM) or
`ESCROW_ACCEPTANCE_REVIEW_DELAY_SECONDS` (Solana). Optional for all:
`ESCROW_ACCEPTANCE_UNIT_DIVISOR`, `ESCROW_ACCEPTANCE_FACTORY_CODE_SHA256`,
`ESCROW_ACCEPTANCE_MAX_WAIT_SECONDS`, `ESCROW_ACCEPTANCE_POLL_SECONDS`.

For each network, in this order (shown for `base-sepolia`; replace the
network name and directory):

```sh
# 1. Section 21 on the current factory.
bun run escrow:acceptance base-sepolia evidence/escrow-acceptance/base-sepolia
# 2. Extended suite on the current factory (monthly takes executor-v1).
bun run escrow:acceptance base-sepolia evidence/escrow-acceptance-extended/base-sepolia --suite extended
# 3. EVM only: upgrade qualification (owner supplies the upgrade authority key to execute).
bun scripts/escrow-acceptance/evm-upgrade.ts plan    base-sepolia evidence/escrow-upgrade/base-sepolia
bun scripts/escrow-acceptance/evm-upgrade.ts execute base-sepolia evidence/escrow-upgrade/base-sepolia
bun scripts/escrow-acceptance/evm-upgrade.ts verify  base-sepolia evidence/escrow-upgrade/base-sepolia
# 4. EVM only: extended suite on the upgraded factory, in a new directory (monthly takes keeper-v2;
#    it waits until 2026-12-04T00:00Z unless ESCROW_ACCEPTANCE_MONTHLY_SCHEDULE names an earlier first
#    period, for example {"firstPeriod":"2026-09","cutoffSecondsAfterPeriodEnd":259200}).
bun run escrow:acceptance base-sepolia evidence/escrow-acceptance-extended-v2/base-sepolia --suite extended
```

Repeat a command that exits with code 75 later. Each signed transaction is
saved before broadcast, so a repeat never signs a step twice.

## Local proof

```sh
SLOP_ESCROW_FEATURES=short-delay-for-tests bun run build:contracts:solana
bun run test:escrow-acceptance:local
bun scripts/escrow-acceptance/local.ts --suite extended
```

This forks each EVM test network with Anvil (real chain id and real test
stablecoin, funded with `anvil_dealERC20`), deploys a factory and an 18-decimal
`WideToken`, starts a local Solana validator with a 6-decimal and a 9-decimal
mint, generates throwaway keys, and runs the same command until it passes. It
moves time forward on the forks when the runner waits. Nothing reaches a
public network except the read-only fork requests. Name networks to run only
those, for example `bun scripts/escrow-acceptance/local.ts base-sepolia`.
`ESCROW_ACCEPTANCE_LOCAL_EVM_PORT` and `ESCROW_ACCEPTANCE_LOCAL_SOLANA_PORT`
move the loopback ports when another local chain uses the defaults.

With `--suite extended`, the EVM forks deploy a zero-delay factory from the
current source (it has the V2 reserve), a 120-second review-window factory, a
`TestDollar` blockable asset and a recovery identity key. The fork clock moves
to 2026-12-05, inside the 2026-11 commitment window, so the `monthly`
scenario takes the `keeper-v2` path. Anvil keeps every historical state in
memory (`--prune-history`): its disk-persisted states lose locally deployed
bytecode, which breaks finalized-block reads of the test vaults. The local
Solana validator runs only `key-recovery` (see the known blocker below).

## Known blockers

The payments Worker finds vaults only in the project registry, and the
registry names registry networks only. The executor admits a local Solana
validator only as `solana-localnet` and compares that name with the
obligation. Thus no `solana-localnet` vault can reach dispatch, and on
`solana-localnet` the section 21 runner stops before it signs, with that
reason. The extended suite on `solana-localnet` runs only `key-recovery`,
which needs no registry or dispatch, and records that deviation. The local
proof of the other Solana scenarios stays open until a maintainer decides how
a local Solana validator enters the registry.
