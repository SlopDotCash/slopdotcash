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

The [trusted funding-record PR gate](../protocol/funding-record-pr-verification.md) can independently
reverify a narrow append-only proposal and retain an exact-head decision log.
The checker has no review-approval or merge authority. A separate, explicitly
activated standing reviewer can merge only that verified subset under strict
non-bypassable branch protection; the linked protocol defines activation,
revocation, exact-head evidence, and fail-closed human-review cases.

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
A Squads commitment requires an exact 2-of-2 funder and independently reviewed steward
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

The same verifier can also check the three-member project vault shape proposed
in RFC #500. This is verifier support only. No manifest may declare a project
vault, no project uses one, and every statement above about current
instruments is unchanged. Replace the two member arguments in any mode with:

```text
  --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey>
```

In this shape (`project-vault-squads-v1`) every mode proves the canonical
vault PDA, the fixed Squads v4 program owner, the absent configuration
authority, a threshold of 2, and exactly the three declared members with the
exact permission masks 7 (creator), 2 (Slop, vote only), and 6 (independent
signer, vote and execute). Any other mask, threshold, member count, or member
fails closed. The observed time lock is published in seconds and is part of
the quorum identity; the verifier does not decide what it should be. The
verifier cannot prove who controls a key, that the third signer is
independent, or where a future transfer will go.

Two project vault rules are kept by the signers' agreement and not by the
Squads program. A second read-only verifier (`project-vault-rules-v1`) checks
them after the fact from finalized transaction history, with the same
authorities and quorum. It cannot prevent a breach; it makes one visible.

```bash
bun run funding:verify-project-vault-rules -- --mode fallback-wait \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> \
  --transaction-index <integer> --fallback-wait-seconds <integer>
bun run funding:verify-project-vault-rules -- --mode spending-limits \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey>
```

`fallback-wait` replays the votes on one payout. A proposal keeps only its
latest status time, so the moment it was opened for votes and the moment of
each vote are read from the transactions themselves, as Solana block times.
When the two approvals that reached the threshold exclude the creator, every
one of them must come at least the stated wait after the payout was opened
for votes. A release the creator approved is reported and the wait is not
applied. The wait is an input, not a constant.

`spending-limits` reads the complete history of the multisig, back to the
transaction that created it, and fails if a spending limit was ever created
or used. A Squads spending limit lets one listed key move funds with no vote
and no time lock. A limit that was proposed and never executed is reported
and does not fail. History that does not reach the creation, or exceeds
10,000 signatures, fails closed.

Both modes exit nonzero with state `rule-not-met` when the rule was not kept.
Both first require the current multisig to match the declared shape, so a
payout voted on by a since-replaced member fails closed.

A third mode checks the creator seat:

```bash
bun run funding:verify-project-vault-rules -- --mode creator-seat \
  --multisig <multisig> --vault <vault> --vault-index <0..255> \
  --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> \
  --creator-multisig <pubkey> [--creator-vault-index <0..255>]
```

`creator-seat` proves that the creator member is the canonical vault of the
declared creator multisig (index 0 unless given) and that the account at that
address is a Squads v4 multisig. It reports that multisig's threshold, member
count, time lock and whether a configuration authority is set, and judges
none of them: how the creator protects its own seat is the creator's choice.
A plain-key creator seat fails this mode; it is only wrong for a project that
declared a multisig seat.

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

### Monthly instrument review and accessibility boundary

Current active instruments must declare `monthlyCommitment` with an exact
`cycleId` (`YYYY-MM`), positive integer USDC `amountMinor`, and
`accessibility: "unknown"`. `effectiveAt` is that month's UTC start and
`deadline` the following month's UTC start. These are reviewed funding-period
boundaries, not an automatic refund, on-chain spending limit, or expiry of an
earned allocation. Exactly one instrument may back a monthly commitment across
all networks. An instrument identity cannot be reused in another month.
The declared amount may not exceed the shared-pool plus additive-review caps;
the active instrument amount must equal the sum of amounts claimed committed.
Only that active instrument's verified ledger can cover the claim. Donations,
old vault balances, and other instruments cannot cover a new monthly claim.

