# Value-request finish clock boundary

PRD section 5 requires durable value-review outcomes, duplicate refusal and
retryable failure records. A worker may retain a finish timestamp while its
database statement waits. That timestamp does not extend its lease: settlement
requires the current token, a running owner, and a lease later than both the
captured finish timestamp and SQLite's execution clock. Refusal must preserve
the owner and every sibling delivery.

`workers/slopbot/value-retry-backoff.test.ts` adds one regression covering two
outcomes: terminal `published` and blocked `source-incomplete`. It uses the real
migrated SQLite database. The adapter holds the bound finish statement at
`first()`, sets the lease expiry strictly after the captured timestamp but
before SQLite's current clock, verifies both clock comparisons, and executes
the original statement. The assertions require lease refusal, unchanged owner
state (including attempts and retained source-gap evidence), and no inserted
sibling settlement. There is no sleep, clock override, replacement SQL result,
provider call or external service.

Existing retry and private-Inbox fixtures derive their operational clocks from
SQLite plus a margin. Historical intake, project metadata and migration rows
remain historical where they are the subject of an assertion. The migration
test advances only its post-migration claim and finish times. This avoids making
a legitimate synthetic operation rely on an already-expired wall-clock lease.

`formal/models/bot_value_request.qnt` separates the caller's `capturedAt` from
the database execution clock `now`. Both successful finish and refused finish
are explicit, including refusal when there is no running owner. The original
three scenarios remain. Six additional scenarios cover execution-time expiry,
a captured clock at expiry, an old queued token after reclaim, and waiting,
completed and unclaimed states without a current lease.
Each added refusal scenario ends by requiring the actual finish action to
fail, rather than relying on a no-op representation of an old callback.
The finite bounds
remain two lease generations and clocks 0 through 8; at most two blocked
finishes can be counted. This single-delivery abstraction does not model the
SQL join over sibling deliveries; that is the regression's responsibility.

All changes in this audit are authored and manually reviewed only. No tests,
type checks, parsers, simulations, model checkers, browser flows or services
were run. These scenarios and assertions are pending verification and are not
claims of runtime, formal or release acceptance.
