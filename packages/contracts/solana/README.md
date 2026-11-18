# Solana protected payout escrow

Copied from SlopDotCash/slopdotcash (`development`, `5268ca066`). The TypeScript
adapter and the Workers named below remain in that repository;
[the package README](../README.md) lists what runs here.

This Anchor program holds native SOL, classic SPL Token mints and the approved metadata-only
Token-2022 subset in a separate PDA vault for each owner, project digest and purpose. The project PDA seeds are
`["project", owner, project digest, purpose]`, where the purpose byte is `0`
for ordinary awards and `1` for private bounties, so one owner can hold separate
ordinary and bounty projects for the same digest (owner decision D13, 24
October 2026). `initialize` is permissionless: the signing owner pays and owns
the project. Classic SPL mints retain their existing behavior. Token-2022 mints
must have disabled mint and freeze authorities and may contain only
`MetadataPointer` and `TokenMetadata`. Metadata must be self-hosted, both
metadata authorities must be disabled, and the mint account cannot exceed 1,024
bytes. Token accounts may contain only `ImmutableOwner`, or no extensions.
Unknown extensions, transfer fees, transfer hooks and rebasing behavior remain
unsupported (PRD section 6, owner decision 26 October 2026). The program and
TypeScript adapter both check this subset.
Every transfer uses the mint's own token program and decimals with
`transfer_checked`, so the vault receives the exact amount sent.

This source change is not deployment evidence. The currently recorded mainnet
program still requires a separately reviewed and owner-approved upgrade before
Token-2022 vaults can be activated. Deployment policy must pin the
approved mint and network domain. The program cannot determine GitHub authority
or whether a mint is the asset the project intends. A reviewed project manifest
must bind its program ID, project PDA, network, mint, owner and identity
authority.

## Native SOL

Native SOL uses `11111111111111111111111111111111` (the System Program ID) as
its immutable asset identity and nine decimals. It is not the WSOL mint.
`initialize_native` creates the same project PDA and a program-owned, empty
vault at `["vault", project]`. Its permanent rent reserve never enters the
accounting counters. `deposit_native` transfers actual lamports from the
signing depositor; unsolicited transfers do not earn credit or refund rights.
The shared commit and monthly instructions enforce the same credited free
balance, reserved awards and accrued fees for either asset family.

`pay_native` sends lamports directly to the latest co-signed destination,
`withdraw_native` sends the net refund only to the project owner, and
`claim_fees_native` sends accrued fees only to the pinned fee recipient.
No native instruction creates an associated token account or wraps SOL.
Every transfer preserves vault rent and the existing Project account layout.
A recipient with no SOL must receive enough to remain rent-exempt; otherwise
Solana rejects the entire transaction and the award stays unpaid.

The owner planner, funding receipt checker, payment executor and vault totals
reader select these native instructions from the asset identity. Funding and
payment receipts reconcile exact lamport changes and account separately for
network fees. These source changes require a reviewed program upgrade before
native SOL can be activated in a deployment.

All counters are u64 asset base units: lamports for native SOL, token units for SPL. A high-decimal mint limits the total a
project can hold: at 18 decimals, u64 holds about 18.4 whole tokens in the
cumulative `deposited` counter. Use a mint whose decimals fit the expected
project budget.

Anyone can deposit. The owner approves immutable awards: `commit` only in an
ordinary project and `commit_bounty` only in a bounty project. In an ordinary
project the bounded monthly commitment below also commits awards. The only
mutable
authority is the identity authority, replaced by a public two-party rotation. Award approval reserves principal
and its included 2% fee before a wallet exists. The `award` PDA and separate `origin` PDA are
permanent: no close, cancellation, rescue or reserve withdrawal instruction exists.
The same source digest cannot be committed again under a different award ID.
The award ID must equal `sha256("slop-escrow-award" || project PDA || source digest)`,
so another project cannot reserve the same ID first.
A binding needs two signatures. The project's identity authority (Slop's
attester key) and the destination keypair both sign `bind_wallet`, which binds
a numeric GitHub actor to that co-signing destination with an expected
predecessor version. The program takes the destination from the co-signer, so
the authority alone cannot bind a wallet it does not hold, and a destination
cannot bind itself without the authority. Binding PDAs are per project: their
seeds are the project PDA and the actor, inside the program deployment, and
`bind_wallet` also checks the project's network domain. A binding in one
project never pays, delays or vetoes anything in another project, and the seeds
do not include the authority, so bindings survive an authority rotation.
Permissionless payment callers select neither amount nor recipient; the binding
and expected version select the recipient. The backend must verify GitHub login
and the contributor's current registered claim before the identity signer
co-signs. A verified binding activates immediately. `bound_at` records its chain time;
no wallet waiting period follows. The identity authority must be protected
and remain separate from relayers.

