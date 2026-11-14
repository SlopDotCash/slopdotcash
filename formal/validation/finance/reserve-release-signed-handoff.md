# Preserve the signed reserve release across observations

The correction is based on commit b6dfe096b. A later height or owner revision
invalidates an unsigned review. A signed attempt keeps its reviewed revision
and evidence height until the exact canonical finalized transaction succeeds
or fails. A successful receipt must match the signed attempt, allocation root
and whole untouched reserve. The receipt may precede a later observed head.
A competing finalized settlement permanently blocks release.

A verified failed transaction preserves the retired attempt's identity,
reviewed owner revision, review height and failure height. It moves no
funds. Fresh review requires the current owner, the latest observed finalized
height and an untouched reserve. A new signature requires an unused attempt
identity. Pending, missing or mismatched evidence leaves the signed attempt
outstanding.

PRD section 6 specifies the reserve and authorization requirements. Pinned
source commit `6b3b9d0b979f0608d87941f1146056a98513ffcf` checks exact finalized
transactions in `workers/payment-executor/monthly-release.ts:221–326` and
`contracts/solana/wallet-transactions.ts:288–374`. The same source exposes fresh
owner review after verified failure in `src/OwnerReserveRelease.tsx:141–204`
and persists a new attempt identity before wallet submission at `:241–257`.

`pnpm gen` passed. The standalone Quint witness passed five journeys via
`pnpm exec quint test formal/validation/finance/reserve-release-signed-quint-witness.qnt --main reserve_release_signed_witness --seed 411`.
The corresponding generated TypeScript guards and transitions passed 70 directed
events. The journeys cover stale unsigned review, later observations, owner
rotation, wrong or replayed receipts, finalized partial settlement, exact
failure retirement, reused attempt rejection and a new exact finalized winner.
[Quint witness](reserve-release-signed-quint-witness.qnt) · [Quint output](reserve-release-signed-quint.log) · [Guided events](reserve-release-signed-journeys.json)

The focused simulation replayed 100 traces of 25 events against generated
TypeScript, reaching all nine transitions and all three goals. Later
observation followed by release occurred in three traces. The definitive
failure retirement transition occurred 18 times.
[Focused simulation](reserve-release-signed-verification.json) · [Coverage](reserve-release-signed-coverage.json)

The focused Vibestack proof discharged 140 of 146 obligations with zero
errors and zero resource exhaustion. It proved failure retirement, fresh
attempt identity and bound approval. For approval, numeric equality is
transitive even when amounts encode different numbers of trailing zero
limbs. The proof compares the zero-padded limbs without changing the guards.
Six obligations remain open. They cover whole release and valid or conserved
amounts after finalization, valid or conserved amounts after partial
settlement, and a generic step obligation that depends on the open
transition obligations. [Current Dafny output](reserve-release-bound-approval-dafny.log)

Earlier runs of the same model discharged 139 obligations with just the fresh
attempt proof and 138 with the generated proof alone.
[Fresh attempt proof](reserve-release-owner-sign-dafny.log) · [Baseline Dafny output](reserve-release-current-dafny.log)

The pre-retry model at hash
`7d83230662ec2fc283e2c6989eaca8c2f15caf8963a2f28aa540183714b04f4a`
discharged 107 of 114 obligations. [Earlier Dafny output](signed-release-settlement__reserveRelease.ts.log)
