# Robinhood Chain Testnet escrow runbook

This runbook deploys the escrow v4 `EscrowFactory` to Robinhood Chain Testnet
(chain id 46630), creates one test vault, and records the evidence. A human
or owner-authorized agent may run the reviewed steps under PRD section 11.
Keep credentials private. Never use a production key or a mainnet RPC for
these steps.

Network facts and their sources are in
[Robinhood Chain escrow design](robinhood-chain-escrow-design.md). The
contract and adapter are described in
[`contracts/evm/README.md`](../contracts/evm/README.md).

## 1. Prerequisites

- Foundry 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`).
- A clean checkout of the reviewed source commit. Record its SHA.
- A dedicated test deployer in a Foundry keystore, for example
  `slop-test-deployer`. It pays gas and holds a role only if explicitly selected
  for it.
- Testnet ETH for gas on the deployer. Get it from the Robinhood Chain Testnet
  faucet, `https://faucet.testnet.chain.robinhood.com`.
- Explicit test-role addresses: `ESCROW_REGISTRAR`,
  `ESCROW_IDENTITY_AUTHORITY`, `ESCROW_FEE_RECIPIENT` and
  `ESCROW_UPGRADE_AUTHORITY`. The registrar must differ from the identity
  authority. The upgrade authority must differ from the identity authority
  and fee recipient; it may be the registrar.
- `ROBINHOOD_TESTNET_RPC_URL`. The public RPC
  `https://rpc.testnet.chain.robinhood.com` is rate-limited. It is acceptable
  for a one-off deployment, not for the scanner.

Do not put a private key in a command line, an environment dump, a source file
or the evidence.

## 2. Read-only chain checks

```sh
export ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call 0x0000000000000000000000000000000000000064 \
  'arbOSVersion()(uint256)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast block finalized --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --field number
```

Expected results:

1. The chain id is `46630`. Stop if it is not.
2. `ArbSys.arbOSVersion()` at precompile `0x64` returns 55 plus the ArbOS
   version (Nitro `precompiles/ArbSys.go`: `55 + c.State.ArbOSVersion()`).
   The compiled `ProjectEscrow` and `EscrowFactory` contain the Cancun opcode
   `MCOPY` (`foundry.toml` sets `evm_version = "cancun"`). ArbOS 20 (Atlas)
   added `MCOPY`, `TSTORE` and `TLOAD` (Arbitrum ArbOS 20 release notes). The
   returned value must therefore be 75 or more. Stop if it is less.
3. The node serves a `finalized` block. The adapter reads only finalized state.

On 18 October 2026 both `https://rpc.testnet.chain.robinhood.com` and
`https://rpc.mainnet.chain.robinhood.com` returned `arbOSVersion() = 116`
(ArbOS 61). Record the value you read; do not copy this one.

Confirm the opcodes of the exact build:

```sh
cd contracts/evm
forge build
cast disassemble "$(forge inspect ProjectEscrow deployedBytecode)" | grep -c MCOPY
```

## 3. Test USDG supply

