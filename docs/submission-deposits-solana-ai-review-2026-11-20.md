# Submission deposits on Solana: AI-assisted review, 20 November 2026

This is an AI-assisted internal review of
`contracts/solana/programs/slop-submission-deposits/src/lib.rs` by the same agent
session that wrote it. It is not an audit, and nobody independent of the project
has reviewed the program. An independent agent pass, given only the source and
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
It delays; it moves nothing.

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

1. **The next id is part of the record's address.** A deposit must name the
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