A current Squads instrument also names `stewardGithub` with the reviewed
numeric `actorId`, immutable `nodeId`, and display `login`. The actor must
differ from the declared funder actor and project steward; project node-ID and
case-insensitive login collisions are rejected too. Its `stewardMember` must
differ from every manifest receiving address (including replaced routes) and
every declared Squads funder, multisig, and vault address. These are only
deterministic contradiction checks. Distinct keys and GitHub identities do not
prove independent control. The manifest PR must review the identity-to-key
binding and actual independence. The current project schema does not declare a
settler wallet or the funder's separate wallet claims, so those exclusions
remain an activation blocker; no values are inferred or fabricated.

The public distinction is explicit: a pledge is a target without committed
backing; committed is a verified instrument-balance claim; accessible would
add authenticated evidence that the required signers can act. No such
accessibility evidence protocol has been reviewed in this version. Therefore
the funding index always publishes `commitmentAccessibility: "unknown"`, all
new instrument bindings retain `accessibility: "unknown"`, and current project
policy rejects payment activation, including an additive review budget.
Committed balances may still be disclosed with payments disabled. Neither a
balance nor a GitHub statement is automatically upgraded to accessible.

Historical manifests and ledger records are not rewritten. Legacy instrument
references remain parseable for historical verification; a replaced legacy
reference may remain in current history but cannot back a current commitment.
New monthly references cannot be used to relabel old records or move balances
between months. Existing approved and paid allocation rows are unchanged.

The complete monthly instrument history stays in the reviewed manifest without
a lifetime entry-count ceiling. The trusted transition reader still limits each
manifest to 1 MiB, including the immutable base. Duplicate identities, overlapping
active windows, historical rewrites, and deletion remain invalid. Tests cover
the sixteenth-to-seventeenth-month transition and a 1,200-month history.
New cycle funding bases bind their exact month and instrument identity. Moving
history to separate archive files would require a reviewed reference-preserving
protocol; an archive marker alone never authorizes deleting instrument evidence.

### Still unresolved: authenticated loss and immutable lifecycle overlay

Issue #333 remains open. Loss of either key in the reviewed no-config-authority
2-of-2 can strand funds; no unilateral recovery, auto-refund, or new recovery
authority is introduced. Monthly-sized, distinct instruments bound the declared
exposure, but do not prove an on-chain balance cannot exceed that amount.

A future reviewed protocol must bind each signer identity to its member key,
authenticate a capability-loss report without requiring a lost key, identify
the exact instrument and affected cycle funding basis, and retain the public
reason in an append-only inaccessible-state record. It must distinguish
pre-approval holds from already approved, scheduled, partially settled, or paid
intents: approved/paid history must never be rewritten. A settlement gate and
exact-once carry must prevent both old-intent payment and successor-cycle
payment of the same principal; review-budget amounts must not carry. The new
cycle must use a fresh instrument. Until that protocol and authority are
reviewed, `inaccessible` and `accessible` claims are rejected, no report changes
allocations automatically, and no new held/carry behavior is enabled here.

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

## Receiving-address authority

A manifest change that adds, removes, rotates, or replaces a receiving route
must pin an upstream `.github/slop-project.json` authority file containing
the complete identical `funding.addresses` inventory. The optional extension
uses the manifest's existing network, asset, address, effectiveAt, and replacedAt
schema. Existing authority files without funding remain valid for unchanged
address inventories.

The trusted transition gate checks immutable repository identity, verifies that
the pinned commit is in the registered integration branch's history, hashes the
exact file bytes, checks project and steward bindings, and compares every route
field including replacement times. The current integration-head file must
remain byte-identical to the pinned proof, so an old proof cannot resurrect a
withdrawn address. Missing, unreachable, oversized, divergent,
or mismatched evidence fails closed. Unchanged address inventories make no
network request. This rule becomes enforceable for subsequent PRs after the
trusted checker has landed on develop.

This proves that the upstream repository published an address, not wallet
control, signer independence, legal ownership, or authority to pay. Maintainer
review and deterministic funding verification remain separate requirements.
