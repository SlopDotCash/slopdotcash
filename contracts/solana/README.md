# Solana protected payout escrow

This Anchor program holds classic six-decimal SPL tokens in a separate PDA vault
for each owner/project digest. Deployment policy must pin the approved USDC mint
and network domain. The program deliberately cannot determine GitHub authority or
whether an arbitrary mint is Circle USDC. A reviewed project manifest must bind
its program ID, project PDA, network, mint, owner and identity authority.

The owner deposits and approves immutable awards. Award approval reserves principal
and its included 2% fee before a wallet exists. The `award` PDA and separate `origin` PDA are
permanent: no close, cancellation, rescue or reserve withdrawal instruction exists.
The same source digest cannot be committed again under a different award ID.
The award ID must equal `sha256("slop-escrow-award" || project PDA || source digest)`,
so another project cannot reserve the same ID first.
A narrow identity authority binds numeric GitHub actors to destinations with an
expected predecessor version. Binding PDAs include authority, network, actor and
the program deployment. Permissionless payment callers select neither amount nor
recipient; the binding and expected version select the recipient. The backend must
verify GitHub login and the contributor's wallet authorization before the identity
signer submits this transaction. An identity key can redirect future unpaid awards;
this authority must be disclosed, protected and reviewed separately from relayers.

Each binding records `bound_at`. In a project, `pay` rejects a binding until
`bound_at + binding_delay` (set once at `initialize`). While a binding is
pending, the project owner can call `veto_binding(actor_id, version)`. It
creates a permanent `veto` PDA for that project, actor and version, and `pay`
rejects any binding version with a veto. Bindings are shared across projects
with the same identity authority and network, so a veto affects only the
vetoing project. Only a new authority binding (the next version, with a new
delay) can follow. An active binding cannot be vetoed. An owner can delay a
contributor's payout but never take an approved award back. Production
deployments use a delay of at least 48 hours, and the adapter checks the
project's delay against the reviewed manifest. `pay` also requires the
destination to be the bound wallet's associated token account.

The owner can commit an award to any GitHub actor, including an account the
owner controls, and so move unused funds out at the 2% payout fee instead of the
10% withdrawal fee. This is an accepted, documented risk: maintainer review of
related-party awards enforces the policy, not the program.

The 2% fee is deducted from each gross award: 100 pays 98 to the contributor
and 2 to the fee recipient, reserving 100. Integer arithmetic floors gross/50 once
per immutable award; unused withdrawal charges the difference
between floor(cumulative gross/10) and fees already charged. Amounts are SPL u64
micro-units. Tiny awards can incur zero fee. Withdrawals consume only free vault
balance, return funds only to the declared owner, and retain fees after any earlier
payout. Direct unsolicited token deposits do not confer refund rights and are not
counted in `deposited`; such transfers remain unavailable to awards and refunds. Both credited free balance
and the actual vault token balance must cover every new reserve or withdrawal.

All transfer instructions validate the classic token program, mint, token account
owners, vault PDA, project account and signer. Failed token transfers roll back the
entire transaction, including fees and accounting. Frozen destinations do not block
other awards. `paid`, reserve, principal paid and fee counters are on-chain. Paid
records remain permanently allocated to prevent account recreation replay.

## Local build and end-to-end tests

Run `npm run build` here to build the actual SBF binary and its IDL.
Run `npm run test:e2e` to load that binary into an isolated local validator and
execute the SPL payment, durable executor, and unsigned owner-plan workflows.
These use real token accounts, transactions, finalized receipts and balance
checks. They cover the canonical lifecycle, delayed wallet registration, wallet
rotation, binding delay and owner veto, reserve protection, split withdrawals,
frozen destination rollback, duplicate payment and forged award rejection, wrong
destination, unauthorized binding, a third-party payment mixed with unrelated
token transfers, and a foreign project that mentions this project's account.
Fixture keys and tokens have no mainnet value. CI runs these end-to-end
workflows; a successful build alone is not payment evidence.
`cargo check --locked` verifies the host program build but does not prove SBF or
validator execution. Use Anchor 0.32.1 and the platform tools pinned in the scripts.

## Public test deployment

