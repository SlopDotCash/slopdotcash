# Submission deposits on Solana: mainnet deployment runbook

Prepared on 20 November 2026, revised on 25 November 2026: the record's address
and the id a `resolve` names; step 5 (the buffer's authority, signers); step 8
(a hard stop); a new step 9 (a smoke test with the real resolver); step 10 (reads
before the authority is removed). **Nobody has run these steps on mainnet.**
They were run on devnet on 25 November 2026 with throwaway keys (below). The repository
owner signs every transaction in this runbook; no agent and no Slop service
does. The program is `contracts/solana/programs/slop-submission-deposits`; see
its [README section](../contracts/solana/README.md#submission-deposits) and the
[AI-assisted review note](submission-deposits-solana-ai-review-2026-11-20.md).
The steps were rehearsed on a local validator
(`contracts/solana/integration/submission-deposits-rehearsal.e2e.mjs`, which
preloads the program) and, on 25 November 2026, by running the commands of
steps 2 and 4 to 10 in order with throwaway keys, first on a local validator
and then on devnet (the solana CLI's `write-buffer`, `deploy --buffer`,
`set-upgrade-authority --final`, `spl-token`, and every planner mode), using a
stand-in mint and a host build instead of step 3's pinned image. The devnet
program is `CS1Nf65yt1Sw8nNctYCxuVRgT84fPCxCk3K3b9jbnVjm`, deployed in
transaction
`3LCGiMxHoY9MVwEcUJEREhftrpHnUdSNcZ67cAKHhvH2dqwRqyQfkBef92fUr8nFkzMMcGJ4PULK4yCfcEBpe6CT`,
its upgrade authority removed. It is a rehearsal and no Slop service reads it.
Not rehearsed anywhere: step 3's pinned image, `solana-verify`, step 11, an
interrupted upload, a priority fee, and a hardware wallet as signer. The
devnet RPC faucet is closed, so a devnet deployer has to be funded by hand.

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
  wallet. It must differ from the owner. Name the real resolver: the key the
  Worker will use on Solana. It must exist before step 6, hold a little SOL for
  transaction fees, and its holder must be able to sign two transactions by
  hand in step 9, because the program is tested with that key before it becomes
  unchangeable. Do not start with a placeholder address nobody controls: the
  smoke test could not run, and `resolve` would first be exercised on mainnet
  after the last moment at which a fault could still be repaired.
- **The upgrade authority, and when it is removed.** Whoever holds it can
  replace the program's code, and with it move every open deposit. Removing it
  (step 10) gives the program the standing of the Base and Robinhood Chain
  contracts, which nobody can change, and cannot be undone. Recommended: remove
  it in the same sitting, after step 8's checks, and in any case before the fee
  is switched on for Solana, and never before step 9's smoke test has passed. Until it is removed, do not describe the program as
  fixed or not upgradeable anywhere.
- **Deployer and fee payer** (`$PAYER`). Any wallet with enough SOL. It holds no
  role in the program. It can also be the upgrade authority for the minutes
  between deployment and step 10.

In the commands below `$PAYER` and `$UPGRADE_AUTHORITY` are signers: the path of
a keypair file, or a hardware wallet URL such as `usb://ledger`. The solana CLI
(checked on 2.3.0: `solana program deploy --help` lists
`--upgrade-authority <UPGRADE_AUTHORITY_SIGNER>`, and so do `write-buffer
--buffer-authority` and `set-upgrade-authority --upgrade-authority`) does not
accept a bare address there, because the authority signs the deployment and its
own removal. `$UPGRADE_AUTHORITY_PUBKEY` is that signer's address
(`solana-keygen pubkey "$UPGRADE_AUTHORITY"`), which is what the input file of
step 6 and the read-backs name.

The reclaim delay is fixed at 30 days by the planner and cannot be changed after
`initialize`.

What it costs. Sizes, measured on the local build of 25 November 2026 (the
pinned image's build may differ by a little): the program's data account is
434,933 bytes (the 434,888-byte program after a 45-byte header), the program
account 36 bytes, the Config 122, a ledger 50, a vault 165, a `Deposit` 169.
Rent is the cluster's to say, so ask it and do not rely on a figure here:

```sh
solana rent 434933 -u "$RPC"   # the program's data account
solana rent 169 -u "$RPC"      # one Deposit record, returned when it closes
```

For orientation only: a local validator of solana 2.3.0 charges 6,960 lamports
per byte including a 128-byte overhead, which makes about 3.03 SOL for the
program. The public mainnet and devnet endpoints both answered 5,080 lamports
per byte on 25 November 2026: 2,210,109,880 lamports (about 2.21 SOL) for the
program's data account, 833,120 for the program account, 1,270,000 for the
Config, 904,240 for a ledger, 1,488,440 for a vault or any other token account,
1,508,760 for a `Deposit`. The program's rent can only be
recovered by closing the program, which needs the upgrade authority, so once
step 10 is done it is spent for good. The Config, the USDC ledger and its vault
together cost well under 0.01 SOL at either rate. Transaction fees on top.

The rent is paid once, not twice. `write-buffer` puts the whole of it into the
buffer account, and `deploy --buffer` moves those lamports into the program's
data account and closes the buffer. In the local run of 25 November 2026
`write-buffer` sent 432 transactions (2,160,000 lamports of fees at 5,000
each, no priority fee) and the deployment cost two signatures and the program
account's rent. At the public rate that is about 2.215 SOL for `$PAYER` through
step 5, plus about 0.0013 SOL for `initialize`. Hold at least 2.5 SOL, more if
a priority fee is set. The vault and the fee wallet's token account cost
`$PAYER` about 0.004 SOL more, and each smoke deposit locks about 0.0015 SOL
that comes back when it is resolved.

Measured on devnet on 25 November 2026, with no priority fee: the upload
2,212,269,880 lamports (the rent and 432 fees, in 7 seconds), the deployment
843,120, `initialize` 1,275,000, the authority's removal 5,000, which is
2,214,393,000 lamports for the deployer in all; `open_vault` 2,397,680 and the
fee wallet's token account 1,493,440 for the payer; each deposit 5,000 and
1,508,760 locked until it is resolved; each `resolve` 5,000 for the resolver.
A deposit used 19,300 to 23,800 compute units and a `resolve` about 16,560.
Each transaction read as finalized at the first check, about a second after
it was sent.

Have ready before step 5, each tried beforehand:

- A way to sign and send a prepared transaction. Steps 6, 7 and 9 each hand
  over a base64 unsigned legacy transaction whose blockhash lasts about a
  minute. The solana CLI cannot sign one. The local run used a short script on
  `@solana/web3.js` (`Transaction.from`, `sign`, `sendRawTransaction`); a
  wallet that imports a base64 transaction works as well. The resolver's
  holder needs the same for step 9.
- Docker running and `solana-verify` installed, for step 3 and the hash reads
  of step 5.
- `jq`, `node` and the `spl-token` CLI.

## 2. Set the program address in the source

```sh
solana-keygen new --no-bip39-passphrase --outfile ~/slop-submission-deposits-program.json
solana-keygen pubkey ~/slop-submission-deposits-program.json   # PROGRAM
```

Keep that file private until step 5 and delete it afterwards. Then, in a small
reviewed change into `main` (public values only):

- `declare_id!` in `contracts/solana/programs/slop-submission-deposits/src/lib.rs`
- `slop_submission_deposits` in `contracts/solana/Anchor.toml`
- `"address"` in `contracts/solana/idl/slop_submission_deposits.json`, which
  holds it twice (rebuild it:
  `anchor idl build -p slop_submission_deposits --out idl/slop_submission_deposits.json`,
  then, from the repository root,
  `bun x @biomejs/biome format --write contracts/solana/idl/slop_submission_deposits.json`;
  the build writes the file in another layout, and after formatting the
  change is those two lines)

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
solana program write-buffer "$SO" -u "$RPC" --keypair "$PAYER" \
  --buffer-authority "$UPGRADE_AUTHORITY"                         # prints BUFFER
solana program dump "$BUFFER" buffer.so -u "$RPC"
cmp <(head -c "$(wc -c < "$SO")" buffer.so) "$SO"    # the buffer holds exactly the build
solana program deploy --program-id ~/slop-submission-deposits-program.json \
  --buffer "$BUFFER" --max-len "$(wc -c < "$SO")" \
  --upgrade-authority "$UPGRADE_AUTHORITY" --keypair "$PAYER" -u "$RPC"
solana program show "$PROGRAM" -u "$RPC"             # Authority: $UPGRADE_AUTHORITY_PUBKEY
solana program dump "$PROGRAM" deployed.so -u "$RPC"
sha256sum deployed.so                                # DEPLOYED_CODE_SHA256
solana-verify get-program-hash "$PROGRAM" -u "$RPC"  # must equal REVIEWED_EXECUTABLE_HASH
```

The buffer is written under the upgrade authority, not under the payer: the
loader deploys a buffer only when the buffer's authority is the authority that
signs the deployment, so a buffer written with the payer's default authority is
refused in the next command unless the two are the same key. `--buffer` takes
the buffer's address here, because the buffer already exists. `solana program
show` must print `$UPGRADE_AUTHORITY_PUBKEY` as the authority. If it prints
anything else, stop: `initialize` can be signed only by the key shown there.

`DEPLOYED_CODE_SHA256` hashes every byte of the program's data account after its
45-byte header. With `--max-len` equal to the build's size it equals
`REVIEWED_SO_SHA256`.

After the deployment the buffer's address no longer exists; its lamports are
the program's. `solana program show` prints the program's length without the
header (`Data Length: 434888` for this build).

If `write-buffer` stops part way, the CLI prints a recovery phrase for the
buffer's random keypair on the terminal. To avoid that, generate a buffer
keypair file first and pass it as `--buffer <file>` to `write-buffer`; running
the same command again then continues into the same buffer. `solana program
close <BUFFER> --authority "$UPGRADE_AUTHORITY" --recipient <PAYER_PUBKEY> --keypair "$PAYER" -u "$RPC"`
returns the lamports of a buffer that will not be used; name the recipient,
because the CLI otherwise sends them to its default wallet. The local run
closed an unused buffer this way. The `--buffer <file>` advice is from the
CLI's help; no interrupted upload was rehearsed.

The planner reads the cluster at finalized commitment. Before each planner
command in steps 6 to 10, wait until the transaction before it is finalized
(`solana confirm <signature> -u "$RPC"` says `Finalized`), or the planner
reports the state from before it.

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
blockhash() {
  curl -s "$RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"finalized"}]}' |
    jq -er .result.value.blockhash
}
blockhash   # must print a blockhash; stop if it prints nothing or an error
SLOP_SOLANA_RECENT_BLOCKHASH="$(blockhash)" \
node scripts/submission-deposits-plan.mjs initialize deposits-input.json > initialize-plan.json
```

The blockhash is read with the RPC method, not with `solana block`: on
25 November 2026 `solana block --output json` of CLI 2.3.0 failed on both
devnet and mainnet with `RPC response error -32015: Transaction version (1) is
not supported by the requesting client`, and the planner then stopped with
`Invalid public key input`, which is what an empty blockhash looks like. The
`blockhash` function is used again in steps 7 and 9; define it in the shell
that runs them.

Installed without lifecycle scripts, every planner command first prints
`bigint: Failed to load bindings, pure JS will be used` on standard error. It
is harmless and is not part of the plan file.

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
SLOP_SOLANA_RECENT_BLOCKHASH="$(blockhash)" \
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

**Hard stop.** Do not go on to the smoke test or to step 10 unless this read-back printed a `config`
and you compared three values in it, character by character, with what you
decided in step 1: `owner`, `resolver`, and `reclaimDelaySeconds` equal to
`2592000`. After step 10 none of this can be repaired by replacing the program.

- No `config`, or an error: `initialize` has not landed. Go back to step 6.
  Removing the upgrade authority now would end the program for good (step 10).
- A wrong `owner`, `resolver` or delay: do not remove the authority. Nothing
  holds tokens yet. The simplest repair is a fresh program address (step 2) and
  a new deployment; the delay and a lost owner cannot be corrected in place.
- A read through a different RPC endpoint is a useful second opinion; an RPC
  failure is not a pass.

## 9. Smoke test on mainnet, with the real resolver

The last check while a fault can still be repaired by replacing the program:
one base unit of USDC (0.000001 USDC) goes in and comes back, twice, at the
same payer and nonce. It exercises `deposit`, the real resolver's `resolve` with
the id it names, the closing of a record, and a second deposit at an address
that was used before. Nothing is kept; the only costs are transaction fees.

Needed: `$PAYER` holds at least one base unit of USDC in its associated token
account (the planner uses that account and no other, so it must exist:
`spl-token address --verbose --owner <PAYER_PUBKEY> --token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v -u "$RPC"`);
the resolver holds a little SOL (each `resolve` cost it 5,000 lamports in the
local run) and its holder is at hand to sign. `$PAYER` also needs about
0.0015 SOL free for each deposit's record, returned when it is resolved.

Add two fields to `deposits-input.json`. `payer` is already `$PAYER`'s address.

```json
  "keptTo": "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
  "smokeNonce": "1"
```

Write down the starting figures:

```sh
spl-token balance EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --owner <PAYER_PUBKEY> -u "$RPC"
spl-token balance EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --owner 9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY -u "$RPC"
node scripts/submission-deposits-plan.mjs status deposits-input.json   # depositCount N, vault 0 and 0
```

Round one.

```sh
SLOP_SOLANA_RECENT_BLOCKHASH="$(blockhash)" \
node scripts/submission-deposits-plan.mjs smoke-deposit deposits-input.json > smoke-deposit-plan.json
```

Check `smoke-deposit-plan.json`: `amount` is `"1"`, `mint` is the USDC mint,
`keptTo` the fee wallet, `requiredSigner` is `$PAYER`, `depositCountBefore` is N.
Note its `deposit` address. `$PAYER` signs `transactionBase64` and sends it, as
in step 6. Wait until it is finalized, then run `status` again: `depositCount`
is N+1, and the vault's `openTotal` and `balance` are both `"1"`.

```sh
SLOP_SOLANA_RECENT_BLOCKHASH="$(blockhash)" \
node scripts/submission-deposits-plan.mjs smoke-resolve deposits-input.json > smoke-resolve-plan.json
```

Check `smoke-resolve-plan.json`: `depositId` is N+1, `refund` is `true`,
`refundTo` is `$PAYER`'s USDC account, `requiredSigner` is the resolver. The
planner refuses if the Config's resolver is not the one in the input file, or
if the record at that address is anything but the one-unit smoke deposit. The
resolver signs `transactionBase64` and sends it; the resolver pays the fee.
Wait until it is finalized, then run `status`: the vault's `openTotal` and
`balance` are `"0"` again.

Round two: run the same two commands again, with the same `smokeNonce`. The
`deposit` address in the plan must be the same as in round one,
`depositCountBefore` is N+1, and the resolve plan's `depositId` is N+2. This is
the case of an address that held a deposit before.

Confirm, and stop if any of these is not so:

- `$PAYER`'s USDC balance equals the starting figure, and so does the fee
  wallet's.
- `status`: `depositCount` is N+2; the vault's `openTotal` and `balance` are
  `"0"`.
- `solana account <the deposit address> -u "$RPC"` says the account does not
  exist.
- In an explorer, each of the four transactions moved exactly one base unit of
  USDC between `$PAYER`'s account and the vault, and nothing else.

If a step fails: do not remove the upgrade authority. A deposit that is open
and cannot be refunded is one base unit, which `$PAYER` can reclaim after 30
days. While the authority exists the program can be replaced with a corrected
build (see the end of this runbook); once it is removed it cannot.

The two smoke deposits carry an item no pull request hashes to (the SHA-256 of
`slop-submission-deposits:deployment-smoke-test`) and one base unit, so a
reader of the program never takes them for a fee.

## 10. Remove the upgrade authority

This is the owner's decision from step 1. It cannot be undone.

**Removing the authority before `initialize` has landed kills the program.**
`initialize` can be signed only by the program's upgrade authority. Once there
is none, nobody can ever create the Config, no deposit can ever be made, the
address is spent and so is the program's rent (about 2.21 SOL at the rate
mainnet answered on 25 November 2026). The only way on is
a new address and a new deployment. So this step starts with two reads, and
both must pass immediately before the removal, in the same sitting, and step
9's smoke test must have passed:

```sh
solana program show "$PROGRAM" -u "$RPC"
#   Program Id: $PROGRAM, Authority: $UPGRADE_AUTHORITY_PUBKEY (not "none", not another key)
node scripts/submission-deposits-plan.mjs status deposits-input.json
#   step 8's hard stop again: config present, owner, resolver, reclaimDelaySeconds 2592000,
#   and after the smoke test: the vault's openTotal and balance both "0"
```

Only then:

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

## 11. Publish the verification (optional)

```sh
solana-verify verify-from-repo -u "$RPC" --program-id "$PROGRAM" \
  --library-name slop_submission_deposits --mount-path contracts/solana \
  --commit-hash "$COMMIT" https://github.com/SlopDotCash/slopdotcash
```

The escrow's record notes that the default `solana-verify` image cannot build
this lockfile; if it fails for that reason, the hashes of steps 3 and 5 are the
evidence and this step is skipped.

## 12. Record it

A separate reviewed change, not part of deployment:

- Add the program address, the deployment, `initialize`, `open_vault` and
  authority-removal transactions, the commit, both hashes and the read-back to
  `contracts/DEPLOY-MAINNET.md` and to the program's README section.
- The fee constants, the Worker's Solana reader and the pay page's Solana flow
  are later changes. Nothing reads the program until they exist, and no fee is
  asked on Solana until the switch says so.
- Record the two smoke test deposits (their ids, the four transactions) with
  the deployment.
- If the resolver key is ever replaced, the owner calls
  `set_resolver(<the new address>)` and the change is recorded the same way.
- Once deployed from `contracts/solana/programs`, the program is inside Slop's
  own loss-of-funds security program (PRD section 8).

## If something is wrong after deployment

Before step 10: the upgrade authority can replace the program with a corrected
build, through the escrow's buffer procedure in `contracts/DEPLOY-MAINNET.md`
section 2. After step 10: the program cannot be changed. The owner calls
`pause_deposits(true)` so no new deposit arrives, the resolver refunds what is
open (or payers reclaim after 30 days), and a corrected program is deployed at a
new address. Pausing never blocks a refund, a kept payment or a reclaim.

If the upgrade authority was removed before `initialize` ran, the program can
never be initialized and holds nothing: deploy again at a new address.
