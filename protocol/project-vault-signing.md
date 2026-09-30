# Project vault signing: Slop's operating rule for its vote-only key

This is the procedure the holder of Slop's project vault key follows. It
applies only to the 2-of-3 `squads-project-vault` instrument from RFC #500,
described in [`funding/README.md`](../funding/README.md). It is not in force
for any project today: no manifest declares a project vault, and the first
vault waits on the written opinion of Slop's US counsel and on Shaw's sign-off
on RFC #500 sections 2 and 3. Publishing the rule before the first vault exists lets
creators, contributors, the independent signer, and counsel review it as a
fixed text.

Slop's key can vote. It cannot propose a transfer, execute one, change a
signer, or act alone, and Slop cannot block a release the creator and the
independent signer both approve. Everything below is therefore a restriction
Slop places on itself, checked in public after the fact. Nothing here grants
Slop any authority it does not already lack on chain.

## 1. Custody of the key

- The key is held by one named person on a hardware signing device. The name
  is recorded in the manifest pull request that declares the vault.
- The key is never present in CI, on a server, in a bot, in a browser wallet,
  or in any automated process. A vote is a deliberate human action every time.
- The key holder keeps a sealed offline backup. Loss or suspected compromise is
  reported publicly the same day as an issue on this repository. From that
  moment Slop casts no votes with that key.
- Replacing the key is a configuration change that only the creator can write.
  Slop asks the creator to propose the replacement, and the new member is
  reviewed in a public manifest pull request before Slop votes for it. Until it
  lands, a compromised Slop key alone can still move nothing, because the
  threshold is two and the key cannot write or execute a transfer.
- The same person may hold Slop's key on several project vaults. The key on
  each vault is distinct, so a compromise is contained to one vault.
- Slop's key files no signer-capability report. The capability protocol
  (`protocol/signer-access-attestations.md`) covers the creator and the
  independent signer, the two members a release depends on. A standing
  statement that Slop can vote would read as a promise to approve, and this
  procedure makes no such promise: every vote follows the six checks below.

## 2. Before every vote on a payout

Slop votes to approve a payout only when all of the following hold. Each step
is run from a clean checkout of `develop`, and its output is kept.

1. **The allocation is approved and bound.** `allocation.json` for the cycle
   has `status: "approved"`, and `funding/executions/ledger.json` on `develop`
   holds the binding for this project and cycle. Check with the approval
   report in `src/lib/project-vault-approval.ts`: the state must be
   `approved-bound`, never `approved-unbound`. This is RFC #500 section 3.
2. **The proposal matches the plan exactly.** Run the execution verifier
   against the bound proposal:

   ```sh
   bun scripts/verify-squads-execution.ts --project <project-id> \
     --allocation cycles/<project>/<month>/allocation.json \
     --plan cycles/<project>/<month>/execution-plan.json \
     --base-ledger funding/executions/ledger.json \
     --ledger funding/executions/ledger.json
   ```

   Exit 0 with `plan-matched` is required. Any other result ends the
   procedure. Slop does not vote on a proposal it cannot verify.
3. **Every destination is permitted, and there is no fee transfer.** Each
   transfer in the plan goes to a wallet frozen in the approved allocation. A
   refund or windup transfer goes to the creator's declared funder wallet. A
   project vault proposal carries no fee transfer: the 1% fee is a separate
   transfer the creator sends from the creator's own wallet, never from the
   vault (RFC #500 section 8), so `totals.platformFeeMinor` in the plan is
   `0`. A plan or proposal that contains a transfer to Slop's fee recipient or
   to any other Slop address ends the procedure. Slop never votes on a
   transfer to a Slop address.
4. **The vault still has the reviewed shape.** Run the shape verifier in
   `state` mode with the three members from the manifest:

   ```sh
   bun scripts/verify-commitment-squads.ts --mode state \
     --multisig <multisig> --vault <vault> --vault-index <index> \
     --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> \
     --token-account <vault-usdc-ata>
   ```

   The observed time lock must equal `timeLockSeconds` in the manifest. A
   changed member, mask, threshold, or time lock ends the procedure.
5. **No spending limit has ever existed on the vault.**

   ```sh
   bun run funding:verify-project-vault-rules -- --mode spending-limits \
     --multisig <multisig> --vault <vault> --vault-index <index> \
     --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey>
   ```

   `rule-not-met` ends the procedure permanently for that vault.
6. **The creator seat is still the creator's multisig.** Run the same
   verifier in `creator-seat` mode with `--creator-multisig` from the
   manifest. A plain key in the creator seat ends the procedure.

When all six hold, the key holder casts one approval vote on the bound
proposal and posts the six outputs and the vote signature as a comment on the
pull request that merged the binding. The vote moves nothing on its own.

## 3. The fallback release

If the creator has not voted by the end of `fallbackWaitSeconds`, measured from
the block time at which the proposal was opened for votes, the independent
signer repeats steps 1 to 6, adds the fallback wait check, votes, and executes.
Slop's part in the fallback is the vote it already cast in section 2; Slop
never executes, on either path. If Slop's vote was not cast under section 2,
Slop does not cast it later to enable a fallback.

The fallback can release only the proposal the creator wrote. Recipients,
amounts, and order are fixed in that proposal, and neither Slop nor the
independent signer can create or alter a transfer. Anyone can check that the
wait was observed:

```sh
bun run funding:verify-project-vault-rules -- --mode fallback-wait \
  --multisig <multisig> --vault <vault> --vault-index <index> \
  --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> \
  --transaction-index <index> --fallback-wait-seconds <seconds>
```

## 4. Configuration changes

A configuration change also needs two votes. Slop votes for none of them, with
one exception: a signer replacement that has been reviewed and merged in a
public manifest pull request, where the new member, its holder, and the reason
are recorded. Slop never votes for a change to the threshold, for a spending
limit of any kind, or for a time lock that differs from the manifest. If the
creator wants a different time lock, the manifest changes first, by pull
request, and the on-chain change follows.

## 5. Refunds and windup

A refund or windup transfer to the creator's declared funder wallet is written
by the creator and approved by the independent signer. Slop takes no part and
cannot prevent it. If asked to vote on one, Slop may do so only after steps 3,
4, 5 and 6 above pass and the destination is the declared funder wallet. No
fee applies to returned funds.

If a windup follows a bound proposal, the record is `windup.json` in the cycle
directory, derived from the verified refund records and a finalized balance
observation (`cycles/README.md`, "Project vault windup"). Every approved row is
held with one public reason naming the refund transactions. Slop's key holder
does not write that record; anyone may prepare it from public evidence, and
the cycle index validates it.

## 6. Refusals

If any step fails, Slop does not vote, and the key holder opens an issue on
this repository the same day quoting the failing output. Slop does not vote to
reject either; the two other members decide what to do with the proposal.
A refusal is public, dated, and reasoned, like every other decision in the
payout record.

## 7. What this procedure is not

It is not custody: Slop holds no customer balance, cannot move vault funds,
and cannot stop the creator and the independent signer from moving them. It
is not approval: only the creator approves an allocation and only the creator
writes a payout. It is not settlement: a cycle is `paid` only when the
read-only settlement verifier reconciles finalized on-chain deltas against
every approved intent and the separately sent fee. The legal states remain
projected, under review, approved, scheduled, paid, unclaimed, and held or
excluded. Nothing here makes an allocation a balance, a debt, or an interest
in vault assets.
