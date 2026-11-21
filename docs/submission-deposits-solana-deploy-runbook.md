# Submission deposits on Solana: mainnet deployment runbook

Prepared on 20 November 2026. **Nobody has run these steps.** The repository
owner signs every transaction in this runbook; no agent and no Slop service
does. The program is `contracts/solana/programs/slop-submission-deposits`; see
its [README section](../contracts/solana/README.md#submission-deposits) and the
[AI-assisted review note](submission-deposits-solana-ai-review-2026-11-20.md).
The steps were rehearsed on a local validator only
(`contracts/solana/integration/submission-deposits-rehearsal.e2e.mjs`), not on
devnet or mainnet.

One deployment on Solana mainnet. A deployment moves no tokens and activates
nothing. No Slop service reads the program until its address is recorded in a
separate reviewed change, and no contributor is asked for a fee on Solana until
the Worker, the pay page and the fee switch each say so.

## 1. Decide five things

- **The program address.** The address in the source,
  `HgkeEAe63g7pDbvKsXXh8rSStM8Nw5z4eiYapVMKCt9t`, is a local placeholder; its key
  was discarded, so nothing can be deployed there. Generate the real program
  keypair yourself (step 2). It is needed once, to deploy at that address, and
  gives no power over the program afterwards.
- **Owner** (`owner`). It can replace the resolver, pause new deposits and hand
  ownership over in two steps. It can never move, redirect or resolve a deposit.
  A wallet whose key is backed up.
- **Resolver** (`resolver`). It settles each deposit to its payer or to its kept
  wallet. It must differ from the owner. If the Worker's Solana resolver key does
  not exist yet, name an address nobody controls, for example the incinerator
  `1nc1nerator11111111111111111111111111111111`: nobody can then resolve, payers
  can still reclaim after 30 days, and the owner names the real resolver later
  with `set_resolver`.
- **The upgrade authority, and when it is removed.** Whoever holds it can
  replace the program's code, and with it move every open deposit. Removing it
  (step 9) gives the program the standing of the Base and Robinhood Chain
  contracts, which nobody can change, and cannot be undone. Recommended: remove
  it in the same sitting, after step 8's checks, and in any case before the fee
  is switched on for Solana. Until it is removed, do not describe the program as
  fixed or not upgradeable anywhere.
- **Deployer and fee payer** (`$PAYER`). Any wallet with enough SOL. It holds no
  role in the program. It can also be the upgrade authority for the minutes
  between deployment and step 9.

The reclaim delay is fixed at 30 days by the planner and cannot be changed after
`initialize`.

What it costs, at the rent rate of 20 November 2026 (check with `solana rent`):
about 3.02 SOL for the program's own account (432,704 bytes in the local build;
the pinned image's build may differ by a little). That rent can only be
recovered by closing the program, which needs the upgrade authority, so once
step 9 is done it is spent for good. About 0.002 SOL for the Config and about
0.003 SOL for the USDC vault and its ledger. Transaction fees on top.

## 2. Set the program address in the source

```sh
solana-keygen new --no-bip39-passphrase --outfile ~/slop-submission-deposits-program.json
solana-keygen pubkey ~/slop-submission-deposits-program.json   # PROGRAM
```

Keep that file private until step 5 and delete it afterwards. Then, in a small
reviewed change into `main` (public values only):

- `declare_id!` in `contracts/solana/programs/slop-submission-deposits/src/lib.rs`
- `slop_submission_deposits` in `contracts/solana/Anchor.toml`
- `"address"` in `contracts/solana/idl/slop_submission_deposits.json` (rebuild
  it: `anchor idl build -p slop_submission_deposits --out idl/slop_submission_deposits.json`)

Run `bun run test:contracts:solana:submission-deposits`; it fails if the
committed IDL and the build disagree. Record the merged commit as `$COMMIT`.
`anchor build` also writes a `target/deploy/slop_submission_deposits-keypair.json`
of its own; that is a random throwaway and is not the program key.

## 3. Build verifiably from the merged commit

The same pinned image, tools and command as the `solana-verifiable` job of
`escrow-tests.yml`:

```sh
git clone https://github.com/SlopDotCash/slopdotcash.git && cd slopdotcash
git checkout "$COMMIT"
IMAGE=solanafoundation/anchor@sha256:facc4ebd0738ba7ebc1eb4ef000deab6b37e7747960d3f400c73c40c5421b5de
docker pull --platform linux/amd64 "$IMAGE"
docker run --rm --platform linux/amd64 \
  --mount "type=bind,source=$PWD/contracts/solana,target=/workdir" --workdir /workdir \
  --env CARGO_TARGET_DIR=/workdir/docker-target "$IMAGE" \
  cargo build-sbf --manifest-path programs/slop-submission-deposits/Cargo.toml \
    --tools-version v1.52 -- --locked
SO=contracts/solana/docker-target/deploy/slop_submission_deposits.so
sha256sum "$SO"                          # REVIEWED_SO_SHA256
solana-verify get-executable-hash "$SO"  # REVIEWED_EXECUTABLE_HASH
```

`REVIEWED_SO_SHA256` must equal the `sha256` in
`slop-submission-deposits.manifest.json` of the `solana-verifiable-<COMMIT>`
artifact from a successful `escrow-tests.yml` run at `$COMMIT`, whose `solana`
job tested those exact bytes. A pull request's artifact does not prove the
build of `main`. Stop if the two differ.

## 4. Check the cluster and the address

```sh
solana genesis-hash -u "$RPC"     # 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d on mainnet
solana account "$PROGRAM" -u "$RPC"   # must say the account does not exist
```

An RPC failure is not evidence that the account is absent. `$RPC` is a private
mainnet endpoint; never commit it. Every command below names its cluster and
its keypair; none relies on the CLI's default wallet.

## 5. Deploy

```sh
solana program write-buffer "$SO" -u "$RPC" --keypair "$PAYER"   # prints BUFFER
solana program dump "$BUFFER" buffer.so -u "$RPC"
cmp <(head -c "$(wc -c < "$SO")" buffer.so) "$SO"    # the buffer holds exactly the build
solana program deploy --program-id ~/slop-submission-deposits-program.json \
  --buffer "$BUFFER" --max-len "$(wc -c < "$SO")" \
  --upgrade-authority "$UPGRADE_AUTHORITY" --keypair "$PAYER" -u "$RPC"
solana program show "$PROGRAM" -u "$RPC"             # Authority: the upgrade authority
solana program dump "$PROGRAM" deployed.so -u "$RPC"
sha256sum deployed.so                                # DEPLOYED_CODE_SHA256
solana-verify get-program-hash "$PROGRAM" -u "$RPC"  # must equal REVIEWED_EXECUTABLE_HASH
```

`DEPLOYED_CODE_SHA256` hashes every byte of the program's data account after its
45-byte header. With `--max-len` equal to the build's size it equals
`REVIEWED_SO_SHA256`.

## 6. Create the Config, once, with the upgrade authority

Write `deposits-input.json`:

```json
{
  "programId": "<PROGRAM>",
  "upgradeAuthority": "<UPGRADE_AUTHORITY_PUBKEY>",
  "codeSha256": "<DEPLOYED_CODE_SHA256>",
  "owner": "<OWNER>",
  "resolver": "<RESOLVER>",
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "payer": "<PAYER_PUBKEY>"
}
```

The mint is USDC on Solana; confirm it on Circle's own page before using it.
Build the unsigned transaction. The planner checks the cluster, the deployed
bytes, the upgrade authority, the two roles, and that no Config exists:

```sh
cd contracts/solana && npm ci --ignore-scripts --legacy-peer-deps
export SLOP_SOLANA_RPC_URL="$RPC"
export SLOP_SOLANA_GENESIS=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d
SLOP_SOLANA_RECENT_BLOCKHASH="$(solana -u "$RPC" block --output json | jq -r .blockhash)" \
node scripts/submission-deposits-plan.mjs initialize deposits-input.json > initialize-plan.json
```

Check `initialize-plan.json`: `requiredSigner` is the upgrade authority, `owner`
and `resolver` are the two you chose, `reclaimDelaySeconds` is `2592000`. The
upgrade authority signs `transactionBase64` with its own wallet tooling and
sends it within the blockhash's lifetime (about a minute; rebuild the plan if it
expires). It is an ordinary unsigned legacy transaction, the same format as the
escrow's `config-plan.mjs` output.