`scripts/deploy-testnet.sh` is an explicit operator entry point, limited to Devnet
and Testnet. Provide reviewed expected genesis, isolated test payer/program/upgrade
keypair files, and the cluster through its documented required environment variables.
First update `declare_id!` and Anchor configuration to the chosen public program
identity, review and commit those public source changes, then invoke the script.
It builds the committed source, deploys, reads authority metadata and compares
program bytes. It never accepts mainnet or emits private key bytes.

Use Circle test USDC on Devnet only after rechecking Circle's current mint list.
Solana Testnet compatibility uses an explicitly labeled test mint when Circle has
no supported mint there. A local mint does not prove Circle USDC acceptance.
Deployment alone is not product acceptance: run the canonical funded lifecycle,
finalized reconciliation, real OAuth and browser journey separately.

Program upgrade authority remains a fundamental trust boundary: a retained upgrade
key can replace these restrictions. Do not activate mainnet without an explicit
reviewed immutable or governance-controlled deployment decision and independent
contract review. Identity and owner keys are fixed in each v1 project; migration
and key rotation require a separately designed successor protocol, not a hidden
administrative bypass.

## Deployment identity and automatic execution

`adapter.ts` is Worker-compatible and verifies finalized transactions per
escrow instruction, not per transaction. The event index is the instruction's
position in the transaction's flattened instruction list (top-level
instructions, each followed by its inner instructions). For `commit` it checks
the instruction's project, award account and arguments against the durable
award. For `pay` it requires exactly two inner `transferChecked` calls from the
vault, signed by the project PDA, for the net amount to the destination and the
fee to the fee recipient's account. Logs are not used, because unrelated
instructions in the same transaction can truncate them. Unrelated instructions
in the same transaction cannot make a valid payment unverifiable. The scanner
uses the same instruction list, skips other projects' instructions, processes
at most 100 transactions per run, and atomically checkpoints each verified chunk.
Backward discovery pages persist across runs, so a large backlog does not reset
discovery to the newest signature. Each reviewed configuration includes owner, identity authority,
fee recipient, token mint, network domain, program loader and code digest.
For the upgradeable loader, `codeSha256` hashes every byte after the fixed
45-byte ProgramData header, including allocation padding. `upgradeAuthority`
must match the finalized loader state, including `null` for an immutable program.
On mainnet the adapter and manifest schema require `null`: a retained upgrade key
could replace the program, empty vaults, and restore the reviewed bytes.
Classic immutable BPF loader deployments hash their complete executable data.
The deploy script prints separate compiled and deployed hashes; they need not match
when ProgramData reserves additional zero-filled capacity.

The shared service in `workers/payment-executor/solana.ts` validates the current
SQLite/D1 wallet consent and the finalized deployment before signing. Each role
holds a different test signer. The gas signer cannot be the owner or identity
signer. It creates recipient and fee ATAs idempotently and pays the exact bound
version. The identity role stores the claim digest in the wallet binding. A
successor needs the shared 24-hour signed-lineage policy and reconciliation of
older attempts. The program itself never authorizes GitHub sessions.

The durable journal stores signed transaction bytes before sending them. Repeated
requests reuse that signature. A missing receipt cannot authorize another signature
until finalized block height passes the stored expiry, history still has no receipt,
and finalized obligations/bindings are reconciled. Replacement uses an atomic
comparison with the exact expired attempt, so concurrent workers cannot replace a
still-valid transaction. Retired unsigned attempts are rejected before signing.

`owner-plan.mjs` creates unsigned initialize/deposit/commit/withdraw transactions.
Give it the reviewed input file; private RPC URL, expected genesis and a fresh
blockhash come separately from `SLOP_SOLANA_RPC_URL`, `SLOP_SOLANA_GENESIS`, and
`SLOP_SOLANA_RECENT_BLOCKHASH`. It verifies deployed code and authorities and never
reads keys or sends a transaction. Its output omits the RPC URL. The checked-in
IDL is generated from the program; regenerate it after instruction layout changes.

`bootstrap-linux.sh` installs the pinned Linux x86_64 GitHub Actions toolchain.
It is not a mainnet deployment path. The separate Node SDK package is used only
for local integration and unsigned operator tools. Its upstream dependency audit
has unresolved advisories; lifecycle scripts are disabled and the bigint code
uses its JavaScript implementation. The hosted verifier and signer use the root
Noble dependencies and do not import the Anchor/web3/SPL Node SDK packages.
