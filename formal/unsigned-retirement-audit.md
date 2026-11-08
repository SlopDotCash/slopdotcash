# Unsigned payment retirement: concurrent recovery

This focused review starts at `b2cf0141c` and serves PRD section 6: uncertain
payments keep their attempt identity and recover without starting a competing
transfer. No signer, network configuration, deployment or live payment changed.

Two recovery runs can read one unsigned attempt before either applies the
executor's retirement response. The executor may correctly return the same
successful retirement twice. If one recovery run retires the old attempt and
dispatch submits its successor, the other response used to reopen that
successor's outbox. The real SQLite/local-HTTP regression reproduced
`submitted` becoming `ready`. An uncertain successor held after another wallet
change was vulnerable to the same transition. This is an outbox ownership
error; the test does not establish duplicate on-chain payment.

The outbox update now requires `changes()=1` from the immediately preceding
attempt update in the same atomic batch. A repeated response cannot reopen
the outbox when it no longer retires the attempt. Existing paid-state and live
lease guards remain. No attempt, receipt or failure history is removed.

`payment_unsigned_retirement.qnt` models two recovery reads/responses, the
single old unsigned attempt and one successor. It covers submitted, uncertain
held, prepared/live-lease and paid outcomes. Five named scenarios and 500 seeded
60-step traces pass; exhaustive TLC visits 67 distinct states. The runtime
integration consumes the generated submitted/held scenario results, pauses one
local HTTP cancellation response, completes another recovery and dispatch, then
releases the old response. Both attempt records remain unchanged. The held
case also proves that retiring the actual unsigned successor may reopen it.

The complete existing recovery integration passes, as do eight existing
served-network/refused-broadcast tests with 79 assertions. The existing
`dispatch-clock.workflow.mjs` also runs the duplicate retirement through actual
Miniflare/workerd D1 and the production recovery function. It first puts the
old-wallet attempt on hold, verifies that the winning retirement permits a
successor submission, then verifies that the duplicate response preserves that
submission and both attempt rows. This checks both the one-row and zero-row
`changes()` outcomes across separate prepared statements in an actual D1 batch.
Typecheck and focused Biome checks pass with the pinned Bun 1.3.14 / Node 24.15.0
tools. The baseline failure and current receipts are under ignored
`evidence/formal/retirement-*`.

[D1 documents ordered, nonconcurrent batched statements and rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
[SQLite defines `changes()` from the preceding data-changing statement, excluding trigger internals](https://www.sqlite.org/lang_corefunc.html#changes).
The native workflow supplies local runtime evidence for this application path;
it is not a hosted-production D1 test.

The model assumes the executor's unsigned-retirement response and database
batch atomicity. Signature validation, successful signed-attempt refusal,
arbitrary generations and native chain finality remain separate evidence.