An award still waits `binding_delay` from its commitment. This parameter also
retains the owner's review period for vetoing an unpaid binding; it no longer
delays wallet activation. The owner may veto the latest unpaid binding during
that period or an unpaid award's commitment period (passed as `obligation`).
A veto creates a permanent PDA for the exact project, actor, and version.
Only a new co-signed version can replace it. The three-veto cap between
payments remains, except during a confirmed authority rotation.

Only the latest unvetoed version pays. An immediate successor invalidates
payment to the previous wallet. A paid version cannot be vetoed. Payment and
veto can race: a veto protects an eligible award only if it executes first.
A compromised authority with a colluding destination wallet can redirect an
eligible payment; there is no guaranteed reaction period after binding.

`pay` requires the destination to be the
paying wallet's associated token account, and `bind_wallet` rejects a zero
claim digest, a destination equal to the identity authority, the project or the
vault PDA, and a submission past its `expires_at`; a PDA cannot co-sign in any
case. `initialize` rejects a fee recipient equal to the owner
or the project. New production deployments use zero delay, and
the adapter checks the project's delay against the reviewed manifest.

### Deployment Config (review finding L-3)

The program has one `Config` PDA (seeds `["config"]`) with the deployment-wide
`identity_authority`, `fee_recipient` and `rotation_authority`.
`initialize_config(identity_authority, fee_recipient, rotation_authority)` creates it once. Only the program's upgrade authority can sign
it: the instruction requires the program's ProgramData account and checks that
its `upgrade_authority_address` is the signer. The three keys must be distinct
and non-default. No instruction changes or closes the Config. The owner retains upgrade authority in production. Create the Config before
project activation; this implementation has no Config update instruction.

`initialize` takes the Config as its last account. It rejects an identity
authority or fee recipient that differs from the Config (`ConfigMismatch`), and
keeps the earlier separation checks. Each project still rotates its own
identity authority (below). The owner proposes, the pinned rotation authority
confirms, and execution is immediate with the zero-delay production configuration. Thus every identity authority a new project
ever has is either the pinned one or one that the pinned rotation authority
confirmed. A new project always starts with the Config identity authority, even
after other projects rotate away from it. If that key is ever compromised, each
new project must rotate at once after `initialize`.

Why on chain: an adapter-only check would need the attester key published in
source, and the owner has not published it. On-chain pinning matches the EVM
factory. The owner-controlled upgrade authority writes it before project activation.

Residual risk: Project accounts created before the Config existed are not
pinned. The upgrade runbook lists them with `scripts/config-plan.mjs projects`
(a `getProgramAccounts` query on the Project discriminator) before activation.
The adapter refuses a project whose fee recipient differs from the Config fee
recipient, and refuses a deployment that has no Config account.

### Identity authority rotation

