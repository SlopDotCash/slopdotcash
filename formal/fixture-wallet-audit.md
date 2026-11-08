# Disposable wallet fixture lifecycle

The EVM browser fixture used to seed wallet rows from its `beforeAll` hook,
after Pages had opened the local D1 database. Wallet rotations also launched
another Wrangler process against that open database. The fixture now seeds
its initial wallets before Pages starts. Later changes use the real wallet
registration, challenge and authorization API with a disposable Anvil wallet
signature. The initial wallet seed remains an explicit test fixture; it is
not evidence that the initial wallets passed the browser authorization flow.

The local runtime failure was reproduced without application queries. One
warmed Miniflare runtime read a simple table while a second runtime wrote the
same persisted D1 database. Of 200 reads and 30 writes, 10 requests failed,
including `SQLITE_BUSY_SNAPSHOT` and the same `getCurrentBookmark` failure
reported by the notification request. Three sequential external writes and
their follow-up reads succeeded. This identifies a reproducible local
multi-runtime failure mechanism; it does not establish the cause of every
notification failure or a defect in production D1.

`fixture_wallet_runtime.qnt` maps `scripts/run-e2e.mjs`. It bounds one
disposable directory, database and chain, one initial wallet seed and two
later wallet API requests. It models setup failure, missing request responses,
runtime shutdown and cleanup success or failure. A pending request may have
changed the database before shutdown; an absent response is not recorded as a
refusal. Failed cleanup stays a failed result and may retain a resource.

The model has 9 named scenarios. Type checking and scenarios pass. The seeded
simulation runs 500 traces of at most 60 steps with seed `20261107`. Exhaustive
TLC verification explores 166 distinct states (369 generated). The checker
records unchanged model and mapped source hashes. No fairness or eventual
provider-success assumption is asserted. This is a bounded abstraction, not
a proof of implementation refinement.

`api_payment_wallet_protocol.qnt` owns the detailed claim, challenge,
signature, consumption and authorization transition contract. This fixture
model does not duplicate that protocol or claim that all repository fixtures
avoid external database writes.

Implementation conformance uses the existing two-viewport
`tests/e2e/bounty-full-flow.spec.ts` workflow. It retains wrong and stale
payment refusal, partial-payment recovery, changed-wallet consent, finalized
receipt and fee-exclusion assertions. `tests/authorize-fixture-wallet.ts`
requires the returned wallet and chain to match before signing the challenge.
The source does not sign or broadcast production transactions. Local runtime
probes, browser results, traces and videos are retained as ignored evidence,
separately from the finite model results.
