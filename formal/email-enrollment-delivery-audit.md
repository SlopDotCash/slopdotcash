# Enrollment mail transport and token consumption

`email_enrollment_delivery.qnt` refines the transport and request-key behavior
which the existing `api_email_consent` model abstracts as one pending token.
It does not replace that model's activity/security preference contract. This
model has one actor, two request-key and payload representatives, two preference
revision changes, two existing
address-history count classes, and clock points at 0, 59, 60, 120, 1800, 1860
and 3600 seconds. A payload fingerprint includes the address and both requested
preference values. Token hashing, random entropy, email parsing, public routing
and actual provider truth are outside these finite bounds.
The active destination is a payload representative, not the random
`destination_version` capability. That version binding remains with
`api_email_consent` and its real enrollment/unsubscribe tests.

The modeled source transitions are:

- `backend/notifications/email.ts:requestEmailVerification`: exact-key replay
  returns the saved view before the availability check. A different payload
  with that key conflicts. A new request needs a configured sender, respects
  the one-minute actor cooldown and three-per-hour actor/address budget, and
  atomically cancels earlier unconsumed requests only when insertion succeeds.
- `workers/notify/enrollment.ts:sendEmailVerification`: the persisted request
  binds actor, token, address and requested preferences. A queued row is claimed
  once as sending. Existing sending/sent/unknown rows are not sent again. A
  provider exception yields unknown, not confirmed delivery or automatic retry.
- The outer service-error update affects queued rows only. It cannot overwrite
  a sending row whose worker already claimed it. A new key after cooldown can
  replace the unknown request; replaying the old key does not send again.
- Verification alone consumes the token and updates the active destination.
  Delivery completion does not grant consent. A newer request leaves the active
  destination unchanged until verification. A late completion for an older,
  cancelled request changes only that request's transport status. Preference
  revision changes fence an already-read verification.

Expiry is checked using the captured admission time passed into the SQL
statement. The model deliberately allows a valid-at-start request to commit
after the clock reaches expiry, while a new read at expiry is refused. This is
an observed boundary, not a claim of an unsafe implementation or a new
consumption-time policy. The transport has the same captured-time claim check;
the model does not promise to cancel an already-claimed provider call.

The read handles retain a witness that expiry was valid at admission, rather
than the exact copied timestamp. Request creation and expiry do not change
after insertion, so later guards only need that witness plus current
cancel/consume/revision checks. The real test checks exact recorded times;
the finite witness model does not prove their numeric serialization.
The first stored request is named key 1, payload 1, at time 0. This normalizes
arbitrary key/payload labels and the otherwise unobservable empty-history clock
origin. The second key and same/different payload remain independent. The two
external recent requests represent applicable shared-address history; the
zero-history branch also represents a history that expired before enrollment.

Twelve named model scenarios cover replay during sender pause, conflicting keys,
unknown delivery, outer-service/worker ordering, replacement, late completion,
expiry, admission across expiry, preference revision and address-history rate
limits, malformed requests and foreign-account refusal. The existing real API/SQLite/outbox enrollment suite covers concurrent
request replay, sender pause, transport failure, bounded resend, cancelled and
expired links, address changes, token binding and public GET non-consumption.
One appended scenario uses its existing queued-batch hook to cross token expiry
after admission and verifies the captured `consumed_at` value. All 19 tests
pass with 131 assertions; application typecheck and changed-test formatting
also pass.

An initial equivalent model retained every copied read timestamp. It reached
the 180-second verification limit with 2,148,752 distinct states and 1,166,346
still queued; this was not a successful full verification or a counterexample.
That attempt and its model are preserved in ignored evidence. Recorded child
PIDs and the owned process group were absent after the runner reported a
cleanup-query error. The witness abstraction removes those redundant copies
while retaining the same clock, request and transport transition families.
A second, unnormalized witness run reached the same limit with 1,826,488
distinct states and 487,973 still queued. It is preserved separately. The
final model additionally normalizes first-request labels and time origin as
described above; neither incomplete run is counted as a proof pass.
The final stable model passes the repository's selected formal check and full
finite TLC run: 263,076 distinct states, 3,990,645 generated states, an empty
remaining queue, and search depth 19. The verifier stage completed in 35.4
seconds including translation; model and mapped-source hashes stayed fixed.
This is bounded model verification, not proof of implementation refinement.

Only this model, its audit and that targeted conformance addition change. No
production code, sender configuration, real mailbox, signing key or deployment
is changed. Passing bounded checks establishes neither provider delivery nor
unbounded implementation refinement.
