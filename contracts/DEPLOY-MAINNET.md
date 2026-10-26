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
build and exact-artifact qualification are still open for Solana. The owner
waived a second operator and a different build machine on 25 October 2026;
that check was not completed (PRD section 11).

These steps deploy replacement UUPS EVM factories and vault implementations,
and deploy or upgrade the Solana program with owner-controlled upgrades.
The approved launch order is Base, Solana, Ethereum, then Robinhood.

A human or an owner-authorized agent may execute the reviewed plan within
the owner's authorized financial scope (PRD section 11, 25 October 2026). An
authorized agent may use necessary existing credentials privately. Never print
secrets or signing material. Required acceptance, explicit mainnet activation
and the reviewed release flow remain. Application services receive only their
separately authorized attester or fee-conversion key, never deployment or
upgrade keys.
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
   wallet (`--ledger` or `--trezor`) or an owner-controlled Foundry keystore
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

The owner supplies `MONTHLY_CAP_BASE_UNITS`. The setting is true by default,
as on the website; pass false only when the owner opts out.
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

Use Anchor CLI 0.32.1, the Docker image digest below, platform tools v1.52
and the locked `Cargo.lock`. The image is linux/amd64 and contains Solana
CLI 2.3.0.

```bash
git clone https://github.com/SlopDotCash/slopdotcash.git && cd slopdotcash
git checkout "$COMMIT"
cd contracts/solana
IMAGE=solanafoundation/anchor@sha256:facc4ebd0738ba7ebc1eb4ef000deab6b37e7747960d3f400c73c40c5421b5de
docker pull "$IMAGE"
anchor build --verifiable --docker-image "$IMAGE" --no-idl -- --tools-version v1.52 -- --locked
```

Do not use the default `solana-verify build` image with this lockfile. Its
Cargo 1.84.0 cannot build the edition-2024 dependency `block-buffer 0.12.1`.

Anchor 0.32.1 extracts the IDL on the host after the Docker build. With these
arguments, that later step exits with `unexpected argument '--tools-version'`.
Accept that specific error only after the Docker build completed and wrote a
new `target/verifiable/slop_escrow.so`. Any other error is a failed build.
Record that program file as `$SO`.

```bash
sha256sum "$SO"                          # REVIEWED_SO_SHA256
solana-verify get-executable-hash "$SO"  # REVIEWED_EXECUTABLE_HASH
```

Record the source commit, tool versions, image digest and both hashes in the
release issue. A second operator or different machine is not required (owner
decision, 25 October 2026; PRD section 11). This waiver is not a completed
independent check. Qualify this exact artifact on the test network before the
authorized mainnet upgrade. Steps 3 to 9 still verify the deployed bytes,
executable hash and authority.

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

Before you write the buffer in step 4, compare the size of `$SO` with the
`Data Length`. If `$SO` is larger, extend the program account by at least the
difference. Do this before you write the buffer: an upgrade into a program
account that is too small fails after the buffer is paid for.

```bash
DATA_LENGTH=<Data Length from solana program show>
ADDITIONAL_BYTES=$(( $(wc -c < "$SO") - DATA_LENGTH ))
echo "$ADDITIONAL_BYTES"   # extend only if this is greater than 0
solana program extend "$PROGRAM" "$ADDITIONAL_BYTES" -u "$RPC" --keypair "$PAYER"
solana program show "$PROGRAM" -u "$RPC"   # Data Length must now be >= the size of $SO
```

Example: the first-operator verifiable build for the next upgrade (#901,
source `edf3b341`) is 672,560 bytes. The mainnet program has a 681,392-byte
`Data Length`. `ADDITIONAL_BYTES` is negative, so do not extend the program
account for this upgrade.

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
record the evidence before you start the next network. A human or an
owner-authorized agent may run these steps within the approved financial scope.

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

1. Sections 0 to 2 are complete for this network. Record the required testnet
   acceptance evidence and the owner's waiver of the independent contract
   audit and signer/attester legal review. The waived reviews are not completed.
2. The owner creates the vault through project funding. The server verifies
   the finalized creation and records it in a permanent project revision
   (`escrow.deployments`). No per-project admin approval is required. For the
   first EVM vault, complete the factory review below before owner creation.
3. The identity authority address in each factory (EVM) or Config (Solana) is
   the address of the attester key that the attester Worker will use. Read it
   back from the chain at the finalized block and record it.

