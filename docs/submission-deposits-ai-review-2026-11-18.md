# Submission deposits: AI-assisted review, 18 November 2026

This is an AI-assisted internal review of `contracts/evm/src/SubmissionDeposits.sol`
by the same agent session that wrote it, plus one independent agent pass that was
given only the source and the specification. It is not an audit, and nobody
independent of the project has reviewed the contract. The contract was not
deployed when this note was written; it was deployed on 19 November 2026
(`contracts/DEPLOY-MAINNET.md`).

Source reviewed: SHA-256
`7f8c69347c1292a8127aa591678386e2e22ad58fec31966076d74c01bf202c3e`, solc 0.8.30,
optimizer 200 runs, EVM version cancun, `bytecode_hash = none`. Runtime code hash
with the 30-day delay:
`0xe4c13bf58d547617ad10f4ee7bf4a43fb47ab68a4f6e841f5c22acd3874c55ef`.

## Result

No defect was found that lets a deposit's tokens reach anyone but its payer or its
kept address, be paid twice, or be released by anyone but the resolver or, after
the delay, the payer. The independent pass reported no critical, high or medium
finding in the contract. It reported one hazard for the service that will hold the
resolver key (item 4 below) and several points for a second reader, all listed
here.

## What was run

| Check | Result |
| --- | --- |
| `forge test`, `test/SubmissionDeposits.t.sol` | 37 passed |
| `forge test`, `test/SubmissionDepositsInvariant.t.sol` | 3 passed; 2 invariants, 256 runs of 500 calls each, 0 reverts |
| `forge test`, `test/SubmissionDepositsDeploy.t.sol` | 5 passed |
| Deliberate defects (26 single changes to the contract, unit tests only) | 25 made a test fail; the survivor is equivalent (see below) |
| Quint models `submission_deposits` and `submission_deposits_deployment` | typecheck, scenarios, sampling and exhaustive TLC verification pass |
| Deploy scripts dry-run on local forks of Base and Robinhood Chain | pass; the Robinhood script refused the Base fork |
| Rehearsal on local forks with real USDC, USDG and SLOP | 63 checks pass |
| Independent agent pass, 19 tests of its own, 7 on forks | all pass |

The deliberate defects were: no reentrancy lock; kept sent to the payer; refund
sent to the kept address; anyone resolves; the owner resolves; no reclaim delay;
reclaim one second early; anyone reclaims; no balance check on the pull; a token
address without code accepted; a payout error naming the wrong deposit; a false
return accepted; a failed token call accepted; no check of the contract's own
balance on payout; pausing blocks settlement; pausing blocks reclaim; the owner
may be the resolver; the pending owner may be the resolver; the resolver may be
named owner; a deposit settles twice; `openTotal` not reduced; no check of the
recipient's balance on payout; the contract as its own kept address; one-step
ownership; a wrong deposit time; unequal batch lists. "A failed token call
accepted" survives because a reverted token call moves nothing, so the balance
check that follows refuses it with the same error.

The rehearsal covered, on each fork: deployment through the chain's script,
deposit, refund, kept (USDC and USDG to the fee wallet
`0x8f77C37D8650776bFe73c9b12B15209eE15D9b86`, SLOP to
`0x000000000000000000000000000000000000dEaD`), a batch of one refund and one kept
while deposits were paused, refusals for the owner, a stranger and an early
payer, and a reclaim after 30 days of simulated time. On the Base fork it also
froze the payer through the real USDC contract after a deposit: the refund and
the payer's reclaim were refused, and the deposit could still be kept.

## For a second reader

1. **Who can do what with a key.** "The owner cannot resolve" holds by address
   only. `setResolver` has no delay, so an owner key can name a resolver it
   controls in one transaction and settle in the next; a contract owner can do
   both in one. The outcomes stay limited to payer or kept address. The worst a
   stolen owner or resolver key can do is send every open stablecoin deposit to
   the fee wallet (Slop can return it) and every open deposit whose kept address
   is a burn address to that address (permanent). The missing delay is also what
   lets the owner replace a stolen resolver at once. A delay on `setResolver` was
   considered and left out for that reason; a second reader should weigh it.
2. **A frozen payer.** If the token freezes or blacklists the payer after the
   deposit, the refund and the payer's own reclaim revert with `PayoutFailed(id)`
   and the deposit stays open. It can still be kept. There is no other refund
   address by design: adding one would be a way to redirect a deposit.
3. **Token administrators.** A paused token blocks every movement of that token
   until it is unpaused. An issuer that freezes the contract's own address freezes
   every deposit of that token. An issuer that can reduce the contract's balance
   (the independent pass confirmed on a fork that the SLOP token's owner can burn
   from any address) leaves the last deposit unpayable until someone sends the
   missing amount to the contract. The contract has no rescue function, so none of
   this can be repaired from inside it.
4. **Hostile tokens and batches.** Anyone can deposit any token. A hostile token
   can make its own payouts revert or burn gas, and it can behave differently in
   a simulation than on chain. `resolveMany` is all or nothing, so one such
   deposit in a batch fails the batch and costs the resolver its gas. The service
   holding the resolver key should never batch a deposit of a token it does not
   list, should cap gas, and can leave such deposits for their payers to reclaim.
   Honest deposits are not harmed: they settle on their own.
5. **Reclaim race.** From `depositedAt + reclaimDelay` the payer can reclaim at
   any moment, so a later `resolve` reverts with `NotOpen(id)`. Reclaim is allowed
   at exactly that second, not one second after.
6. **Rules added beyond the specification.** `deposit` refuses the contract's own
   address as `keptTo` (such a deposit could never be kept without stranding its
   tokens) and a token address without code. `resolveMany` refuses empty and
   unequal lists. `pauseDeposits` refuses a repeat of the current setting.
   `setResolver` refuses the current resolver and the pending owner. The
   constructor refuses a zero delay and one above 365 days. Payouts require exact
   balance changes on both sides, not only the pull.
7. **The payer is `msg.sender`.** A deposit made through an intermediary contract
   is refunded to that contract, and only it can reclaim. A wallet interface must
   have the person's own wallet call `deposit`.
8. **Stray tokens and ETH.** Tokens sent without `deposit` are counted in no
   deposit and cannot be moved. The contract has no payable function.
9. **Storage.** `resolver`, `depositsPaused` and the reentrancy flag share one
   slot on purpose, which makes the lock cheap. Owner functions are not locked;
   they touch no deposit. A record takes six slots because the field order is
   fixed by the specification; packing it would save one slot per deposit.
10. **Time.** All timing uses `block.timestamp`. On Robinhood Chain that is the
    sequencer's time, which is adequate for a 30-day delay.

## Not covered

- No independent human review and no audit.
- No deployment to a real chain, so no real-chain transaction of this contract
  exists. The same compiler settings already run the escrow and the referral
  distributor on both chains.
- The off-chain rule for which deposits count, the service that holds the
  resolver key, its key handling and its gas are separate changes and were not
  reviewed here.
- The models abstract one token, unit amounts and two deposits; `resolveMany` and
  reentry during the pull are covered by Foundry tests only.
- Tokens other than USDC on Base and USDG and SLOP on Robinhood Chain were tested
  only as local stand-ins.
