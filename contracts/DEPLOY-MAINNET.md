> Current owner decision (24 October 2026): deploy replacement EVM UUPS proxies
> with `ESCROW_UPGRADE_AUTHORITY` explicitly set and `BINDING_DELAY = 0`.
> The script deploys vault logic, factory logic and an atomically initialized
> factory proxy. Retain Solana upgrade authority. Neither upgrade path has a
> timelock. Historical immutable contracts retain their original behavior.
> Record `evmUpgrade` (authority, both implementation addresses and both code
> SHA-256 digests) alongside the proxy digests. Read ERC-1967 implementation
> slots at the same finalized block used for verification. Proxy bytecode alone
> does not prove the approved logic. After an upgrade, review and append a new
> registry revision before treating the new implementation as accepted, and keep
> the outgoing implementation in its reviewed history so events from before the
> upgrade still verify. Copy the same `evmUpgrade` (including `history`) into the
> executor's pinned `PAYMENT_DEPLOYMENTS`; it is compared field by field, and a
> mismatch makes monthly signing fail closed. Each history entry's
> `supersededAtBlock` is the block of the LAST proxy upgrade (vault or factory)
> that leaves that review; events after it from that review are rejected, so a
> bound set at the first of several upgrades would reject events from proxies
> not yet upgraded.
>
> Pending upgrades (24 October 2026): the mainnet EVM vaults and the Solana
> program were deployed from `bce5b0df`. Source on `development` rounds the 2%
> fee up (#1189) and, on Solana, releases a monthly award whose source already
> holds the identical award (#1175). The payment executor already relies on that
> Solana release rule. Upgrade the Solana program and record its new
> `codeSha256` before any Solana project turns on automatic monthly payment;
> until the upgrade, reconciliation accepts either fee rounding. The EVM
> upgrade kit (deploy script, calldata, fork rehearsal and registry revision)
> is in section 4; it is prepared and unsigned.

# Owner-controlled escrow mainnet deployment

## Current mainnet deployments

The owner approved activation on every network on 24 October 2026. These are
deployments, not project activations. The source is `main` at `bce5b0df`.
The independent reviews were waived (#903), not completed.

EVM (Base 8453, Ethereum 1, Robinhood Chain 4663) uses the same addresses and
runtime code on each chain:

| Role                   | Address                                      | Runtime SHA-256                                                    |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Factory proxy          | `0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb` | `afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509` |
| Factory implementation | `0xc831Fc745a63161Df6Fae612bDFE77B969b329fE` | `62a3bf4a741b8084a63152835047bb71e8396b153a112225910d1dffecd64275` |
| Vault implementation   | `0xe137dE4fbAc6438007703065C905a58b03322Fc8` | `1c21fa901dc924a7a2dd84b770b7d1cf69ef14ba97957ae5c8986232b8f9d551` |

Registrar `0xd64F35aC87D9a1FB8eBD44e745c24436B606cF60`, identity authority
`0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70`, fee recipient
`0x8f77C37D8650776bFe73c9b12B15209eE15D9b86`, upgrade authority and deployer
`0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D`, binding delay 0. Sourcify has a
full match for all three contracts on each chain.

Solana program `7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ`: upgrade
authority `EmMRRFhjZmr2SN5RdhV98WPnUhgJxKMoE1itSwUsU8tr`, 681,392 bytes,
`codeSha256` `86a24ca13ba7ace124cf81fcb0d182f54ad480081e8bb0b847d12ee32c0c0726`.
Config `9hjoFnUrgF65K4DnWSDbS1WJjoGu4LChuz8XFq73UtaS`: identity authority
`Eq6tYrPnkhj3hLmSZUL9xUWjkZ3Y5j3naBAJyQyKMYzS`, fee recipient
`9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY`, rotation authority
`2tAA47aavW2mqtCAxbn21ZqLb8xZTeq8XvkRR9emduiy`. The release issues (#898,
#899, #900, #901) hold the transaction identities. The verifiable Docker
build and second-operator hash are still open for Solana.

These steps deploy replacement UUPS EVM factories and vault implementations,
and deploy or upgrade the Solana program with owner-controlled upgrades.
The approved launch order is Base, Solana, Ethereum, then Robinhood.

Deployment runs through a human operator. Under the current repository rules,
humans create, store and rotate signing keys and deploy mainnet contracts.
Agents may prepare unsigned plans, review public configuration and verify
public chain evidence; they must not handle signing material or execute a
mainnet deployment. Application services receive only their separately
authorized attester or fee-conversion key, never deployment or upgrade keys.
Keep signing material and transaction journals private; publish only
transaction identities and verified results.

No project activates escrow because a factory or program exists. Activation
needs a reviewed manifest revision with the deployment evidence below
(`src/lib/escrow-policy.mjs`, `assertEscrowPolicy`).

## 0. Before any network

1. Check out the reviewed commit of `main`. Record its SHA. Run
   `git status` and confirm a clean tree.
2. Record the owner waiver of independent contract and legal reviews
   ([#903](https://github.com/SlopDotCash/slopdotcash/issues/903)). Do not report
   those reviews as completed. Confirm that the testnet acceptance runs
   (`docs/robinhood-chain-testnet-runbook.md` and the Base Sepolia run) and a
   rehearsed key recovery runbook are recorded. These are launch gates.
3. Record the approved public role addresses and their
   custody:
   - `ESCROW_REGISTRAR`: proposes identity authority
     rotations. Use the owner-controlled custody process, never the attester
     service key.
   - `ESCROW_IDENTITY_AUTHORITY`: Slop's attester key (PAY-05).
   - `ESCROW_FEE_RECIPIENT`: the network fee wallet. On Base the script
     defaults to Slop's published Base fee recipient
     `0x8f77C37D8650776bFe73c9b12B15209eE15D9b86` when this variable is not
     set. On every other chain it is required.
4. Set `ESCROW_UPGRADE_AUTHORITY` to the approved deployment authority. It can
   upgrade factory and vault logic immediately. The deployer pays gas and holds
   upgrade power only if selected. Use a hardware
   wallet (`--ledger` or `--trezor`) or a human-managed Foundry keystore
   (`--account`). Hardware is optional; the owner selected software custody.
   Never pass a private key on the command line.
5. Use Foundry 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`).
   Build and test the exact tree:

   ```sh
   cd contracts/evm
   forge fmt --check
   forge build --sizes
   forge test
   ```

## 1. EVM factory deployment (Base, Robinhood Chain, Ethereum)

| Network         | Chain id | Script                                         | RPC variable        |
| --------------- | -------- | ---------------------------------------------- | ------------------- |
| Base            | 8453     | `script/DeployBase.s.sol:DeployBase`           | `BASE_RPC_URL`      |
| Robinhood Chain | 4663     | `script/DeployRobinhood.s.sol:DeployRobinhood` | `ROBINHOOD_RPC_URL` |
| Ethereum        | 1        | `script/DeployEthereum.s.sol:DeployEthereum`   | `ETHEREUM_RPC_URL`  |

Each script rejects every other chain id and reverts when a required address
is missing. One factory serves every standard ERC-20 on its chain; the
project owner later creates its own vault per project, token and purpose.

### 1.1 Robinhood Chain only: opcode check

The compiled contracts use `MCOPY` (Cancun). Read the ArbOS version first:

```sh
cast chain-id --rpc-url "$ROBINHOOD_RPC_URL"                  # 4663
cast call 0x0000000000000000000000000000000000000064 \
  'arbOSVersion()(uint256)' --rpc-url "$ROBINHOOD_RPC_URL"    # must be >= 75
```

`arbOSVersion()` returns 55 plus the ArbOS version; ArbOS 20 added `MCOPY`.
Stop if the value is below 75. Record the value and block.

### 1.2 Simulate

```sh
cd contracts/evm
export ESCROW_REGISTRAR=0x...
export ESCROW_UPGRADE_AUTHORITY=0x...
export ESCROW_IDENTITY_AUTHORITY=0x...
export ESCROW_FEE_RECIPIENT=0x...      # optional on Base only
forge script script/DeployEthereum.s.sol:DeployEthereum \
  --rpc-url "$ETHEREUM_RPC_URL" --account slop-mainnet-deployer --sender 0xYourDeployer
```

Replace the script and RPC for Base or Robinhood Chain. Read the simulated
`FactoryDeployed` event: chain id, registrar, identity authority, fee
recipient, and `bindingDelay = 0`. A second person checks each address
against the recorded decision.

### 1.3 Broadcast

Run the same command with `--broadcast`. Keep the `broadcast/` artifacts out of
git. Record the factory address and the deployment transaction hash.

### 1.4 Verify the deployed factory

```sh
FACTORY=0x...
RPC="$ETHEREUM_RPC_URL"
BLOCK=$(cast block finalized --rpc-url "$RPC" --field number)
cast call "$FACTORY" 'registrar()(address)' --rpc-url "$RPC" --block "$BLOCK"
cast call "$FACTORY" 'identityAuthority()(address)' --rpc-url "$RPC" --block "$BLOCK"
cast call "$FACTORY" 'feeRecipient()(address)' --rpc-url "$RPC" --block "$BLOCK"
cast call "$FACTORY" 'upgradeAuthority()(address)' --rpc-url "$RPC" --block "$BLOCK"
cast call "$FACTORY" 'bindingDelay()(uint64)' --rpc-url "$RPC" --block "$BLOCK"
cast call "$FACTORY" 'AUTHORITY_ROTATION_DELAY()(uint64)' --rpc-url "$RPC" --block "$BLOCK"
cast code "$FACTORY" --rpc-url "$RPC" --block "$BLOCK" | xxd -r -p | shasum -a 256
```

Deploy the same build with the same constructor arguments on a local Anvil and
compare the runtime code SHA-256. The digest is the manifest's
`factoryCodeSha256`. Retain `BLOCK` with the evidence and use it for the
implementation-slot and implementation-code reads required above. Do not
resolve the moving `finalized` tag again between verification reads.

### 1.5 Source verification

```sh
forge verify-contract "$FACTORY_IMPLEMENTATION" src/ProjectEscrow.sol:EscrowFactory \
  --chain-id 1 --watch \
  --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY"
```

- Base: `--chain-id 8453`, Etherscan v2 API key (Basescan).
- Ethereum: `--chain-id 1`.
- Robinhood Chain: `--chain-id 4663 --verifier blockscout --verifier-url
https://robinhoodchain.blockscout.com/api/`.

`foundry.toml` pins solc 0.8.30, `evm_version = "cancun"`, optimizer 200 runs
and `bytecode_hash = "none"`; the verifier reads them from the project.

### 1.6 Each vault

Vault creation is permissionless. The project owner sends the transaction from
its own account and becomes the owner. `PURPOSE` is `0` for the ordinary vault
and `1` for a private bounty vault:

```sh
cast send "$FACTORY" 'create(bytes32,address,uint8)' \
  "$PROJECT_ID" "$TOKEN" "$PURPOSE" --rpc-url "$RPC" --account slop-mainnet-owner
KEY=$(cast call "$FACTORY" 'vaultKey(address,bytes32,address,uint8)(bytes32)' \
  "$OWNER" "$PROJECT_ID" "$TOKEN" "$PURPOSE" --rpc-url "$RPC")
VAULT=$(cast call "$FACTORY" 'vaults(bytes32)(address)' "$KEY" --rpc-url "$RPC")
```

> **Required upgrade step, not performed.** Owner vault setup on the website
> calls `createWithMonthlyCommitment`. The current mainnet factories listed
> above do not have this method. Before setup can work on a network, an
> operator must deploy and verify new factory and vault implementations, and
> the upgrade authority (the owner wallet) must sign the factory upgrade below.
> Until then, the setup route refuses creation on that network. No one has
> deployed, signed or submitted this upgrade. Section 4 holds the prepared,
> unsigned upgrade kit.

For a new ordinary vault under PRD decision D1, use the reviewed factory and
vault implementation that support atomic monthly setup. The older deployments
listed above do not gain this method from a source merge. After a reviewed
operator upgrade, replace the creation call above with:

```sh
cast send "$FACTORY" 'createWithMonthlyCommitment(bytes32,address,uint128,bool)' \
  "$PROJECT_ID" "$TOKEN" "$MONTHLY_CAP_BASE_UNITS" true \
  --rpc-url "$RPC" --account slop-mainnet-owner
```

The owner chooses `MONTHLY_CAP_BASE_UNITS`; false instead of true opts out.
Read `monthlyCap()` and `monthlyEnabled()` from the created vault at the same
finalized block as its other acceptance reads. The legacy creation call is
for compatibility and private bounty vaults; it does not enable the default.

For an existing factory, the operator first deploys and verifies the reviewed
replacement factory and vault implementations. Prepare and simulate this
unsigned factory upgrade, which also selects the implementation for future
vaults in the same transaction:

```sh
SET_VAULT_DATA=$(cast calldata 'setVaultImplementation(address)' "$NEW_VAULT_IMPLEMENTATION")
UPGRADE_DATA=$(cast calldata 'upgradeToAndCall(address,bytes)' "$NEW_FACTORY_IMPLEMENTATION" "$SET_VAULT_DATA")
cast call "$FACTORY" "$UPGRADE_DATA" --from "$UPGRADE_AUTHORITY" --rpc-url "$RPC"
```

Only the operator signs and submits the reviewed payload. After finality,
verify the implementation slots, code hashes, selected vault implementation,
roles and existing vault mapping. Append the new factory evidence to affected
registry records before resuming verification. This does not upgrade existing
vaults or change their caps, switches, balances, bindings or awards.

Before you create a vault, check that the token is a standard ERC-20 with
exact transfers: no fee on transfer, no rebasing. Read `decimals()` and record
it. After creation, verify the vault source like the factory (the constructor
arguments are the vault implementation and the encoded initializer used for
creation), record its runtime code SHA-256 as `codeSha256`, and run
`verifyEvmDeployment` from `contracts/evm/adapter.ts` against the manifest
before activation.

### 1.7 EVM evidence

Record: source SHA, Foundry version, chain id, ArbOS version (Robinhood
Chain), deployer, registrar and custody, identity authority and custody, fee
recipient, factory address, deployment transaction, `factoryCodeSha256`, local
Anvil digest, explorer verification link, and for each vault its project ID,
token, decimals, creation transaction and `codeSha256`.

## 2. Solana program deployment, upgrade and verification

Program: `slop-escrow`, ID `7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ`
(upgradeable). It exists on devnet and on mainnet; see "Current mainnet
deployments" below. Read the target cluster again before deciding between
initial deployment and upgrade.

Use the owner-controlled operator process described above. The application
services do not receive the payer or upgrade key. The plan builders in
`contracts/solana/scripts/` read chain state and produce unsigned transactions.

Placeholders:

- `$PROGRAM` = `7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ`
- `$PROGRAM_KEYPAIR` = the private keypair whose public key equals `$PROGRAM`;
  required only for initial deployment
- `$RPC` = a private mainnet RPC URL (`-u $RPC` below; never commit it)
- `$UPGRADE_AUTHORITY` = the current upgrade authority signer (keypair path or
  `usb://ledger?key=N`)
- `$PAYER` = the fee payer keypair for the buffer
- `$IDENTITY` = the published Slop identity authority (attester) public key
- `$FEES` = the published Slop fee recipient public key

### 1. Preconditions

1. The change is merged to `main` through a reviewed PR. CI is green on the
   exact commit. Record the commit SHA as `$COMMIT`.
2. Record the owner waiver of external reviews and the actual validation
   results for this version. A waiver is not review evidence.
3. `$IDENTITY` and `$FEES` are published and approved by the repository owner.
   They must be distinct. They cannot change after step 6.
4. Use the production build. The lifecycle suite uses the same build; zero
   mandatory delays no longer need a separate short-delay test build.

### 2. Verifiable build with the pinned toolchain

```bash
git clone https://github.com/SlopDotCash/slopdotcash.git && cd slopdotcash
git checkout "$COMMIT"
cd contracts/solana
# Either verifiable path; both use a pinned Docker image.
solana-verify build --library-name slop_escrow
# or: anchor build --verifiable   (Anchor 0.32.1; image solanafoundation/anchor:v0.32.1)
```

Record the output file (`target/deploy/slop_escrow.so` for `solana-verify`,
`target/verifiable/slop_escrow.so` for Anchor) as `$SO`.

```bash
sha256sum "$SO"                          # REVIEWED_SO_SHA256
solana-verify get-executable-hash "$SO"  # REVIEWED_EXECUTABLE_HASH
```

A second operator repeats this step on a different machine. Both hashes must
match. Record them in the release issue.

### 3. Record the current deployed program

If the program account is absent, verify the target cluster and that
`solana-keygen pubkey "$PROGRAM_KEYPAIR"` equals `$PROGRAM`. Record initial
deployment and skip the existing-program dump, hash and extension checks below.
An RPC failure is not evidence that the account is absent.

```bash
solana program show "$PROGRAM" -u "$RPC"           # record Authority and Data Length
solana program dump "$PROGRAM" current.so -u "$RPC"
sha256sum current.so                               # PREVIOUS_DEPLOYED_SHA256
solana-verify get-program-hash "$PROGRAM" -u "$RPC"
```

The previous hash must equal the hash recorded at the last reviewed release.
If it differs, stop: the program changed outside the runbook.

If the size of `$SO` is larger than the `Data Length`, extend the program first:

```bash
solana program extend "$PROGRAM" <ADDITIONAL_BYTES> -u "$RPC" --keypair "$PAYER"
```

### 4. Write and check the buffer

```bash
solana program write-buffer "$SO" -u "$RPC" --keypair "$PAYER"   # prints BUFFER
solana program set-buffer-authority "$BUFFER" \
  --new-buffer-authority <UPGRADE_AUTHORITY_PUBKEY> -u "$RPC" --keypair "$PAYER"
solana program dump "$BUFFER" buffer.so -u "$RPC"
```

The prefix of `buffer.so` must equal `$SO` byte for byte, and any trailing
bytes must be zero:

```bash
python3 - "$SO" buffer.so <<'PY'
import sys, hashlib
local = open(sys.argv[1], 'rb').read(); remote = open(sys.argv[2], 'rb').read()
assert remote[:len(local)] == local, 'buffer differs'
assert not any(remote[len(local):]), 'nonzero trailing bytes'
print('ok', hashlib.sha256(local).hexdigest())
PY
```

### 5. Deploy or upgrade

For an initial deployment, use the program keypair as the program signer:

```bash
solana program deploy --program-id "$PROGRAM_KEYPAIR" --buffer "$BUFFER" \
  --upgrade-authority "$UPGRADE_AUTHORITY" --keypair "$PAYER" -u "$RPC"
solana program dump "$PROGRAM" upgraded.so -u "$RPC"
```

For an existing program, use its current upgrade authority:

```bash
solana program upgrade "$BUFFER" "$PROGRAM" \
  --upgrade-authority "$UPGRADE_AUTHORITY" -u "$RPC"
# equivalent: solana program deploy --program-id "$PROGRAM" --buffer "$BUFFER" \
#   --upgrade-authority "$UPGRADE_AUTHORITY" -u "$RPC"
solana program dump "$PROGRAM" upgraded.so -u "$RPC"
```

Run the same prefix check on `upgraded.so` against `$SO`. Then:

```bash
sha256sum upgraded.so                                # DEPLOYED_CODE_SHA256
solana-verify get-program-hash "$PROGRAM" -u "$RPC"  # must equal REVIEWED_EXECUTABLE_HASH
```

`DEPLOYED_CODE_SHA256` hashes every ProgramData byte after the 45-byte header,
including zero padding. It is the `codeSha256` value for every project manifest.

Optionally submit the verification to the public registry:
`solana-verify verify-from-repo -u "$RPC" --program-id "$PROGRAM" --library-name slop_escrow --mount-path contracts/solana --commit-hash "$COMMIT" https://github.com/SlopDotCash/slopdotcash`.

### 6. Create the Config once with the upgrade authority

Write `config-input.json`:

```json
{
  "programId": "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ",
  "upgradeAuthority": "<UPGRADE_AUTHORITY_PUBKEY>",
  "codeSha256": "<DEPLOYED_CODE_SHA256>",
  "identityAuthority": "<IDENTITY>",
  "feeRecipient": "<FEES>",
  "rotationAuthority": "<ROTATION_AUTHORITY>"
}
```

Build the unsigned transaction. The script checks the cluster genesis, the
deployed bytes, the upgrade authority, and that no Config exists:

```bash
cd contracts/solana && npm ci --ignore-scripts --legacy-peer-deps
SLOP_SOLANA_RPC_URL="$RPC" \
SLOP_SOLANA_GENESIS=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
SLOP_SOLANA_RECENT_BLOCKHASH="$(solana -u "$RPC" block --output json | jq -r .blockhash)" \
node scripts/config-plan.mjs plan config-input.json > config-plan.json
```

Check `config-plan.json`: `requiredSigner` is the upgrade authority,
`identityAuthority` is `$IDENTITY`, `feeRecipient` is `$FEES`. The upgrade
authority signs `transactionBase64` with its own wallet tooling and sends it,
within the blockhash lifetime (about 60 seconds; rebuild if it expires). The
transaction is an ordinary unsigned legacy transaction, the same format as
`owner-plan.mjs` output.

Confirm the result:

```bash
node scripts/config-plan.mjs projects config-input.json   # "config" shows $IDENTITY and $FEES
```

The Config has no update or close instruction. A mistake here requires a new
program deployment, so check both keys twice before signing.

### 7. List existing Project accounts

```bash
SLOP_SOLANA_RPC_URL="$RPC" SLOP_SOLANA_GENESIS=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
node scripts/config-plan.mjs projects config-input.json > projects.json
```

This is a `getProgramAccounts` query on the Project discriminator
(`cda8bdcab5f78e13`). Every entry with `"pinned": false` was created before the
Config, or with another fee recipient. Record each one in the release issue
with its owner, fee recipient, identity authority and size. The adapter refuses
every unpinned project, so its manifest cannot activate payments. Tell its owner
to create a new project under the Config and move unused funds with
`withdraw` (2% fee).

### 8. Retain the owner's upgrade authority

The owner approved continuing Solana upgradeability without a timelock on 24 October 2026.
Keep the separate owner-controlled upgrade key. Do not use `--final` and do not
transfer this authority to the identity attester or fee converter. Record its
public key in the reviewed manifest. The authority can replace fund-controlling
code; this trust remains explicit after activation.

### 9. Final checks

```bash
solana program show "$PROGRAM" -u "$RPC"   # Authority: the approved owner upgrade public key
solana program dump "$PROGRAM" final.so -u "$RPC"
sha256sum final.so                         # must equal DEPLOYED_CODE_SHA256
solana-verify get-program-hash "$PROGRAM" -u "$RPC"   # must equal REVIEWED_EXECUTABLE_HASH
node scripts/config-plan.mjs projects config-input.json   # Config unchanged
```

Every project manifest then uses `codeSha256 = DEPLOYED_CODE_SHA256`,
`upgradeAuthority = $UPGRADE_AUTHORITY_PUBKEY`, `identityAuthority = $IDENTITY` and
`feeRecipient = $FEES`. The adapter (`verifySolanaDeployment`) refuses any
other value. Attach the commands, outputs and hashes from every step to the
release issue. An upgrade is not proof of payment availability: run the funded
lifecycle on each activated project separately.

## 3. Payout activation, one network at a time

Do this section for one network. Finish it, reconcile the first payout, and
record the evidence before you start the next network. Agents must not run
these steps; they may prepare commands and read reports.

The code enables only Base mainnet (section 3.6). Every other value in
`workers/payment-executor/mainnet-execution.mjs` is `false`, and the
executor and the attester refuse those mainnets before they read a signer
secret. `workers/payment-executor/configure.mjs --stack production`
generates the production stack for one mainnet. It is the identity attester
Worker only (PAY-05). Slop holds no relayer key and runs no dispatcher or
other scheduled job that starts a payment (PAY-04). The project or a
permissionless executor holds the relayer key and submits the approved
payments.

### 3.1 Preconditions

1. Sections 0 to 2 are complete for this network, and the independent review
   and the testnet acceptance runs are recorded.
2. An admin revision on `/admin` records the vault deployment in the project
   manifest (`escrow.deployments`), with the factory, factory code digest,
   registrar and identity authority from section 1.7 or section 2.9.
3. The identity authority address in each factory (EVM) or Config (Solana) is
   the address of the attester key that the attester Worker will use. Read it
   back from the chain at the finalized block and record it.

### 3.2 Configure the stack

1. Pin the signer deployments from the registry snapshot:
   `bun run projects:sync`, then
   `bun run payments:deployments mainnet <network> > pinned.json`.
2. Generate the stack:
   `node workers/payment-executor/configure.mjs --stack production --network <network> --deployments pinned.json --output workers/payment-executor/.generated`.
   It writes the attester configuration only, with
   `SIGNER_STACK=production`. Review the configuration and
   `apply-production-stack.sh`.
3. Put the attester key in the managed secret store of the attester Worker
   only, as `SIGNER_PRIVATE_KEY` (EVM) or `SOLANA_SIGNER_SEED` (Solana, 64 hex
   digits). One key per network. Never reuse the registrar, owner, fee-wallet
   or a test key. Do not create or store a relayer key: the project or a
   permissionless executor holds it (PAY-04). The hosted signer refuses the
   relayer role on a production stack.
4. Set `PAYMENT_RPC_URLS` on the attester Worker to a private endpoint for
   this network that serves the finalized tag (EVM) or finalized commitment
   (Solana).
5. To let contributors sign the destination binding on the site, add this
   network to the Pages variable `PAYMENT_NETWORKS` in `wrangler.toml`
   through a reviewed pull request. Until then `/wallets/bind-challenge`
   refuses this network.

### 3.3 Readiness report

Run the report with the stack configurations and the private RPC map in your
local shell. The report never prints an RPC URL.

```sh
PAYMENT_RPC_URLS="$PRIVATE_RPC_JSON" \
PAYMENT_SOLANA_GENESIS="$GENESIS_JSON" \
bun run payments:readiness \
  --registry-origin https://slop.cash \
  --config "$ATTESTER_CONFIG" \
  --probe
```

For each network the report states `factory`, `attester`, `rpc` and
`executor`. `--probe` reads the chain id or genesis hash and the finalized
head; `rpc=finalized` is the only passing probe result. For this network
`factory`, `attester` and `rpc` must pass. `executor` reports `missing`,
because Slop runs no relayer or dispatcher on a mainnet (PAY-04); the
executor of the project or the permissionless executor is verified
separately. Attach the report to the release issue.

### 3.4 Enable the executor for this network

1. Open a pull request that changes only this network's value in
   `mainnet-execution.mjs` to `true` and updates
   `mainnet-execution.test.ts` to match. Link the owner's audit waiver (PRD
   section 11, "External reviews"), the testnet evidence and the readiness
   report from step 3.3.
2. The repository owner reviews and merges it (PAY-05). Deploy the attester
   Worker from that reviewed commit only.
3. Run the readiness report again. `factory`, `attester` and `rpc` must
   pass for this network.

### 3.5 First payout and reconciliation

1. Approve one small award on one project of this network through the normal
   review flow. Wait for the contributor's wallet binding. It activates
   immediately; the binding delay is zero (PRD section 11, "Contract
   timelocks").
2. The executor of the project, or a permissionless executor, submits the
   payment with its own relayer key. Slop does not submit it, and does not
   send a manual transfer with any key.
3. Confirm the finalized `Paid` event, the obligation `state=paid`, the
   contributor net amount and the fee in the explorer, and the new
   `vault_snapshots` row (block, `total_paid`, `total_payout_fees`).
4. Confirm that the funding page shows the same totals and the observed time.
5. Record the transaction, the snapshot row and the page screenshot on the
   release issue. Then start the next network at step 3.1.

### 3.6 Base mainnet activation: owner steps

The owner approved Base mainnet execution on 24 October 2026 and installs the
secrets. `base-mainnet` is `true` in `mainnet-execution.mjs`, and the Pages
`PAYMENT_NETWORKS` in `wrangler.toml` is `["base-mainnet"]`. The production
release (`.github/workflows/deploy.yml`, job `deploy`, `main` only, environment
`eliza-army-production`) generates the attester configuration with
`configure.mjs --stack production` from the registry snapshot of the released
commit. Then:

- If the snapshot pins no Base mainnet vault, the release skips the attester
  and reports a notice. The attester has nothing to sign.
- If the snapshot pins a vault, the release reads the secret names of
  `slop-payments-base-mainnet-attester` (never the values). The names must be
  exactly `PAYMENT_RPC_URLS` and `SIGNER_PRIVATE_KEY`. A missing or extra
  name stops the release before it changes the identity Worker, D1 or
  Pages. The release then deploys the attester with the commit SHA as its
  version tag and checks that the active version has that tag.

Install the secrets before the first snapshot that pins a Base vault reaches
`main`. The push of that snapshot to `main` starts a release, and that release
stops while the Worker or a secret is missing, as does every later release of
the site. Do these steps from a clean checkout of `development` after an admin
revision records the project's Base vault and the registry snapshot that
contains it is on `development`:

1. Generate the configuration. The secrets belong to the Worker name, so this
   configuration also serves the later `main` release:

   ```sh
   bun install --frozen-lockfile --ignore-scripts
   bun run payments:deployments mainnet base-mainnet > /tmp/base-mainnet-pinned.json
   node workers/payment-executor/configure.mjs --stack production \
     --network base-mainnet \
     --deployments /tmp/base-mainnet-pinned.json \
     --output workers/payment-executor/.generated
   CONFIG=workers/payment-executor/.generated/slop-payments-base-mainnet-attester.json
   ```

   `.generated/` is ignored by git.

2. Install the two secrets on the attester Worker only. Wrangler reads each
   value at its prompt; do not put a value in the command, a file in the
   repository, or the shell history. If the Worker does not exist yet,
   Wrangler asks to create it: answer yes.

   ```sh
   ./node_modules/.bin/wrangler secret put SIGNER_PRIVATE_KEY --config "$CONFIG"
   ./node_modules/.bin/wrangler secret put PAYMENT_RPC_URLS --config "$CONFIG"
   ```

   - `SIGNER_PRIVATE_KEY`: the `0x`-prefixed hex private key of the identity
     authority `0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70`. No other key.
   - `PAYMENT_RPC_URLS`: one line of JSON,
     `{"base-mainnet":"https://<private Base endpoint>"}`. The endpoint must
     serve the `finalized` block tag.

   Do not install a relayer key, a test key or a Solana seed. The release
   refuses any other secret name.

3. Check the names (Wrangler prints names, not values):

   ```sh
   ./node_modules/.bin/wrangler secret list --config "$CONFIG"
   ```

   The list must contain exactly `PAYMENT_RPC_URLS` and `SIGNER_PRIVATE_KEY`.

4. Fund `0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70` with a small Base ETH
   balance. The attester signs and pays gas for each destination binding
   transaction. It never pays out an award.

5. Optional: run the readiness report of section 3.3. Enter the RPC map at a
   silent prompt so that it is not in the command or the shell history:

   ```sh
   read -rs PAYMENT_RPC_URLS && export PAYMENT_RPC_URLS
   bun run payments:readiness --registry-origin https://slop.cash \
     --config "$CONFIG" --probe
   unset PAYMENT_RPC_URLS
   ```

   For `base-mainnet`, `factory` and `attester` must be `configured` and
   `rpc` must be `finalized`. `executor` reports `missing`.

6. Approve the production release: merge the reviewed promotion pull request
   from `development` to `main`. The `deploy` job checks the secrets and
   deploys the attester. Check the job log for the attester deploy, then
   check the Worker with
   `./node_modules/.bin/wrangler deployments status --config "$CONFIG"`.

Monitoring: the attester's five-minute cron run throws on any indexing or
monthly authorization failure, which shows in the Cloudflare Workers logs of
`slop-payments-base-mainnet-attester`
(`./node_modules/.bin/wrangler tail --config "$CONFIG"`). No alerting service
watches it.

Destination bindings: the attester's five-minute cron run binds them. After
it indexes the finalized vault events, it finds each reserved award on a
pinned vault whose contributor has a current signed wallet authorization and
a stored destination binding signature that is valid for at least 10 more
minutes. For each one it checks the award, the GitHub actor, the claim
digest and the wallet signature again, then submits `bindDestination` with
the identity key. It journals the signed transaction before the first
broadcast. When a broadcast result is unknown, the next run broadcasts the
same bytes again and never signs a second binding for that version. It
checks at most 10 contributors per run. A failed binding makes the cron run
fail in the Worker logs. The attester refuses `/v1/pay`; the cron run is its
only binding path. Slop does not submit the payout: `pay` is permissionless
(step 8 below).

#### Base test payout, owner sequence

This is the full sequence for one 10 USDC test award. Agents must not run
these steps. `$RPC` is your Base RPC URL, `--account owner` is your Foundry
keystore for the owner wallet, and `$ACTOR` is the contributor's numeric
GitHub ID. Run the commands from a clean checkout of `development`.

```sh
FACTORY=0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
OWNER=<your owner wallet address>
PROJECT=<the Slop project ID>
PROJECT_ID=$(cast format-bytes32-string "$PROJECT")
```

1. Create the vault from the owner wallet. Purpose `0` is the ordinary
   vault. `PROJECT_ID` is a nonzero label only; the admin revision of step 2
   links the vault to the project.

   ```sh
   cast send "$FACTORY" 'create(bytes32,address,uint8)' "$PROJECT_ID" "$USDC" 0 \
     --rpc-url "$RPC" --account owner
   KEY=$(cast call "$FACTORY" 'vaultKey(address,bytes32,address,uint8)(bytes32)' \
     "$OWNER" "$PROJECT_ID" "$USDC" 0 --rpc-url "$RPC")
   VAULT=$(cast call "$FACTORY" 'vaults(bytes32)(address)' "$KEY" --rpc-url "$RPC")
   ```

   Record the creation transaction and the vault's runtime code SHA-256
   (section 1.6).

2. On `/admin`, append a manifest revision for the project with a reason.
   It adds the `escrow` policy with one `base-mainnet` deployment: the vault,
   USDC as `asset`, your wallet as `owner`, the identity authority, fee
   recipient, factory, registrar, factory and vault code digests,
   `evmUpgrade`, `bindingDelaySeconds` `"0"` and the creation transaction
   (section 1.7). `escrow` is the payment switch: the schema requires
   `reward.paymentMode` `"disabled"` beside it, because that field controls
   only the old direct-payment path. Then sync the snapshot in a reviewed
   pull request to `development`: `bun run projects:sync`.

3. Install the attester secrets (steps 1 to 3 above). Do this before the
   promotion that carries the new snapshot reaches `main`, or the release
   stops at the secret check. Then merge the promotion pull request to
   `main` (step 6 above). The release deploys the attester and its cron.

4. Fund the attester for gas (step 4 above). About 0.001 ETH on Base pays
   for many bindings.

5. Deposit USDC into the vault. Use the "Fund or withdraw" panel on the
   project funding page, or approve and deposit (20 USDC here):

   ```sh
   cast send "$USDC" 'approve(address,uint256)' "$VAULT" 20000000 --rpc-url "$RPC" --account owner
   cast send "$VAULT" 'deposit(uint128)' 20000000 --rpc-url "$RPC" --account owner
   ```

6. Approve a 10 USDC award for the contributor. The monthly flow starts with
   the period `2026-11`, so for this test the owner commits the award
   directly. `SOURCE` must be a new nonzero 32-byte value for each award:

   ```sh
   SOURCE=$(cast keccak "slop-base-test-1")
   AWARD=$(cast call "$VAULT" 'awardId(bytes32)(bytes32)' "$SOURCE" --rpc-url "$RPC")
   cast send "$VAULT" 'commitAward(bytes32,uint64,uint128,bytes32)' \
     "$AWARD" "$ACTOR" 10000000 "$SOURCE" --rpc-url "$RPC" --account owner
   ```

   After the block is finalized (about 15 minutes on Base), the next
   attester run records the award as reserved.

7. The contributor signs the binding. The site has no button for this step
   yet. Signed in on `https://slop.cash`:
   1. On `/earnings`, connect and confirm the Base wallet (a
      `personal_sign` message).
   2. Switch the wallet to Base. In the browser console of the same page,
      run:

      ```js
      const call = async (path, body) => {
        const response = await fetch(`/api/v1/payments/wallets/${path}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
        return response.json();
      };
      const me = await (await fetch("/api/v1/payments/me", { credentials: "same-origin" })).json();
      const claimId = me.wallets.find((w) => w.chain === "base").claimId;
      const consent = { claimId, network: "base-mainnet", vault: "<VAULT>", expectedVersion: "0" };
      const { typedData } = await call("bind-challenge", consent);
      const [address] = await ethereum.request({ method: "eth_requestAccounts" });
      const signature = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify(typedData)],
      });
      await call("bind-authorize", { ...consent, expiresAt: typedData.message.expiresAt, signature });
      ```

      `expectedVersion` is `"0"` for the first binding. For a later one, use
      the version from `cast call "$VAULT" 'bindings(uint64)(address,uint64,bytes32,uint64,bool)' "$ACTOR" --rpc-url "$RPC"`.
      The signature is valid for 90 days.

   Within five minutes the attester submits `bindDestination`. Check it:

   ```sh
   cast call "$VAULT" 'payableBinding(uint64)(address,uint64)' "$ACTOR" --rpc-url "$RPC"
   ```

   The result is the contributor's wallet and version `1`. If it stays
   `0x0…0 0`, read the attester log with `wrangler tail` (step 6 above).

8. Pay. Any wallet may send this transaction; Slop holds no relayer key:

   ```sh
   cast send "$VAULT" 'pay(bytes32,uint64)' "$AWARD" 1 --rpc-url "$RPC" --account owner
   ```

   The contributor receives 9.8 USDC. After finality the attester run marks
   the award paid, and `/earnings` shows it.

9. Move the 2% fee (0.2 USDC) to the fee recipient
   `0x8f77C37D8650776bFe73c9b12B15209eE15D9b86`. Anyone may call it:

   ```sh
   cast send "$VAULT" 'claimFees()' --rpc-url "$RPC" --account owner
   cast call "$USDC" 'balanceOf(address)(uint256)' 0x8f77C37D8650776bFe73c9b12B15209eE15D9b86 --rpc-url "$RPC"
   ```

10. Withdraw the unused balance (10 USDC here). The vault keeps the 2%
    withdrawal fee. Use "Fund or withdraw" on the funding page, or:

    ```sh
    cast send "$VAULT" 'withdrawUnused(uint128)' 10000000 --rpc-url "$RPC" --account owner
    ```

    You receive 9.8 USDC. Run step 9 again to move the withdrawal fee.

Record the transactions on the release issue (section 3.5).

To stop new Slop attestations on a network, change its
`mainnet-execution.mjs` value back to `false` through a reviewed pull request
and redeploy the attester Worker. On Base the release redeploys it only while
the snapshot pins a Base vault, so stop the attester this way before a
snapshot removes the last pinned Base vault; a release with no pinned vault
leaves an existing attester unchanged. Do not delete `SIGNER_PRIVATE_KEY` to
stop it: every later release of the site then stops at the secret check. Do
not delete the Worker: that deletes its signing journal. Slop cannot stop a payment that the project
or a permissionless executor submits for an approved and funded obligation.

## 4. EVM upgrade to `development` 2a4e80b3

This upgrades the live EVM factory proxy and every vault proxy listed in
"Current mainnet deployments" (source `main` at `bce5b0df`) on Base, Ethereum
and Robinhood Chain to the escrow source on `development` at `2a4e80b3`. Agents
prepared this kit. They did not sign, send or broadcast any transaction. The
upgrade authority signs and sends every transaction in this section.

### 4.1 What changes

The only source change is `contracts/evm/src/ProjectEscrow.sol`
(`git diff bce5b0df 2a4e80b3 -- contracts/evm/src`):

- The 2% payout fee and the unused-fund withdrawal fee round up:
  `ceil(gross / 50)` (#1189). Before the upgrade they round down. A
  withdrawal or award under 50 base units now pays 1 base unit of fee.
- `commitMonthly` accepts an existing award that holds the old rounded-down
  fee, `floor(gross / 50)`, as the same obligation. It counts that award once
  and does not reserve it again.
- `EscrowFactory.createWithMonthlyCommitment` and
  `ProjectEscrow.initializeWithMonthlyCommitment` create an ordinary vault and
  set its monthly cap and switch in the same transaction (#1168). `create`
  stays for compatibility and for private bounty vaults.

Review results (agent review, 24 October 2026; not an independent audit):

- Storage layout. `forge inspect <contract> storageLayout` is identical at
  `bce5b0df` and `2a4e80b3` for `ProjectEscrow` (27 variables, slots 0 to 18)
  and `EscrowFactory` (10 variables, slots 0 to 7), including the `Award` and
  `Binding` struct layouts. No variable is added, removed, retyped or moved.
- Initializers. `initializeWithMonthlyCommitment` uses the `initializer`
  modifier, like `initialize`. Every existing proxy holds initialized version
  1 and has code, so both functions revert on it for every caller. Both
  implementation constructors call `_disableInitializers()`. The upgrade
  passes empty data, so no reinitializer runs and none is needed.
- Existing awards keep their stored fee. `pay` uses the fee stored at
  commitment, so a pre-upgrade award pays its rounded-down fee. Only new
  commitments and withdrawals use the rounded-up fee.
- Mixed state between steps fails closed. A new factory with the old vault
  implementation selected cannot run `createWithMonthlyCommitment`: the old
  vault logic has no `initializeWithMonthlyCommitment` and no fallback, so the
  creation reverts. The old factory with the new vault implementation works,
  because the new logic still has `initialize`.
- The vault proxy (`ERC1967Proxy`) runtime code does not change, so the
  registry `codeSha256` of a vault and the `factoryCodeSha256` stay the same.
- No defect was found.

### 4.2 Accepted risk: one upgrade key

The upgrade authority is the single key
`0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D` on all three chains. It can
replace factory and vault logic, including logic that holds deposited funds,
at once and without a timelock. On 24 October 2026 the owner decided to keep
this single key and not to move upgrade control to a multisig or a timelock.
Record this as an accepted risk. Do not describe the escrow as non-custodial
toward the upgrade key.

### 4.3 Reviewed implementations

Both implementations are created through the deterministic CREATE2 deployer
`0x4e59b44847b379578588920cA78FbF26c0B4956C` with salt
`keccak256("slop.escrow.implementation")` =
`0xbde1f59275bea48e817232a3bac1795c60b7725db9ceedfaf52afbfeb137183f`. The
address depends only on the creation code, so the address and runtime code are
the same on every chain. The runtime code includes the implementation's own
address (the UUPS self-reference), so the digests are known before signing.
The digest is SHA-256 over the decoded `eth_getCode` bytes, the value that
`contracts/evm/adapter.ts` compares.

| Role                   | Address                                      | Runtime SHA-256                                                    |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Vault implementation   | `0xf10EF0D801895FDbF240976f5d3010E314662f0C` | `05bef32c557281484149acd361f91f603b691ad281d6dcca341b3d51b9430367` |
| Factory implementation | `0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f` | `976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd` |

Reproduce them from a clean checkout with Foundry 1.7.1 and the pinned
`foundry.toml` (solc 0.8.30, cancun, optimizer 200 runs,
`bytecode_hash = "none"`). The same method reproduces the live `bce5b0df`
digests in "Current mainnet deployments":

```sh
cd contracts/evm
forge build
DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT=$(cast keccak "slop.escrow.implementation")
for CONTRACT in ProjectEscrow EscrowFactory; do
  HASH=$(cast keccak "$(cast concat-hex 0xff "$DEPLOYER" "$SALT" "$(cast keccak "$(forge inspect "$CONTRACT" bytecode)")")")
  echo "$CONTRACT 0x${HASH:26}"
done
# Runtime digests: a plain local Anvil (no fork) has the same CREATE2 deployer.
anvil --chain-id 8453 --port 18700 --silent &
forge script script/DeployUpgradeImplementations.s.sol:DeployUpgradeImplementations \
  --rpc-url http://127.0.0.1:18700 --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --unlocked --broadcast
for ADDRESS in 0xf10EF0D801895FDbF240976f5d3010E314662f0C 0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f; do
  cast code "$ADDRESS" --rpc-url http://127.0.0.1:18700 | xxd -r -p | shasum -a 256
done
kill %1
```

The same build at `bce5b0df`, with the old implementation addresses filled in,
gives the live digests `1c21fa90...d551` and `62a3bf4a...4275`; the agent
checked this against Base on 24 October 2026.

### 4.4 Before signing, on each chain

1. Robinhood Chain only: run the opcode check in section 1.1 again.
2. Confirm the live state. Every value must match "Current mainnet
   deployments":

   ```sh
   FACTORY=0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb
   AUTHORITY=0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D
   SLOT=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
   cast storage "$FACTORY" "$SLOT" --rpc-url "$RPC"            # ...c831fc745a63161df6fae612bdfe77b969b329fe
   cast call "$FACTORY" 'vaultImplementation()(address)' --rpc-url "$RPC"   # 0xe137dE4f...22Fc8
   cast call "$FACTORY" 'upgradeAuthority()(address)' --rpc-url "$RPC"      # $AUTHORITY
   cast call "$FACTORY" 'pendingUpgradeAuthority()(address)' --rpc-url "$RPC"  # 0x0
   ```

3. List every existing vault. Each vault proxy is upgraded separately. Read
   the factory's `VaultCreated` logs from its deployment block:

   | Chain           | Factory deployment block | Deployment transaction                                               |
   | --------------- | ------------------------ | -------------------------------------------------------------------- |
   | Base            | 53020390                 | `0xfb8587a46e66e67d863d1befa77455ccdb330c49a0cd70ca4eb2bf6c8ff25dfb` |
   | Ethereum        | 26261441                 | `0xf0c8da783cede40a2e91f252575fdc6eedd2029f73c5800cfae78ab49d5551ea` |
   | Robinhood Chain | 96643004                 | `0xdbc3036eaf5187ac79aa84ed06e2747c1c4d258e4d4af13ed96a9f8cdba9558b` |

   ```sh
   cast logs --address "$FACTORY" --from-block "$FACTORY_BLOCK" --to-block latest \
     'VaultCreated(bytes32 indexed,address indexed,address indexed,address,uint8,uint8)' \
     --rpc-url "$RPC"
   ```

   The vault is the third indexed topic. Split the range if the provider
   limits `eth_getLogs`. On 24 October 2026 (Base block 53055424, Ethereum
   block 26267105, Robinhood Chain block 97292925) no chain had a vault, so no
   vault upgrade was needed at that time. Run the query again immediately
   before signing, because vault creation is permissionless.

4. Run the fork rehearsal (section 4.6) for the chain at a recent block.
   Stop if it fails.

### 4.5 Order and transactions

Send the steps in this order on one chain, and finish that chain before the
next. Use the approved launch order: Base, Ethereum, then Robinhood Chain.

1. Deploy both implementations (no upgrade).
2. Upgrade every vault proxy.
3. Upgrade the factory proxy.
4. Select the new vault implementation for future vaults.
5. List vaults again and upgrade any vault created before step 4.

Why this order:

- Step 1 changes no proxy. Its result is checked against the digests in
  section 4.3 before any upgrade.
- Vaults go first because each vault upgrade is independent of the factory:
  the vault's `_authorizeUpgrade` reads `factory.upgradeAuthority()`, which
  does not change. If a vault upgrade fails, the factory is still unchanged.
- The factory selects the new vault logic last. Until step 4, the setup route
  stays closed: `prepareEvmVaultCreation` refuses creation unless
  `vaultImplementation()` equals the reviewed current implementation. After
  step 3 and before step 4, `createWithMonthlyCommitment` reverts (fail
  closed) and `create` still makes an old-logic vault.
- Step 5 is necessary because vault creation is permissionless. A vault created
  before step 4 runs the old logic.

Steps 3 and 4 can be one transaction instead:
`upgradeToAndCall(NEW_FACTORY, setVaultImplementation(NEW_VAULT))` (section
1.6). The rehearsal covers the separate steps.

#### Step 1: deploy the implementations

Any funded account can send step 1, because the CREATE2 address does not
depend on the sender. The script deploys only. It skips an implementation that
is already at its address (CREATE2 makes that code identical).

```sh
cd contracts/evm
forge build
# Simulate (no transaction is sent):
forge script script/DeployUpgradeImplementations.s.sol:DeployUpgradeImplementations \
  --rpc-url "$RPC" --account slop-mainnet-deployer --sender 0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D
# Owner only: add --broadcast to send. For a hardware wallet use --ledger instead of --account.
```

The simulation returns `vaultImplementation` and `factoryImplementation`. Both
must equal section 4.3. The two deployments use about 4.02 million and 1.60
million gas (`eth_estimateGas` on each chain, 24 October 2026; Robinhood Chain
adds about 6,000 for its parent-chain data fee). Forge prints a 30% margin
(7.63 million). Steps 2 to 4 use about 48,000 gas per vault plus 76,000 for
the factory. On 24 October 2026 the authority held 0.00497 ETH on Base,
0.00372 ETH on Ethereum and 0.00189 ETH on Robinhood Chain. That covers all
steps at that day's prices, but not step 1 on Ethereum above about 0.6 gwei.
Any funded account can send step 1; only steps 2 to 5 need the authority.
The script sends two transactions to the CREATE2 deployer.
Their data is the salt followed by the creation code, which you can rebuild:

```sh
SALT=$(cast keccak "slop.escrow.implementation")
cast concat-hex "$SALT" "$(forge inspect ProjectEscrow bytecode)"   # vault transaction data
cast concat-hex "$SALT" "$(forge inspect EscrowFactory bytecode)"   # factory transaction data
```

After finality, check the code:

```sh
NEW_VAULT=0xf10EF0D801895FDbF240976f5d3010E314662f0C
NEW_FACTORY=0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f
cast code "$NEW_VAULT" --rpc-url "$RPC" --block finalized | xxd -r -p | shasum -a 256    # 05bef32c...0367
cast code "$NEW_FACTORY" --rpc-url "$RPC" --block finalized | xxd -r -p | shasum -a 256  # 97620815...a1dd
cast call "$NEW_VAULT" 'proxiableUUID()(bytes32)' --rpc-url "$RPC"    # $SLOT
cast call "$NEW_FACTORY" 'proxiableUUID()(bytes32)' --rpc-url "$RPC"  # $SLOT
```

Verify the source on each explorer as in section 1.5 (no constructor
arguments), for both `src/ProjectEscrow.sol:ProjectEscrow` and
`src/ProjectEscrow.sol:EscrowFactory`.

#### Steps 2 to 4: unsigned calldata

Every call is from the upgrade authority with value 0. The calldata is the
same on every chain:

| Step | To               | Call                                | Calldata                                                                                                                                                                                                     |
| ---- | ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2    | each vault proxy | `upgradeToAndCall(NEW_VAULT, "")`   | `0x4f1ef286000000000000000000000000f10ef0d801895fdbf240976f5d3010e314662f0c00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000` |
| 3    | factory proxy    | `upgradeToAndCall(NEW_FACTORY, "")` | `0x4f1ef2860000000000000000000000009f27aec70559d8f4ca1a62398e673a25b1ce3e2f00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000` |
| 4    | factory proxy    | `setVaultImplementation(NEW_VAULT)` | `0x53e78b6b000000000000000000000000f10ef0d801895fdbf240976f5d3010e314662f0c`                                                                                                                                 |

Rebuild and simulate each one before signing:

```sh
UPGRADE_VAULT=$(cast calldata 'upgradeToAndCall(address,bytes)' "$NEW_VAULT" 0x)
UPGRADE_FACTORY=$(cast calldata 'upgradeToAndCall(address,bytes)' "$NEW_FACTORY" 0x)
SELECT_VAULT=$(cast calldata 'setVaultImplementation(address)' "$NEW_VAULT")
for VAULT in $VAULTS; do
  cast call "$VAULT" "$UPGRADE_VAULT" --from "$AUTHORITY" --rpc-url "$RPC"
done
cast call "$FACTORY" "$UPGRADE_FACTORY" --from "$AUTHORITY" --rpc-url "$RPC"
```

`setVaultImplementation` can be simulated only after step 3, or on a fork.
The owner signs and sends each transaction with his own tooling, for example
`cast send "$TARGET" "$DATA" --rpc-url "$RPC" --account <owner keystore>`, or
`--ledger`. Record each transaction hash and block. Wait for each
transaction to succeed before the next step.

### 4.6 Fork rehearsal

`contracts/evm/integration/mainnet-upgrade-rehearsal.ts` runs the steps above
on a local Anvil fork. It sends nothing to the forked network: it impersonates
the upgrade authority on the fork only.

```sh
cd contracts/evm && forge build && cd ../..
bun contracts/evm/integration/mainnet-upgrade-rehearsal.ts "$FORK_RPC" [LOGS_RPC] [PORT]
```

It checks that:

- the live factory, implementations and digests match the recorded review;
- the checked-in deploy script creates both implementations at the section
  4.3 addresses, with the section 4.3 digests, and that neither can be
  initialized;
- a vault created and used on the live logic (deposit, rounded-down awards,
  monthly policy, binding, payment, fee-free 49-unit withdrawal) keeps every
  declared storage slot, its initializer version, its awards and its proxy
  code after the upgrade, and that `initialize` and
  `initializeWithMonthlyCommitment` revert on it;
- only the authority can upgrade; every live vault is upgraded and its storage
  is unchanged; the factory keeps every role;
- fees round up after the upgrade (a 49-unit withdrawal pays 1);
- `commitMonthly` counts a pre-upgrade rounded-down award once and reserves
  only the new award, with a rounded-up fee;
- `createWithMonthlyCommitment` creates a vault on the new logic with the
  owner's cap and the unchanged proxy code;
- `verifyPayment` and `verifyReserve` accept a pre-upgrade event through
  `history` and post-upgrade events through the new current review; they
  reject a pre-upgrade event without history, a post-upgrade event under the
  old review, and an event between upgrades when `supersededAtBlock` is set at
  the first upgrade instead of the last; `prepareEvmVaultCreation` opens.

Results on 24 October 2026, all three chains passed every check:

| Chain           | Fork block | Live vaults | Rehearsal vault upgrade | Factory upgrade (`supersededAtBlock`) | `setVaultImplementation` |
| --------------- | ---------- | ----------- | ----------------------- | ------------------------------------- | ------------------------ |
| Base            | 53055965   | none        | 53055993                | 53055997                              | 53055999                 |
| Ethereum        | 26267203   | none        | 26267231                | 26267235                              | 26267237                 |
| Robinhood Chain | 97304013   | none        | 97304041                | 97304045                              | 97304047                 |

Gas used on each fork: vault upgrade 47,911, factory upgrade 37,597,
`setVaultImplementation` 38,318. The authority was not funded on the fork; its
live balance paid every step. The fork does not model Robinhood Chain's
parent-chain data fee. The fork blocks are local Anvil blocks, not mainnet
evidence.

### 4.7 Choose `supersededAtBlock`

`supersededAtBlock` is the block of the last proxy upgrade that leaves the old
review on that chain: in the order above, the step 3 factory upgrade block, or
a later step 5 vault upgrade block. `setVaultImplementation` changes no proxy
and does not count. The adapter uses an entry only for events with
`eventBlock < supersededAtBlock`, and it reads each proxy's implementation at
the end of the event's block. An event in the same block as the last upgrade
reads the new implementation and verifies against the new current review.
A bound at the first vault upgrade would reject events from proxies that were
still on the old logic, so do not use it.

### 4.8 Registry revision and executor

Record the change as an admin manifest revision on `/admin`, one revision per
project deployment on the upgraded chain, after step 5 is final. The new
current review:

```json
{
  "authority": "0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D",
  "vaultImplementation": "0xf10EF0D801895FDbF240976f5d3010E314662f0C",
  "vaultImplementationCodeSha256": "05bef32c557281484149acd361f91f603b691ad281d6dcca341b3d51b9430367",
  "factoryImplementation": "0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f",
  "factoryImplementationCodeSha256": "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd"
}
```

If the deployment already has an `evmUpgrade` with the `bce5b0df` review,
keep its earlier `history` entries unchanged and append the outgoing review
once:

```json
{
  "authority": "0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D",
  "vaultImplementation": "0xf10EF0D801895FDbF240976f5d3010E314662f0C",
  "vaultImplementationCodeSha256": "05bef32c557281484149acd361f91f603b691ad281d6dcca341b3d51b9430367",
  "factoryImplementation": "0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f",
  "factoryImplementationCodeSha256": "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
  "history": [
    {
      "authority": "0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D",
      "vaultImplementation": "0xe137dE4fbAc6438007703065C905a58b03322Fc8",
      "vaultImplementationCodeSha256": "1c21fa901dc924a7a2dd84b770b7d1cf69ef14ba97957ae5c8986232b8f9d551",
      "factoryImplementation": "0xc831Fc745a63161Df6Fae612bDFE77B969b329fE",
      "factoryImplementationCodeSha256": "62a3bf4a741b8084a63152835047bb71e8396b153a112225910d1dffecd64275",
      "supersededAtBlock": "<last proxy upgrade block on this chain, decimal>"
    }
  ]
}
```

Also update `sourceCommit` to `2a4e80b3` (full SHA) and
`deploymentTransaction` to the step 3 transaction if the revision records
them. `codeSha256` (vault proxy) and `factoryCodeSha256` (factory proxy) do
not change. A deployment first recorded after the upgrade carries only the
new current review and no `history`: `assertEscrowTransition` rejects history
on a new deployment.

Then refresh the executor. `PAYMENT_DEPLOYMENTS` is generated from the
registry, so it copies `evmUpgrade` with its `history` field by field:

```sh
bun run projects:sync
node workers/payment-executor/configure.mjs --stack production \
  --network <base-mainnet|ethereum|robinhood-mainnet> \
  --deployments <reviewed deployments JSON from the synced registry> --output <dir>
```

Deploy the regenerated attester configuration through the reviewed release.
Until the revision and the executor update land, monthly signing and payment
verification for an upgraded vault fail closed, because its new implementation
is not yet a reviewed one. Do not edit the snapshot by hand.

Keep the rounded-down branch of `acceptsPayoutFee`
(`src/lib/payments/contracts.ts`): pre-upgrade events still hold
`floor(gross / 50)`.

### 4.9 After the upgrade: read-only verification

At one finalized block:

```sh
BLOCK=$(cast block finalized --rpc-url "$RPC" --field number)
cast storage "$FACTORY" "$SLOT" --rpc-url "$RPC" --block "$BLOCK"     # ...9f27aec70559d8f4ca1a62398e673a25b1ce3e2f
cast call "$FACTORY" 'vaultImplementation()(address)' --rpc-url "$RPC" --block "$BLOCK"  # $NEW_VAULT
for VAULT in $VAULTS; do
  cast storage "$VAULT" "$SLOT" --rpc-url "$RPC" --block "$BLOCK"     # ...f10ef0d801895fdbf240976f5d3010e314662f0c
  cast call "$VAULT" 'totals()(uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint256)' \
    --rpc-url "$RPC" --block "$BLOCK"                                  # equal to the values read before step 2
done
for ADDRESS in "$NEW_VAULT" "$NEW_FACTORY" "$FACTORY"; do
  cast code "$ADDRESS" --rpc-url "$RPC" --block "$BLOCK" | xxd -r -p | shasum -a 256
done                                                                   # 05bef32c..., 97620815..., afb62459...
for GETTER in 'upgradeAuthority()(address)' 'registrar()(address)' 'identityAuthority()(address)' \
  'feeRecipient()(address)' 'bindingDelay()(uint64)' 'AUTHORITY_ROTATION_DELAY()(uint64)'; do
  cast call "$FACTORY" "$GETTER" --rpc-url "$RPC" --block "$BLOCK"
done                                                                   # unchanged
cast call "$NEW_VAULT" 'payoutFee(uint128)(uint128)' 1000049 --rpc-url "$RPC"   # 20001
```

Read each vault's `totals()` before step 2 and keep the values. Then run
`verifyEvmDeployment` from `contracts/evm/adapter.ts` with the revised
manifest at `BLOCK`, and record the evidence (section 1.7) on the release
issue.

### 4.10 Rollback

Rollback uses the same calls with the `bce5b0df` implementations, from the
upgrade authority: each vault `upgradeToAndCall(0xe137dE4fbAc6438007703065C905a58b03322Fc8, "")`,
the factory `upgradeToAndCall(0xc831Fc745a63161Df6Fae612bDFE77B969b329fE, "")`,
then `setVaultImplementation(0xe137dE4fbAc6438007703065C905a58b03322Fc8)`.
Storage is compatible in both directions. After a rollback:

- fees round down again; awards committed after the upgrade keep their
  rounded-up fee and pay it;
- the old `commitMonthly` rejects a monthly allocation that repeats an award
  committed with a rounded-up fee (`DuplicateAward`, fail closed);
- vaults created with `createWithMonthlyCommitment` keep their cap and switch,
  but new creation must use `create` and `setMonthlyCommitment`.

Record the rollback as a new revision: the rolled-back review becomes current,
and the outgoing review is appended to `history` with the rollback's last
proxy upgrade block. Never edit or remove an existing history entry.
