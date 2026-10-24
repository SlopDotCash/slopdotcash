> Current owner decision (24 October 2026): deploy replacement EVM UUPS proxies
> with `ESCROW_UPGRADE_AUTHORITY` explicitly set and `BINDING_DELAY = 0`.
> The script deploys vault logic, factory logic and an atomically initialized
> factory proxy. Retain Solana upgrade authority. Neither upgrade path has a
> timelock. Historical immutable contracts retain their original behavior.
> Record `evmUpgrade` (authority, both implementation addresses and both code
> SHA-256 digests) alongside the proxy digests. Read ERC-1967 implementation
> slots at the same finalized block used for verification. Proxy bytecode alone
> does not prove the approved logic. After an upgrade, review and append a new
> registry revision before treating the new implementation as accepted.

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

The code does not enable a mainnet. Every value in
`workers/payment-executor/mainnet-execution.mjs` is `false`, and the
executor and the attester refuse a mainnet deployment before they read a
signer secret. `workers/payment-executor/configure.mjs --stack production`
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

To stop new Slop attestations on a network, change its
`mainnet-execution.mjs` value back to `false` through a reviewed pull request
and redeploy the attester Worker. Slop cannot stop a payment that the project
or a permissionless executor submits for an approved and funded obligation.