Each project rotates its own identity authority through a public two-party
rotation. The owner calls `propose_authority_rotation(next)`, which records the
candidate and an effective time `rotation_delay` seconds later (set at
`initialize`; new production deployments use zero, and the adapter checks the
project's delay against the reviewed manifest) and emits
`AuthorityRotationProposed`. The rotation authority, the second fixed party, calls
`confirm_authority_rotation`. The owner can cancel its own pending proposal
with `cancel_authority_rotation`. Once confirmed and past the effective time,
anyone can call `execute_authority_rotation`, which emits `AuthorityRotated`;
the current authority has no instruction that blocks or delays it. Until
execution the current authority keeps binding; afterwards only the new one
can. Binding PDAs derive from the project and actor, not the current
authority, so every existing binding stays valid and `pay` keeps finding it.
Each project rotates independently: no other project's authority can write this
project's bindings. The next authority must differ from the owner, the fee recipient, the
rotation authority and the current identity authority.

### Key recovery runbook

Who acts: the project owner key and the independent rotation-authority key,
together. The identity key and fee-conversion key cannot confirm recovery.
The program Config pins all three keys separately. Keep the rotation key out
of both hot Workers; the owner alone starts every rotation.

Identity key lost: the authority can no longer co-sign, so awards to actors
without an active binding wait; nothing is lost and no reserve moves. The
owner proposes the replacement, the rotation authority confirms, and anyone
executes after the delay. Existing bindings keep paying throughout.
Contributors whose bindings were pending or missing co-sign their next binding
with the new authority.

Identity key compromised: the owner proposes a replacement immediately and
the rotation authority confirms it. Execute after the existing rotation period.
The owner may veto unexpected unpaid bindings within their review windows,
but the veto must execute before payment. The confirmed proposal waives the
veto count; it neither pauses payments nor disables the current key early.
After execution the old key cannot bind. The new authority and contributor
can replace the latest binding. Review bindings made during the incident;
rotation cannot reverse payments or replace bindings by itself.

Owner key lost: awards, withdrawals and rotation proposals for that project
stop (other parties can still deposit, but nobody can commit or withdraw the
deposits); reserved awards still pay to active bindings. Fee recipient key
lost: fee transfers still work, but the received tokens cannot be swept.
Rotation-authority key lost: no new identity rotation can be confirmed.
There is no owner, fee-recipient or rotation-authority change in this version.

The owner can commit an award to any GitHub actor, including an account the
owner controls. Because the withdrawal fee equals the award fee (repository
owner decision of 19 October 2026, #907), such a self-award costs the same 2%
as a withdrawal and gives no fee advantage. Maintainer review of related-party
awards still applies under the eligibility policy.

The 2% fee is deducted from each gross award: 100 pays 98 to the contributor
and 2 to the fee recipient, reserving 100. Integer arithmetic rounds gross/50 up
once per immutable award. An unused-funds withdrawal pays the same 2%:
`ceil(gross / 50)`, rounded up once per withdrawal (PRD section 6). Withdrawing
850 USDC pays 17 USDC and returns 833 USDC. Every award or withdrawal of at least
one base unit pays at least one unit of fee, so splitting never lowers the fee
(owner decision of 24 October 2026; the earlier rounding down let a split into
pieces under 50 base units avoid it). The fee depends only on the current
withdrawal, so a test project that paid an earlier 10% or 5% schedule is not
affected. A program deployed before this change takes `floor(gross / 50)` until
it is upgraded; reconciliation accepts either rounding and nothing else.
Amounts are token base units.
Withdrawals consume only free vault balance, return funds only to the declared
owner, and retain fees after any earlier payout.

`deposit(amount)` is permissionless. The `depositor` signs and transfers from
its own token account of the project mint. The program adds the amount to
`deposited` and emits `Deposited { project, depositor, amount }`. The deposit
becomes free balance. The depositor gets no refund right: only the owner can
commit or withdraw free balance, and a withdrawal goes only to the owner.
Direct unsolicited token transfers to the vault are not counted in `deposited`;
such transfers remain unavailable to awards and refunds. Both credited free
balance and the actual vault token balance must cover every new reserve or
withdrawal.

The program has no service charge. Slopbot is free (PRD section 5); owner
decision D13 removed `charge_service` and its `service_fees` counter. The
conservation identity is
`deposited = free + reserved + paid + payout_fees + withdrawn_gross`.
The binding lifecycle does not change this identity. `pay` and `withdraw` move
only the net amount; the payout or withdrawal fee stays in the vault and is
added to `accrued_fees`. Anyone calls `claim_fees` to move all accrued fees to
any token account of the mint that the fee recipient owns. A frozen or missing
fee account therefore stops only `claim_fees`, never a payout or withdrawal, as
on EVM (review item L-2). Every new reserve or withdrawal also requires
`vault.amount >= reserved + accrued_fees + amount`. A withdrawal whose return
rounds to zero needs no transfer.
It cannot spend reserved principal or fees. Every credited balance is
owner-controlled free balance, whoever deposited it; this version keeps no
separate donor-class funds.

## Bounded monthly commitment

For ordinary project creation, `scripts/owner-plan.mjs` requires `monthlyCap`
in asset base units. It defaults `automaticMonthly` to true; false records an
owner opt-out. The unsigned transaction contains `initialize` followed by
`set_monthly_commitment` with the same owner signer, so both succeed or neither
does. This uses the current program and needs no program upgrade. Private
bounty initialization does not accept monthly settings.

`buildInitializeVaultInstructions` in `owner-instructions.ts` builds the same
instructions for edge and browser callers. It returns the project, vault and
Config addresses and unsigned instructions. The caller must first verify the
reviewed program, Config, network, mint and owner's authority. The builder does
not prove those facts or send a transaction. The local validator workflow
compares its output with the owner CLI, creates both monthly choices and a
separate bounty vault, then verifies deposits into each vault.

The owner can later call `set_monthly_commitment(cap, enabled)` on an ordinary
project. "On" needs a positive cap; turning it off preserves existing awards.
Legacy callers that send `initialize` alone retain their earlier off/zero
initial state. A period is a calendar UTC
month written as `YYYYMM`. Its window opens 72 hours after the month ends, at
00:00 UTC on the 4th, and closes when the next month's window opens, so only one
period is open at a time.

1. Anyone calls `commit_monthly(period, allocation_root, total, frozen_at)`
   inside the window, while the switch is on. The instruction just before it in the same
   transaction must be an Ed25519 program check of one signature by the
   project's identity authority over
   `"slop-monthly-allocation-v3" || program ID || project PDA || period (u32 LE) || allocation root || total (u64 LE) || frozen_at (i64 LE) || network domain (32 bytes)`.
   `frozen_at` is when the attester froze the allocation, after it checked that
   no included source had an `origin`; it must lie between the window opening
   and the admission time.
   The program reads that instruction from the instructions sysvar and requires
   every offset to point inside it. The `month` PDA
   (`["month", project, period LE]`) records the root once, so each period
   commits once. The total must be positive, within the current owner cap, and
   fully covered by free vault funds. Recording the root reserves that full
   total before any individual award can be created.
2. Anyone calls `commit_monthly_award(period, award_id, source_digest,
actor_id, gross, index, count, proof)` for each award. The program rebuilds
   the root from the leaf and its Merkle proof. A leaf is
   `sha256(0x00 || actor_id LE || gross LE || source_digest)` and a node is
   `sha256(0x01 || left hash || left total LE || right hash || right total LE)`.
   Each proof sibling includes its hash and aggregate gross amount. Node totals
   add with checked u64 arithmetic; an odd last node moves up unchanged. Both
   the root hash and total must match the recorded month. Creating an award
   uses the existing reservation without reserving its gross a second time.
   Later owner cap changes or opt-out affect new months only. The award then
   commits as an ordinary award with the 2% fee
   through the same `origin` and `award` PDAs, so a source commits once, by
   hand or monthly. It also creates the `["monthly-source", project,
source_digest]` marker.
3. Recording a root adds its total to `monthly_outstanding`; each committed
   award subtracts its gross. While `monthly_outstanding` is positive the owner's
   ordinary `commit` fails with `MonthlyOutstanding`, so the owner cannot consume
   an admitted award's source by hand and strand its reserve. Anyone, including
   the owner, can clear the gate by committing the remaining awards. Time and
   owner opt-out never remove the gate or release funds. Later monthly admissions,
   funded payments and withdrawals of free funds remain available. If the
   complete retained allocation has the wrong authenticated total and no leaf
   has settled, the owner calls
   `release_monthly_reserve(period, expected_unsettled, released)` with
   `released == expected_unsettled == total` after an Ed25519 check of the
   project's identity authority signature over `"slop-monthly-release-v1"`, the
   program, project, period, root, total, unsettled and released gross, and
   network. Partial or partly settled allocations refuse aggregate release.
   This prevents the same gross also being consumed by `release_monthly_award`.
   The released gross returns to free balance and is added to `committed` and
   `released`; committed awards do not change. See
   `docs/escrow-unsettleable-month-release.md`.
4. An award that can never commit is returned to free balance by anyone with
   `release_monthly_award(period, source_digest, actor_id, gross, index, count,
proof)`, passing the source's `origin`, its `monthly-source` marker and the
   obligation the origin records. The leaf must prove against the recorded
   month, and one of these must hold: its actor is zero; the recorded
   obligation pays this actor at least this gross (an identical hand award,
   which EVM also counts once, or a larger award that arrived after the
   freeze), so the contributor is already paid; or the recorded obligation was committed
   strictly before the month's `frozen_at`. The attester takes `frozen_at` from
   the block time of the finalized slot at which it checked that no included
   source has a `monthly-source` marker and that any existing `origin` records
   the identical award (same actor and gross, a genuine 2% fee), and never
   repeats a source of any admitted month. The EVM attester applies the same
   rule before signing, because EVM `commitMonthly` reverts the whole month for
   any other existing award. While automatic monthly payment is on, the owner
   cannot reserve a funded Solana monthly award by hand: that would spend the
   free balance the month's admission needs. Otherwise the call fails with `AwardCommittable`. A
   source the owner consumes by hand after the freeze with a smaller award, or
   one to another actor, therefore stays reserved and never becomes a refund.
   The release instruction still takes the `monthly-source` address but no
   longer reads it. Because admission reserves the whole total even for an
   award that is later released, the backend funds a Solana month only when its
   full total is free. Both `commit_monthly_award` and `release_monthly_award`
   create the `["settled", month, source_digest]` PDA, so each source of a month
   settles once: a committed award cannot also be released. A source repeated
   inside one allocation could settle only once and would leave the second copy
   reserved, so the allocation builder in `adapter.ts` rejects repeated sources
   before the identity authority signs.

Two steps are necessary because one Solana transaction cannot create the
accounts of a full month. The attester's role grows from wallet binding to
monthly attestation. It cannot withdraw, redirect or pay funds, and it cannot
commit more than one owner cap in each calendar month. Payment stays
permissionless `pay` through the ordinary binding and delay rules. The adapter
verifies a `commit_monthly_award` reservation like a `commit` reservation.

All transfer instructions validate the mint's token program, admitted extensions,
token account owners, vault PDA, project account and signer. Failed token transfers roll back the
entire transaction, including fees and accounting. Frozen destinations do not block
other awards. `paid`, reserve, principal paid and fee counters are on-chain. Paid
records remain permanently allocated to prevent account recreation replay.

## Month pledges

Operator decision of 15 November 2026. Until a month is committed, its money is free
balance the owner could withdraw. A month pledge locks it in the vault on chain
([spec/contracts/solanaEscrow.md, "Story: Pledge free funds to future months irrevocably"](../../../spec/contracts/solanaEscrow.md)).
The owner calls `pledge_month(period, amount)` for a UTC period (`YYYYMM`): the current
period or one of the next 11. One `MonthPledge` PDA per project and period
(`["pledge", project, period u32 LE]`, 54 bytes) records the amount and whether it is
open; `Project.pledged_open` is the sum of open pledges. Clients pledge several periods
in one transaction, one instruction each; twelve fit in one legacy transaction.
The owner pays the account's rent (about 0.0013 SOL) and gets it back with
`close_month_pledge` once the pledge has closed.

- A pledge must fit: free balance stays at or above `pledged_open` after it, otherwise
  `InsufficientFreeBalance`. A pledge can be raised, never lowered (`PledgeTooLow`); an
  equal amount changes nothing. A zero amount fails `InvalidAmount`. A past period, one
  more than 11 months ahead, or a period whose pledge already closed is refused with
  `PledgePeriodClosed`. A bounty project cannot pledge (`WrongPurpose`). No `month`
  account is checked: a period's window opens 72 hours after it ends, so the current or
  a later period cannot be committed yet.
- `withdraw`, `withdraw_native` and the owner's hand `commit` must leave free balance at
  or above `pledged_open`, otherwise `PledgedFunds`. Deposits, payments, fee claims and
  monthly award commits are unchanged.
- `commit_monthly` takes an optional last account, `month_pledge`, the period's pledge
  PDA. An open pledge is the owner's consent to that period: the month records even when
  monthly commitments are off. With them off the limit is the pledge alone, whatever the
  cap says; with them on it is the larger of the monthly cap and the pledge
  (`MonthlyCapExceeded` above it). So `set_monthly_commitment(_, false)` or a lowered cap
  after pledging stops only unpledged months, and turning monthly off never lets a month
  take more than its pledge. A month never takes funds another period's open pledge
  holds (`PledgedFunds`). On success the pledge closes and leaves `pledged_open`; any
  amount above the recorded total is free again. `MonthPledged { project, period,
  amount }` and `PledgeClosed { project, period, amount, reserved }` are emitted.
- The program is built with Anchor's `allow-missing-optionals`, so a caller that predates
  pledges may leave `month_pledge` off entirely (or pass the program ID). Such a commit
  still counts every open pledge, the period's own included. Anyone can then close that
  period's pledge at once with `expire_pledge`, which reports `reserved: true`.
- `expire_pledge(period)` is permissionless. It closes an open pledge whose period was
  never committed once the period's window has closed (00:00 UTC on the 4th of the
  second month after it), so pledged funds return to the owner if the executor misses
  the whole window. Before that, or on a closed pledge, it fails `PledgeNotLapsed`.
- `close_month_pledge(period)` is the owner's. It deletes a pledge that has already
  closed (committed or lapsed) and returns its rent to the owner; an open pledge fails
  `PledgeOpen`. A closed pledge's period is always before the current one (its window
  opened after the period ended), so `pledge_month` can never reopen it. A closed period
  with no account reads amount 0 and closed, the same as a period never pledged.

