> Replacement deployment policy, approved 24 October 2026: factory and vault
> logic use OpenZeppelin v5.5.0 UUPS proxies. The deployment authority controls
> upgrades without a timelock. Fee and identity keys cannot upgrade. New release
> deployments use zero award delay and immediate identity-authority rotation.
> Legacy delay examples below describe previous deployments; they do not set
> the replacement deployment policy.
>
> `ESCROW_UPGRADE_AUTHORITY` is required. Implementations disable initialization;
> proxies initialize atomically. `setVaultImplementation` selects logic for new
> vaults only. Existing vaults upgrade individually with `upgradeToAndCall`.
> Factory upgrade-authority transfer requires recipient acceptance and changes
> who can upgrade every vault from that factory. It has no waiting period.
> Verify the proxy code, ERC-1967 implementation address, implementation code
> digest and upgrade authority, not only the proxy bytecode. Keep storage layout
> compatible and prove funded lifecycle continuity before each upgrade.

# EVM escrow v5

This is an owner-upgradeable escrow implementation for one project, one asset and one
purpose. The asset can be native ETH or any standard ERC-20 with any decimals: Circle USDC,
Paxos USDG or a project token. Anyone can call the factory to create a vault
for itself. The caller is the owner, and the factory keeps one vault for each
(owner, project ID, token, purpose). The purpose is `Ordinary` (0) for ordinary
awards or `Bounty` (1) for private bounties, so one project can hold separate
ordinary and bounty vaults for the same token (owner decision D13, 24 October
2026). Vault logic has no owner change, token approval, arbitrary call, rescue,
claim expiry, or award cancellation entry point. An approved award remains
reserved until it is paid. The owner can cancel only an unpaid wallet binding
inside a bounded window. The registrar can rotate the identity authority. The
separate upgrade authority can replace factory or vault logic as described
above. See [the deployment record](../DEPLOY-MAINNET.md) for recorded releases;
new source changes need their own acceptance evidence. The owner waived the
independent contract audit, not the release checks.

## Native ETH

The source implementation uses the zero token address for native ETH and stores
18 decimals. This adds no storage slots. `deposit(amount)` requires exactly
`amount` wei in transaction value; ERC-20 deposits require zero transaction value.
Direct transfers are not credited. Payouts, owner refunds and fee claims transfer
ETH and check exact vault and recipient balance changes. Failed recipients keep
the award or accrued fee unpaid; they do not consume it.

Run `bun contracts/evm/native.integration.ts` from the repository root for the
local Anvil lifecycle, including sender gas, monthly awards and receiver failure.
The ordinary adapter integration also runs this test. No deployment or reviewed
production implementation binding changes with this source update.

## Networks

| Network | Chain id | Reference asset (not an allowlist) | Deploy script |
| --- | --- | --- | --- |
| Base Sepolia | 84532 | Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `DeployBaseSepolia.s.sol` |
| Base | 8453 | Circle USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `DeployBase.s.sol` |
| Robinhood Chain Testnet | 46630 | Paxos test USDG `0x7E955252E15c84f5768B83c41a71F9eba181802F` | `DeployRobinhoodTestnet.s.sol` |
| Robinhood Chain | 4663 | Paxos USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | `DeployRobinhood.s.sol` |
| Ethereum Sepolia | 11155111 | Circle test USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `DeployEthereumSepolia.s.sol` |
| Ethereum | 1 | Circle USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `DeployEthereum.s.sol` |

