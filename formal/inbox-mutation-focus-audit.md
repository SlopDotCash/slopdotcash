# Inbox focus during a notification mutation

This source-only follow-up starts at `1fb9a74e0803`. No test, typechecker,
browser, simulation or prover was run. The code path is confirmed by source
inspection; the correction and 13 authored model scenarios remain unverified.

## Cause and correction

`InboxPage.act()` captures a generation, performs the actor-bound mark-read or
security-acknowledgement POST, checks the current session again, then reloads
the inbox. Its generation checks protect a later page or account from an old
action result.

The focus listener previously called `load()` during that action. A focus GET
could read the old unread/unacknowledged state before the POST committed and
increment the generation. The successful action then failed `ownsView()` and
skipped its final read. The focus GET could become the displayed state even
though the mutation had succeeded. This is a lost reconciliation path, not a
backend authorization bypass.

The correction uses a stable ref for the action lifetime. It is set
synchronously before the action starts, blocks another action from the same
render, and suppresses only focus-triggered reads. The existing action's final
read observes the completed write. The promise's `finally` clears the ref for
success, refusal, failure or superseded completion. Later focus events use the
ordinary loader again. This follows the existing InboxEmail approach of not
starting a background focus read while its mutation is active; the explicit
ref also covers the interval before React commits the busy state.

## Identity, errors and departure

The existing session checks before and after the POST are unchanged. The POST
still sends the actor captured from the displayed inbox in its expected-actor
header. The page enters loading state before the action, so private content is
hidden while a focus event is suppressed. A changed or missing session causes
the existing error/signed-out result rather than restoring the old inbox.

The ref does not suppress `reportsIdentityChanged`: that explicit callback can
still reset the cursor, start a new generation and supersede the action. Cursor
controls remain disabled during the action. The unmount cleanup still advances
the generation; an old completion cannot change a later view. A server write
already accepted before departure or an account change is not undone by UI
cleanup.

On a same-actor request or readback failure, the existing code can restore the
previous inbox with an explicit action error. A transport error can occur after
the server committed, so that previous unread label is not proof of backend
state; the next retry/focus read reconciles it. The correction does not invent
success or treat a failed request as proof that nothing changed. Requests keep
the existing 15-second fetch deadlines; this change does not add polling or
wait indefinitely for a focus event.

## Model boundary and conformance references

`ui_inbox_mutation_focus` covers a representative notification mutation for two
actors and cursors, four live generations and a departure generation. It
includes focus during POST and final read, actor/sign-out changes, an explicit
identity reload, failed POST/readback/session checks, cursor refusal during an
action and ref release. A set records which actor's backend mutation completed;
the displayed read label and completion notice remain separate observations.

Actor checks, expected-actor enforcement, server responses and transport
outcomes are predicates supplied by the existing helpers/API. The model does
not prove browser event scheduling, all notification grammar or every shared
Inbox child. It assumes eventual delivery only in its named scenarios, not an
unconditional successful network request. The original `ui_inbox` and identity
models remain separate.

Existing inbox browser flows are in `tests/e2e/site.spec.ts` and
`tests/e2e/registry.spec.ts`. They are conformance references only: their earlier
results do not validate this new source revision. The missing focused browser
evidence is a held POST, a focus event before commit, completion, and a final
read showing the mutation, with separate account-change and failure cases.

## Independent model validation

The initial model at `29eb8bedf0bc02bd35e6ff44d16e8ce681e48af5` could not
parse: `beginRead(cursor:int)` had no required return type. The normal checker
and TLC both stopped at that syntax error before semantic validation.

The correction names the existing state record `State` and declares
`beginRead(cursor:int):State`. All fields, transitions, guards, invariants and
finite domains are unchanged. The corrected model passes type checking, all
13 named scenarios and 500 seeded simulation traces of at most 60 steps with
seed `20261107`. Full finite TLC completes with 260,413 generated states,
34,953 distinct states, maximum depth 23 and an empty queue.

Quint 0.33.1, Node 24.15.0, local Apalache 0.62.4 and OpenJDK 21.0.10 used the
existing 90-second normal-stage and 180-second verification deadlines. Model
and mapped source hashes stayed unchanged during the checks. The domain
remains two actors, two cursors, four live epochs and one departure epoch;
process scheduling, API authority and exact receipt validation remain outside
this finite model. No browser run or runtime edit is claimed. The original
parse failure and corrected receipts remain outside committed source.
