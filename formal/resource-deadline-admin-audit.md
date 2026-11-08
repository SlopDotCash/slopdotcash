# Resource deadlines and private Admin reads

This source-only correction follows the review at `929f07d06`. No check,
parser, test, formatter, model run, prover, browser or application was run.
The two new models contain twenty-one named scenarios; four new browser
definitions are also unexecuted. Payment-page assembly is documented
separately in `payment-page-assembly-audit.md` and changes no payment rule.

## Source findings and correction

`usePublicResource` previously aborted its controller when its deadline
expired, but accepted a later loader success while its effect was still
active. Admin's loaders ignored that signal and used the independent
fifteen-second project API deadline. A request completing after the hook's
twelve-second deadline could therefore publish without a timeout state.

The hook now has one settlement latch for success, failure and timeout. The
deadline publishes its error/retention result before requesting abort.
Later fulfillment or rejection cannot replace that terminal result or
populate the retained cache. Effect cleanup still prevents a departed or
replaced request from publishing. A loader that ignores abort can remain
in flight until its own deadline; the correction does not claim transport
termination merely because its view has settled.

The optional `retainFailure` predicate narrows an opted-in caller's existing
transient retention policy. It does not authorize retaining an HTTP refusal
that the original classifier rejects, and it adds no identity policy to
public resources. Existing callers retain their default behavior. In
particular, an ordinary public refresh may retain a last good result with
a timeout warning.

Admin's project-list and fee loaders previously relied only on the outer
session gate. A read sent under A could return after the browser session
changed to B without a focus event and publish A's private result. Both
loaders now capture the outer gate's actor, check that the current session
still names that admin, send the existing expected-actor header, and check
the actor/admin role again before returning data. The sections are keyed by
actor so observed identity changes cannot reuse the previous private view.
The current editor draft/save implementation is unchanged.

Known access refusals remain terminal failures. For a transient HTTP or
network failure, the list retains its last good record only after a fresh,
matching admin observation completes. `RecheckedAdminReadFailure` records
that completed check while preserving the original `ProjectApiError`
status, code and message. An identity error has its own type, not an invented
HTTP status. An unavailable session observation is non-retainable.

The hook-level deadline also cannot produce the rechecked error type. If it
fires while the Admin loader is waiting for its final identity observation,
the old private data is dropped. A late matching session result cannot
change the already settled timeout back into a retained or successful view.
Every Admin continuation checks the signal before starting another request
or returning data, including a preflight that finishes after cancellation.
The private GET itself still uses the project API's independent transport
deadline; already sent requests are not described as canceled server work.

## Source-to-model relation

| Source | Modeled transition slice |
| --- | --- |
| `src/lib/use-public-resource.ts` | Same-loader retained cache, first/new-loader loading, success/failure/timeout arbitration, terminal late result, retry, effect replacement and departure. |
| `src/Admin.tsx`, list/fee loaders and parent gate | Captured actor, preflight, dispatch, final identity observation on successful/failed reads, typed retention eligibility, identity-keyed view replacement and deadline during identity work. |
| `src/lib/project-api.ts` | Existing request header and independent fetch/JSON error classification consumed by these loaders. |
| `backend/http.ts` | Existing expected-actor check uses the actor captured by this HTTP request, not a later browser cookie. |
| `backend/projects/handler.ts`, `backend/fee-conversions/handler.ts` | Existing admin admission for the two private read endpoints. Database contents, editor writes and fee execution remain in their separate models. |

`ui_resource_deadline` uses two requests and two loader identities. Its ten
scenarios cover timeout before late success, success before a later result,
public versus caller-restricted retention, checked/unchecked transient
failures, authoritative refusal, retry, loader replacement and departure.
The retention predicate's result is abstracted as a Boolean; the Admin model
explains when the real caller may supply that eligibility.

`ui_admin_resource_identity` uses two actors plus signed-out, two requests
and two component lifetimes. Its eleven scenarios separate preflight from the
cookie/header captured at dispatch, independent backend admission and final
browser observation. A browser cookie change after dispatch does not alter
the original request's actor. The model covers transient failure whose
matching identity check finishes, identity read failure, access refusal,
non-transient error, deadline before final identity returns and detached
completion. Its fee mode preserves that section's existing lack of result
retention. It does not assert that a silent cookie change immediately
removes already displayed information before an observation occurs.

These models complement `ui_resources` and `ui_focus_session`; their older
high-level ready/loading/generation states do not establish the new deadline
arbitration or private post-response checks. `ui_snapshot_cache` remains a
separate shared-cache model. No snapshot, cycle or payment loader changes
were required by this correction.

## Authored conformance and limits

Four definitions extend `tests/e2e/admin-refresh-retention.spec.ts`:

- Held successful project and fee replies after a changed, non-admin session
  must show the identity error and publish no private record.
- A held Admin HTTP reply after the twelve-second deadline must leave the
  timeout visible when the late reply arrives.
- A successful editor write followed by a failed list refresh and held final
  identity read must drop the retained project at the deadline; the accepted
  revision remains recorded after the identity read is released.

The existing three same-actor refresh/retry cases are unchanged. They remain
the intended coverage for retained data on a checked transient failure and
full teardown on a later 401/403. All new cases use explicit response and
session doubles in the real Admin route. They do not prove a live identity
provider, production backend or native browser result, and none were run.
Exact timing uses the existing browser clock facility only in the authored
deadline cases.

The generic hook still assumes its loader returns a Promise and that a
caller-supplied retention predicate is synchronous and does not throw. HTTP
body parsing, unbounded caller state spaces, actual browser task scheduling,
and transport/provider truth are separate boundaries. A model-source link
does not prove whole-application refinement or absence of all state errors.