### First EVM vault: reviewed factory infrastructure

`contracts/evm/factories.ts` holds only public network infrastructure reviews.
It is empty until real finalized deployment or upgrade evidence is reviewed.
An unsigned kit, a planned address or a local fork must not become a live pin.
Reuse the network definitions in `ESCROW_NETWORKS`; do not add a project,
owner, asset or vault as a bootstrap placeholder.

After the approved upgrade is signed, verify the finalized factory
proxy, its implementation and selected new-vault implementation, runtime
hashes, upgrade authority, registrar, identity authority, fee recipient and
delays. Record those reviewed fields, the source commit and expected vault
proxy runtime hash once in `REVIEWED_EVM_FACTORIES`, with the public chain
proof in the PR. The normal main release makes that factory available to
owners. No secret belongs in this file.

The owner saves the project reward policy, confirms the wallet in Earnings,
reviews creation and signs with that wallet. The server checks the actual
transaction, project, owner, asset, purpose, code and finality, then appends
the first real D1 deployment. It also accepts reviewed factory infrastructure
from an existing D1 deployment. D1 remains the only project inventory.

Only then derive the attester pins from the registered vault. A missing
attester does not block wallet confirmation or vault creation. Existing
unpaid awards and prior deployment reviews remain unchanged.
The normal main release can first install an inactive Base attester with
an empty allowlist and no cron. This lets the owner install its secrets
before creating a vault; it does not establish vault or payment readiness.

### 3.2 Configure the stack

1. For a network with registered vaults, pin the signer deployments from the
   registry snapshot. For the first Base vault, use the empty-capable setup
   in section 3.6 instead:
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

The owner approved Base mainnet execution on 24 October 2026. The owner or
an authorized agent installs the secrets under PRD section 11.
`base-mainnet` is `true` in `mainnet-execution.mjs`, and the Pages
`PAYMENT_NETWORKS` in `wrangler.toml` is `["base-mainnet"]`. The production
release (`.github/workflows/deploy.yml`, job `deploy`, `main` only, environment
`eliza-army-production`) generates the attester configuration with
`configure.mjs --stack production` from the checked registry artifact of the
verified build. The release verifies both registry-file digests first. Then:

- If the snapshot pins no Base mainnet vault and the Worker is proved absent,
  the release installs the private attester with an empty allowlist and no
  cron. No secret is required. Every signing request is refused. An existing
  Worker stays unchanged, so an empty snapshot cannot remove earlier pins or
  interrupt its journal. An ambiguous provider lookup stops the release.
- If the snapshot pins a vault, the release reads the secret names of
  `slop-payments-base-mainnet-attester` (never the values). The names must be
  exactly `PAYMENT_RPC_URLS` and `SIGNER_PRIVATE_KEY`. A missing or extra
  name stops the release before it changes the identity Worker, D1 or
  Pages. The release then deploys the attester with the commit SHA as its
  version tag and checks that the active version has that tag.

After the reviewed main release installs the inactive Worker, install its
secrets before the first snapshot that pins a Base vault reaches `main`.
A nonempty release stops if either required secret is missing. A vault is
not a prerequisite for this key setup. The empty service remains unable to
sign, even after keys are installed. Do these steps from a clean reviewed
checkout; the attester is not needed for owner wallet confirmation or creation:

1. Generate the configuration. The secrets belong to the Worker name, so this
   configuration also serves the later `main` release:

   ```sh
   bun install --frozen-lockfile --ignore-scripts
   bun run projects:sync
   bun --eval 'import { HISTORICAL_PROJECTS } from "./src/lib/projects.mjs"; import { paymentDeployments } from "./scripts/prepare-payment-deployments.ts"; console.log(JSON.stringify(paymentDeployments(HISTORICAL_PROJECTS, "mainnet", "base-mainnet")));' > /tmp/base-mainnet-pinned.json
   node workers/payment-executor/configure.mjs --stack production \
     --network base-mainnet \
     --deployments /tmp/base-mainnet-pinned.json \
     --output workers/payment-executor/.generated
   CONFIG=workers/payment-executor/.generated/slop-payments-base-mainnet-attester.json
   ```

   `.generated/` is ignored by git.

