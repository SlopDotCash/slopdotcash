# Escrow acceptance runbook (PRD section 21)

This runbook runs the PRD section 21 funded-award scenario on one test
network and writes a machine-readable evidence file. A human operator runs it
with funded test keys. Test assets are not real funds, and a test run is not
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
| `monthly` | Monthly commitment is off at vault creation. A zero cap is refused. Only the open period is accepted (the 72-hour cutoff). An allocation changed after signing, a total over the owner's cap, and an opted-out vault are refused. The owner commits and pays one award by hand first; the production executor then submits the attester-signed allocation (`/v1/commit-monthly`). The manual award is counted once (EVM) or released (Solana), a changed manual award fails closed, a second commitment is refused, and no award is paid twice. |
| `interrupted-send` | The production payments Worker cron pays through the production executor. A loopback fault proxy forwards the first payment broadcast to the node, discards the answer, and fails the next status lookup. The signer instances restart. The cron recovers the journaled attempt: one attempt, one transaction, one payment. |
| `failed-recipient` | One of three recipients rejects the token (blocked on EVM, frozen token account on Solana). The other two are paid in the same cron run. The failed award stays reserved and is paid with the same attempt after the block ends. |
| `frozen-fee-destination` | While the fee recipient rejects the token, the fee claim fails, a mined claim reverts, and a waiting payout still pays. After the block ends, one claim moves every accrued fee. |

Additional environment for the extended suite:

| Variable | Networks | Value |
| --- | --- | --- |
| `ESCROW_ACCEPTANCE_ASSETS` | all | Assets for the bounty scenario, one bounty vault each. |
| `ESCROW_ACCEPTANCE_SCENARIO_ASSET` | all | Asset for the monthly, lifecycle and interrupted-send scenarios. |
| `ESCROW_ACCEPTANCE_BLOCKABLE_ASSET` | all | EVM: a `TestDollar` (`contracts/evm/integration/TestDollar.sol`), whose `blockAddress` models a blocked USDC destination. Solana: a classic mint whose freeze authority is the owner key. |
| `ESCROW_ACCEPTANCE_REVIEW_FACTORY` | EVM, optional | A factory from the same source with the same roles and a nonzero binding delay, for the cancellation window. |
| `ESCROW_ACCEPTANCE_REVIEW_DELAY_SECONDS` | Solana, optional | Binding delay of the review-window project. |

The owner key needs 500 units of the scenario asset for the monthly scenario,
100 for each lifecycle vault and 50 for the interrupted send, 100 of each
bounty asset, and 250 of the blockable asset. The run derives the destination
wallets in memory from the second actor key, so no new key is stored. The
blockable asset and the review-window deployment are test fixtures: the
evidence names their addresses, and a review-window result is not evidence
for the deployed zero-delay configuration.

The monthly commitment window is the contract's: the run uses the period
whose window is open on the chain at run time. That can precede the first
period of the production schedule (2026-11). The owner's monthly settings in
the account and the coordinator's freeze are not part of this run; the
executor receives an authorization that the identity test key signs over the
same digest (EVM) or message (Solana) as the attester.

The evidence file has a `scenarios` object: per scenario its status
(`passed`, `pending` or `failed`), the reason, its vaults, every
transaction, and its checks. The run exits 0 only when every scenario passed.

## Local proof

```sh
SLOP_ESCROW_FEATURES=short-delay-for-tests bun run build:contracts:solana
bun run test:escrow-acceptance:local
```

This forks each EVM test network with Anvil (real chain id and real test
stablecoin, funded with `anvil_dealERC20`), deploys a factory and an 18-decimal
`WideToken`, starts a local Solana validator with a 6-decimal and a 9-decimal
mint, generates throwaway keys, and runs the same command until it passes. It
moves time forward on the forks when the runner waits. Nothing reaches a
public network except the read-only fork requests.

## Known blockers

The payments Worker finds vaults only in the project registry, and the
registry names registry networks only. The executor admits a local Solana
validator only as `solana-localnet` and compares that name with the
obligation. Thus no `solana-localnet` vault can reach dispatch, and on
`solana-localnet` the runner stops before it signs, with that reason. The
local proof therefore covers the EVM forks only, until a maintainer decides
how a local Solana validator enters the registry.
