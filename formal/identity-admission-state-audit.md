# Identity rate-limit admission states

This source-only refinement covers the existing identity rate limiter and its
caller under the PRD section 12 state requirements. Application code, expiry
policy, authentication policy and executable tests are unchanged. No model,
test, parser, formatter, application, service or network probe was run. The
scenarios are authored and unexecuted; metadata generation is a separate step.

## Corrected abstraction

The prior `api_identity_admission` started with a zero-count row and an existing
expiry, although the migration permits only positive stored counts. It used
one clock for request capture, SQL execution and reply, and its `count < 4`
action guard prevented all later requests, including rollover after expiry,
once the bound was reached. Its unavailable-storage action disabled requests
without representing the caller's 503 response or a count committed before a
failed reply.

The replacement bounds the number of attempts, not the counter behavior. It
models absent rows, atomic insert/update, positive persisted counts, denied
requests that still increment, equality at expiry, independent cleanup,
captured timestamps, returned snapshots, post-commit failure and fresh retries.
The original `fixedWindowTest` and `failedClosedTest` names remain. The separate
`identity_rate_gate` model describes route selection, approximate edge admission,
the clock/hash/exact sequence and dispatch to the identity handler. Neither
model equates limiter admission with a successful OAuth or local flow.

## Source map

| Source | Modeled boundary |
| --- | --- |
| [`rate-limit.ts`](../workers/identity/rate-limit.ts), `consumeExactRateLimit` digest input | One fixed secret, scope and principal identify a counter; hashing is an awaited operation that may fail before D1 |
| `INSERT ... ON CONFLICT ... RETURNING` | First touch inserts count 1; one atomic update increments or resets against the captured request timestamp and returns that statement's count/expiry |
| Result validation and return | Missing/invalid metadata refuses; allowed means count is at most the configured limit; retry duration uses returned expiry minus captured time |
| `deleteExpiredRateLimits` | One DELETE tests the current row's expiry against the cleanup invocation's captured timestamp |
| [`index.ts`](../workers/identity/index.ts), `applyIdentityRateLimit` | Configured HTTPS-origin POST route selection; start and poll scopes; edge before exact; 429/503/null outcomes |
| `rateLimitKey` and rate-limit response helpers | Bounded connecting-IP value or shared unattributed fallback; fixed edge retry header versus exact retry duration |
| Worker `fetch` | A null limiter result dispatches to `handleIdentityRequest`; admission does not bypass the handler's own checks |
| `deleteExpiredIdentityState` and scheduled maintenance | The scheduled timestamp passes through identity cleanup to counter cleanup; it is not resampled after intervening awaits |
| [`0004_identity_rate_limits.sql`](../migrations/0004_identity_rate_limits.sql) | Opaque 64-character key, positive integer count and expiry strictly later than stored start |

The origin/method predicate assumes valid deployment configuration. Errors from
the edge binding, clock callback, digest or exact helper inside the caller's
`try` become 503. Configuration/origin parsing before that `try` is outside the
gate model's error classes. Unmatched routes, origins or methods bypass this
limiter only; they remain subject to the identity handler. The four exact route
names match the handler's OAuth/local start/poll routes.

## Counter, time and retry semantics

The caller samples seconds after the edge binding passes and before the
awaited SHA-256 operation and D1 statement. That timestamp remains the SQL
window test and response-validation reference even if execution is delayed.
An unexpired stored row preserves its original start and expiry and increments
for every exact attempt, including a request later returned as 429. Equality
at expiry resets the count to 1 and starts the next window at the request's
captured timestamp. Expired metadata need not be deleted for rollover to work.

