# Referral distributor: Robinhood Chain Testnet runbook (prepare only)

This runbook rehearses `ReferralDistributor` on Robinhood Chain Testnet
(chain id 46630) with a mock token. It is a preparation document: nothing in
it has been run and no address below is a deployment. The owner approved the
program and its initial parameters in PRD section 11, "Referral program", and
requested full integration and activation on 25 October 2026. The program token
is not deployed yet. Complete and record this rehearsal before live activation.
A human or owner-authorized agent may run the reviewed steps under PRD
section 11. Keep credentials private.
Never run this script on chain id 4663 and never use a production key.

The contract is described in
[`contracts/evm/README.md`](../contracts/evm/README.md#referral-distributor).
The accrual job that produces the roots is `workers/referral-accrual`
(its README explains the file and the leaf shape). The AI-assisted review of
the contract is
[`docs/security/referral-distributor-ai-review-2026-10-25.md`](security/referral-distributor-ai-review-2026-10-25.md).

## 1. Prerequisites

- Foundry 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`), the
  version `escrow-tests.yml` pins.
- A clean checkout of the reviewed source commit. Record its SHA.
- A dedicated test deployer in a Foundry keystore, for example
  `slop-test-deployer`. It pays gas and holds no role: the owner and poster
  are separate addresses read from the environment.
- Testnet ETH on the deployer from `https://faucet.testnet.chain.robinhood.com`.
- Two test-role addresses: `REFERRAL_OWNER` (void, pause, poster change,
  rescue) and `REFERRAL_POSTER` (posts roots). They must differ; the
  contract refuses them equal. For the rehearsal both can be test keystores.
  At launch the poster is the Worker's hot key and the owner must be a key
  that can act within five days of any `RootPosted` (the review's M-2): the
  S.P. operator key or a multisig with no execution delay, not a decision
  market. Who holds them is the owner's decision.
- `REFERRAL_EPOCH_CAP` in base units: the most the declared total may exceed
  the highest total ever posted. The owner approved 2,000,000 tokens for the
  whole root, or `2000000000000000000000000` at 18 decimals. The separate
  per-project lifetime cap remains 250,000 tokens. Confirm the actual token
  decimals before preparing its deployment.
- `REFERRAL_POST_SPACING` in seconds: the least time between two live posts.
  The script defaults to 27 days (one post per calendar month with room for
  a late run). A rehearsal that wants to post two epochs in one session sets
  it low, for example `600`, and records that it did.
- `ROBINHOOD_TESTNET_RPC_URL`. The public RPC
  `https://rpc.testnet.chain.robinhood.com` is rate-limited and does not keep
  account state at the `finalized` tag (`docs/testnet-funding.md`). It is
  acceptable for the broadcast. State read-backs below use `latest` or `safe`.
  Finality uses the finalized block header and exact canonical receipts and
  events. A latest-state observation alone does not prove finality.

Do not put a private key in a command line, an environment dump, a source
file or the evidence.

## 2. Read-only chain checks

```sh
export ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call 0x0000000000000000000000000000000000000064 \
  'arbOSVersion()(uint256)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
```

Expected: chain id `46630`; `arbOSVersion()` at least 75 (ArbOS 20 added the
Cancun opcodes `foundry.toml` targets; the escrow runbook explains the
offset). Stop if either differs. `ReferralDistributor` reads only
`block.timestamp`, never `block.number`, so Arbitrum Nitro block semantics do
not affect its delays.

## 3. Build and test the exact source

```sh
cd contracts/evm
forge fmt --check
forge build --sizes
forge test --match-contract ReferralDistributorTest -vv
```

Record the `ReferralDistributor` creation-code hash from
`forge inspect ReferralDistributor bytecode | shasum -a 256` beside the source
SHA. All contract tests must pass.

## 4. Simulate, then broadcast

```sh
export REFERRAL_OWNER=0x...      # test owner
export REFERRAL_POSTER=0x...     # test poster, differs from the owner
export REFERRAL_EPOCH_CAP=2000000000000000000000000
# Optional: least seconds between live posts, default 27 days.
# export REFERRAL_POST_SPACING=600
# Optional: mock supply minted to the distributor, default 2,000,000 tokens.
# export REFERRAL_MOCK_SUPPLY=2000000000000000000000000
forge script script/DeployReferralDistributorRobinhoodTestnet.s.sol:DeployReferralDistributorRobinhoodTestnet \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --account slop-test-deployer
```

The script refuses every chain except 46630 and refuses an owner equal to
the poster. Review the simulation: one `MockReferralToken`, one
`ReferralDistributor(token, owner, poster, epochCap, postSpacing)`, one mint
of the mock supply to the distributor. Then rerun with `--broadcast`. Keep
the transaction artifacts in the ignored `broadcast/` directory and record:

- source SHA and compiler settings (`solc 0.8.30`, `cancun`, optimizer 200);
- distributor address, token address, deployment transaction hashes;
- owner, poster, epoch cap and post spacing as read back below. The
  script's `ReferralDistributorDeployed` event is emitted by the script
  contract and never lands on chain, so it is not evidence.
- the finalized deployment block and Keccak-256 of the verified runtime code.
  These become `REFERRAL_DEPLOYMENT_BLOCK` and
  `REFERRAL_DISTRIBUTOR_CODE_HASH` for the independent watcher.

## 5. Read back the deployment

```sh
D=0x...   # distributor
cast call "$D" 'token()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'owner()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'poster()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'epochCap()(uint256)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'postSpacing()(uint64)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'CLAIM_DELAY()(uint64)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'RESCUE_DELAY()(uint64)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$D" 'nextEpoch()(uint256)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
cast call "$(cast call "$D" 'token()(address)' --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")" \
  'balanceOf(address)(uint256)' "$D" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"
```

Expected: the mock token, the two role addresses, the cap, the spacing,
`604800`, `31536000`, `0`, and the mock supply. Compare the deployed runtime
code with `forge inspect ReferralDistributor deployedBytecode` (the
immutables are `token`, `epochCap` and `postSpacing`; compare after masking
those words, or compare the creation transaction input against the creation
code plus constructor arguments).

## 6. Rehearse one epoch end to end

1. Produce a file with `bun run referral-accrual:dry-run <fixture.json>
   <as-of>` whose referrers use test wallets you control, and take its
   `merkle.root`, `totals.treeTotalBase` and each referrer's `leaf.proof`.
2. As the poster: `cast send "$D" 'postRoot(uint256,bytes32,uint256)' 0 <root>
   <treeTotalBase> --account slop-test-poster`. Expect `RootPosted(0, root,
   total, claimableAt)` and `hasPendingRoot() == true`.
3. Inside the window, as the owner: `voidRoot(0)` once to rehearse the veto.
   Expect `RootVoided(0, root)`. Then post the same root as epoch 1 (a voided
   epoch keeps its index, and a voided post does not consume the spacing).
4. Wait seven days (or rehearse on a local Anvil fork with `evm_increaseTime`
   first). Check `claimable(address,uint256,bytes32[])` for one referrer, then
   claim from that wallet: `claim(uint256,bytes32[])`. Expect `Claimed` and
   the mock balance to move. Claim again and expect `NothingToClaim`.
5. Post epoch 2 with a higher cumulative for that referrer (after
   `postSpacing` has passed since epoch 1, or with a low rehearsal spacing)
   and claim the difference after the delay. Also try a claim for more than
   the declared total and expect `TotalExceeded`.
6. Rehearse the incident drill with a pending root: `pause` (the window
   freezes; read `claimableAt(index)` before and after), `setPoster` to a
   fresh key, `voidRoot(index)`, `unpause`. Confirm `rescue` reverts with
   `IsPaused` while paused and with `RescueTooEarly(earliest)` after, and
   that `rescueAvailableAt()` moved to the unpause time plus 365 days.
   Then rehearse the drill with the honest root instead and confirm the
   claimable time after unpause equals the time the window had left.

Incident order at launch, from the review (section H-2 and L-2 of
`docs/security/referral-distributor-ai-review-2026-10-25.md`): pause first,
so the objection window stops; rotate the poster, so the compromised key
cannot repost; void the pending root; unpause. A watcher must rebuild every
posted root from the public accrual file and a human must decide to void by
day five, because the sequencer can delay a transaction and the contract
cannot see inside a root.

Record every transaction hash and the values read back. Captured evidence is
not committed; publish only reviewed safe deployment evidence.

## 7. What this rehearsal does not prove

- It is not an audit. The contract has an AI-assisted internal review only
  (three independent model reviews reconciled against 41 proof tests; every
  High and Medium finding fixed before the pull request opened).
- It does not activate the program. Activation needs the token to exist, the
  funding line agreed, an operating independent
  root watcher, a verified deployment on chain id 4663 with the program token,
  and the live poster configured with its separate key and deployed addresses.
  The separate poster ceilings are 0.0002 ETH per transaction and 0.002 ETH
  per UTC day. Verify their enforcement before funding or signing.
  The normal checked `main` release installs the Worker in its reviewed mode;
  the current mode is Off. No manual Worker shell or extra release flag is needed.
  Counsel review is not required (PRD section 11, owner decision of 26 October 2026).