The Config's delay has no update instruction and the Config cannot be closed. A
wrong owner can be corrected only by that owner handing ownership over; a wrong
resolver by the owner's `set_resolver`. Check both twice before signing.

## 7. Open the USDC vault and check the kept destination

```sh
SLOP_SOLANA_RECENT_BLOCKHASH="$(solana -u "$RPC" block --output json | jq -r .blockhash)" \
node scripts/submission-deposits-plan.mjs vault deposits-input.json > vault-plan.json
```

Check `vault-plan.json`: `mint` is the USDC mint, `decimals` is `6`,
`requiredSigner` is `$PAYER`. Sign and send it as in step 6.

A kept USDC fee goes to the associated token account of Slop's Solana fee wallet
`9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY` (re-read that address in
`contracts/DEPLOY-MAINNET.md`). The program never creates a token account, so
that account must exist before a fee can be kept:

```sh
spl-token address --verbose --owner 9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY \
  --token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v -u "$RPC"   # its address
spl-token account-info --address <that address> -u "$RPC"          # must exist, owner the fee wallet
```

If it does not exist, anyone can create it; no key of the fee wallet is needed:
`spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --owner 9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY --fee-payer "$PAYER" -u "$RPC"`.

## 8. Read everything back

```sh
node scripts/submission-deposits-plan.mjs status deposits-input.json
```