The Ethereum USDC addresses come from Circle's
[USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
page. On 18 October 2026 an `eth_call` on each chain returned symbol `USDC`
and 6 decimals. `src/lib/escrow-policy.mjs` records each reference asset with
its decimals and source. The registry lists reference assets only; a project
can fund a vault in any standard token.

The contract reads only `block.timestamp` and `block.chainid`, never `block.number`, so Arbitrum Nitro's block-number semantics on Robinhood Chain do not affect award ids or delays. `foundry.toml` targets Cancun. Opcode support on Robinhood Chain is not yet proven: the first testnet deployment must record the ArbOS version read from the `ArbSys` precompile and a successful deployment receipt before any activation.

## Authority and identity

`createWithMonthlyCommitment(projectId, token, cap, enabled)` creates an ordinary
vault and its monthly policy atomically. `buildCreateVaultCalldata` requires the
owner's cap and defaults `enabled` to true; an explicit false opts out. The
compatibility `create(projectId, token, purpose)` entry point remains for old
callers and private bounty vaults. Both are permissionless and make `msg.sender`
the owner. A vault proves only which account created it. The project registry
decides which owner's vault a project uses, so a vault that another account
creates for the same project ID never replaces or reaches the owner's vault.
The registrar creates no vaults and holds no money power. The registrar, the
fee recipient, identity authority and upgrade authority are explicit initializer parameters.
The deploying account holds an upgrade role only if selected as upgrade authority. Anyone can deposit. The project owner
approves awards and withdraws free funds to itself. An ordinary vault also
takes the bounded monthly commitment below. The identity authority
is a factory-level address that every vault reads; it is Slop's attester key. A
binding needs two signatures. The identity authority submits the
`bindDestination` transaction, and the destination wallet signs an EIP-712
message over the chain ID, vault, actor ID, destination, expected predecessor
version, wallet-claim digest and expiry (`DestinationBinding` under the
`SlopProjectEscrow` version `5` domain). The vault recovers the signer with
`ecrecover` and rejects a binding whose signer is not the destination, so the
authority alone cannot point funds at a wallet it does not hold. Only an
externally owned account can produce that signature; a contract wallet cannot
be bound in this version. Anyone can call `pay`; the caller cannot select the
amount or destination. The registrar must enforce the project's single-network
manifest choice across chains. A factory cannot enforce another chain's
registry, and separate factory deployments cannot prevent duplicate project
registration globally.

The authority's transaction signature binds the chain ID and contract address,
and the wallet signature binds the same fields through its domain, so there is
no reusable attestation blob. Each binding includes a reviewed wallet-claim
digest, an expected predecessor version, and an expiry that bounds submission
of both signatures. Once accepted, the binding persists. The authority must
independently verify GitHub login and the current registered claim before
submission. A verified binding activates immediately. The `activatesAt` event field records
that transaction's block time. Only the latest version may receive payment.
An award still waits `bindingDelay` seconds from its commitment. This parameter
also retains the owner's review period for cancelling an unpaid binding; it
no longer delays wallet activation. The owner may cancel the latest unpaid
binding during that review period or an award's commitment period. A cancelled
version never pays; a new co-signed version is required.

The cancellation cap remains three between payments, waived during a pending
factory authority rotation. Cancellation must execute before payment. For an
already eligible award, there is no guaranteed reaction period after a wallet
change. Protect the identity authority and verify account and wallet proof
before signing. A compromised authority with a colluding destination wallet
can redirect an eligible payment. Authority rotation does not reverse payments.

The initializer bounds the award/review period to zero through
30 days. New production deployments use zero. The adapter
checks this parameter against the reviewed manifest. Use separate identities
for the owner, attester, registrar, and gas sponsor.

### Identity authority rotation

The factory holds `identityAuthority` and one pending replacement. The
registrar calls `proposeIdentityAuthority(next)`; the proposal is public in
`IdentityAuthorityRotationProposed` with its effective time, the proposal block time
(`AUTHORITY_ROTATION_DELAY = 0`). The registrar can cancel its own pending
proposal with `cancelIdentityAuthorityRotation`. Immediately after the proposal
anyone can call `executeIdentityAuthorityRotation`, which emits
`IdentityAuthorityRotated`; the current authority has no call that blocks or
delays it. Until execution the current authority keeps binding; afterwards only
the new one can. Bindings are stored per vault and actor and do not reference
the authority, so every existing binding, cancelled or active, stays valid across
a rotation, and `pay` never reads the authority. The next authority must be
nonzero and differ from the current authority and the registrar. Vaults are
created only by the factory and read `factory.identityAuthority()`. The reviewed
manifest pins the factory address, its runtime code digest
(`factoryCodeSha256`) and its registrar, and the adapter checks that the factory
created the vault under `vaultKey(owner, projectId, token, purpose)`, that the
vault purpose matches the payout policy, and that the factory has the reviewed
asset, fee recipient,
binding delay and zero `AUTHORITY_ROTATION_DELAY`. A vault from a factory with
other rotation rules therefore fails verification. The manifest's
`identityAuthority` is the authority at activation; the adapter does not compare
it with the authority in force, because after activation the authority changes
through this rotation. An identity rotation preserves bindings and payment evidence.
A code upgrade requires new implementation evidence in an appended manifest revision.

### Key recovery runbook

Who acts: the registrar key (a reviewed multisig or hardware key, never the
attester service) and each project owner. The attester key is a hot service
key and is never used for recovery.

Attester key lost: the authority can no longer bind, so awards to actors
without an active binding wait; nothing is lost and no reserve moves. The
registrar proposes the replacement key, publishes the proposal transaction,
and executes the rotation immediately. Existing bindings keep paying
throughout. A contributor whose binding was pending or missing signs nothing
new unless the wallet signature already collected has expired.

Attester key compromised: the registrar proposes a replacement immediately
and executes it immediately. The owner may
cancel unexpected unpaid bindings within their review windows. Such a cancel
must execute before payment; it is not a guaranteed recovery mechanism.
Pending rotation waives the cancellation count, but it does not pause payment
or remove the current authority before execution. After execution, the old key
cannot bind; the new authority and contributor can replace the latest binding.
Review bindings made during the incident. Rotation neither reverses a payment
nor replaces an existing binding by itself.

Registrar key lost or compromised: there is no second rotation path; the
registrar is the recovery authority, so choose it at factory deployment and
record its custody in the deployment evidence. A compromised registrar can
propose a rotation to a key it controls, but still needs a wallet co-signature
per binding. The separate upgrade authority can authorize a reviewed code change
for recovery; that power can also change fund-handling logic.

Project owner key lost: deposits, awards and withdrawals from that vault stop;
reserved awards still pay to active bindings. There is no owner change in this
version.

Only the latest binding can pay. `bindings(actorId)` is the latest authority
binding with its `activatesAt` and `cancelled` flag. `payableBinding(actorId)`
returns it once its delay has passed and it is not cancelled, and version 0
otherwise. `paidVersion(actorId)` records the version the last payment used, so
that binding cannot be cancelled. While a rotation waits out its delay, or after
the owner cancels it, no caller can pay any earlier wallet: a contributor who
rotates away from a lost or compromised wallet freezes payment to it at once,
and payment resumes only to the new binding once it is ready. This is the
stale-binding rule: a finalized change invalidates payment to the earlier
destination. A payment names the version it
expects, and a payment naming any other version fails. If payment executes
first, a later rotation cannot repay the award. Every award ID and source
digest is consumed permanently. Source
digests identify a single allocation origin including project, cycle, and actor; keep it stable across amount or snapshot
revisions; do not supply a whole-cycle digest for each award. The award ID must
equal `awardId(sourceDigest)`, which is
`keccak256(abi.encode(chainId, vault, sourceDigest))`. Another vault cannot
claim the same ID first, so ledger IDs stay unique across projects.

## Bounded monthly commitment

`commitAward` stays owner-only. To let the monthly coordinator commit a month
without the owner's wallet, an ordinary vault has one more path:

- Normal creation sets the owner's cap and turns the setting on unless the
  owner opts out. The owner can later call `setMonthlyCommitment(cap, enabled)`.
  "On" needs a positive cap. While it is off, no new monthly allocation can enter.
  An admitted month and awards already committed stay reserved. Compatibility callers of the old
  three-argument `create` retain their earlier off/zero initial state.
- The new creation path requires both reviewed factory and vault implementations.
  Existing deployments and vault state do not change when this source merges;
  qualify and record any operator-authorized upgrade before using it.
- A period is a calendar UTC month written as `YYYYMM` (owner decision D1). Its
  window opens `MONTHLY_CUTOFF_DELAY` (72 hours) after the month ends, at 00:00
  UTC on the 4th, and closes when the next month's window opens.
  `monthlyWindow(period)` returns both times. Only one period is open at a
  time.
- The identity authority signs the EIP-712 message
  `MonthlyAllocation(uint32 period, bytes32 allocationRoot)` under the vault's
  `SlopProjectEscrow` version `5` domain, which binds the chain and the vault.
  `monthlyDigest(period, root)` returns the digest.
- Anyone calls `commitMonthly(period, awards, signature)` inside the window.
  `awards` is the list of `(actorId, gross, sourceDigest)` in allocation order.
  The vault rebuilds `allocationRoot(awards)` and requires the authority's
  signature over it. The full gross total must be within `monthlyCap`; the free
  balance must cover all awards that are not already reserved or paid.
  `monthlyRoots(period)` must be empty, so each period commits once.
  Each new award takes the 2% payout fee, consumes its source digest, gets the
  ID `awardId(sourceDigest)`, and pays through the ordinary binding rules.
  An award already committed by the owner is counted once when its actor,
  gross amount, source digest and fee match. Its payment state and commitment
  time stay unchanged. A conflicting award makes the whole call revert.
- The allocation root is a Merkle tree over the awards in order. A leaf is
  `keccak256(0x00, actorId, gross, sourceDigest)` and a node is
  `keccak256(0x01, left, right)`, both packed. An odd last node moves up
  unchanged. Solana commits awards one at a time, so it uses a sha256 Merkle
  sum tree that also binds each subtree's gross total (see
  `contracts/solana/README.md`).

