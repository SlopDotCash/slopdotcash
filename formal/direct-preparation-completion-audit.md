# Initial direct-payment preparation completion

This source-only review starts at local commit `6f5aee920874`. It does not
replace the separate direct-recovery regression or model-bound correction.
The original patch was prepared without checks, as requested. Independent
validation was later performed on the isolated proof branch described below;
it is not a full validation of the combined observation branch.

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
immutable post-publication evidence. Its eight named scenarios subsequently
passed the isolated checks below. Cryptography, RPC honesty, current project
role resolution and database atomicity remain outside this bounded projection.

## Independent validation

The regression uses the existing private API workflow, migrated SQLite and a
real loopback Anvil node. It delays delivery of the actual nonce RPC response
while the reporter or payer wallet changes, or while the reporter submits a
new consent through the API. Wallet claims use the existing isolated fixture
setup; this is not live wallet authorization or mainnet evidence.

On baseline `6106bf0454eb04b9f4d8f8d2f0387d07e57fb05e`, the first reporter
race returned 200, advanced the case and event count from 3 to 4, and inserted
one stale intent. That expected failing baseline stopped at the first race.
It is not a full baseline pass.

With the fix on `254d428f313cbaaeb1e26ab76805db995aae28ce`, all five existing
asset workflows and 15 new preparation races passed. Reporter and payer
replacement returned `409 payment_preparation_changed` without advancing the
case, events or intents. Concurrent consent correctly retained its own case
transition, and the older preparation returned `409 stale_revision`. The
earlier direct-recovery regression also passed in this run. Test-only commit
`3bcb50a6317ee8a684510f2b0415018736e04569` retains these cases.

The eight named model scenarios and 500 seeded simulations of at most 60 steps
passed. Exhaustive finite TLC exploration found 330 distinct states, 1,398
generated states and depth 10, with unchanged recorded inputs. Deadlock
checking is disabled; no temporal property is claimed. These checks do not
prove implementation refinement or unbounded concurrency.

The receipt is retained at
`slopdotcash-direct-preparation-validation/evidence/direct-preparation/result.json`,
with SHA-256 `b74f382c3ba958eb93847a64ca06198e607d33d12be448623aae6749e48bf57b`.
It records source and tool hashes, both logs and cleanup of port 29577. This
isolated source includes the proof branch's extracted EVM recovery planner;
the local observation branch still has the earlier inline planner. The
preparation fence and handler change match by source comparison, but the
complete payment source files are not byte-identical. Preserve that proof
extraction when integrating and repeat final combined-head acceptance.
