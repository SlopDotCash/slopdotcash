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

For Base and Ethereum mainnet USDC, the read-only verifier queries three fixed,
independent public RPC authorities for `eth_chainId`, the `finalized` head, and
the canonical block at the receipt height. At least two must agree on the exact
transaction and block identity. It then accepts only a successful receipt whose
block-bound canonical USDC `Transfer` logs credit the project owner the exact
amount with balanced deltas, no undeclared positive credit, no mint or burn,
and at least the network confirmation policy (12 on Base, 64 on Ethereum)
behind each agreeing authority's finalized head:

```text
bun run funding:verify-evm -- --network <base|ethereum> --transaction <0x-hash> --recipient <project-owner-address> --amount-minor <integer>
```

It has the same boundaries: read-only evidence for human review, never a key,
signature, broadcast, or written funding record. The production CLI has no RPC
override; deterministic tests may inject only the fetch implementation.

For Bitcoin mainnet BTC, the read-only verifier queries three fixed,
independent public Esplora authorities for the transaction, the chain tip, and
the canonical block hash at the transaction height. At least two must agree on
the exact transaction and block identity. It then accepts only a confirmed
transaction whose block hash still sits in each agreeing authority's best
chain, with at least 6 confirmations behind each tip, a coherent fee that
exactly reconciles input and output sums, no coinbase input, no input spending
the recipient's own coins, no dust-level credited output, and non-dust
recipient outputs summing to the exact amount:

```text
bun run funding:verify-bitcoin -- --transaction <txid> --recipient <project-owner-address> --amount-minor <satoshis>
```

Same boundaries again: read-only evidence for human review, never a key,
signature, broadcast, or written funding record. The production CLI has no API
override; deterministic tests may inject only the fetch implementation.

## Committed funds

A project may additionally declare reviewed commitment instruments in
`project.funding.commitments`. Each instrument is a third-party on-chain
mechanism that Slop does not control: an autonomous Squads v4 multisig vault
holding USDC on Solana or a Sablier Lockup v4 USDC stream on Base or Ethereum.
A Squads commitment requires an exact 2-of-2 funder and project-steward
multisig with no configuration authority; a Sablier commitment uses a
non-upgradeable, non-cancelable stream. Slop holds no key, admin, or fee position in any
instrument; it publishes the reviewed reference and read-only evidence only.
Committed funds are constrained by that reviewed third-party instrument, not
held by Slop.

Public commitment evidence is append-only under:

```text
funding/<project>/commitments/<network>/<transaction-id>/<record-id>.json
```

Every record uses `project-commitment` schema version `1`, an event of
`deposit`, `release`, or `refund`, and binds the exact project-manifest
commit, instrument identity (multisig, vault index, vault, and both reviewed
members; or contract and stream id), transaction ID, integer minor-unit amount,
observation time, state, finality, and verifier version. Corrections use the
same `supersedes` chain rules as direct-funding records, and verified and
self-reported amounts are never summed into one number. Commitment records are
never mixed into direct-funding totals.

For a Squads v4 vault on Solana mainnet, the read-only verifier
(`commitment-squads-v2`) queries three fixed public RPC authorities at
`finalized` commitment and requires two to agree exactly:

```text
bun run funding:verify-commitment-squads -- --mode state \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --funder-member <pubkey> --steward-member <pubkey> \
  --token-account <token-account>
bun run funding:verify-commitment-squads -- --mode deposit \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --funder-member <pubkey> --steward-member <pubkey> \
  --signature <signature> --amount-minor <integer>
bun run funding:verify-commitment-squads -- --mode release \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --funder-member <pubkey> --steward-member <pubkey> \
  --recipient <owner> --signature <signature> --amount-minor <integer>
bun run funding:verify-commitment-squads -- --mode refund \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --funder-member <pubkey> --steward-member <pubkey> \
  --recipient <owner> --signature <signature> --amount-minor <integer>
```

Every mode proves that the declared vault is the canonical Squads PDA for the
reviewed multisig and vault index. It also proves that the multisig account is
owned by the fixed Squads v4 program, has the default (absent) configuration
authority, and contains exactly the two declared voting member keys at a 2-of-2
threshold. State mode additionally proves the vault's USDC token-account
balance (canonical mint, vault-owned account, exact integer) with the canonical
evidence URL `https://solscan.io/account/<vault>`. Deposit mode proves the exact
vault credit. Release and refund modes take the expected recipient as explicit
input—a release must credit an active manifest receiving route and a refund the
funder's claimed wallet—and are never inferred. The verifier never signs,
broadcasts, handles a key, or writes a record.

For a Sablier Lockup v4 USDC stream on Base or Ethereum, the read-only
verifier (`commitment-sablier-v2`) queries three fixed public RPC authorities,
checks each authority's chain ID, pins every stream view call to that
authority's own finalized block, and requires two to agree exactly on the
stream state:

```text
bun run funding:verify-commitment-sablier -- --network <base|ethereum> --stream-id <integer> --recipient <0x-address>
```

It proves the stream's underlying token is the canonical USDC contract for
the network and that the stream recipient equals the expected project payout
address, which is explicit input and never inferred. It reports the exact
integer deposited, withdrawn, refunded, and locked (deposited minus withdrawn
minus refunded) minor-unit amounts, the funder-side sender address, the
on-chain end time, and the canceled and depleted flags truthfully, with the
canonical evidence URL `https://basescan.org/address/<contract>` or
`https://etherscan.io/address/<contract>` and each agreeing authority's
finalized block identity. Wrong chains, wrong tokens, wrong recipients, and
malformed return data fail closed. A cancelable stream also fails closed: the
funder could reclaim the undistributed balance at any time, so it cannot back
a positive `committedMinor`, and no evidence is emitted for it. Only a stream
whose `isCancelable` flag is already false can be recorded. The verifier never
signs, broadcasts, handles a key, or writes a record.

A manifest may set `fundingState: "committed"` only while an active instrument
is declared and the verified commitment ledger (deposits minus releases and
refunds) covers `committedMinor`. The check is deterministic ledger arithmetic
and fails closed in CI.

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