For larger allocations, reviewed V2 vaults expose `monthlyReserveVersion() == 2`.
The old entry points, v5 domain, and funded awards remain valid. V2 adds the
`MonthlyReserveV2` signed type; it does not reinterpret an old signature.

The attester uses the frozen economic allocation and reads all source awards
at one finalized block. It excludes consumed sources from a separate execution
tree, without changing the frozen allocation or total. A V2 signature binds the
period, frozen allocation digest, remaining Merkle-sum root, whole gross,
remaining gross, leaf count, and `ordinarySourceSequence`. Each new ordinary
source increments that sequence. `reserveMonthly` rejects a changed sequence
before moving funds, then reserves the entire remaining gross in one operation.
The whole frozen gross must still fit the owner's current cap.

`commitMonthlyLeaf` verifies the ordered sum proof and moves that leaf's gross
from `pendingMonthlyGross` into award principal and fees. It does not charge
free funds again. Leaf replay fails atomically. A month whose sources are all
funded seals with an empty tree and zero remaining reserve. The trusted attester
rejects duplicate sources before signing; the contract cannot inspect every
leaf during constant-size admission.

While pending gross remains, new manual awards wait. If part of a reserve can never settle (an attester fault),
the owner calls `releaseMonthlyReserve(period, expectedRemaining, releasedGross, attestation)` with the
identity authority's EIP-712 `MonthlyRelease` signature from `monthlyReleaseDigest`. The signature binds the
exact remaining gross, so a leaf that settles first makes it stale. The released gross returns to free balance
without a fee, `monthlyReleased(period)` records it, committed awards do not change, and the period stays
committed. Time alone never releases a reserve. See `docs/escrow-unsettleable-month-release.md`. Later signed monthly
admissions can use free funds within their own caps. Existing funded payments, bindings, deposits,
and free withdrawals remain available. Permissionless leaf execution completes
the reserve after owner opt-out or window expiry. It has no refund, expiry, or
human release step. The executor bounds examined leaves, including already
committed leaves, and retains a finalized cursor for restart.

