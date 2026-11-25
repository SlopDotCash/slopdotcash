# Submission deposits on Solana: AI-assisted review, 20 November 2026

This is an AI-assisted internal review of
`contracts/solana/programs/slop-submission-deposits/src/lib.rs` by the same agent
session that wrote it. It is not an audit, and nobody independent of the project
has reviewed the program. **Changed on 25 November 2026:** item 1 below was
settled by changing the program before deployment; see
"[Change of 25 November 2026](#change-of-25-november-2026)". The source hash,
build sizes, test counts and deliberate-defect results in this note describe the
program as it was on 20 November, before that change. An independent agent pass, given only the source and
the specification, was started and did not run (the account's model spending
limit stopped it before it read a line); the adversarial read below is the
author's own and carries the author's blind spots. The program is not deployed.

Source reviewed: SHA-256
`ab23f8089011e139856420338bb423ea8b17b51be66eff31cb5ca57d248f40ee`, Anchor 0.32.1,
platform tools v1.52, `anchor-lang` and `anchor-spl` 0.32.1 from the workspace
`Cargo.lock`. The local build is 432,704 bytes with SHA-256
`078cb016274d46ddb114fa47af5b0238a942dde06367c30330801800b7988c33`; a
local build is not the pinned image's build and its hash is not the deployable
one (the pinned image's is below).

## Result

No defect was found that lets a deposit's tokens reach anything but a token
account its payer owns or the associated token account of its kept wallet, be
paid twice, or be released by anyone but the resolver or, after the delay, the
payer. One limit was found that the EVM contract does not have (item 1 below):
whoever keeps making deposits can make other payers' deposits fail and retry.
It delays; it moves nothing. That limit was removed on 25 November 2026.

## What was run

All on 20 November 2026, on macOS arm64 with a host `solana-test-validator`
(Agave 2.3.0), not the pinned 2.1.21 validator container that CI uses.

| Check | Result |
| --- | --- |
| Host unit tests (`cargo test --locked -p slop-submission-deposits`) | 5 passed |
| Rehearsal suite, 30-day delay, mint at the USDC address | 9 passed |
| Lifecycle suite, six-second delay | 24 passed |
| Invariant campaign, 240 steps, seed 20261120 | passed: 90 deposits, 35 kept, 34 refunded, 14 reclaimed, 8 early reclaims refused, 20 deposits refused while paused, 9 refused attacks, 30 pause changes |
| Deliberate defects (40 single changes to the program, whole suite each) | 37 made a stage fail; 3 survived, each explained below |
| Quint models `solana_submission_deposits`, `solana_submission_deposits_suite`, `solana_submission_deposits_deployment` | typecheck, scenarios, sampling and exhaustive TLC verification pass |
| The runbook's CLI steps on a local validator (write buffer, compare, deploy at a keypair address, read back, remove the authority) | pass; the deployed bytes equal the build, and closing the program afterwards is refused |
| The escrow's program bytes with and without this program in the workspace | identical (SHA-256 `fc72521d8f0374b44ee49f447538fb403ff541e27ac3640b436d6b0013527521`, local build) |

The deliberate defects were: kept sent to the payer; refund sent to the kept
wallet; anyone resolves; no reclaim delay; reclaim one day early; anyone
reclaims; a refund to any account the payer owns; a refund to the associated
address whoever owns it now; pausing does not stop deposits; pausing blocks
settlement; pausing blocks reclaim; the open total not reduced on a payout; not
raised on a deposit; a resolved deposit stays open; a reclaimed deposit stays
open; the rent of a resolved deposit to any account; the owner may be the
resolver; the pending owner may be the resolver; the resolver may be named
owner; anyone accepts a pending handover; a cancelled handover can be accepted;
one-step ownership; anyone initializes; anyone pauses; a zero kept wallet; the
program's own accounts as kept wallet; a zero amount; a zero delay; any delay;
the owner equal to the resolver at `initialize`; a wrong deposit time; a count
that does not advance; a wrong payer, kept wallet, amount or item recorded; a
reclaim to an account the payer does not own; a deposit from an account the
payer does not own; no vault check after a payout; no exact-receipt check on a
deposit.

Three survive, and none is a gap in the tests. "A cancelled handover can be
accepted" removes the check that the pending owner is not the all-zero address;
that address is the System Program's, nobody can sign as it, so the check cannot
be reached (the EVM contract's zero-address check is the same). "No vault check
after a payout" and "no exact-receipt check on a deposit" remove the two last-line
checks of item 6, which the classic Token program never lets fail. The script and
its results are kept with the build notes, outside the repository.

The pinned image built both programs in CI for this change's pull request (run
44731581604, source commit `8eed8a2ca9ee1aa3247b60cfb410ed93e8f334b8`):
`slop_submission_deposits.so` is 432,856 bytes with SHA-256
`81223522313e9d2e32899d442fbc6e6471d2d19a15a7e1d06106a207cf23ffb8`, which holds
only while the placeholder program id is in the source; `slop_escrow.so` has
SHA-256 `871796f06fb10ed1f87143eb3b7ed184b076ca5cf5e42e4f55f1876626110e79`, the
same as the scheduled run on `main` of 19 November 2026 (44560021713), so the
escrow's deployable bytes are unchanged. A pull request's artifact does not
prove the build of `main`.

## For a second reader

1. **The next id is part of the record's address.** *Changed on 25 November
   2026, operator decision: the record's address is now derived from the payer
   and a number the payer picks, and the id is assigned inside the record. The
   rest of this item describes the design of 20 November and why it was
   changed.* A deposit must name the
   account of id `deposit_count + 1`. Two deposits built against the same count
   have one winner; the other fails (`ConstraintSeeds`) and is rebuilt. Someone
   who keeps landing deposits of any mint whose vault they opened can therefore
   keep honest deposits failing. Each of the attacker's deposits locks its rent
   (about 0.002 SOL) for the 30 days until reclaim and costs a transaction fee;
   nothing is lost by anyone and no deposit is misdirected. The owner's only
   lever is the pause, which stops honest deposits too. The alternative is a
   record address derived from the payer and a number the payer picks, with the
   id assigned inside the record; that removes the race and makes a reader find
   open deposits with `getProgramAccounts` instead of by id. Kept as built
   because the address-by-id rule is what makes "an id is used once" and "absent
   means settled" true by construction. This is the owner's call before
   deployment.
2. **The upgrade authority.** While it exists, its holder can replace the
   program and move every open deposit. Nothing in the program limits that and
   nothing can. The runbook removes it; the README forbids calling the program
   fixed before then. `initialize` must run first: removed before it, the
   program can never be initialized.
3. **Destinations are checked by owner field and by address.** A refund must go
   to the address of the payer's associated token account, and that account's
   owner field must still be the payer. Either check alone is not enough: the
   address alone would pay an account the payer handed to someone else; the
   owner field alone would let the resolver pick among the payer's accounts.
   Both have a deliberate-defect test.
4. **The rent recipient is unchecked by type and fixed by `has_one`.** `payer`
   in `resolve` is an `UncheckedAccount`; the `has_one = payer` on the deposit is
   the only thing that fixes it. A payer who turns their own wallet address into
   an account that cannot receive lamports would block every outcome of their
   own deposit, the kept one included. That costs the payer the deposit and
   Slop one kept fee; no way was found to block the kept outcome alone.
5. **Classic SPL Token only.** `Account<Mint>` and `Program<Token>` refuse
   Token-2022. The wrapped SOL mint is a classic mint and is admitted like any
   other; the Worker's table decides what counts. A vault's token authority is
   its ledger address, which only this program can sign for, and the vault has
   no delegate and no close authority (asserted in the lifecycle suite).
6. **The two solvency checks cannot fail with a correct token program.** After a
   deposit the vault must have risen by exactly the amount; after any payout it
   must still cover `open_total`. With the classic Token program both always
   hold, so no test reaches `TransferNotExact`, and `VaultShort` is reached only
   by a deliberate defect in the program's own arithmetic. They are kept as a
   last line, not as tested behaviour.
7. **Time.** `deposited_at` and the reclaim check read the cluster clock. The
   exact boundary second is covered by the host unit test of `reclaimable_at`
   and by the comparison in the source; on a live validator the suites prove
   "an hour short is refused" and "five minutes past is accepted" at 30 days and
   the same around a six-second delay, not the single second.
8. **Events are not the record.** `emit!` writes to the program log, which
   another instruction in the same transaction can push past its size limit. A
   reader that trusted events could miss a deposit. The interface tells readers
   to use accounts and instruction data; the rehearsal decodes both by hand.
9. **Issuer powers.** USDC has a freeze authority. A frozen payer account blocks
   that payer's refund (tested); a frozen kept account blocks the kept outcome
   (tested); a frozen vault blocks everything for that mint and the program has
   no way around it (not tested: it needs the freeze authority to act on the
   vault, and the result is the Token program's own refusal).
10. **`initialize` is bound to the upgrade authority through the loader's
    ProgramData account**, as in `slop-escrow`. A program deployed with a
    non-upgradeable loader has no such account and could not be initialized;
    the runbook deploys with the upgradeable loader.

## Change of 25 November 2026

Operator decision, 25 November 2026, taken before deployment because the program
is meant to become unchangeable.

What changed in the program, and nothing else:

- `deposit(item, amount, kept_to, nonce)` has a fourth argument, a `u64` the
  payer chooses.
- The `Deposit` account's seeds are `"deposit"`, the payer's address, and the
  nonce as 8 bytes little-endian. They were `"deposit"` and the next id.
- The record stores the nonce after the payer (169 bytes with its discriminator;
  it was 161). The program still sets `id = deposit_count + 1` and stores it.
- `resolve` and `reclaim` take the `Deposit` account by its address and check it
  against the payer, nonce and bump stored in it.
- The `Deposited` event also carries the nonce.

Why: with the id in the address a payer signed against the current count, so any
deposit that landed first made theirs fail with `ConstraintSeeds`, and a stream
of one-unit deposits of a throwaway mint could keep every payer failing. With
the payer and the nonce in the address, no transaction of anyone else can change
the address a signed deposit names.

What was checked, by reading and by test:

- **No other account of `deposit` depends on the count.** `config`, `ledger`,
  `mint`, `source`, `vault` and the two programs are fixed by `"config"`, the
  mint, and the payer's own token account. Only the `Deposit` address named the
  count, and it no longer does.
- **Concurrent deposits serialize and none fails for it.** Every deposit still
  writes `Config` (the count) and the mint's `Ledger` and vault, so the runtime
  runs deposits of one block one after another. Each reads the count when it
  runs, takes the next id, and writes it back. The lifecycle suite signs two
  deposits of two payers against the same state and sends both: both land. It
  also signs one deposit, lets a third party land three more (two of a mint
  made for the purpose), then sends the signed one: it lands with the fourth
  id. Under the 20 November program the first of those tests had exactly one
  winner and the second failed.
- **Nobody can create or occupy another payer's address.** The payer is a
  `Signer`, and the `init` constraint derives the address from that signer's
  key and the nonce argument. A transaction that names the address of
  (someone else, nonce), or of (payer, another nonce), or the old id-derived
  address, is refused with `ConstraintSeeds` (tested for each). Only this
  program can sign for an address derived from its id, so no other program can
  create an account there either. Anyone can send lamports to such an address
  before the payer uses it; `init` then allocates and assigns the funded
  account instead of creating it, the deposit lands, and the lamports go to the
  payer when the record closes (tested).
- **A reused (payer, nonce) is refused while its record is open**: the System
  Program reports the account as already in use, nothing is moved and the
  count does not advance (tested, with the same and with different arguments).
  Only that payer can cause it, and only for themselves.

Two consequences for whoever reads the program off chain, neither a way to move
or lose tokens:

- **Open deposits are found by scanning, not by counting.** A reader asks for
  the program's accounts that begin with the `Deposit` discriminator
  (`getProgramAccounts`) and reads the id stored in each. A deposit it recorded
  earlier whose account is gone is settled. The rehearsal suite does this by
  hand at finalized commitment. A public RPC endpoint may restrict
  `getProgramAccounts`; the Worker needs one that serves it.
- **An address is free again after its record is closed.** The same payer can
  later make a new deposit with the same nonce; it gets a new id at the old
  address (tested). So an address does not identify a deposit over time: a
  reader keys a deposit by its stored id and its creating transaction, checks
  the stored id whenever it reads an address, and takes a deposit's outcome
  from the first `resolve` or `reclaim` on that address after its creating
  transaction, not simply the newest transaction there. The program could
  prevent reuse only by keeping every record forever, which would cost each
  payer the rent the closing returns. A payer who reuses a nonce affects only
  how their own deposits read.

Also unchanged and still true: ids count up from 1 with no gap, in landing
order, because the count only moves inside a successful deposit.

What was run on 25 November 2026 is in the pull request that made the change and
in the build notes; the table and the deliberate-defect results above were not
rerun in full. The 40 deliberate defects of 20 November were not repeated.

## Not covered

- No independent review, human or agent, and no audit.
- No run in the pinned validator container or in CI: the `solana-verifiable` and
  `solana` jobs of `escrow-tests.yml` have not run with this change. The
  `solana` job runs on the nightly schedule and on manual dispatch, not on pull
  requests.
- The pinned image's build exists for the placeholder program id only (above).
  The deployable hash exists once the owner's program address is in the source.
- The `solana` job on `main` failed on 17, 18 and 19 November 2026 at steps that
  this change does not touch, so a red scheduled run after merge says nothing
  about these suites by itself; read which step failed.
- No transaction on devnet or mainnet. The mint at the USDC address in the
  rehearsal is local bytes with local authorities; Circle's mint was not cloned.
- The Worker's Solana reader, the pay page's Solana flow and the fee tables do
  not exist. The read recipe in the interface was exercised once, by hand, in
  the rehearsal.
- Compute-unit use and how many `resolve` instructions fit in one transaction
  were not measured.
