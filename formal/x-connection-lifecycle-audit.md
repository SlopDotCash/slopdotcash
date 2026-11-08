# X connection completion and cleanup

This model-only refinement starts from `a8b0f8226`. It changes no application
or authorization rule. No parser, scenario, simulation, verifier or runtime
test was run here. The twenty named scenarios are unexecuted.

The earlier `api_x_connection` represented successful linking, permanent
reservation and sign-out with two scenarios. Reading `backend/points/x.ts`
identified more explicit state transitions: one-time callback claim,
expiration before claim, superseding a processing flow, provider and identity
failure, user cancellation, D1 failure, final cleanup and token revocation.
The refined model distinguishes those transitions rather than treating every
provider response as successful.

Two bounded flow IDs represent a new start replacing the actor's earlier
pending or processing flow. A late callback keeps its captured hash. Both its
link write and cleanup use that hash, so it cannot link through the new flow
or delete that new flow. Duplicate callbacks do not acquire an already claimed
flow. A foreign actor's reserved X identity cannot be reassigned. Disconnect
removes the public link and active flow while retaining the identity claim.
No new participation points are created.

The model explicitly preserves the current time semantics. The ten-minute
flow deadline is checked when claiming a pending callback; a claimed flow may
finish after that deadline. Session expiry is checked at the fresh `verifiedAt`
timestamp bound to the final batch. Deleting that session before execution
still refuses linking, but time passing after the timestamp was bound is not
another clock read. These are observed behaviors, not new guarantees about a
deadline or a requested policy change.

After a committed link, failed flow deletion can make the request fail without
undoing the link. Successful deletion attempts to revoke a temporary provider
token; revoke failure does not undo verified identity. If deletion itself
throws, the later revoke step is not reached. The handler stores no provider
token in D1. A successful response is an observation of a committed link, not
lasting authority that survives later disconnection.

Cryptographic state/cookie equality, provider status and bounded JSON grammar,
the source's per-request clock observations, atomic D1 batches, and external
provider revocation truth remain predicates. Start-request crypto/persistence
delays, multiple simultaneously claimed distinct callbacks, a new login after
session deletion, and other identity/profile APIs remain outside this focused
two-flow model. Their separate contracts must not be inferred from a pass here.

`backend/points/x.test.ts` is the existing real-handler/SQLite reference with
controlled provider responses. It covers connection, reconnect, retained
historical awards, permanent identity claim and malformed request bodies.
Additional runtime conformance is still needed for the newly modeled provider,
expiry, supersession and cleanup orders. A source mapping or these unexecuted
scenarios do not complete that acceptance work.