`monthly-reserve.integration.ts` exercises the real migrated database, frozen
snapshot, signer, public authorization, and local chain executor with 100 awards.
Its `SLOP_MONTHLY_LEGACY_ROOT` option expects a pre-upgrade tree that already
has `createWithMonthlyCommitment`. The deployed mainnet source (`bce5b0df`)
does not, so that option fails at setup against it. The upgrade proof for the
deployed vaults is the Base fork rehearsal in `../DEPLOY-MAINNET.md` section
4.6.

The authority's role therefore grows from wallet binding to monthly
attestation. It still cannot withdraw, redirect or pay funds, and it cannot
commit more than one owner cap in each calendar month. A monthly award, like
any award, pays only to a binding that the destination wallet signed, after the
commit delay, and the owner can still cancel a binding in
those windows. A stolen authority key can reserve at most one cap for each
month until the registrar's rotation executes; the owner limits that exposure
with the cap and the opt-out. `test/MonthlyCommitment.t.sol` tests the cap, one
commitment per period, the opt-out, the window, the signature binding over vault,
period and root, replay, the wrong attester, the rotation, purpose isolation and
permissionless creation. `test/MonthlyReserveV2.t.sol` tests V2 trees of
odd and even widths, index aliasing, forged sibling totals, leaf replay, a
stale source sequence, count-zero sealing, the cap on the whole gross and
preservation of funded leaves after the admission window, and later monthly admission while earlier leaves remain. The invariant handler in `test/OpusInvariant.t.sol` commits
signed legacy allocations, V2 reserves and leaves from
random callers, and checks both identities below with pending gross.

