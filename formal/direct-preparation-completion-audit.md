# Initial direct-payment preparation completion

This source-only review starts at local commit `6f5aee920874`. It does not
replace the separate direct-recovery regression or model-bound correction.
No tests, syntax/type/lint/format checks, simulations, verifiers or browser
commands ran. This code and model revision is unvalidated.

## Reachable pre-publication race

`prepareDirectIntent` reads the current authorized reporter claim and exact
initial consent, then the current authorized payer claim. EVM preparation
awaits balance-proof support, head and nonce reads; Solana preparation awaits
its plan. Those waits allow either actor to authorize a successor wallet.
`registerPaymentWallet` and wallet authorization do not increment the private
security case revision. The old initial insertion checked only the successful
`prepare-payment` case event, so the case CAS could succeed and publish the
captured old wallets despite that replacement.

For example: capture reporter claim A and its consent; wait on the RPC; the
reporter authorizes B; complete A's plan; commit the unchanged case revision.
The resulting initial intent already required wallet review. A payer change
could likewise publish an intent for a payer claim that was no longer the
current selection. This is a stale initial-publication defect inferred from
source order, not a reproduced unauthorized transfer.

## Completion fence

`directPreparationFence` reconstructs the exact initial consent marker from
the prepared intent. The existing case UPDATE now requires both captured
claim IDs/digests to remain the authorized current claims for the captured
reporter and payer actors and chain, and requires that consent record.
`insertDirectIntent` repeats the same predicate after the event witness. The
single D1 batch either publishes the matching case/event/intent or produces
`payment_preparation_changed` without an initial intent or nonce reservation.

The atomicity of that D1 batch is an external runtime assumption. The source
uses the existing transaction mechanism; this review did not execute it.
SQLite schema constraints continue to arbitrate competing case writes and
reserved nonces. No schema or signer change is included.

## Deliberately preserved behavior

The fence applies only before initial publication. It does not rewrite an
already published intent when a wallet changes and does not reject exact
finalized evidence merely because it paid a retained earlier destination.
`verifyDirectPayment` keeps its case-event witness and immutable receipts.
The separately implemented successor-completion fence and chain-retirement
helpers are unchanged. In particular, this commit does not recreate or alter
the independently reviewed EVM recovery proof-helper extraction.

`direct_preparation_completion.qnt` models one initial preparation, two payer
and reporter claims, consent, an RPC await, case CAS, storage failure and
immutable post-publication evidence. Its eight named scenarios are authored
but have not been executed. Cryptography, RPC honesty, current project role
resolution and database atomicity remain outside this bounded projection.
