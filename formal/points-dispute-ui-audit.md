# Private Points dispute UI

This scoped review starts from `a8b0f8226` and covers `PointsDisputes.tsx`,
its Inbox mount/key, and query navigation through `Link` and `App`. Only the
new model and this audit are authored by this lane. No parser, test, browser,
simulation, verifier or application command was run. The model's twenty-four
named scenarios are unexecuted.

## Source-confirmed privacy finding

The initial component detected an account mismatch after a successful HTTP
response, but both its read and mutation error handlers only set an error.
A new read cleared `detail`, not the cached list or selected award/reason.
The parent learned about a child mutation only on success. Thus A could have
an award form open, start a request, and have its post-response session read
observe B or sign-out while Inbox had not performed its own focus/read cycle.
The component displayed an account-changed error while keeping A's private
form or list. This is a source interleaving, not a browser reproduction.

Root owns the runtime correction. Its request helper captures a fetch/JSON
failure and then rechecks the current session while the request still owns
its component lifetime (and read controller). A different or signed-out actor
clears the child and invokes `onIdentityChange`, wired to Inbox's existing
`reportsIdentityChanged`: the parent clears private query parameters and
refreshes the recipient. A session lookup failure clears the child and uses
the parent reload callback without inventing an actor. HTTP 401/403/404/410 or
a 409 `account_changed` also clears the child and reloads the parent, even when
the later session lookup matches. In particular, a revoked moderator can
receive 404 from the private detail/decision route while remaining signed in.
The model includes those statuses in its authority-refusal outcome class.
Other transport failures may retain cached
content only after the session matches. Departed/aborted requests notify no
parent. The model's `identity` error class means this invalidation result,
not a claim that all three paths show the same literal error text.

## Model scope and mapping

`ui_points_disputes` is separate from the generic Inbox model. It represents:

| Source boundary | Model representation |
| --- | --- |
| Initial query parsing and effect read | `selected`, `url`, `startRead`; no detail is fabricated while the request is pending |
| Empty/list pages and older cursor | `page`, `nextPage`, `olderRecords`; the previous list can remain while a new list read loads or fails |
| Award selection, reason input, Back | `chooseAward`, `editReason`, `back`; empty reasons do not enable normal submission |
| Detail, machine draft, human decision and terminal result | `detail`, `draft`, `mayDecide`, `editDecision`; response classes stand for the valid backend contract |
| Canceled/replaced GET callbacks | `activeRead` and captured request epoch; an obsolete callback does not publish data or clear current busy state |
| Mutation callback lifetime | Captured actor/epoch in `mutations`; response delivery does not imply a still-mounted recipient |
| Known identity loss or authority refusal | Clear private fields, hide for parent refresh and notify only the still-owned parent |
| Same-account request failure | Preserve form/list with an explicit error and Retry; do not claim that an ambiguous POST had no effect |
| Mutation success | Select the returned dispute ID, clear input drafts, replace the query and request child/parent refresh |
| Query navigation and actor change | `remount`; the key includes the recipient and the complete search string |
| Leaving Inbox | `depart`; server acceptance may still occur, but old results cannot rewrite the new view |

Inbox sets its child wrapper to hidden while its own load runs. This is not
an unmount when the recipient and search key stay the same. The model therefore
keeps a same-actor hidden child and its draft distinct from query/actor remount.
An Inbox outage after a matching session recheck can also reveal that retained
child alongside the parent's error; it is distinct from child request failure.
`Link` dispatches popstate after a query navigation; the mutation's own
`replaceState` is followed by its explicit parent callback. The model does
not assume that `replaceState` itself dispatches a browser event.
Mutation success clears only the award choice and reason/decision drafts.
The cached page remains; a detail is cleared by the next read effect rather
than by the mutation callback. `keyTarget` distinguishes the mounted query
from a URL changed by that callback, so the parent can keep a same-query retry
instance or remount after creation. Target 1/2 denotes a retained award and its
associated dispute; real revision IDs and dispute IDs are different strings.

Read requests have an abort controller tied to the selected ID, cursor and
retry effect. Mutation requests have component lifetime ownership, not that
controller. A source-level delivered mutation callback has no independent
synchronous busy/ref guard or mutation-generation counter. The model admits
two such callbacks and preserves the shared `busy` flag's actual behavior:
one completion can clear it while another callback is outstanding. Normal
rendered controls use `busy` to disable actions. The model does not establish
which overlapping callback deliveries a particular React/browser scheduler
can produce, and it does not invent an at-most-one-request lock.

## Bounds and omitted predicates

The model has two component lifetimes, two actor representatives plus sign-out,
two read callbacks, two mutation callbacks, two dispute/award identifiers,
two list pages, and one empty/nonempty input class. Detail responses represent
triage, moderator review and resolved state; backend authorization and strict
JSON/body/schema validity remain external predicates. A list response class
represents up to two selectable records, not the production page-size limit.

Each request ID is used once in the model; there is no claim of an application
retry cap. Real fetches retain the existing 15-second deadline and bounded
512 KiB response reader. HTTP failure, deadline/transport failure, known
identity mismatch and unavailable session are different modeled outcomes.
Actual timer scheduling, lazy-import failure, arbitrary malformed response
shapes, origin policy, raw input formatting, DOM event delivery, backend
decision atomicity and provider execution remain separate acceptance needs.
Recommendation direction, upheld/denied label text, amounts, timestamps and
source-link formatting are data presentation rather than extra control states
in this model. It models the presence of a draft and resolved decision, not
the pure label formatter or both immutable backend decision values.
No invariant treats a model name, selected URL or visible control as server
authority, and server acceptance is distinct from presenting its response.

The pre-fix retained-private-form order is described above. The identity-failure
scenarios require the corrected private teardown, including when a POST was
already accepted. A later successful fresh read may populate the same actor's
view again; an old error string is not treated as permanent access state.

## Existing workflow reference

`tests/e2e/points-disputes.spec.ts` has the real Inbox/Points dispute workflow:
open a retained award, hold intake and decision HTTP responses, assert inputs
are disabled during those requests, observe the private receipt, retry the
unavailable local model path, and obtain an independent moderator decision
and a separate unread notice. It also checks access boundaries and link/query
navigation. Root extended that workflow to change the real local cookie from
A to B without focus/navigation while A's committed POST response is held,
require removal of the private form and query, then restore A and continue
the receipt/moderation path. Neither that new regression nor the existing
workflow was run in this lane. The new identity-loss order, obsolete
read/mutation deliveries and overlapping callback cases need exact-source
runtime evidence separately; none is claimed here.


The existing browser workflow now also switches its actual session cookie to
an unrelated test account while the first account's accepted intake response
is held. It requires the private form and query to disappear, then restores
the original account and continues the persisted receipt and moderation flow.
The scenario has not been run; new walkthrough, accessibility and console/
network evidence are still pending on this source.