The monthly dispatcher sends a new reservation before older months’ leaves.
A leaf can change the source sequence and invalidate a reservation signature.

The first version uses individual commit and pay calls. Dispatchers isolate
failed recipients by submitting separate transactions. No account can sweep
unclaimed awards. Missing destinations cause a revert and leave reserves intact.

## Accounting

All values are integer token base units, stored as checked `uint128`. The vault
stores `decimals()` once, for display only, and never scales an amount. Each
award reserves its gross allocation. The payout fee is `ceil(gross / 50)` (2%)
and the recipient receives `gross - fee`. A 100-USDC award costs the project
100 USDC and sends 98 USDC to the contributor plus 2 USDC of fees. The 2% is
paid in the vault token. Each unused-fund withdrawal pays the same 2%:
`withdrawalFee(gross) = payoutFee(gross) = ceil(gross / 50)`, rounded up once
per withdrawal (PRD section 6). Withdrawing 850 USDC of free funds pays 17 USDC
and sends 833 USDC to the owner. Every award or withdrawal of at least one base
unit pays at least one unit of fee, so splitting never lowers the fee (owner
decision of 24 October 2026; rounding down let a split into pieces under 50
base units avoid the fee on low-decimal tokens). A one-unit award has a one-unit
fee and pays the contributor nothing. Vault logic deployed before this change
takes `floor(gross / 50)` until it is upgraded; the adapter accepts either
rounding and nothing else.

Payout and withdrawal fees accrue in the vault as `accruedFees`. Anyone can
call `claimFees()` to move them to the configured fee recipient. A blocked fee
recipient (for example, a USDC blacklist) stops only `claimFees`; payouts and
refunds continue. Refunds go only to the owner.

`deposit(amount)` is permissionless. Any account approves the vault and calls
it; the vault pulls the exact amount from the caller, credits `freeBalance`,
and emits `Deposited(depositor, amount)`. All deposits join one free balance.
A depositor gets no refund right: only the owner commits free funds to awards
or withdraws them to itself. Direct transfers to the vault are
not credited and cannot be rescued.

Deposits and transfers must move exact amounts. The vault compares balances
before and after each transfer, so a fee-on-transfer token reverts the deposit
or payment. Rebasing tokens break the balance identity and are not supported;
the contract cannot detect every rebase, so the registry review must reject
them. A token without a `decimals()` function that returns a `uint8` value is
rejected when the vault is created. Arbitrary tokens with dishonest
`balanceOf` results are outside the supported asset model. Token failures or
blocked recipients revert the full payment.

