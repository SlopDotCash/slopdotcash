# Robinhood Chain USDG escrow payouts: design

Date: 12 October 2026, proposed by Drew Pierson. Status: scope approved by the repository owner on 14 October 2026 (PRD FND-02 and the section 22 decision row). Nothing in it activates a project, lifts the mainnet executor rejection, or changes the fee policy.

**Amendment, 18 October 2026 (product owner decisions, PRD section 22).** These decisions change parts of this record. Where the text below disagrees, this amendment wins:

- The project vault is the only funding mode (FND-01). The legacy monthly-pool rail (PAY-09), Squads and Sablier are removed, so the "legacy rail stays Base and Solana" statements below are historical.
- A project is added and activated only through admin-approved revisions in the D1 registry (PRJ-02). No pull request activates a project, and deployment bindings live in the D1 revision.
- The withdrawal fee is 2%, `ceil(gross / 50)` (rounded up since 24 October 2026), equal to the payout fee and enforced in the contract (PRD section 18; repository owner decision of 19 October 2026, #907). The 10% figure below and the 5% figure of 18 October 2026 are superseded.
- Any standard ERC-20 with any decimals may be a Robinhood Chain reward asset (TOK-01, TOK-03); USDG stays the network stablecoin. Generalization of `ProjectEscrow.sol` and the adapter beyond six decimals is MVP-06/MVP-07b work.
- Fee-wallet conversion to USDG on Robinhood Chain is superseded: the PRD (section 6) converts fees to USDC only. Robinhood Chain conversion stays pending until a Circle USDC address verified from Circle's primary source and a route to it exist ([fee-converter guide](../workers/fee-converter/README.md)).

This document is the decision record for adding Robinhood Chain as a third escrow settlement network beside Base and Solana. It extends [the payouts addendum](payouts-mvp.md) and [the Base and Solana architecture plan](base-solana-payout-plan.md), which states the rule this work follows: "Add a network definition and a chain adapter, then pass the same accounting and workflow conformance suite." PRD requirements: FND-01, FND-02, PAY-06, PAY-07, PAY-08. MVP packages: MVP-02, MVP-06, MVP-07.

## Why

The $SLOP token launches on Robinhood Chain in November 2026 through the Umia auction. Sponsors who arrive through that launch will assume project pools can pay on the same network. Robinhood Chain is an Arbitrum Nitro Layer 2 with ETH gas, so the existing EVM escrow contract and adapter apply with configuration, not new contract code. The stablecoin natively issued there is Paxos USDG, not USDC.

## Verified facts

The values below come from primary sources. The on-chain rows were first read on 12 October 2026 and read again on 14 October 2026 at the blocks given under "Reproduce the on-chain rows". Re-verify before deployment; never copy an address from a third-party page.

Primary pages: Robinhood Chain docs [Connecting](https://docs.robinhood.com/chain/connecting), [Token Contracts](https://docs.robinhood.com/chain/contracts), [Transaction Finality](https://docs.robinhood.com/chain/transaction-finality), [Differences from Ethereum](https://docs.robinhood.com/chain/differences-from-ethereum) and [Gas and Fees](https://docs.robinhood.com/chain/gas-and-fees); Paxos [USDG testnet guide](https://docs.paxos.com/guides/stablecoin/usdg/testnet).

| Fact | Value | Source |
|---|---|---|
| Mainnet chain id | 4663 (`0x1237`) | `eth_chainId` on `https://rpc.mainnet.chain.robinhood.com`; [Connecting](https://docs.robinhood.com/chain/connecting) |
| Testnet chain id | 46630 (`0xb626`) | `eth_chainId` on `https://rpc.testnet.chain.robinhood.com`; [Connecting](https://docs.robinhood.com/chain/connecting) |
| Native gas token | ETH | [Connecting](https://docs.robinhood.com/chain/connecting) |
| Mainnet explorer | `https://robinhoodchain.blockscout.com` | [Connecting](https://docs.robinhood.com/chain/connecting) |
| Testnet explorer | `https://explorer.testnet.chain.robinhood.com` | [Connecting](https://docs.robinhood.com/chain/connecting) |
| USDG token (mainnet) | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | [Token Contracts](https://docs.robinhood.com/chain/contracts); Paxos USDG mainnet guide |
| USDG metadata (mainnet) | name "Global Dollar", symbol USDG, `decimals() == 6`, `paused()` false | `eth_call` at mainnet block 88282064 |
| USDG contract shape (mainnet) | ERC-1967 proxy; implementation `0x68184c449e1a8f34fa18d289737129fd27b66f8f`; Paxos freeze interface present (12 October reading) | `eth_getStorageAt` on the ERC-1967 implementation slot at mainnet block 88282064 |
| USDG on testnet | Paxos test USDG `0x7e955252e15c84f5768b83c41a71f9eba181802f`; ERC-1967 proxy, implementation `0xf0863d7a29a55d0c4263c11bfac754312ff078df`; name "Global Dollar", symbol USDG, `decimals() == 6`, `paused()` false; the mainnet USDG address has no code on 46630. The 12 October reading of "no USDG on testnet" checked only the mainnet address and was wrong. | [USDG testnet guide](https://docs.paxos.com/guides/stablecoin/usdg/testnet); `eth_call`, `eth_getStorageAt` and `eth_getCode` at testnet block 134966126 |
| Test USDG supply | No primary source states how to obtain test USDG on Robinhood Chain Testnet. The Paxos guide links a general Paxos faucet but does not say that it serves this network. | [USDG testnet guide](https://docs.paxos.com/guides/stablecoin/usdg/testnet) |
| Finality tags | the RPC serves `safe` and `finalized`; `finalized` was 868 seconds (mainnet) and 1,122 seconds (testnet) behind head on 14 October 2026, and about 18 minutes behind on 12 October | `eth_getBlockByNumber` with `latest` and `finalized` at the blocks below |
| Finality model | soft confirmation from the sequencer, then posted to Ethereum, then Ethereum finality | [Transaction Finality](https://docs.robinhood.com/chain/transaction-finality) |
| `block.number` opcode | returns an estimate of the Ethereum block number, not the L2 block | [Differences from Ethereum](https://docs.robinhood.com/chain/differences-from-ethereum) |
| Gas estimation | `eth_estimateGas` folds the Ethereum data-posting fee into the returned gas units | [Gas and Fees](https://docs.robinhood.com/chain/gas-and-fees) |
| Base fee recipient `0x8f77c37d8650776bfe73c9b12b15209ee15d9b86` | plain account: no code and transaction count 0 on Base (block 52591539) and on Robinhood Chain (block 88282440) | `eth_getCode` and `eth_getTransactionCount` on `https://mainnet.base.org` and the Robinhood Chain mainnet RPC |

### Reproduce the on-chain rows

Readings of 14 October 2026. Mainnet: `latest` block 88282064 (timestamp 1791972388, 10:06:28 UTC), `finalized` block 88273460 (timestamp 1791971520). Testnet: `latest` block 134966126 (timestamp 1791972388), `finalized` block 134955868 (timestamp 1791971266). Each call below names the block it was read at; replace the block to read the current state.

```bash
# decimals(): result ends in ...06 on both networks
curl -s -H 'content-type: application/json' https://rpc.testnet.chain.robinhood.com \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x7e955252e15c84f5768b83c41a71f9eba181802f","data":"0x313ce567"},"0x80b6b6e"]}'
curl -s -H 'content-type: application/json' https://rpc.mainnet.chain.robinhood.com \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","data":"0x313ce567"},"0x54313d0"]}'
# ERC-1967 implementation slot: testnet result ends in f0863d7a29a55d0c4263c11bfac754312ff078df
curl -s -H 'content-type: application/json' https://rpc.testnet.chain.robinhood.com \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getStorageAt","params":["0x7e955252e15c84f5768b83c41a71f9eba181802f","0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc","0x80b6b6e"]}'
```

Other selectors used: `symbol()` `0x95d89b41`, `name()` `0x06fdde03`, `paused()` `0x5c975abb`.

The escrow contract reads `block.timestamp` and `block.chainid` only. It never reads `block.number`, so the Arbitrum block-number semantics do not affect award ids, binding delays, or rotation delays. RPC block numbers used by the adapter, scanner and reconciler are L2 block numbers and stay consistent with each other.

## Goals

1. A project can select Robinhood Chain as its one settlement network and run the same escrow lifecycle it would run on Base: deposit, commit awards, contributor-signed destination binding, permissionless `pay`, refund of free funds, finalized-event indexing, exact reconciliation.
2. Contributors see Robinhood Chain and USDG named truthfully in consent text, wallet cards, payout rows and explorer links.
3. Base behavior is unchanged, byte for byte where possible, and every Base test still passes.
4. A testnet deployment can be executed by a human from a written runbook with no key passing through an agent.

## Non-goals

- Activating any project on Robinhood Chain. Each activation is its own admin-approved D1 project revision with a reviewed deployment record.
- Lifting the hosted executor's rejection of mainnet deployments. That is the repository owner's decision under PAY-05 and the production readiness gate.
- Choosing the Robinhood Chain fee recipient or identity authority addresses. These are policy inputs recorded at deployment.
- The legacy 1% monthly-pool settlement rail (PAY-09, RFC #472). It stayed Base and Solana only and was removed on 18 October 2026.
- Bridging, on-ramp or faucet guidance for sponsors and contributors beyond the runbook's test-gas steps.
- Any change to the 2% fee or the fee incidence. (The withdrawal fee changed from 10% to 5% on 18 October 2026 and from 5% to 2% on 19 October 2026 by separate owner decisions; see the amendment above.)

## Design

### 1. Network and chain model

`ESCROW_NETWORKS` in `src/lib/escrow-policy.mjs` gains two entries and every entry gains explicit fields that the code currently infers from the word `base`:

| Network | chain | family | testnet | chainId | asset | assetSymbol | gasCeiling | scanPageBlocks |
|---|---|---|---|---|---|---|---|---|
| `base-sepolia` | `base` | `evm` | true | 84532 | Circle test USDC | USDC | 500000 | 2000 |
| `base-mainnet` | `base` | `evm` | false | 8453 | Circle USDC | USDC | 500000 | 2000 |
| `robinhood-testnet` | `robinhood` | `evm` | true | 46630 | Paxos test USDG `0x7e955252e15c84f5768b83c41a71f9eba181802f` | USDG | 2000000 | 9000 |
| `robinhood-mainnet` | `robinhood` | `evm` | false | 4663 | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | USDG | 2000000 | 9000 |
| `solana-devnet` | `solana` | `solana` | true | n/a | Circle devnet USDC | USDC | n/a | n/a |
| `solana-testnet` | `solana` | `solana` | true | n/a | null | TEST | n/a | n/a |
| `solana-mainnet` | `solana` | `solana` | false | n/a | Circle USDC | USDC | n/a | n/a |

Two exported helpers replace ad hoc string tests: `chainFamily(chain)` returns `evm` or `solana`, and `ESCROW_CHAINS` lists the chain values the policy accepts. Every place that today writes `chain === "base"` to mean "this is an EVM chain" calls `chainFamily(chain) === "evm"` instead. Places that mean "this specific network" keep comparing network names.

The chain value is `robinhood`, displayed as "Robinhood Chain". A vague `evm` chain value is rejected for the reason the architecture plan gives: Base and Robinhood Chain have different chain ids, different assets and different explorers, and every signed message and receipt binds one of them.

Wallet claims, payment wallet challenges and authorizations, binding authorizations and payout rows are per chain. A contributor who wants Robinhood Chain payouts registers a Robinhood Chain wallet and signs its consent, even when the address equals their Base address. The reason is that the consent message and the EIP-712 binding digest name the chain id and vault, so a Base signature cannot be reused on Robinhood Chain, and the product must not imply otherwise.

The one-chain-per-project rule holds through `assertEscrowPolicy` (`reward.chain` must equal `escrow.chain`, deployments must belong to that chain) and the `payment_project_network_locked` trigger. Neither changes.

### 2. Contracts and deployment

No Solidity change for Robinhood Chain itself. `ProjectEscrow.sol` currently accepts any token whose `decimals()` is 6 and whose transfers move exact amounts (the any-decimals generalization is separate MVP-06 work); it derives award ids from `block.chainid` and the vault address; it uses `block.timestamp` for the binding delay, the commit window, binding expiry and authority rotation. All of this is correct on Arbitrum Nitro.

New Foundry scripts under `contracts/evm/script/`:

- `DeployRobinhood.s.sol`: `require(block.chainid == 4663)`, USDG constant equal to the registry asset, fee recipient and identity authority read from the environment as public addresses, binding delay 48 hours (`MIN_PRODUCTION_BINDING_DELAY`), authority rotation delay as fixed in the factory by #675. Production release remains outside this script, as it is for Base.
- `DeployRobinhoodTestnet.s.sol`: `require(block.chainid == 46630)`, binds the factory to the Paxos testnet USDG constant (equal to the registry asset), with fee recipient and identity authority from the environment, mirroring `DeployBaseSepolia.s.sol`. No separate test token is deployed.

USDG is an upgradeable proxy with a pause switch and a per-address freeze, the same risk class as Circle's USDC on Base. The contract already fails closed: a frozen or paused recipient reverts `pay`, the award stays reserved, and a frozen fee recipient blocks only `claimFees`. The README's asset section gains a USDG paragraph stating this.

`foundry.toml` targets the Cancun EVM. Arbitrum Nitro supports Cancun opcodes from ArbOS 30; support on this chain is an acceptance gate, not yet evidence: the first testnet deployment (PR C runbook) must record the ArbOS version read from the `ArbSys` precompile and the deployment receipt. If deployment fails on an opcode, the fallback is a per-script `evm_version` of Shanghai, recorded as a deviation.

Fee recipient: the Base fee address is a plain account with no history on either chain, so the same key could receive on Robinhood Chain. Whether to reuse it, and which address is the identity authority, are decisions for the repository owner, recorded in the deployment evidence and the D1 project revision. This design does not assume them.

### 3. Data model

Five tables carry `CHECK(chain IN ('base','solana'))`: `wallet_claims` (migration 0010), `payment_obligations` and `payment_wallet_proposals` (0011), `payment_direct_transfers` (0014), `wallet_observations` (0015). SQLite cannot alter a CHECK in place, so migration `0017_robinhood_chain.sql` rebuilds each table with the widened constraint. D1 applies a migration inside one transaction, so the rebuild order is set by how SQLite counts deferred foreign-key violations, not by the rename-first order migration 0003 used when `wallet_claims` had no child tables:

1. Copy every row, with an explicit column list, into `<name>_0017_copy`: a plain `STRICT` table with the same columns and no foreign keys, constraints or defaults.
2. Drop the original table's triggers, then the original table.
3. Create `<name>` with `CHECK(chain IN ('base','solana','robinhood'))` and every other column, constraint, foreign key and `STRICT` setting identical to the current definition.
4. Re-insert every row from the copy with an explicit column list, then drop the copy.
5. Recreate every index and trigger with its original definition.

The order matters because of how SQLite treats a dropped parent. Inside D1's transaction `PRAGMA foreign_keys = OFF` has no effect, so the file sets `PRAGMA defer_foreign_keys = ON`: the implicit delete performed by `DROP TABLE` then counts each orphaned child row as a deferred violation, checked at commit. `ALTER TABLE ... RENAME` never clears that count, so renaming a replacement into place fails the commit even though every child resolves again. Re-inserting the parent rows under the original name does clear it, and the copy declares no foreign keys, so it adds nothing to the count. The file also keeps `PRAGMA foreign_keys = OFF`, restored to `ON` at the end, for an autocommit runner such as the local test harness, where the deferral lapses after each statement.

`wallet_claims` is referenced by its own `supersedes_claim_id`, by `wallet_possession_challenges`, `wallet_possession_attestations`, `payment_wallet_authorizations`, `payment_attempts`, `payment_wallet_challenges` and, after #675, `payment_binding_authorizations`. `payment_obligations` is referenced by `payment_outbox` and `payment_attempts`. No table is renamed, so no child's foreign-key text is rewritten; each resolves by name to the rebuilt table. The migration test in section 6 seeds a row in every child table, applies the file both outside and inside an explicit transaction, compares row counts, column order, indexes and triggers, and expects `PRAGMA foreign_key_check` to return no rows.

Row ids, digests, timestamps and lineage links do not change. No existing row gains the new chain value. Applied by the existing deploy step on staging first, then production, exactly as earlier migrations were.

### 4. Backend and workers

Routing by family. `workers/payments/index.ts` selects the EVM adapter and scanner when `chainFamily(deployment.chain) === "evm"` and the Solana ones otherwise; the executor service binding is `EVM_PAYMENT_EXECUTOR` (renamed from `BASE_PAYMENT_EXECUTOR`) or `SOLANA_PAYMENT_EXECUTOR`. `workers/payments/reconcile.ts` chooses the finalized-revert proof by family and records the deployment's chain in the proof instead of the constant `base`. `backend/payments/base-adapter.ts` becomes `evm-adapter.ts` and reports `chain` from its configuration.

Executor. `workers/payment-executor/index.ts` runs under `CHAIN_FAMILY` of `evm` or `solana`; `configure.mjs` derives it from the registry, allows `robinhood-testnet` in its network list, and names the worker, service binding and secret by network. `preflightEvmDeployment` (renamed from `preflightBaseDeployment`) accepts a deployment when its network is a registry testnet whose `chain` and `chainId` both equal the deployment record's, or the local 31337 override; every mainnet network stays rejected. The binding API applies the same rule to the reviewed deployment it builds consent for, and takes the claim chain from that deployment. The journal keys for EVM attempts stay `pay:<idempotencyKey>` and the nonce key already includes the chain id, so no journal migration is needed and no hosted test stack exists in production to migrate.

Gas policy per network. `eth_estimateGas` on Robinhood Chain returns gas units that include the Ethereum data-posting component, so a `pay` call can legitimately exceed the Base ceiling of 500,000 when Ethereum is congested. The ceiling moves into the registry (`gasCeiling`): Base keeps 500,000; Robinhood Chain uses 2,000,000. The 10 gwei `maxFeePerGas` cap stays global; Robinhood Chain's L2 base fee is far below it. The executor README's "Base signing limits gas to 500,000" sentence becomes a per-network table.

Scanner paging per network. `scanEvmPayments` (renamed from `scanBasePayments`) reads `scanPageBlocks` from the registry, defined as the inclusive number of blocks per `eth_getLogs` page: Base keeps 2,000 per run (the old `from + 1999` arithmetic, unchanged); Robinhood Chain uses 9,000, which stays under the common provider limit of 10,000 blocks per `eth_getLogs` request while keeping up with sub-second blocks on a five-minute cron and catching up from the deployment block in a reasonable number of runs. The cursor semantics do not change: it advances only after every recognized finalized event is indexed.

Finality. The adapter already gates every receipt on the `finalized` block tag, which on Arbitrum Nitro means the batch is final on Ethereum. The Robinhood docs name that stage "full finality". No confirmation counts are introduced. Soft confirmation and the "posted to Ethereum" stage are never treated as paid.

Wallet API. `src/lib/wallets.ts` `WALLET_CHAINS` gains `robinhood` with the EVM address rule; `backend/trace/handler.ts` accepts `chain=robinhood` on the claim endpoints and its error text names all three chains; `backend/payments/possession.ts` verifies `personal_sign` for any EVM-family chain and the EIP-712 binding signature with the deployment's chain id. `backend/payments/handler.ts` builds balances for every chain in `ESCROW_CHAINS`.

Manifest schema. `src/lib/project-schema.mjs` requires `reward.currency` to be `USDG` when `reward.chain` is `robinhood` and `USDC` otherwise. `src/lib/funding-address.mjs` maps `robinhood` to `USDG` and validates its addresses with the EVM rule; the funding-record and commitment modules are not extended (the legacy rail stays Base and Solana), and the schema rejects a fresh-cycle instrument on a Robinhood Chain project with a clear message.

Account API types. `PaymentChain` in `src/lib/payments/contracts.ts` becomes `"base" | "solana" | "robinhood"`; `transactionUrl` adds the Blockscout mainnet and testnet explorers.

### 5. Site

- Labels: "Robinhood Chain · USDG" for `robinhood-mainnet`, "Robinhood Chain Testnet · test USDG" for `robinhood-testnet`.
- Amount formatting on the payouts, escrow funding and proposal pages takes the symbol from the network's `assetSymbol` instead of appending "USDC".
- Wallet registration offers Solana, Base and Robinhood Chain; the address hint for Robinhood Chain is the same EVM rule as Base.
- Payouts page wallet cards and the connect flow name the chain the contributor chose. The EVM connect branch stays `personal_sign`, which is chain-independent; it does not call `wallet_switchEthereumChain`, because signing consent does not require the wallet to be on that network. Copy says so in one sentence.
- Explorer links use `transactionUrl`.
- No em dashes in any new copy.

### 6. Tests and CI

- `contracts/evm/adapter.integration.ts` and `backend/payments/base.integration.ts` (renamed `evm.integration.ts`) add a second Anvil pass started with chain id 46630 under network `robinhood-testnet`, proving award ids bind 46630, the preflight accepts the testnet entry and rejects a chain-id mismatch, the family routing reaches the EVM executor and scanner, the registry's gas ceiling is applied, and the ledger records `chain = robinhood`.
- A negative case: a deployment claiming `robinhood-mainnet` is rejected by the hosted preflight.
- Migration test (`backend/payments/migrations.test.ts`): apply 0001 through 0017 on a local SQLite database (`bun:sqlite`), once in autocommit and once inside a single transaction to match D1's apply, after seeding a Base claim lineage and a Solana one with a row in every child table; confirm row counts, indexes, triggers, column order and an empty `PRAGMA foreign_key_check`, then insert `robinhood` rows into all five tables.
- Foundry suites unchanged; `forge build` and `forge fmt --check` run as today.
- `scripts/test-payout-browser.mjs` asserts the new labels alongside the Base ones.
- `.github/workflows/escrow-tests.yml` job `base` is renamed `evm` and runs the EVM integration with both chain ids.
- Typecheck, lint, format and the e2e suites green before each PR.

### 7. Testnet runbook (prepare only)

To be delivered in PR C as `docs/robinhood-chain-testnet-runbook.md` with an evidence template; it is not part of PR B. An agent prepares; a human broadcasts. Steps:

1. Create a dedicated Foundry keystore account for the testnet deployer; never a raw key in a command, file or environment dump.
2. Fund it from `https://faucet.testnet.chain.robinhood.com`; confirm with `node scripts/check-payout-test-funding.mjs robinhood-testnet <address>` (the script gains the network with chain id `0xb626` and the public testnet RPC).
3. Obtain an archive RPC key (Alchemy is the documented provider) for the scanner; the public RPC is rate-limited and not for production use.
4. Simulate `DeployRobinhoodTestnet.s.sol` without broadcast; review the printed addresses; broadcast with the keystore account.
5. Verify source on the testnet Blockscout; read back `token()`, `owner()`, `identityAuthority()`, `feeRecipient()`, `bindingDelay()` and the runtime code SHA-256; read the ArbOS version from the `ArbSys` precompile.
6. Create one vault for a test project manifest; record the deployment under `escrow.deployments` with `network: "robinhood-testnet"` and the testnet USDG address as `asset`.
7. Establish a documented supply route for at least 1,000 test USDG on Robinhood Chain Testnet. No primary source states one today (see Verified facts). Without a route, stop and record the gap for the repository owner; do not substitute another token.
8. Run the canonical acceptance scenario from the architecture plan with testnet USDG: fund 1,000; commit 100 and 50; pay 98 plus 2; refund free funds at the withdrawal fee; bind the late wallet with a contributor signature; pay 49 plus 1; replay and prove no duplicate payment.
9. Record the evidence manifest: source SHA, compiler settings, factory and vault addresses, deployment transactions, chain id, token address and code hash, registrar, fee recipient, identity authority, ArbOS version, finalized block of each receipt.

### 8. Delivery

The repository rules require a new requirement to be discussed with humans and added to the PRD, with maintainer approval of scope and phase, before implementation is accepted. FND-02 read "Choose Base or Solana before first funding", so Robinhood Chain was a new requirement.

- **Step 0, PRD amendment (PR #678).** A docs-only PR adds Robinhood Chain and USDG to FND-02 and to every other PRD delivery and payouts-addendum line that named only Base and Solana or called Robinhood future scope, replaces the section 22 "Robinhood meaning" row with the decision, and links this document. The repository owner approved this scope on 14 October 2026.

Order of events, stated exactly: the implementation PRs below were opened as drafts before the scope approval existed. A draft is not approval. They stayed drafts and unmerged until the repository owner approved the scope on 14 October 2026, and they merge only after this amendment.

Payment authority is a separate prerequisite. Robinhood Chain destination binding and payment dispatch reuse the PAY-05 actor-binding design (the bounded identity attester) that the repository owner approved on 14 October 2026 in PR #675. They add no new issuer, verification, expiry, replay, revocation or recovery rule. Mainnet destination binding and payment dispatch stay blocked on every network until the tested implementation passes independent review and the counsel review in PRD section 22.

The implementation pull requests into `development`, merged by the repository owner after step 0:

- **PR A (#677), family refactor.** `chainFamily`, `ESCROW_CHAINS`, the registry fields, renames (`evmPaymentAdapter`, `scanEvmPayments`, `preflightEvmDeployment`, `EvmEscrowConfig`, `verifyEvmDeployment`, `evmAwardId`, `finalizedEvmRevert`, `EVM_PAYMENT_EXECUTOR`, `CHAIN_FAMILY=evm`), and every `chain === "base"` call site that means EVM. No new chain value, no migration, no label change. Base integration output identical before and after.
- **PR B (#680), Robinhood Chain.** Registry entries (including the Paxos test USDG asset for `robinhood-testnet`), migration 0017, deploy scripts, wallet and payment API acceptance, manifest schema, labels, explorer links, tests, README and docs updates (the EVM contracts README network table and USDG paragraph, `docs/testnet-funding.md`, the executor README gas table). The PRD delivery and payouts addendum changes land in step 0, not here.
- **PR C, runbook.** Not yet opened. `docs/robinhood-chain-testnet-runbook.md`, the evidence template, the test USDG supply route, and the `check-payout-test-funding.mjs` network entry if not already in B.

Each PR cites FND-01, FND-02, PAY-06, PAY-07 and MVP-02, MVP-06, MVP-07 in its description per the repository's PR rule.

## Open decisions for the repository owner

1. ~~Robinhood Chain fee recipient address.~~ Decided 19 October 2026: reuse the Base fee wallet `0x8f77C37D8650776bFe73c9b12B15209eE15D9b86`.
2. Robinhood Chain identity authority address, and who holds it, under the #675 bounded-attester design.
3. Which project is first to carry a `robinhood-mainnet` deployment, and when the hosted executor may accept a mainnet network at all.
4. Whether the public copy on `/sponsors` and project pages may say "USDG on Robinhood Chain" before a project is activated there. This design adds no such copy.

## Risks and mitigations

- **USDG freeze or pause.** Handled by fail-closed reverts; the unpaid award stays reserved; a frozen fee recipient blocks only fee claims.
- **Sequencer reordering before posting.** Nothing is paid or indexed before the `finalized` tag, which is Ethereum finality.
- **Gas spikes from Ethereum data fees.** Per-network gas ceiling; the 10 gwei price cap protects the relayer from paying an absurd price, and a transaction over the ceiling is held with a human-readable cause, not retried to a different value.
- **Migration on a live table.** A copy-aside rebuild that re-inserts the parent rows under the original name, so D1's single-transaction apply commits with deferred foreign keys; applied on staging first, pinned by the transactional migration test, with row counts asserted by that test.
- **Cancun opcode support.** Not yet proven on this chain; the first testnet deployment is the acceptance gate, and the fallback is a recorded `evm_version` deviation.
- **Address copied from the wrong source.** The registry carries the USDG address that two official pages list and the chain confirms; the deploy script's constant must equal the registry value, checked by a test.
