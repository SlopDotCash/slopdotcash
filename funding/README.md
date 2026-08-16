# Direct project funding records

Slop does not receive, control, sign for, or recover project funds. A project
may publish reviewed receiving addresses in `projects/<project>/project.json`.
Transfers go directly from the sender's wallet to the project-controlled
address.

Public evidence is append-only under:

```text
funding/<project>/<network>/<transaction-id>/<record-id>.json
```

Every record uses `project-funding` schema version `1` and binds the exact
project-manifest commit, network, asset, transaction ID, active recipient,
integer minor-unit amount, observation time, attribution choice, finality, and
verifier version. A correction appends a new record that names the prior record
in `supersedes`; committed records are never edited in place.

An authenticated GitHub user reports a transfer by opening a pull request that
adds the first record at this path. The pull request is the public human review;
GitHub authentication identifies the author but does not prove control of the
sending or receiving wallet. Never put private keys, seed phrases, private
wallet metadata, or signing material in a record or pull request.

The public states are deliberately separate:

- `self-reported`: a donor or project supplied the transaction ID; Slop has not
  independently confirmed it.
- `verified-on-chain`: a deterministic network verifier confirmed the exact
  recipient, asset, amount, success, and required finality.
- `disputed`: later evidence conflicts, including a reorg or invalidated
  recipient/asset observation.

Duplicate transactions, wrong recipients, unsupported assets, invalid or
non-final transactions, and broken correction chains fail closed. Verified and
self-reported totals are never added into one displayed number. GitHub identity
and repository authority do not prove control of any wallet.

Contributor profiles project only the latest records whose donor chose public
GitHub attribution and whose immutable GraphQL actor node ID matches the
profile. The record retains GitHub's numeric actor ID as an additional audited
identity field, but mutable login text is never used to join history.
Funding-only profile discovery by login fails closed. Anonymous records are
excluded entirely; each supported asset keeps separate self-reported and
verified-on-chain totals.

For Solana mainnet USDC, the read-only verifier queries `getTransaction` at
`finalized` commitment and accepts only the canonical USDC mint, successful
execution, the exact signature, the exact project-owner credit, balanced raw
token deltas, and no undeclared positive credit:

```text
bun run funding:verify-solana -- --signature <signature> --recipient <project-owner-address> --amount-minor <integer>
```

It emits candidate finality and verifier fields for human review; it never
signs, broadcasts, handles a key, or writes a funding record.

For Base and Ethereum mainnet USDC, the read-only verifier first checks the
RPC's `eth_chainId`, reads the `finalized` head, and accepts only a successful
receipt for the exact transaction hash whose canonical USDC `Transfer` logs
credit the project owner the exact amount with balanced deltas, no undeclared
positive credit, no mint or burn, and at least the network confirmation policy
(12 on Base, 64 on Ethereum) behind the finalized head:

```text
bun run funding:verify-evm -- --network <base|ethereum> --transaction <0x-hash> --recipient <project-owner-address> --amount-minor <integer>
```

It has the same boundaries: read-only evidence for human review, never a key,
signature, broadcast, or written funding record.

Project payout plans remain unsigned and are executed outside Slop by the
declared project settler. A transaction signature is only reported evidence;
the cycle remains unpaid until deterministic finalized balance deltas reconcile
every contributor intent. The separately sent 1% platform fee is outstanding
until a signature is reported, reported until the same verification succeeds,
and verified only with finalized exact recipient and amount evidence. Slop does
not deduct, sweep, enforce, sign, or broadcast the fee.

The settlement protocol stores these as `pending`, `reported`, and `paid` and
the product labels them **Fee outstanding**, **Fee reported**, and **Fee
verified**. A reported signature keeps `paidMinor` at zero until the read-only
finalized balance-delta verifier succeeds.

Cycle pages publish deterministic UTC timing copy: the cycle-close warning,
the declared-settler reminder inside seven days of close, the ready-to-sign
reminder after 24 hours, and the overdue reminder after 72 hours. These are
coordination notices only; they do not message a wallet, sign, broadcast, or
upgrade settlement state.