2. Install the two secrets on the attester Worker only. Wrangler reads each
   value at its prompt; do not put a value in the command, a file in the
   repository, or the shell history. The normal reviewed main release must
   have installed the Worker first. Do not create or deploy it locally.

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

   Before a vault is registered, the report remains not ready. After
   registration, regenerate the pins and configuration. For `base-mainnet`,
   `factory` and `attester` must be `configured` and `rpc` must be
   `finalized`. `executor` reports `missing`.

6. After vault registration, approve the normal production release: merge
   the reviewed promotion pull request from `development` to `main`. The
   `deploy` job checks the pins and secrets and installs the scheduled
   attester. Check the job log for the attester deploy, then
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
broadcast. When a broadcast result is unknown, the next run reads its receipt
and broadcasts the same bytes only while the exact claim and wallet consent
remain authorized. Obsolete or unprovable attempts stay held without a new
signature. A held nonce can still block later transactions; this safeguard
alone does not complete failure-isolation acceptance. It
checks at most 10 contributors per run. A failed binding makes the cron run
fail in the Worker logs. The attester refuses `/v1/pay`; the cron run is its
only binding path. Slop does not submit the payout: `pay` is permissionless
(step 8 below).

#### Base test payout, owner sequence

This is the full sequence for one 10 USDC test award. The owner must authorize
the award and its transactions before a human or agent runs it. `$RPC` is your
Base RPC URL, `--account owner` is your Foundry
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

7. The contributor authorizes the vault destination from **Payouts**:
   1. Confirm the payout address in **Account → Wallets**. This is an
      account-wallet proof, separate from vault consent.
   2. On `/earnings`, find the reserved award and select **Authorize payout
      wallet**. Review its exact network, vault and confirmed address.
   3. Select the wallet and sign. For EVM, switch to the named network first;
      the challenge reads the current finalized binding version from the
      reviewed registry vault. The EIP-712 signature is valid for 90 days.
      For Solana, a Wallet Standard wallet with transaction signing co-signs
      the attester's exact prepared binding; the attester pays its gas.
   4. Refresh payments. Saved consent or a submitted binding is not paid.
      Payment remains unverified until finalized reconciliation. A changed
      wallet, rejected signature or unavailable attester preserves the award.

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

## 4. EVM monthly reserve V2 upgrade

This kit targets contract source `dd1af34d22c08a8aecd9bb6c644831f2e2da85ac`.
It replaces the earlier `239d0235`, `e55a804a` and `2a4e80b3` kits. The existing mainnet review is still
`bce5b0df`, as listed above. Recheck that review before use. Rehearse this kit
on a local fork before mainnet execution. The owner may authorize an agent to
use the upgrade authority key for the reviewed plan. Follow the approved launch
order and acceptance checks in section 0.

### 4.1 What changes

The new vault keeps round-up fees and atomic owner-selected monthly setup.
Existing awards keep their stored fee, including the old rounded-down fee.
Legacy methods and EIP-712 version 5 signatures keep their meaning.

V2 reserves the entire unfunded part of one signed month in a bounded call.
Anyone can then create each award from its Merkle proof. A leaf moves funds
from the monthly reserve to the award reserve; it does not debit free funds
again. Funded leaves remain executable after opt-out or the admission window.
While leaves remain, new manual awards wait. Later signed monthly admissions
can use free funds within their own caps. Funded payments and withdrawals of
free funds remain available.

The first 27 vault storage fields are unchanged, including `Award`, `Binding`
and existing mappings. New fields follow them:

| Field | Slot | Byte offset |
| --- | --- | --- |
| `pendingMonthlyGross` (`uint128`) | 18 | 1, after the existing `entered` flag |
| `ordinarySourceSequence` (`uint256`) | 19 | 0 |
| `monthlyReserves` (mapping) | 20 | 0 |

The factory's 10 fields are unchanged. No initializer or migration call is
needed. Old source-use mappings remain authoritative; the new source sequence
starts at zero and tracks subsequent ordinary awards. Both implementation
constructors disable initialization. Existing proxies cannot initialize again.
Proxy runtime digests do not change. These are storage-compatibility findings,
not permission to roll back after V2 use (section 4.10).

### 4.2 Accepted risk: one upgrade key

The authority is `0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D` on all three
EVM chains. The owner retained this single key without a timelock. It can
replace logic that governs deposited funds. Identity, fee and keeper keys
have no upgrade power. The independent reviews were waived, not completed.

### 4.3 Reviewed implementations

