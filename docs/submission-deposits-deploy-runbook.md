# Submission deposits: mainnet deployment runbook

The owner ran these steps on 19 November 2026; the result is in
[`contracts/DEPLOY-MAINNET.md`](../contracts/DEPLOY-MAINNET.md#submission-fee-deposit-contracts-19-november-2026).
The steps are kept for the record and for the `setResolver` change still to
come. The repository owner signs every transaction in this runbook; no agent
and no Slop service does. The contract is
`contracts/evm/src/SubmissionDeposits.sol`; see the
[contract section](../contracts/evm/README.md#submission-deposits) and the
[AI-assisted review note](submission-deposits-ai-review-2026-11-18.md).

One deployment each on Robinhood Chain (chain id 4663) and Base (chain id 8453).
A deployment moves no tokens and activates nothing. No Slop service reads the
contract until its address is recorded in a separate reviewed change.

## 1. Choose the three addresses

- **Owner** (`SUBMISSION_DEPOSITS_OWNER`). It can replace the resolver, pause new
  deposits and hand ownership over in two steps. It can never move, redirect or
  resolve a deposit. Use the same address on both chains. A wallet whose key is
  backed up; ownership can move to a multisig later.
- **Resolver** (`SUBMISSION_DEPOSITS_RESOLVER`). It settles each deposit to its
  payer or to its kept address. It must differ from the owner. If the Worker's
  resolver key does not exist yet, deploy with the unusable address
  `0x000000000000000000000000000000000000dEaD`: nobody can then resolve, payers
  can still reclaim after 30 days, and the owner names the real resolver later
  with `setResolver`.
- **Deployer**. Any wallet with a little ETH on the chain. It pays gas and holds
  no role. Estimated cost on 18 November 2026: about 0.00002 ETH on Base and
  about 0.00007 ETH on Robinhood Chain (1.34M gas used, 1.74M estimated).

The reclaim delay is fixed at 30 days by the script and cannot be changed after
deployment.

## 2. Build from the merged commit

```sh
git fetch origin && git checkout origin/main
forge --version            # 1.7.1 (commit 4072e48705af9d93e3c0f6e29e93b5e9a40caed8)
forge build --root contracts/evm
forge test --root contracts/evm --match-path "test/SubmissionDeposits*.t.sol"
```

Stop if a test fails.

## 3. Import the deployer key once

```sh
cast wallet import slop-deployer --interactive
```

The prompt is hidden. The key is never typed on a command line or stored in shell
history. Skip this step if the account already exists (`cast wallet list`).

## 4. Dry run, then deploy, on each chain

Set the two public addresses once in the shell:

```sh
export SUBMISSION_DEPOSITS_OWNER=<owner address>
export SUBMISSION_DEPOSITS_RESOLVER=<resolver address>
cd contracts/evm
```

Robinhood Chain, dry run (sends nothing):

```sh
forge script script/DeploySubmissionDepositsRobinhood.s.sol:DeploySubmissionDepositsRobinhood --rpc-url https://rpc.mainnet.chain.robinhood.com --account slop-deployer
```

Robinhood Chain, deployment (the same command plus `--broadcast`):

```sh
forge script script/DeploySubmissionDepositsRobinhood.s.sol:DeploySubmissionDepositsRobinhood --rpc-url https://rpc.mainnet.chain.robinhood.com --account slop-deployer --broadcast
```

Base, dry run:

```sh
forge script script/DeploySubmissionDepositsBase.s.sol:DeploySubmissionDepositsBase --rpc-url https://mainnet.base.org --account slop-deployer
```

Base, deployment:

```sh
forge script script/DeploySubmissionDepositsBase.s.sol:DeploySubmissionDepositsBase --rpc-url https://mainnet.base.org --account slop-deployer --broadcast
```

Each script refuses any other chain ("wrong chain"), a missing role and a shared
owner and resolver, and it reads the deployed values back before it reports. The
output prints `0: contract SubmissionDeposits 0x...`. That is the deployment
address for that chain. The two addresses differ unless the deployer has the same
nonce on both chains.

## 5. Check each deployment

With `ADDR` the deployed address and `RPC` the chain's endpoint:

```sh
cast call $ADDR 'owner()(address)' --rpc-url $RPC
cast call $ADDR 'resolver()(address)' --rpc-url $RPC
cast call $ADDR 'pendingOwner()(address)' --rpc-url $RPC
cast call $ADDR 'reclaimDelay()(uint64)' --rpc-url $RPC
cast call $ADDR 'depositCount()(uint256)' --rpc-url $RPC
cast call $ADDR 'depositsPaused()(bool)' --rpc-url $RPC
cast keccak $(cast code $ADDR --rpc-url $RPC)
```

Expected: the owner and resolver you named, a zero pending owner, `2592000`
(30 days), `0`, `false`, and the runtime code hash
`0xe4c13bf58d547617ad10f4ee7bf4a43fb47ab68a4f6e841f5c22acd3874c55ef`.
The hash is the same on both chains, because the only value fixed at deployment
inside the code is the 30-day delay. It holds for the source at the commit this
runbook was merged with; a different hash means a different build, so stop and
compare before using the address.

Also confirm in the explorer that the deployment transaction created one
contract and moved no tokens.

## 6. Publish the source on Sourcify

From `contracts/evm` at the same commit, once per chain:

```sh
forge verify-contract $ADDR src/SubmissionDeposits.sol:SubmissionDeposits --chain-id 4663 --verifier sourcify --watch --constructor-args $(cast abi-encode "constructor(address,address,uint64)" $SUBMISSION_DEPOSITS_OWNER $SUBMISSION_DEPOSITS_RESOLVER 2592000)
```

```sh
forge verify-contract $ADDR src/SubmissionDeposits.sol:SubmissionDeposits --chain-id 8453 --verifier sourcify --watch --constructor-args $(cast abi-encode "constructor(address,address,uint64)" $SUBMISSION_DEPOSITS_OWNER $SUBMISSION_DEPOSITS_RESOLVER 2592000)
```

Sourcify needs no key. robinhoodchain.blockscout.com imported Sourcify results
for the vault contracts on 17 November 2026. robin.etherscan.io and basescan.org
do not: they need the web form (compiler type Solidity, Standard-Json-Input,
`v0.8.30+commit.73712a01`, optimizer 200 runs, EVM version cancun, MIT license)
with the standard input from
`forge verify-contract ... --show-standard-json-input`, and the same constructor
arguments.

## 7. Record it

A separate reviewed change, not part of deployment:

- Add both addresses, the deployment transactions, blocks and the runtime code
  hash to `contracts/DEPLOY-MAINNET.md` and to the contract section of
  `contracts/evm/README.md`.
- Set the two addresses in the fee constants the Worker and Slopbot read.
  Nothing collects a fee until that change and the separate switch to record-only
  or live.
- When the Worker's resolver key exists and has gas on both chains, the owner
  calls `setResolver(<Worker address>)` on each deployment and the change is
  recorded the same way.

## If something is wrong after deployment

The contract cannot be upgraded. The owner calls `pauseDeposits(true)` so no new
deposit arrives, the resolver refunds what is open (or payers reclaim after 30
days), and a corrected contract is deployed at a new address. Pausing never
blocks a refund, a kept payment or a reclaim.
