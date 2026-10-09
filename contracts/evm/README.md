# Base escrow v3

This is an immutable escrow implementation for a single project and six-decimal
USDC. It has no proxy, owner change, token approval, arbitrary call, rescue,
claim expiry, or award cancellation entry point. An approved award remains
reserved until it is paid. The owner can cancel only a pending wallet binding. This code has local EVM execution evidence. It has not received
an independent security review or a public testnet deployment.

## Authority and identity

The factory registrar creates one vault for each nonzero project ID in that
factory. The project owner deposits, approves awards, and withdraws free funds
to an immutable refund address. Only the separate identity authority can bind
a numeric GitHub actor ID to a wallet. Anyone can call `pay`; the caller cannot
select the amount or destination. The registrar must enforce the project's
single-network manifest choice across chains. A factory cannot enforce another
chain's registry, and separate factory deployments cannot prevent duplicate
project registration globally.

The identity authority submits a direct chain transaction. Its transaction
signature binds the chain ID and contract address. There is no reusable signed
attestation blob. Each binding includes a reviewed wallet-claim digest, an
expected predecessor version, and an expiry for transaction submission. Once
accepted, the binding persists. The authority must independently verify GitHub
login, wallet control, and any rotation/recovery approval before submission.
The on-chain authority can redirect unpaid funds if compromised. It cannot
change awards or withdraw funds. To limit that risk, every new or rotated
binding activates `bindingDelay` seconds after it is made, and `pay` rejects a
binding before activation. During the delay the project owner can call
`cancelBinding(actorId, version)`. A cancelled binding never pays; only a new
authority binding (the next version, with a new delay) can follow. An active
binding is final and cannot be cancelled. The owner can therefore delay a
contributor's payout, but can never take an approved award back. Production
deployments use a delay of at least 48 hours (`MIN_PRODUCTION_BINDING_DELAY`),
and the adapter checks the deployed `bindingDelay` against the reviewed
manifest. Use separate test identities for the owner,
attester, registrar, and gas sponsor.

A payment carries the expected binding version. If rotation executes first,
the old payment fails. If payment executes first, later rotation cannot repay
the award. Every award ID and source digest is consumed permanently. Source
digests identify a single allocation origin including project, cycle, and actor; keep it stable across amount or snapshot
revisions; do not supply a whole-cycle digest for each award. The award ID must
equal `awardId(sourceDigest)`, which is
`keccak256(abi.encode(chainId, vault, sourceDigest))`. Another vault cannot
claim the same ID first, so ledger IDs stay unique across projects.

The first version uses individual commit and pay calls. Dispatchers isolate
failed recipients by submitting separate transactions. No account can sweep
unclaimed awards. Missing destinations cause a revert and leave reserves intact.

## Accounting

All values are integer USDC micro-units. Each award reserves its gross allocation. The payout fee is
`floor(gross * 2 / 100)` and the recipient receives `gross - fee`. A 100-USDC
award costs the project 100 USDC and sends 98 USDC to the contributor plus
2 USDC of fees. Each unused-fund
withdrawal charges the increase in `floor(cumulative gross withdrawals / 10)`.
This prevents reduced withdrawal fees from splitting transactions. A one-unit
award requires one unit of funding and has a zero fee; tiny award rounding is intentional.

Payout and withdrawal fees accrue in the vault as `accruedFees`. Anyone can
call `claimFees()` to move them to the immutable fee recipient. A blocked fee
recipient (for example, a USDC blacklist) stops only `claimFees`; payouts and
refunds continue. Refunds go only to the owner: the constructor requires
`refundDestination == owner`.

Deposits and transfers must move exact amounts. Token failures or blocked
recipients revert the full payment. The accepted token
must have six decimals and ordinary exact-transfer behavior. The deployment
script fixes Circle's Base Sepolia test USDC address; verify that asset again
before deployment. Arbitrary tokens with dishonest `balanceOf` results are
outside the supported asset model. Direct transfers to the vault do not create
refundable credits and cannot be rescued in this version. The supported funding
path is owner `approve` followed by `deposit`.

The conservation identity is:

```
totalDeposited = freeBalance + reservedPrincipal + reservedFees
               + totalPaid + totalPayoutFees + totalGrossWithdrawn
vault balance  = freeBalance + reservedPrincipal + reservedFees + accruedFees
accruedFees + claimed fees = totalPayoutFees + totalWithdrawalFees
```

The owner can commit an award to any GitHub actor, including an account the
owner controls. That moves unused funds out at the 2% payout fee instead of the
10% withdrawal fee. This is an accepted, documented risk: maintainer review of
related-party awards enforces the policy, not the contract.

All escrow accounting counters are checked uint64 values for Solana parity;
lifetime deposits cannot exceed uint64 maximum. `reservedPrincipal` records
net contributor obligations; `reservedFees` records their deducted fees.
`totalWithdrawalFees` is included within gross withdrawals. `totalPaid` is only
contributor net. Event observations and counters are not finality proof;
backend receipts must use finalized chain state. Before indexing an event or
signing, the adapter verifies the finalized runtime code SHA-256 and the token,
owner, identity authority, and fee recipient against the reviewed manifest.
`codeSha256` hashes decoded `eth_getCode` bytes, including constructor
immutables. The current manifest has one sponsor address, so activation also
requires the refund destination to equal that owner.

## Local validation

Use Foundry 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`)
and the compiler pinned in `foundry.toml`. From the repository root:

```sh
forge fmt --root contracts/evm --check
forge build --root contracts/evm --sizes
bun contracts/evm/adapter.integration.ts
```

The integration deploys `integration/TestDollar.sol`, a six-decimal test
ERC-20. The test token is not Circle USDC; Circle integration, wallet signatures, OAuth, indexer finality,
and live broadcast require separate public-chain acceptance. The adapter integration
script starts an isolated Anvil on port 18546, executes actual deployment, award,
and payment transactions, and checks canonical finalized receipts plus rejection
of wrong chains, vaults, obligations, event indices, and nonfinalized receipts.

## Testnet deployment

The checked-in script rejects every chain except Base Sepolia (84532). It reads
only public destination addresses from the environment. Supply a dedicated
test-only external signer through Foundry's account or hardware-wallet options.
Do not put a private key in a command, environment dump, source file, or evidence.
The signer becomes the factory registrar. It is not the project owner unless
explicitly selected when the registrar later creates a project vault.

Set `BASE_SEPOLIA_RPC_URL`, `TEST_FEE_RECIPIENT`, and
`TEST_IDENTITY_AUTHORITY` in the isolated test deployment environment. First
simulate the exact compiled source:

```sh
cd contracts/evm
forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --account slop-test-deployer
```

After the test deployment authority reviews that simulation, the same invocation
with `--broadcast` submits testnet transactions. No public deployment was run as
part of the local implementation. Production release is outside this script.
Keep transaction artifacts in ignored `broadcast/`, and publish only reviewed
safe deployment evidence.

Record the source SHA, compiler settings, factory address, deployment transaction,
chain ID, token address/code, registrar, fee address, and identity authority.
Verify runtime bytecode and constructor configuration. Create each vault from
its reviewed project manifest, then verify its owner, refund address, token,
project ID, and authority. Export the ABI from `forge inspect ProjectEscrow abi`
as build output for the adapter; do not maintain a handwritten second ABI.
Run the full acceptance scenario with actual test USDC and finalized receipts.
Independent review, operational signer recovery, and public-chain evidence
remain launch gates.