Foundry 1.7.1, solc 0.8.30, Cancun, optimizer 200 runs and
`bytecode_hash = "none"` produce the following implementations. The CREATE2
deployer is `0x4e59b44847b379578588920cA78FbF26c0B4956C`; the salt is
`keccak256("slop.escrow.implementation")`. Addresses are the same on each chain.
Runtime SHA-256 includes the implementation address in the UUPS self-reference.

| Role | Address | Runtime SHA-256 | Bytes |
| --- | --- | --- | --- |
| Vault | `0x6A79B8970E980159c362d11F37dC8BFFbF2da027` | `112ea2575a1d699cb128105bf5ba7ec78a0e22f8b83051bc2114d60567a5b1e3` | 21,548 |
| Factory | `0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f` | `976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd` | 6,879 |

The factory matches the earlier kit; the vault does not. Reproduce addresses
from the reviewed source:

```sh
cd contracts/evm
forge build --sizes
DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT=$(cast keccak "slop.escrow.implementation")
for CONTRACT in ProjectEscrow EscrowFactory; do
  HASH=$(cast keccak "$(cast concat-hex 0xff "$DEPLOYER" "$SALT" "$(cast keccak "$(forge inspect "$CONTRACT" bytecode)")")")
  echo "$CONTRACT 0x${HASH:26}"
done
```

The fork rehearsal deploys these exact creation bytes and compares decoded
`eth_getCode` SHA-256 with the address-patched compiled runtime. A raw
`forge inspect deployedBytecode` digest still has unfilled immutable values.

### 4.4 Before signing, on each chain

1. Verify the finalized factory proxy, both old implementations, roles and
   pending rotations against the current review in section 0. Do not treat a
   previous read or fork as current mainnet evidence.
2. List every vault from `VaultCreated` logs through the same block. Read from
   the factory deployment block: Base `53020390`, Ethereum `26261441`,
   Robinhood `96643004`. Split ranges to meet the provider's limit. Check
   each vault's implementation and retain its stored awards and counters.
3. Check Robinhood opcode support as in section 1.1.
4. Run the local fork rehearsal below. Retain its source SHA, fork block,
   runtime hashes, storage comparison and result. A provider error leaves the
   rehearsal incomplete; it is not an empty vault inventory.
5. Obtain current gas estimates and native balances. V2 deploys more code
   than the old kit. Old price and balance estimates do not qualify this kit.

### 4.5 Order and transactions

Use these values only after the exact build and current-state checks pass:

```sh
FACTORY=0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb
AUTHORITY=0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D
NEW_VAULT=0x6A79B8970E980159c362d11F37dC8BFFbF2da027
NEW_FACTORY=0x9f27aec70559D8f4CA1A62398e673A25B1cE3e2f
```

1. Deploy the implementations. This changes no proxy. Any funded account may
   deploy them; only the upgrade authority may change the proxies.

   ```sh
   # From contracts/evm; simulation only, no --broadcast.
   forge script script/DeployUpgradeImplementations.s.sol:DeployUpgradeImplementations \
     --rpc-url "$RPC" --account slop-mainnet-deployer --sender "$AUTHORITY"
   ```

   The authorized operator adds `--broadcast` only for the approved network and
   after reviewing the simulation. The script sends salt plus creation bytes
   to the CREATE2 deployer and skips implementations already present.
   After finality, compare both runtimes with section 4.3. Verify their source
   on the explorer as in section 1.5.
2. Upgrade each existing vault with empty initialization data.
3. Upgrade the factory, then select the new vault logic. These two calls may
   be combined with `upgradeToAndCall(NEW_FACTORY, SELECT_VAULT)`.
4. Read the creation logs again and upgrade any old-logic vault created before
   the new template was selected. Creation is permissionless.

Build the unsigned calldata:

```sh
UPGRADE_VAULT=$(cast calldata 'upgradeToAndCall(address,bytes)' "$NEW_VAULT" 0x)
UPGRADE_FACTORY=$(cast calldata 'upgradeToAndCall(address,bytes)' "$NEW_FACTORY" 0x)
SELECT_VAULT=$(cast calldata 'setVaultImplementation(address)' "$NEW_VAULT")
ATOMIC_FACTORY=$(cast calldata 'upgradeToAndCall(address,bytes)' "$NEW_FACTORY" "$SELECT_VAULT")
```