USDC and USDG are upgradeable proxies with a pause switch and a per-address
freeze. The contract fails closed: a frozen or paused recipient reverts `pay`
and the award stays reserved; a frozen fee recipient blocks only `claimFees`.

The conservation identities are unchanged by the binding lifecycle:

```
totalDeposited = freeBalance + reservedPrincipal + reservedFees + pendingMonthlyGross
               + totalPaid + totalPayoutFees + totalGrossWithdrawn
vault balance  = freeBalance + reservedPrincipal + reservedFees + pendingMonthlyGross
               + accruedFees
               + unsolicited direct transfers
accruedFees + claimed fees = totalPayoutFees + totalWithdrawalFees
```

`totals()` returns every counter and the vault token balance in one call, so a
reader gets one consistent block. Each counter also has its own public getter.
The adapter's `readVaultTotals` reads `totals()`, `token()` and `decimals()` at
one pinned finalized block and checks the first identity. The old `totals()`
ABI stays unchanged. A V2 reader also reads `pendingMonthlyGross()` at that block
when it is nonzero and returns the combined award and pending-month reserve.

The vault has no service charge. Slopbot is free (PRD section 5), so no call
moves free funds to the fee recipient except the payout and withdrawal fees
(owner decision D13 removed `chargeService`).

The owner can commit an award to any GitHub actor, including an account the
owner controls. Because the withdrawal fee equals the payout fee (repository
owner decision of 19 October 2026, #907), such a self-award costs the same 2%
as a withdrawal and gives no fee advantage. Maintainer review of related-party
awards still applies under the eligibility policy.

`reservedPrincipal` records net contributor obligations; `reservedFees`
records their deducted fees. `totalWithdrawalFees` is included within gross
withdrawals. `totalPaid` is only contributor net. Event observations and
counters are not finality proof; backend receipts must use finalized chain
state. Before indexing an event or signing, the adapter verifies the finalized
runtime code SHA-256 and the token, owner, fee recipient, binding delay and
factory (address, runtime code digest, registrar and rotation delay) against
the reviewed manifest, that the vault purpose matches the payout policy, and
that the factory indexed this vault under its owner, project ID, token and
purpose. `codeSha256` hashes decoded `eth_getCode` bytes, including
the proxy runtime. `evmUpgrade` separately pins both implementation addresses,
their code digests and the controlling authority.

## Events and ABI (v5)

```
ProjectEscrow
  Deposited(address indexed depositor, uint128 amount)
  AwardCommitted(bytes32 indexed id, uint64 indexed actorId, uint128 gross, uint128 fee, bytes32 sourceDigest)
  DestinationBound(uint64 indexed actorId, address indexed destination, uint64 version, bytes32 claimDigest, uint64 activatesAt)
  BindingCancelled(uint64 indexed actorId, uint64 version)
  Paid(bytes32 indexed id, uint64 indexed actorId, address indexed destination, uint64 version, uint128 gross, uint128 net, uint128 fee)
  UnusedWithdrawn(address indexed destination, uint128 gross, uint128 net, uint128 fee)
  FeesClaimed(address indexed feeRecipient, uint128 amount)
  MonthlyCommitmentSet(uint128 cap, bool enabled)
  MonthlyCommitted(uint32 indexed period, bytes32 allocationRoot, uint128 gross, uint256 awards)
  deposit(uint128) commitAward(bytes32,uint64,uint128,bytes32) commitBountyAward(bytes32,uint64,uint128,bytes32)
  withdrawUnused(uint128) pay(bytes32,uint64) claimFees() totals() decimals() purpose()
  setMonthlyCommitment(uint128,bool) commitMonthly(uint32,(uint64,uint128,bytes32)[],bytes)
  monthlyCap() monthlyEnabled() monthlyRoots(uint32) monthlyWindow(uint32)
  monthlyDigest(uint32,bytes32) allocationRoot((uint64,uint128,bytes32)[])
  payoutFee(uint128) = gross / 50   withdrawalFee(uint128) = payoutFee(gross)
EscrowFactory (UUPS proxy; the implementation constructor disables initializers)
  initialize(address registrar, address feeRecipient, address identityAuthority, uint64 bindingDelay, address upgradeAuthority, address vaultImplementation)
  proposeUpgradeAuthority(address) acceptUpgradeAuthority() setVaultImplementation(address)
  create(bytes32 projectId, address token, uint8 purpose)   (owner = msg.sender)
  createWithMonthlyCommitment(bytes32 projectId, address token, uint128 cap, bool enabled)
  vaults(bytes32 key) vaultKey(address owner, bytes32 projectId, address token, uint8 purpose)
  VaultCreated(bytes32 indexed projectId, address indexed token, address indexed vault, address owner, uint8 purpose, uint8 decimals)
```

The adapter exports the topics as `EVM_ESCROW_EVENT_TOPICS`, computed from
these signatures. For the full ABI, use `forge inspect ProjectEscrow abi`.

## Local validation

Use Foundry 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`)
and the compiler pinned in `foundry.toml`. From the repository root:

```sh
forge fmt --root contracts/evm --check
forge build --root contracts/evm --sizes
forge test --root contracts/evm
bun contracts/evm/adapter.integration.ts
```

`forge test` runs the Foundry suites under `test/`. `test/AnyToken.t.sol`
covers 0-, 2-, 9- and 18-decimal tokens, amounts beyond `uint64`, `uint128`
overflow, permissionless deposit, the 2% withdrawal fee, fee-on-transfer
rejection, tokens without valid decimals, one vault per owner, project, token
and purpose, and `totals()`. `test/MonthlyCommitment.t.sol` covers the monthly
commitment and purpose isolation. The invariant suite runs at 6 and 18 decimals with random
depositors. The suites also include regression tests for the
binding lifecycle (commit delay, payment frozen during a rotation and after its
cancel, cancel cap between payments and its waiver during a pending rotation,
delay bounds, one-shot cancel), token and
accounting checks, and invariant runs over random owner, authority and payer
sequences. These suites are regression evidence, not a security review. The
`base` job in `.github/workflows/escrow-tests.yml` runs the format check, build
and `forge test` on every escrow change.

The integration deploys `integration/TestDollar.sol`, a six-decimal test
ERC-20, and `test/WideToken.sol` at 18 decimals with amounts beyond `uint64`. The test token is not Circle USDC; Circle integration, wallet signatures, OAuth, indexer finality,
and live broadcast require separate public-chain acceptance. The adapter integration
script starts an isolated Anvil on port 18546 (`SLOP_EVM_ADAPTER_TEST_PORT`), executes actual deployment,
permissionless vault creation, award, monthly commitment and payment
transactions, and checks canonical finalized receipts plus rejection
of wrong chains, vaults, obligations, event indices, and nonfinalized receipts.

## Testnet deployment

Each checked-in script rejects every chain except its own. Every script reads
four public addresses from the environment: `ESCROW_REGISTRAR`,
`ESCROW_FEE_RECIPIENT`, `ESCROW_IDENTITY_AUTHORITY` and
`ESCROW_UPGRADE_AUTHORITY`. Each is required.
Only `DeployBase.s.sol` defaults `ESCROW_FEE_RECIPIENT` to Slop's published
Base fee recipient `0x8f77C37D8650776bFe73c9b12B15209eE15D9b86` when it is not
set. No script fixes a token: one factory serves every ERC-20 on its chain.
Supply a dedicated test-only external signer through Foundry's account or
hardware-wallet options. The signer pays gas and holds a role only if explicitly
selected for it. Do not put
a private key in a command, environment dump, source file, or evidence.

First simulate the exact compiled source:

```sh
cd contracts/evm
forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --account slop-test-deployer
```

Use `DeployEthereumSepolia.s.sol:DeployEthereumSepolia` with
`$ETHEREUM_SEPOLIA_RPC_URL`, or follow
[`docs/robinhood-chain-testnet-runbook.md`](../../docs/robinhood-chain-testnet-runbook.md)
for Robinhood Chain Testnet. After the test deployment authority reviews the
simulation, the same invocation with `--broadcast` submits testnet
transactions. No public deployment was run as part of the local
implementation. Mainnet steps are in [`../DEPLOY-MAINNET.md`](../DEPLOY-MAINNET.md);
a human or owner-authorized agent may run them under PRD section 11.
Keep transaction artifacts in ignored `broadcast/`, and
publish only reviewed safe deployment evidence.

Record the source SHA, compiler settings, factory address, deployment
transaction, chain ID, registrar and its custody, fee address, identity
authority and upgrade authority. Verify proxy and implementation bytecode,
atomic initialization, and zero binding and rotation delays as described in
the mainnet guide. The project
owner creates each vault from its own account with
`create(projectId, token, purpose)`; then verify its owner, purpose, token,
decimals, project ID, and authority. Export the ABI from
`forge inspect ProjectEscrow abi` as build output for the adapter; do not
maintain a handwritten second ABI. Run the full acceptance scenario with
actual test tokens and finalized receipts. Independent review, a rehearsed run
of the key recovery runbook on the test deployment, and public-chain evidence
remain launch gates.

## Referral distributor

`src/ReferralDistributor.sol` is a separate, non-upgradeable contract for the
Slop Cash S.P. project-referral program approved in PRD section 11,
"Referral program". The program token is not deployed yet. It is separate from the
escrow: it holds one ERC-20 (the program token), has no factory, no proxy, no
project id and no vault role, and the escrow never calls it.

- A bounded poster calls `postRoot(index, root, newTotal)` once per epoch.
  The index must be the next one, no root may be pending, at least
  `postSpacing` must have passed since the last non-voided post, the total
  may not fall below what was already claimed or exceed the highest total
  ever posted by more than `epochCap`, and the balance plus what was already
  claimed must cover it. Claims against the root open `CLAIM_DELAY` (7 days)
  later. The sum of all claims never exceeds the active root's declared
  total, so a root the owner does not void can redirect at most the unclaimed
  part of the previous total plus one `epochCap`.
- The owner may `voidRoot(index)` inside that window. A voided epoch keeps its
  index, the previous live root stays claimable, and the next post carries
  the corrected totals. `pause` freezes a pending root's window and blocks
  posts, claims and rescue; `unpause` gives the root the time it had left.
  The owner can also change the poster, hand over ownership in two steps,
  and `rescue(to)` the whole balance only after `RESCUE_DELAY` (365 days)
  with no root going live and no unpause, which ends the program.
- A referrer calls `claim(cumulative, proof)` and receives `cumulative` minus
  what it already claimed. The leaf is
  `keccak256(bytes.concat(keccak256(abi.encode(account, cumulative))))` with
  sorted-pair hashing, the same bytes `workers/referral-accrual/merkle.ts`
  builds; both test suites assert fixed vectors. Nobody pushes a transfer and
  nobody holds a recipient list. `currentRoot()` and `claimableAt(index)`
  report the live root and each window without a transaction.

`test/ReferralDistributor.t.sol` (19 tests) covers claims after the delay,
double claims, cumulative differences, void inside and after the window, cap,
shrink and funding checks, one pending root at a time, post spacing, roles,
pause with a frozen window, rescue timing, proof binding to `msg.sender`,
claims bound to the declared total, failed transfers, a three-leaf tree and
a fuzz over two epochs. `script/DeployReferralDistributorRobinhoodTestnet.s.sol`
deploys it on chain id 46630 with `integration/MockReferralToken.sol`; see
[`docs/referral-distributor-testnet-runbook.md`](../../docs/referral-distributor-testnet-runbook.md)
(prepare only; nothing has been deployed). The AI-assisted internal review is
[`docs/security/referral-distributor-ai-review-2026-10-25.md`](../../docs/security/referral-distributor-ai-review-2026-10-25.md);
it is not an audit.