The reference test asset is Paxos test USDG
`0x7E955252E15c84f5768B83c41a71F9eba181802F` (6 decimals). The Paxos
[USDG testnet guide](https://docs.paxos.com/guides/stablecoin/usdg/testnet)
lists it for "Robinhood Testnet", with the supply control address
`0x4549bb98c667aAb626627C118102c28065E8f54C`. The only supply route the Paxos
documentation links is the Paxos faucet, `https://faucet.paxos.com/`. On
18 October 2026 neither the guide nor the faucet page stated which networks the
faucet serves. Thus:

1. Open `https://faucet.paxos.com/` in a browser. Select USDG and Robinhood
   Testnet if the faucet offers them. Request test USDG to the test owner
   address.
2. Confirm receipt on chain:

   ```sh
   cast call 0x7E955252E15c84f5768B83c41a71F9eba181802F \
     'balanceOf(address)(uint256)' "$TEST_OWNER" \
     --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
   ```

3. If the faucet does not serve Robinhood Testnet, record that in the
   evidence and ask Paxos support. Do not substitute another token as "USDG".
   Escrow v4 accepts any standard ERC-20, so the acceptance run can continue
   with a separately recorded test token (for example a deployed
   `test/WideToken.sol`), but the evidence must name that token and must not
   claim a USDG run.

## 4. Deploy the factory

```sh
cd contracts/evm
export ESCROW_REGISTRAR=0x...
export ESCROW_IDENTITY_AUTHORITY=0x...
export ESCROW_FEE_RECIPIENT=0x...
export ESCROW_UPGRADE_AUTHORITY=0x...
forge script script/DeployRobinhoodTestnet.s.sol:DeployRobinhoodTestnet \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --account slop-test-deployer
```

Review the simulation: chain 46630, the four role addresses, atomic proxy
initialization, and zero binding and authority-rotation delays. Then run the
same command with `--broadcast`. The script
reverts with `wrong chain` on any other chain, and reverts when an environment
address is missing.

## 5. Verify the factory

```sh
FACTORY=0x...
BLOCK=$(cast block finalized --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --field number)
cast call "$FACTORY" 'registrar()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK"
cast call "$FACTORY" 'feeRecipient()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK"
cast call "$FACTORY" 'identityAuthority()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK"
cast call "$FACTORY" 'upgradeAuthority()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK"
cast call "$FACTORY" 'bindingDelay()(uint64)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK"
cast call "$FACTORY" 'AUTHORITY_ROTATION_DELAY()(uint64)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK"
cast code "$FACTORY" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --block "$BLOCK" | xxd -r -p | shasum -a 256
```

Record both implementation addresses and code digests along with the proxy
digests and upgrade authority, using the same finalized block for all reads
as required by [`contracts/DEPLOY-MAINNET.md`](../contracts/DEPLOY-MAINNET.md).
Compare them with the same build on a local Anvil deployment. Verify the
factory implementation, vault implementation and proxy separately on the
Robinhood Chain Testnet explorer (`https://explorer.testnet.chain.robinhood.com`)
with `forge verify-contract`, using the explorer's Blockscout API URL. The
implementations take no constructor arguments; the factory proxy takes its
implementation address and encoded initialization call from step 4.

## 6. Create and exercise one vault

The test owner creates its ordinary vault (purpose `0`) for a reviewed test
project ID and the test token. Vault creation is permissionless and the sender
is the owner:

```sh
cast send "$FACTORY" 'create(bytes32,address,uint8)' \
  "$PROJECT_ID" 0x7E955252E15c84f5768B83c41a71F9eba181802F 0 \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --account slop-test-owner
KEY=$(cast call "$FACTORY" 'vaultKey(address,bytes32,address,uint8)(bytes32)' \
  "$TEST_OWNER" "$PROJECT_ID" 0x7E955252E15c84f5768B83c41a71F9eba181802F 0 \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")
VAULT=$(cast call "$FACTORY" 'vaults(bytes32)(address)' "$KEY" \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")
```

Then run the acceptance scenario with finalized receipts:

1. A third-party test account approves and calls `deposit`. Check the
   `Deposited` event names that account.
2. The owner commits one award with `awardId(sourceDigest)`.
3. The attester binds the contributor wallet with the wallet's EIP-712
   signature (domain `SlopProjectEscrow`, version `5`).
4. Anyone calls `pay`; the replacement deployment has no mandatory award delay.
5. The owner withdraws part of the free balance. Check the fee is
   `ceil(gross / 50)` (2%) and only `gross - fee` reaches the owner.
6. Anyone calls `claimFees`.
7. Read `totals()` and the adapter's `readVaultTotals` at the finalized block,
   and check the conservation identity.

## 7. Evidence template

Attach this to the issue or PR. Use `N/A - <reason>` only when a field truly
does not apply.

```text
Robinhood Chain Testnet escrow deployment evidence
Date (UTC):
Operator (GitHub login):
Source commit SHA:
Foundry version / commit:
solc / evm_version / optimizer runs:  0.8.30 / cancun / 200
RPC used:
Chain id read:                          46630
ArbSys.arbOSVersion() and block:
  -> ArbOS version (value - 55):
MCOPY present in deployed bytecode:     yes / no
Deployer (gas only):
Registrar and custody:
Identity authority and custody:
Fee recipient:
Factory address:
Factory deployment transaction:
Factory runtime code sha256:
Local Anvil runtime code sha256 (same args):
Explorer source verification link:
Test token address / symbol / decimals:
Test token supply route and result:
Project ID:
Vault address / creation transaction:
Vault runtime code sha256:
Deposit tx (depositor):
Commit tx / award id:
Bind tx / binding version:
Pay tx / net / fee:
Withdraw tx / gross / fee:
ClaimFees tx / amount:
readVaultTotals output (finalized block number and time):
Conservation identity holds:            yes / no
Problems and deviations:
```

A testnet deployment is not proof of mainnet readiness. Mainnet steps are in
[`contracts/DEPLOY-MAINNET.md`](../contracts/DEPLOY-MAINNET.md).