All proxy changes have value zero and use the upgrade authority. Simulate
against the correct preceding state before signing. The rehearsal covers the
separate factory calls. The owner chooses the transaction order only within
these requirements; a new factory with an old vault template cannot create
an atomic monthly vault. Do not install the new review in D1 before its
implementation changes are final.

### 4.6 Fork rehearsal

```sh
cd contracts/evm && forge build && cd ../..
bun contracts/evm/integration/mainnet-upgrade-rehearsal.ts "$FORK_RPC" [LOGS_RPC] [PORT]
```

Every write goes to the loopback Anvil fork. The script generates local test
actors and impersonates the public authority there; it uses no live key.
`LOGS_RPC` is an optional read-only provider for the complete vault inventory.

The rehearsal checks old runtime pins and roles, authority-only upgrades,
initializer refusal, unchanged legacy storage and awards, rounded-down
historic fees, rounded-up new fees, atomic monthly creation and exact
pre-/post-upgrade receipt verification. It then reserves V2 funds on the
upgraded legacy vault, keeps an old funded award unchanged, turns monthly
payment off, closes the admission window and completes both leaves and a
payment. The totals adapter must include the pending reserve and prove that
leaf creation does not debit free funds twice.

The script advances time on its local fork only to exercise the monthly
window. Its blocks and receipts are local evidence. It does not qualify
mainnet finality, actual fees, provider availability or the first live payout.
Use the result for this exact contract source; earlier `239d0235`, `e55a804a` and `2a4e80b3` results do
not qualify this revision. Retain any failed provider attempt with the successful retry.

### 4.7 Choose `supersededAtBlock`

For each deployment, use the block of the **last** vault or factory proxy
upgrade that leaves its old review. A first-upgrade bound can reject valid
receipts from a proxy that had not yet upgraded. Template selection alone
changes no existing proxy. Keep transaction identities and block hashes.

### 4.8 Registry revision and executor

After finality, append a reviewed deployment revision through the existing
registry operation. Use the addresses and digests in section 4.3 as current
`evmUpgrade`; retain each previous review in `history` with its verified
`supersededAtBlock`. Never rewrite old history. A new deployment has no
invented prior history. Proxy digests stay unchanged. Set `sourceCommit` to
`dd1af34d22c08a8aecd9bb6c644831f2e2da85ac` and record the upgrade transaction
where the registry contract requires it.

Regenerate pinned `PAYMENT_DEPLOYMENTS` from D1 and deploy the reviewed
attester, public monthly authorization path, scanner and keeper-compatible
application release. Their V2 support and the new contract review must agree.
Do not enable V2 admission with old executors or scanners. Preserve signed
legacy authorizations, pending sends and payment journals across the release.
Keep the old fee-verification branch for already funded awards indefinitely.

```sh
bun run projects:sync
node workers/payment-executor/configure.mjs --stack production \
  --network <base-mainnet|ethereum|robinhood-mainnet> \
  --deployments <reviewed deployments JSON from the synced registry> --output <dir>
```

The separate keeper uses operator-selected gas budgets and its durable local
journal (`scripts/payment-keeper/README.md`). This upgrade does not select a
budget, install a signing key or authorize live execution. Until review and
configuration agree, signing and verification fail closed.

### 4.9 After the upgrade: read-only verification

Prove unchanged storage at the canonical finalized completion block of the
upgrade, including template selection and stragglers. Separately pin the current
finalized block and verify proxy implementations, runtime, template, roles,
pending rotations and the complete vault inventory. Later payments do not
rewrite the preservation snapshot: verify their canonical receipts, stored fees,
exact token movement and allowed accounting changes. Refuse every unexplained
storage change or unsupported later activity.

Run `verifyEvmDeployment` with the new review and history. Verify historic
receipts at their own blocks. Confirm V2 availability and that cached totals
include pending monthly funds. Record both block numbers and hashes on the
network release issue. Then complete section 3's separate first-payout and
reconciliation gates.

### 4.10 Recovery

Do not use the earlier kit's generic rollback calls. The old implementation
cannot finish V2 monthly reserves and does not maintain the new source
sequence. Storage layout compatibility alone does not make rollback safe.
Keep every funded monthly and award obligation reserved, including walletless
awards. Opt-out stops new admission; it does not cancel an admitted reserve.

Use a separately reviewed forward repair if a defect prevents completion.
Preserve pending reserve data, stored award fees, source-use maps and signed
attempt journals. Rehearse recovery against the affected state before
signing. Append its implementation review and history as another revision.
