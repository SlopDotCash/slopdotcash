# Inbox read and identity observations

This source-only model describes the existing `Inbox.tsx` loading path. No
application code changed, and no model, test, browser or application ran for
this addition. It complements `ui_inbox_mutation_focus`, which owns action,
focus and mutation-readback ordering. It does not replace the backend inbox,
private report or incomplete-assessment models.

## Source behavior

`loadInbox` first reads the project session. A confirmed signed-out result
returns without a notifications request. An unavailable session is different:
the request may continue without an expected-actor header, but its response
still needs a later matching session before publication. When the initial
session was known, both that identity and the response recipient must match
the final session observation. A valid envelope from another recipient cannot
be reassigned to whichever account happens to answer the later session read.

HTTP 401 takes the existing signed-out path. Other request, body, schema and
identity failures enter the parent's recovery session read. A confirmed
signed-out recovery clears the recipient; a known account gets an explicit
inbox error with its private child views still assigned to that account. An
unavailable recovery session hides those views by setting the recipient to
null. It does not pretend that the inbox is empty.

Every new parent load advances `generation` and aborts its prior load. The
completion and failure handlers compare their captured generation before
changing parent state. Sign-out and unmount also advance it. The model retains
a superseded request identity to represent its ignored callback. Abort is not
treated as proof that the remote server never processed a request.

`acceptRecipient` resets the cursor, page history and private query parameters
when a known recipient changes or becomes signed out. If the new recipient
arrived on an older page, `receive` keeps loading until the first-page request
replaces it. A same-recipient result retains the current page. The model's
`draftClearRequested` records the call to `clearAllDrafts`; it does not prove
that session storage was accessible or that bytes were deleted. Those storage
functions catch unavailability separately.

## Mapping and assumptions

| Source | Model transitions |
| --- | --- |
| `Inbox.tsx` `load` | `start`, superseded request identity and `staleReply` |
| `loadInbox` initial session and HTTP status | `firstSession`, `http` |
| `parseNotificationsResponse` and final session comparison | `body`, `finalSession` |
| `receive`, `acceptRecipient` | `receive`, `acceptActor` |
| Parent failure handler | `recoverSession` |
| Older-page control and cursor-driven reload | `olderPage`, `start` |
| Session-change subscription and unmount cleanup | `signOut`, `depart` |

React documents that changed effect dependencies run the prior cleanup before
the new setup, and unmount runs cleanup. See the official
[effect lifecycle](https://react.dev/reference/react/useEffect#parameters).
The model groups cursor updates and their loading transition; it does not
model render frames between a state setter, commit and passive effect. The
actual generation comparisons remain the implementation boundary.

Session reads are observations, not continuous knowledge of the cookie store.
The `cookieChangeIsNotContinuousSessionKnowledgeTest` scenario intentionally
allows a previously accepted view to remain until another observation or
explicit session-change event occurs. It must not be interpreted as proving
that the current cookie always equals the displayed recipient. Authorization
of later requests and committed backend effects are separate contracts.

## Bounds and evidence

`ui_inbox_reads` has 21 named scenarios, two account identities, signed-out and
unavailable session results, three load generations, one retained superseded
identity, two cursor positions, a next-cursor flag and one departure. The older-page action requires that flag, matching the disabled control when no next cursor exists. Success, 401, request failure,
valid empty envelope, invalid body, failed final session, unknown recovery session, changed recipient
and same-recipient paging are separate transitions. The terminal refusal
scenarios finish at their disabled `receive` action.

Existing browser definitions in `inbox-response-owner.spec.ts` and
`inbox-report-account-change.spec.ts` exercise related identity and response
ownership paths. Their presence is a source link, not execution evidence for
this new model or the current branch. No new browser assertions or product UI
were added. Body-size limits, real HTTP cancellation, schema-parser branches,
private child requests, arbitrary page histories, physical storage behavior
and complete React scheduling remain outside this finite model. Passing it
would not by itself establish implementation refinement or whole-inbox safety.
