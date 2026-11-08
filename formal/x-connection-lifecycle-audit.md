# X connection completion and cleanup

This follow-up starts from `a8b0f8226`. It began as a model refinement and
then corrected skipped token revocation and shared-cookie response races. No
authorization rule changed. No parser, scenario, simulation, verifier or
runtime test was run here. The twenty-nine named scenarios are unexecuted.

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
The permanent claim retains its verification marker after callback-local
captures are cleared. No new participation points are created.

The model explicitly preserves the current time semantics. The ten-minute
flow deadline is checked when claiming a pending callback; a claimed flow may
finish after that deadline. Session expiry is checked at the fresh `verifiedAt`
timestamp bound to the final batch. Deleting that session before execution
still refuses linking, but time passing after the timestamp was bound is not
another clock read. These are observed behaviors, not new guarantees about a
deadline or a requested policy change.

After a committed link, failed flow deletion can make the request fail without
undoing the link. Source review found that this failure also skipped the
temporary provider-token revocation attempt required by
`protocol/points-v1.md`, "X connections and payout recognition". The deletion
now has a nested `finally`, so its rejection still attempts revocation. A
provider-revocation failure is caught and the original storage error continues
to propagate. The handler stores no provider token in D1. A successful response
is an observation of a committed link, not lasting authority that survives
later disconnection.

Cryptographic state/cookie equality, provider status and bounded JSON grammar,
the source's per-request clock observations, atomic D1 batches, and external
provider revocation truth remain predicates. The named-cookie model separates start persistence and cookie-response arrival.
Crypto internals, multiple simultaneously claimed distinct callbacks, a new login after
session deletion, and other identity/profile APIs remain outside this focused
two-flow model. Their separate contracts must not be inferred from a pass here.

`backend/points/x.test.ts` is the existing real-handler/SQLite reference with
controlled provider responses. It covers connection, reconnect, retained
historical awards, permanent identity claim and malformed request bodies.
Additional runtime conformance is still needed for the newly modeled provider,
expiry, supersession and cleanup orders. A source mapping or these unexecuted
scenarios do not complete that acceptance work.

Nineteen additional unexecuted tests now use that same handler and real SQLite
migrations. They cover user cancellation, token/identity refusal, sign-out and
disconnect during provider work, both observed expiry boundaries, a superseding
flow, foreign identity ownership, replay while the first callback is pending,
batch rollback, and cleanup or provider-revocation failure. The cleanup-failure
cases require a revocation request and the preserved storage-error result,
including when the provider revocation also fails. Provider responses and time
are controlled; SQLite triggers inject the two database failures.
These tests do not exercise live X authorization or imply that all combinations
have been verified.


## Cookie ownership across response order

The earlier handler used one cookie name for every X flow and cleared it in
every callback response. A new start could replace that cookie while an older
callback awaited the provider; the old callback then cleared the new cookie.
The initial supersession test passed the new cookie explicitly and therefore
did not represent this browser-cookie overwrite.

Source review also found a second order: start A can commit its flow, start B
can replace that flow and return its cookie, then A can return its older cookie.
Removing callback deletion alone would still let A overwrite B. Moving one
await would not order network responses.

New starts therefore use a cookie name specific to their random OAuth state.
A callback clears only that name. The existing ten-minute expiry and
HttpOnly, Secure, SameSite=Lax and host/path restrictions are retained. An
already-started legacy shared-cookie flow may still complete, but a callback
never clears that shared cookie. The database still requires the exact state,
capability digest, initiating session and one-time pending claim. A retained
or replayed cookie cannot restore a consumed or replaced database flow.

The model separates the D1 start transition from cookie-response arrival and
tracks two independently named cookies. A response for A can arrive after B
without replacing B, and a callback for A can only delete A. A thrown database
cleanup error discards the prepared redirect; the outer error response has no
cookie deletion header, which the model preserves. Legacy shared-cookie
compatibility remains a separate predicate rather than a full migration model.

The handler/SQLite cases now assert the response cookie name, refuse a replay
with a previously used capability, preserve a valid flow after a malformed
callback, delay the first start after its real database commit so the second
response arrives first, and complete a legacy shared-cookie request. Provider
responses and cookie headers are controlled. None of these new cases have
been run here; actual browser cookie-jar behavior and live X remain additional
acceptance requirements.
