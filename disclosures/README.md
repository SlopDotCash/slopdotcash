# Direct-payment disclosures

A disclosure records USDC transfers that a project creator signed and broadcast
**outside** the verified settlement flow, together with the reconstruction that
shows which contributor row each transfer corresponds to.

This directory exists because the public record must not contradict the chain.
It is not part of the reward lifecycle. Nothing here is a proposal, a review, an
approval, an allocation, an execution plan or a settlement, and nothing here
creates a claim on any project.

## Why these are not cycle artifacts

`cycles/<project>/<YYYY-MM>/` is append-only and ordered: `source-snapshot.json`
and `proposal.json`, then `allocation.json`, `execution-plan.json`,
`transactions.json` and `settlement.json`. The August 2026 transfers have none
of those. There was no proposal, no 14-day public review, no creator approval
and no cycle directory. Writing a `settlement.json` for a month that never had a
proposal would fabricate a lifecycle and imply an approval that never happened.

So the transfers are recorded here instead, in their own vocabulary, and the
cycle tree stays honest about what it does and does not contain.

## States

A disclosure row uses one of three states. None of them is the reward
lifecycle's `paid`.

- `paid-direct`: a finalized transfer was observed for this row and reconciles
  against the declared basis. The canonical settlement verifier has not run,
  because there is no allocation or execution plan for it to run against.
- `unclaimed`: the row has an entitlement above the 2.00 USDC minimum transfer
  and no transfer was observed, in every case so far because the frozen
  preparation carried no wallet for that contributor.
- `held-below-minimum`: the entitlement is under the 2.00 USDC minimum. The
  exact integer amount is retained and is not discarded or redistributed.

## The reconstructed basis

A preparation records weights, not amounts. To say what a transfer *should*
have been, a disclosure must state the basis the sender actually used, and that
basis is not always the published one.

Every disclosure therefore declares `reconstructedBasis`: the pool cap, the
denominator weight, the rounding mode, and every per-row `weightAdjustment`
with a reason. `scripts/check-direct-payment-disclosures.ts` recomputes each
row from those declared values and fails if the result does not match. A
reconstruction that only fits because a weight was quietly edited will not
pass, because each row also carries the published weight and the checker
compares it against the preparation bytes.

Where a reconstruction is derived from the observed amount rather than from a
published artifact, the row says so in its adjustment reason. That is a
description of what happened, not an endorsement of it.

`overCapMinor` is `allocatedMinor` minus the cap. A positive value means the
basis actually used distributes more than the project's published monthly cap.

## The sending wallet

A disclosure publishes every transaction signature, because signatures are what
make the record independently auditable. It does not assert the sending wallet
as a field. Any Solana signature resolves to its sender on any explorer, so
nothing is being concealed; the repository simply does not publish a creator's
payout address on their behalf without being asked. A `sender` field can be
added to a record when the creator asks for it.

## Verifying

```bash
bun run disclosures:check
```

The checker is offline and read-only. It reads no chain, holds no key, and
authorizes nothing. Confirming that a signature exists and is finalized is a
separate step; the signatures are published here so anyone can do it
independently.

## Adding one

Open a pull request. Never include private keys, seed phrases, signing material
or private wallet metadata. A correction appends a new file that names the file
it supersedes; committed disclosures are not edited in place.