A client reads pledges with one finalized `getMultipleAccounts` of the project and the
requested periods' pledge PDAs: an absent pledge account reads amount 0 and closed, a
pledge whose project, period or open flag does not match is an error, and a Project of
the 332-byte layout reads as no pledge support (not migrated), never as zero pledged.
The owner's `pledge_month`, `expire_pledge` and `close_month_pledge` transactions are
planned and simulated unsigned; nothing that plans them signs or sends. In the source
repository `adapter.ts` does the reading and instruction building
(`readSolanaMonthPledges`) and `month-pledge.ts` the planning
(`prepareSolanaPledgeMonths`, `prepareSolanaExpirePledge`, `prepareSolanaClosePledge`,
`solanaPledgeMonthsMessage`).

Upgrading a live deployment, in this order:

1. Release the site and executor that pass `month_pledge` to `commit_monthly` and read
   both Project sizes (SlopDotCash/slopdotcash#2828 in the source repository) first, and
   confirm it is live. In this repository that is settlement's monthly executor, which
   must name the pledge, and every reader of a Project (settlement's Solana codecs,
   signer, owner plans and vault totals, and fee claims), which must accept 332 and 340
   bytes. The new program accepts a commit without the account, but such a commit counts
   the period's own pledge against it, so the executor must name the pledge before any
   owner can pledge.
2. Upgrade the program.
3. Right after the upgrade, run `migrate_project` on every live ordinary vault (Eliza,
   Teeny's brain, Hyperliquid Source and pumpfun-source on 15 November 2026). The new
   program cannot read a 332-byte Project, so every instruction on an unmigrated vault
   fails (deposits, withdrawals, payments and `commit_monthly`) until it is migrated.
   `config-plan.mjs migrate` plans one unsigned transaction per unmigrated project; any
   payer signs it, and it only adds rent and a zero `pledged_open`. A migrated project
   behaves exactly as before until its owner pledges.

What stays: the program is upgradeable by its upgrade authority, which can replace these
rules, so a pledge holds funds against the vault owner, not against that key. The owner
can still lower contributors' amounts before the allocation is frozen; a pledge stops
withdrawal, not cuts. A pledged month that is never committed lapses when its window
closes.

## Local build and end-to-end tests

`npm run build` builds the SBF binary and its IDL with Anchor 0.32.1 and
platform tools v1.52 (see [the package README](../README.md) for the
`~/.cache/solana` constraint).

`npm run test:e2e` builds the deployable program, without the
`short-delay-for-tests` feature, loads it as upgradeable with the local payer
as upgrade authority, and runs `integration/production-delay.e2e.mjs` against a
fresh validator. It proves that only the upgrade authority creates the Config,
through the unsigned `scripts/config-plan.mjs` transaction, exactly once, and
that `initialize` accepts zero award and rotation delays and rejects a
negative award or rotation delay, an award delay above 30 days and a rotation
delay above 90 days. It uses local test funds only.

The validator is `solana-test-validator` 2.1.21 when that exact version is on
`PATH`; otherwise it is the pinned Agave 2.1.21 container of
`scripts/local-solana-validator.mjs` at the repository root, which needs a local
Docker or Podman engine with that image already pulled
(`SLOP_SOLANA_CONTAINER_RUNTIME=podman` selects Podman). The script prints which
one it uses. The Solana CLI is needed in both cases for the airdrop.

The other suites in `integration/` drive the program through the off-chain
TypeScript client (`adapter.ts`, `funding.ts`, `owner-creation.ts`,
`commitment.ts`, `owner-instructions.ts`, `monthly-reserve.ts`) and the payment
services (`workers/payment-executor`, `workers/payments`, `backend/payments`,
`scripts/payment-keeper`). Those are not on this branch, so `test-e2e.sh` prints
`SKIP` with what each suite needs instead of running it: `escrow`, `executor`,
`keeper`, `native`, `owner-instructions`, `owner-plan`, `pledge` and
`token-2022`. They return with that business logic.

If a test stage fails, `.local/failure-evidence/` retains bounded status and
receipt metadata, without keys, transaction bytes, account data or raw logs.
`cargo test` checks the delay bounds on the host build; neither it nor
`cargo check --locked` proves SBF or validator execution.

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
owner-approved upgrade-authority decision. The owner approved retained upgrade
control and waived independent contract and legal reviews on 24 October 2026. The owner and fee recipient keys are fixed in each project;
the identity authority changes only through the public two-party rotation
above, never through a hidden administrative bypass.

## Mainnet upgrade

The program remains upgradeable on mainnet under the owner-controlled authority.
`contracts/DEPLOY-MAINNET.md` records the deployment and upgrade procedure. That runbook builds verifiably, upgrades through a checked buffer,
creates the Config with `config-plan.mjs`, and lists unpinned projects. Do not revoke the approved upgrade authority.
Signing requires the operator authorization and custody used for deployment.

## Deployment identity and automatic execution

`adapter.ts` is Worker-compatible and verifies finalized transactions per
escrow instruction, not per transaction. The event index is the instruction's
position in the transaction's flattened instruction list (top-level
instructions, each followed by its inner instructions). For `commit` it checks
the instruction's project, award account and arguments against the durable
award. For `pay` it requires exactly one inner `transferChecked` from the vault,
signed by the project PDA: the net amount to the destination. The fee stays in
the vault as `accrued_fees` until `claim_fees`. Logs are not used, because unrelated
instructions in the same transaction can truncate them. Unrelated instructions
in the same transaction cannot make a valid payment unverifiable. The scanner
uses the same instruction list, skips other projects' instructions, processes
at most 100 transactions per run, and atomically checkpoints each verified chunk.
Backward discovery pages persist across runs, so a large backlog does not reset
discovery to the newest signature. Each reviewed configuration includes owner,
identity authority at activation, independent rotation authority, rotation
delay, fee recipient, token mint,
network domain, program loader and code digest. The adapter also reads the Config PDA. It refuses the deployment when the
Config is missing, or unless the project fee recipient, the Config fee
recipient and the reviewed `feeRecipient` are equal and the reviewed
`identityAuthority` is the Config identity authority. It also requires the
reviewed `rotationAuthority` to equal the separate Config rotation authority. For `pay` it reads the
mint at finalized commitment (decimals at byte 44) and requires each transfer's
decimals and token program to equal the mint's. `contracts/solana/token-extensions.ts`
admits a classic SPL mint, or the metadata-only Token-2022 subset of PRD section
6: mint and freeze authorities disabled, mint extensions limited to
`MetadataPointer` and `TokenMetadata`, and token accounts with only
`ImmutableOwner` or no extension. It refuses every other or unknown extension, a
wrong account type, non-zero base padding and a metadata pointer or embedded
metadata mint that does not name the mint. The vault token account must be owned
by the same token program as its mint.
The result fields `grossMicro`, `netMicro` and `feeMicro` keep their names; they
carry token base units of the project mint as decimal strings. The adapter checks every field
against finalized state except the identity authority: after activation it
changes through the authorized rotation that the verified program code
enforces, so the immutable manifest keeps verifying through a rotation and
historical receipts stay verifiable.
For the upgradeable loader, `codeSha256` hashes every byte after the fixed
45-byte ProgramData header, including allocation padding. `upgradeAuthority`
must match the finalized loader state, including `null` for an immutable program.
On mainnet the owner-approved upgrade authority remains set and must match the
manifest. This authority can replace program logic governing deposited funds.
Each approved upgrade must record the new program hash and preserve prior
deployment evidence.
Classic immutable BPF loader deployments hash their complete executable data.
The deploy script prints separate compiled and deployed hashes; they need not match
when ProgramData reserves additional zero-filled capacity.

The shared service in `workers/payment-executor/solana.ts` validates the current
SQLite/D1 wallet consent and the finalized deployment before signing. Each role
holds a different test signer. The gas signer cannot be the owner or identity
signer. It creates the recipient ATA idempotently and pays the exact bound
version. The identity role prepares a `bind_wallet` transaction that names the
destination as a second required signer, signs its half, journals the bytes
and returns them; the contributor's wallet signs the same bytes and the
completed transaction is broadcast through the identity role, which checks
both signatures against the journaled message first. The transaction must be
completed within its blockhash lifetime, so the identity role never binds
unattended. The account API reaches the identity role through a service
binding: a signed-in contributor calls `POST /wallets/solana-bind/prepare` with
the award ID to receive the half-signed transaction for their current claim
and payout attempt, signs it in the wallet, and returns it with
`POST /wallets/solana-bind/complete`. The identity role stores the claim digest
in the wallet binding. The executor compares the award commitment delay with the time of the
latest confirmed block, not the host clock, so a fast host clock cannot submit
a payment the program must reject. A
successor needs signed lineage authorization and reconciliation of
older attempts. The program itself never authorizes GitHub sessions.

The durable journal stores signed transaction bytes before sending them. Repeated
requests reuse that signature. A missing receipt cannot authorize another signature
until finalized block height passes the stored expiry, history still has no receipt,
and finalized obligations/bindings are reconciled. Replacement uses an atomic
comparison with the exact expired attempt, so concurrent workers cannot replace a
still-valid transaction. Retired unsigned attempts are rejected before signing.

`readVaultTotals({ rpcUrl, network, projectPda, programId })` returns the
shared `VaultTotals` shape from `contracts/vault-totals.ts`. It reads the
Project and mint accounts with one finalized `getMultipleAccounts` call, so
both come from one slot. `blockNumber` is that slot and `blockTime` is its
finalized block time. `vault` is the project PDA, `asset` the mint, and
`decimals` comes from the mint account. Counters are decimal text in token base
units. `freeBalance` is `deposited - paid - payout_fees - withdrawn_gross -
reserved`; the function throws when it is negative. Solana keeps
one combined `reserved`, so `reservedPrincipal` and `reservedFees` are null.
`accruedFees` is the project's unclaimed fees.

`owner-plan.mjs` creates unsigned initialize/deposit/commit/veto/withdraw,
claim-fees, propose-rotation, confirm-rotation and cancel-rotation transactions; a veto may name an
unpaid award (`obligationId`) to use its commit-delay window. `initialize`
refuses reviewed authorities that differ from the Config, and passes the Config
account. `confirm-rotation` requires the independent rotation-authority signer,
not the owner or fee wallet. `deposit` takes an optional `depositor`; the depositor then pays the
fee, signs, and funds the deposit from its associated token account.

`config-plan.mjs plan` creates the unsigned `initialize_config` transaction for
the current upgrade authority after it checks the deployed program bytes and
that no Config exists. `config-plan.mjs projects` lists every Project account
and marks which ones the Config pins and which still need migration.
`config-plan.mjs migrate` builds one unsigned `migrate_project` transaction per
316- or 332-byte project for the input's `payer`. No mode reads keys or sends a
transaction.

### Project account layout

The `Project` account is 340 bytes. The D13 revision removed `service_fees` and
appended `purpose`, `monthly_cap` and `monthly_enabled`, and the purpose is a
project PDA seed. The red-team revision of 24 October 2026 appended
`accrued_fees` and `monthly_outstanding` (u64 each). A 316-byte project from the
build before it cannot be read until anyone calls the permissionless
`migrate_project`, which grows it to 332 bytes, takes any added rent from the
payer and starts the new fields at zero (that build sent fees out at once).
The month pledge revision of 15 November 2026 appended `pledged_open` (u64) at
offset 332; `migrate_project` also grows a 332-byte project to 340 bytes with
`pledged_open` at zero, and every earlier offset is unchanged
([spec/contracts/solanaEscrow.md](../../../spec/contracts/solanaEscrow.md),
"The pre-pledge build's 332-byte project grows to the current layout with no
open pledges").
The 24 October revision appended `released`, `frozen_at` and `expired` to
`MonthlyAllocation` (now 109 bytes).
The `expired` field remains for layout compatibility; this build removes
`expire_month`. New funded months never expire. Before an in-place upgrade,
`config-plan.mjs migrate` also refuses a previously expired month with unsettled
funds. Such a month has an understated outstanding counter and needs separate
recovery review; the planner neither rewrites it nor releases its reserve.
A month of an earlier layout (92 bytes from the 316-byte build, or 100 bytes
from the interim build with `released` only) cannot be read by this build:
its awards fail closed, and any outstanding gross it added to
`monthly_outstanding` could never settle, so the owner's direct
commits would stay refused for good. An in-place upgrade therefore requires
that `getProgramAccounts` shows no MonthlyAllocation account of any size other
than 109 bytes; `config-plan.mjs migrate` refuses to plan otherwise. Devnet
program `7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ` had no month account on
24 October 2026. A project from before D13 cannot sign with the D13 seeds, so
D13 itself was a new deployment. Later upgrades must preserve this layout or use an explicitly reviewed migration.
A replacement deployment must preserve the old deployment and its obligations.

`owner-plan.mjs` takes the reviewed deployment input file;private RPC URL, expected genesis and a fresh
blockhash come separately from `SLOP_SOLANA_RPC_URL`, `SLOP_SOLANA_GENESIS`, and
`SLOP_SOLANA_RECENT_BLOCKHASH`. It verifies deployed code and authorities and never
reads keys or sends a transaction. Its output omits the RPC URL. The checked-in
IDL is generated from the program; regenerate it after instruction layout changes.

`bootstrap-linux.sh` installs the pinned Linux x86_64 GitHub Actions toolchain.
It checks the Agave archive's recorded SHA-256 before extraction and accepts only
HTTPS downloads and redirects. The digest pins the bytes observed from the
upstream release; it does not prove an independent build or producer signature.
It is not a mainnet deployment path. The separate Node SDK package is used only
for local integration and unsigned operator tools. Its upstream dependency audit
has unresolved advisories; lifecycle scripts are disabled and the bigint code
uses its JavaScript implementation. The hosted verifier and signer use the root
Noble dependencies and do not import the Anchor/web3/SPL Node SDK packages.

The separated-role Config is 105 bytes. This layout requires a new program
deployment; an earlier 73-byte Config is not migrated or accepted by the
adapter. Prepare `rotationAuthority` in the reviewed configuration and keep
its seed only in the owner-controlled signing environment. It must differ
from the fee wallet, identity authority, project owner and vault.

The owner approved zero mandatory award and identity-rotation delays and retained production upgrade authority on 24 October 2026. New project configurations use zero delays. Existing project accounts retain their recorded delays. The configured upgrade key and exact program bytes remain part of verification.
