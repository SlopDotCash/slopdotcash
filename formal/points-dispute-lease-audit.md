# Points dispute worker ownership

This separate follow-up starts from `a8b0f8226`. It adds a source-reviewed
model without changing application behavior. No parser, test, simulation or
verifier was run here. All fifteen named scenarios are unexecuted.

`api_points_disputes` represents intake, escalation and independent resolution.
It does not represent the worker lease. The new `points_dispute_lease` models
one already-retained dispute and two distinct worker claims. It complements
that intake model and the provider-cost and generic review-lease models; none
of their source links proves implementation refinement.

| Source transition | Model transition and retained fact |
| --- | --- |
| Atomic claim of an unresolved row without a completed draft/escalation pair | `claim`; a live owner refuses takeover, an expired owner permits it |
| Re-read after claim, project registry and installation/access lookup | `preflight`; a retained draft skips another provider call; unavailable context escalates |
| Provider admission at current scope and claim | `send`; lost authority does not start another call |
| Record returned call costs before checking the lease again | `reply`; costs can remain after a worker loses its lease; cost failure does not claim successful escalation |
| First draft under exact claim token and expiry predicate | `record`; a stale worker cannot write, the first draft remains immutable, confidence is at most 0.89 |
| Escalation and moderator notification in one batch | `escalate`; stale or resolved work cannot escalate or send the modeled notification |
| Final token-matched release | `cleanup`; an old worker cannot release a replacement claim; resolved rows retain an inert old claim |
| Independent moderator resolution and recipient notification | `decide`; the first decision remains, no original Points or payment record changes |

The model uses worker IDs as two never-reused claim tokens. Expiry represents
comparison with the timestamp bound into the SQL statement, not a proof that
the wall clock cannot advance between that observation and database execution.
One fixed independent moderator represents valid notification recipients;
recipient-list changes, malformed IDs and notification read/delivery state
remain separate. Confidence 89 represents the permitted capped range in scaled
integer units, not an assertion that every real draft has confidence 0.89.

The model separates provider completion from draft persistence and final
cleanup. This exposes the important order in which an old call may finish and
have its cost recorded after a replacement worker acquired the row. It cannot
then publish a draft, escalate or clear the replacement token. A successful
model run would only establish that property under the stated finite
abstraction; no such run is claimed here.

`backend/points/disputes.test.ts` already contains real-handler/SQLite cases
for live and expired leases, a replaced lease during source lookup, stale and
expired SQL-bound writes, persisted-draft recovery, immutable source records,
concurrent resolution and current repository identity. These existing tests
were read, not run in this lane. The new model also names provider/cost and
late-completion orders; no existing test is claimed to cover each combination.

Remaining conformance includes executing the new model, pairing its trace
orders with the actual worker and database, and retaining any failing output.
Multiple provider routes, arbitrary call counts, cost-writer partial failure,
SQL/read errors beyond the explicit cost-write outcome, scheduler fairness,
wall-clock delay and the complete intake/notification compositions are outside
this focused model. This does not close the application-wide state review.

## Intake and immutable source

`points_dispute_intake` adds twelve unexecuted scenarios for the transaction
that precedes worker processing. Two requests compete for one dispute on a
retained revision. A successor may arrive before the source read or between
that read and the SQL insertion. The SQL must refuse a new dispute for that
old revision. An identical retry can still recover an already-created dispute
after a successor arrives; a changed statement cannot replace it. Creation and
the owner's opened notification are atomic and idempotent. Admission classes
represent malformed bodies, corrupt source digests, foreign recipients and the
actual recipient. No award or payment is changed.

This is a separate transaction model so the worker model does not gain an
unbounded history of intake requests. Their shared boundary is one immutable
retained dispute. The source tests cover identical retry after a correction,
a correction between source read and insertion, first-statement retention,
authority and notification deduplication. Database rollback and admission
classes remain explicit assumptions until their exact scenarios are executed.
Neither model yet establishes all detail-read, pagination, retry-response or
concurrent moderator-decision interleavings. The older `api_points_disputes`
model's single happy-path scenario does not close those remaining flows.