Expected: `upgradeable` is `true` and `upgradeAuthority` the key you named; in
`config`, the owner and resolver you chose, `pendingOwner` `null`,
`reclaimDelaySeconds` `2592000`, `depositCount` `"0"`, `depositsPaused` `false`;
in `vault`, the USDC mint, `openTotal` `"0"` and `balance` `"0"`.

Also confirm in an explorer that the deployment, the `initialize` and the
`open_vault` transactions moved no tokens.

## 9. Remove the upgrade authority

This is the owner's decision from step 1. It cannot be undone.

```sh
solana program set-upgrade-authority "$PROGRAM" --final \
  --upgrade-authority "$UPGRADE_AUTHORITY" --keypair "$PAYER" -u "$RPC"
solana program show "$PROGRAM" -u "$RPC"   # Authority: none
```

Set `"upgradeAuthority": null` in `deposits-input.json` and run step 8's command
again: `upgradeable` must now be `false`, with the same Config. Run it once more
with the old authority in the file: it must refuse with "Upgrade authority
mismatch". From here on nobody can change the program, close it, or recover its
rent.

If the authority is kept instead, record who holds it and why in the deployment
record, and treat that key as able to take every open deposit.

## 10. Publish the verification (optional)

```sh
solana-verify verify-from-repo -u "$RPC" --program-id "$PROGRAM" \
  --library-name slop_submission_deposits --mount-path contracts/solana \
  --commit-hash "$COMMIT" https://github.com/SlopDotCash/slopdotcash
```

The escrow's record notes that the default `solana-verify` image cannot build
this lockfile; if it fails for that reason, the hashes of steps 3 and 5 are the
evidence and this step is skipped.

## 11. Record it

A separate reviewed change, not part of deployment:

- Add the program address, the deployment, `initialize`, `open_vault` and
  authority-removal transactions, the commit, both hashes and the read-back to
  `contracts/DEPLOY-MAINNET.md` and to the program's README section.
- The fee constants, the Worker's Solana reader and the pay page's Solana flow
  are later changes. Nothing reads the program until they exist, and no fee is
  asked on Solana until the switch says so.
- When the Worker's Solana resolver key exists and holds a little SOL, the owner
  calls `set_resolver(<that address>)` and the change is recorded the same way.
- Once deployed from `contracts/solana/programs`, the program is inside Slop's
  own loss-of-funds security program (PRD section 8).

## If something is wrong after deployment

Before step 9: the upgrade authority can replace the program with a corrected
build, through the escrow's buffer procedure in `contracts/DEPLOY-MAINNET.md`
section 2. After step 9: the program cannot be changed. The owner calls
`pause_deposits(true)` so no new deposit arrives, the resolver refunds what is
open (or payers reclaim after 30 days), and a corrected program is deployed at a
new address. Pausing never blocks a refund, a kept payment or a reclaim.

If the upgrade authority was removed before `initialize` ran, the program can
never be initialized and holds nothing: deploy again at a new address.