The DELETE evaluates current row contents. If cleanup captures time 3 and a
request first renews the row to expiry 6, cleanup preserves it. The converse
order can delete the old row before a delayed request inserts again. In the
scaled model a request captured at time 0 can run after cleanup at time 3,
recreate a row expiring at 3, and still receive an allowed result because its
validation compares with time 0. A request captured at time 0 that executes
after another request renews expiry to 6 can return Retry-After 6. The model
retains those source-supported outcomes; it adds no execution-time expiry
fence and makes no claim that Retry-After is bounded by one window at reply
time. The README's fixed-window description does not select a stronger
requested-at versus executed-at policy.

Returned rows are snapshots of the atomic statement. Another increment,
renewal or cleanup before the JavaScript reply does not rewrite that snapshot.
Conversely, a missing/invalid return or uncertain response after an upsert does
not prove that its increment rolled back. Retrying is a fresh request, not an
idempotent replay, and may consume another count. A 503 cannot forward into the
identity handler; it can still follow a committed count.

The counter invariant limits allowed results per modeled row generation.
Generation changes on reset or recreation and is proof bookkeeping, not a
database field. It deliberately does not claim a universal limit over live
wall-clock windows when old captured requests or cleanup are reordered.

## Keys and gate assumptions

OAuth start and local start share the exact `oauth-start` scope; OAuth poll and
local poll share `oauth-poll`. Start and poll use different edge bindings and
different exact scope inputs. The gate model covers two named principal
classes and the shared unattributed class. Missing or overlong connecting-IP
headers map to that fallback in source. Header trust, all address spellings,
deployment wiring and actual edge counter accuracy are external assumptions.

Numeric model keys stand for the secret/scope/principal digest input. A fixed
secret and collision-free SHA-256 abstraction keep distinct modeled inputs
separate; this is not a cryptographic proof or a secret-rotation model. No raw
address or secret is added to model state. The counter model uses two already
classified digest keys, while the gate covers the route-to-scope mapping.
Their correspondence is documented rather than mechanically composed.

Cloudflare describes its [edge rate-limit counters](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy)
as approximate and local to a Cloudflare location. The gate therefore treats
that result as an input, rather than proving a global bound from it. SQLite's
[UPSERT rules](https://sqlite.org/lang_upsert.html) distinguish the current row
from the proposed `excluded` values, as the counter's reset branches do. Its
[RETURNING documentation](https://sqlite.org/lang_returning.html) describes the
modified-row result and separates those values from transaction completion.
The counter model assumes the D1 method completes the atomic statement; it is
not a proof about a raw SQLite step, the D1 driver or network delivery.

## Bounds and evidence limits

| Model | Finite bound | Named scenarios |
| --- | --- | ---: |
| [`api_identity_admission`](models/api_identity_admission.qnt) | Four one-shot attempts, two digest keys, limit 2, window 3, clock 0–6 and one cleanup invocation | 17 |
| [`identity_rate_gate`](models/identity_rate_gate.qnt) | Two invocations, four limited endpoint classes plus bypass, two named principals plus fallback | 15 |

The production caller uses limits 12 and 120 with a 60-second window. The finite
counter model scales those values, retains the exact update branches and does
not cap stored counts to the limit. All four attempts can be pending; SQL
commit actions serialize their writes. Arbitrary integer overflow, clock
regression, historical rows from another policy, all malformed D1 values,
unbounded attempts and all SQL/crypto implementation details remain outside
the finite model. Invalid-result classification represents the helper's checks,
not exhaustive parser or driver validation. There is no liveness theorem.

[`identity-maintenance.test.ts`](../scripts/identity-maintenance.test.ts)
contains an existing migrated-SQLite workflow definition for expired/live rate
rows during scheduled cleanup and failed intake renewal. It is relevant only
to cleanup wiring. No direct existing test/workflow invoking
`consumeExactRateLimit` or `applyIdentityRateLimit` was found in the source
review. Direct exact-boundary, concurrent upsert, edge/gate, delayed-clock and
real D1 execution evidence is therefore missing. The existing README's
production qualification requirement is not replaced by these models or by
the maintenance definition, and no production rate-limit qualification is
claimed.
