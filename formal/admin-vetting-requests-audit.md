# Admin vetting request ownership

This source-only follow-up covers the private vetting overview, scan request,
admission exemption grant/revocation, and activation-clearance request lifetimes.
It adds `models/ui_admin_vetting_requests.qnt` and
`tests/e2e/admin-vetting-request-ownership.spec.ts`. Its 21 named Quint scenarios
and 10 browser test definitions are **unexecuted**. No parser, simulation,
verifier, browser, application, type check, lint, formatter, or test was run for
this follow-up, following the instruction to skip checks and focus on pushing.

## Source transitions

`src/AdminVetting.tsx` uses `ownedVettingRequest` for private reads and mutations.
Each request must still own its view before checking identity, after that check
before dispatch, and after the response before checking identity again. A
successful current postflight check permits publication. An abandoned request
returns without publishing, calling its parent, or starting another request.
`src/lib/admin-request.ts` supplies the current-session and failure checks.

| Source boundary | Required transition |
| --- | --- |
| `VettingSection.load` | A mounted parent starts a fresh generation; only that generation can publish or report access loss. Starting the read removes the prior ready projection. |
| `useVettingMutation.run` | One synchronous in-flight guard covers the preflight, HTTP request, postflight and callback. A second submit cannot dispatch while it is occupied. |
| `QueueScan` and `AdmissionExemptionForm` | The selected project/revision and trimmed form fields are captured before the first asynchronous wait. Later edits do not replace the submitted body. |
| Mutation success callback | The child and parent must both still be mounted. A current success may set the note and start one parent refresh; an obsolete callback may do neither. |
| `ActivationClearance` | Each effect owns only its own attempt. A replaced/unmounted effect cannot publish clearance or report access loss. Its existing selected-revision comparison also rejects a mismatched returned revision. |
| Known identity/access failure | The current child reports access loss to `AdminPage`; its session revision enters checking and removes the private keyed project subtree before another observed session can mount it. |
| Temporary API failure with a matching current actor | Keep the existing child view and show its error. A failed or changed identity check instead triggers parent revalidation. |

The former late-success hazard was the child explicitly calling its saved
parent callback after departure. That callback could start a new vetting GET;
the problem was not a claim that React alone re-runs effects from an ignored
post-unmount state update. The mounted child guard and the parent's own guard
both cover that callback boundary. Current access errors also reach the parent
instead of leaving its private ready projection indefinitely behind a child
error.

`projectApiRequest` attaches the expected GitHub actor header to these requests.
The backend's actor admission uses the session captured by that HTTP request
and its expected actor; absence of a header retains the existing compatibility
contract. The browser and model separate this admission from later UI session
observations. A cookie change after dispatch does not rewrite an already-sent
request. An accepted scan or exemption write remains accepted after navigation,
identity loss, or a suppressed response callback. This work does not cancel or
roll back server writes.

## Finite model

The model bounds two read slots, two nonzero actors plus a signed-out identity,
two parent lifetimes, two abstract form payloads, and one mutation attempt. It
separates preflight observation, dispatch-time cookie capture, external server
admission, postflight observation, and the parent callback/refresh. A read's
generation also represents the ownership of an activation-clearance effect.
Loading a new parent read invalidates the old ready child in the abstraction.

The 21 named scenarios cover current read publication; preflight identity loss
and identity-check unavailability; departure; competing read generations;
postflight actor mismatch; forbidden reads; retry after a temporary read
failure; duplicate mutation submission; form snapshot preservation; abandoned
and changed-actor mutation preflight; an actor change between preflight and
HTTP dispatch; dispatch-time identity surviving a later cookie change; accepted
writes both before and after departure; old callbacks after a new actor mounts;
forbidden mutations; temporary mutation errors; a successful current refresh;
and a fresh actor check before that refresh dispatches.

`invariant` distinguishes accepted server state from visible client state,
requires private publication to have observed the actor owning the current
parent lifetime, clears private projection and success note on invalidation,
and bounds a single mutation's callback/refresh to one. It does not require the
cookie to remain equal to the last observed actor at every instant: the source
checks identity at asynchronous boundaries, not continuously.

The model does not encode exemption policy, repository authority, scan results,
payload schema validation, clearance revision labels, the HTTP deadline, or
durability/idempotence inside the backend. It abstracts returned content and
external authorization decisions. Its single-attempt bound does not prove an
unbounded sequence of retries or interactions between separate child forms.
No source refinement proof or whole-application state-completeness claim is
made by these definitions.

## Browser definitions

The new file declares five cases for each of two operations, scan and exemption
grant: accepted response after SPA departure; accepted old-actor response;
forbidden response with withdrawn access; changed preflight actor; and current
success with a frozen payload, duplicate submit, and exactly one refresh. The
existing admission-exemptions browser file retains the grant/revoke history
flow and its interface checks.

The fixture captures both the Cookie and expected-actor header at dispatch,
records an allowed write before holding its response, and retains that record
through departure or cookie replacement. A deliberately named test cookie and
route doubles make the distinction explicit; these are not live authentication,
real backend admission, or scan execution evidence. The successful current
cases assert rendered results, not only HTTP counts. The access-loss cases
assert removal of the parent private overview, not only a child error.

The no-refresh departure assertion observes completed response handling and
two browser animation frames. It covers the immediate saved-callback hazard,
not every possible future request from unrelated application activity. The
definitions still need execution against the integrated source; syntax,
rendering, browser diagnostics, and timing have not been validated here.
