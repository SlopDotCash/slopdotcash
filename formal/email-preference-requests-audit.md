# Email preference request ownership

This source-only review covers the active `InboxEmail` preference editor in
`src/InboxEmail.tsx`. It does not cover the separate `InboxEmailAction` mail-link
component. The existing parent-identity, explicit-signout, enrollment-delivery
and mail-link models remain separate obligations.

The pending runtime correction makes `checkActor` take the captured generation
and return false before or after its session await when it no longer owns the
view. `save` checks ownership before its 401/403/409 branches, so an old response
cannot reset or reload a departed editor. Both preference saves and verification
requests recheck ownership after the final session observation. `runCurrent`
handles ordinary failures through a fresh actor check and publishes its error
only after a final generation comparison; it does not throw into the generic
action hook's error publisher. A generation/abort check after reading the GET
body also prevents a departed load from starting its postflight session request.

## Model and source relation

`models/ui_email_preference_requests.qnt` has 18 named, unexecuted scenarios.
It bounds two requests, two component lifetimes, two actors, two draft values,
six generation values, two preference GETs, two mutation dispatches, two
automatic reloads and six session checks. The initial state is an already
loaded, editable account; `beginRead` also models a subsequent foreground or
background load. A remount projects a newly loaded independent editor, without
claiming its full parent/session boot sequence.

| Runtime transition | Model action |
| --- | --- |
| `load` or focus refresh creates a new generation; a background load keeps the draft editable while blocking saves. | `beginRead`, `editDraft` |
| A session check starts only for the captured current generation, then checks it again before reacting to its reply. | `preflightStart`, `preflightReply`, `postflightStart`, `postflightReply` |
| `save` and `requestVerification` capture the loaded actor, preference/body and generation; the expected actor accompanies the dispatched cookie. | `beginAction`, `dispatch`, `cookieChanges` |
| A stale 403 or 409 reply cannot reset state or invoke `load`; a current 403 clears identity, while a current 409 preserves the draft and records destination-conflict feedback. | `httpReply` |
| A late or invalid GET body cannot start another check; a valid current body proceeds to a final identity observation. | `bodyReply`, `postflightStart` |
| An ordinary failure may retain the current draft/error only after a matching actor check. Unknown identity hides the editor without clearing its internal draft. Confirmed change/signout resets it. | `requestFailure`, `failureCheckStart`, `failureCheckReply`, `lost` |
| A successful matching preference result updates its flags. A successful verification result ends editing and clears its retry key. | `accepted`, `httpReply`, `postflightReply` |
| Unmount/replacement increments the generation before old continuations can react; an old response cannot update the new draft or trigger a reload. | `depart`, `remount` |

Successful save 200 and verification 202 replies require an explicit accepted
request in the model. The publication invariant ties every accepted UI result
to its owning generation, a matching observed actor, and, for mutations, that
accepted request. Dispatch-cookie equality is checked independently. This
does not equate a later browser cookie with the cookie of an already-sent
request, and it does not claim an instantaneous privacy guarantee from a
session response observed earlier.

`sendSave` and `sendVerification` are named-scenario trace conveniences, not
actions in `step`. They neither invoke `init` nor reset a running model. Full
preference parsing, response byte limits, identity-server semantics and
backend destination-version/verification policy remain external boundaries.
The automatic reload is represented as its generation change, draft effect,
counter and visible state; its full subsequent parent/identity flow is not
expanded into another request slot in this model.

## Browser definitions

Seven added cases in `tests/e2e/email-editor-focus.spec.ts` reuse its built-page
HTTP fixture and normal UI controls. They cover:

- Departure while an action's mismatched session preflight is pending: no new
  preference GET or verification POST may follow.
- Departure before either a 403 or 409 preference response: no reload may follow.
- An old postflight reply after SPA departure and a newly mounted draft: the
  draft and accepted preference remain, with no extra old-editor read.
- Ordinary save failure for the same actor versus a changed actor: only the
  matching actor keeps an editable draft.
- Current destination-version conflict: explicit feedback remains, the draft
  stays editable, and a retry uses the newly read destination version and
  reaches a current successful save.

The fixture adds an optional verified destination and a preference-read count;
existing calls retain their original unverified default. These are HTTP and
browser lifecycle definitions, not live email delivery, wallet or identity
provider evidence. No new message is sent by this authoring work.

No parser, simulator, prover, tests, type/lint/format checks, browser or service
was executed. The model, seven browser cases and runtime mapping are all
source-review evidence only, as required by the user's skip-checks instruction.
