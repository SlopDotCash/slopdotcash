# Security settings identity and publication lifetime

This source review found three related paths in the active Security workspace:

1. A permission response dispatched for A could grant A's editor after a silent
   change to B's cookie. The response compared its viewer to the old React prop
   but did not recheck the session.
2. Publication did not pass the optional expected-actor header. B could send
   A's loaded terms after the cookie changed. If B also had repository authority,
   the backend correctly accepted a B-owned revision; the browser had not bound
   the action to its displayed actor.
3. A publication accepted before a focus-driven editor unmount could finish
   later and call the still-mounted public page's project/revision callbacks.
   That could replace a newer displayed revision with the old result.

These are source-confirmed orderings, not runtime reproductions. The correction
does not change repository authority, bounty terms, funding policy, split,
revision admission, or layout. The existing hidden review form and disabled
publishing fields did not establish a separate editable-preview defect, so no
new preview policy is claimed or introduced.

## Implementation and model mapping

`models/ui_security_settings_lifetime.qnt` has 20 named source-authored
scenarios. It uses two actors, two component lifetimes, two reusable read slots,
two publication attempts, two abstract candidate bodies, and server revisions
1 through 3. The bodies represent distinct complete submitted payloads; they
are not token amounts or replacements for the monetary models.

| Source | Reviewed transition | Model actions |
| --- | --- | --- |
| `src/ProjectSecuritySettings.tsx` permission effect | Capture the prop actor; check it before sending a permission read; send the expected actor; compare the response viewer and a fresh session; clear the gate on refusal, unknown identity, or a changed actor. | `beginRead(permission)`, `readPreflight`, `readDispatch`, `readReply`, `readPostflight`, `wrongPermissionViewer` |
| `src/ProjectSecuritySettings.tsx` current-revision effect | Capture actor and generation, pre/post-check it around the public project read, publish only from the current request, and recheck identity before retaining an ordinary failure. Known access loss clears the parent gate. | `beginRead(revision)`, `readPreflight`, `readReply`, `readPostflight`, `depart` |
| `src/ProjectSecuritySettings.tsx` editor/callback composition | The actor/project key and layout cleanup retire the old editor. A departed callback cannot update the public page or its Published message. | `depart`, `remount`, `publishReply`, `publishPostflight` |
| `src/SecurityBounty.tsx` parent identity refresh | A confirmed missing/different actor or `actor_changed` response requests a new parent session. The new actor gets a new permission/read lifetime without requiring focus. Ordinary repository refusal and unknown identity errors retain local retry and do not request this refresh. | `identityDeny`, `parentIdentityReply`, `unavailablePublicationIdentity` |
| `src/SecurityProgramEditor.tsx` `publish` | Capture actor, complete candidate, bounty amount and expected revision before the first await. Refuse a second current request. Precheck actor, send bound PUT, postcheck actor, then publish only from the mounted owner. | `beginPublish`, `publishPreflight`, `publishDispatch`, `publishReply`, `publishPostflight` |
| `src/SecurityProgramEditor.tsx` failure handling | Known access loss clears the gate immediately; other failures recheck the actor before keeping the existing form/error. A departed failure cannot clear the new gate or change its UI. | `publishReply(access/temporary)`, `publishPostflight`, `depart` |
| `src/lib/project-api.ts` | The existing `publishProjectRevision` option serializes the expected-actor header; the wrapper returns a successful response without claiming authority itself. | `publishDispatch` |
| `backend/http.ts`, `backend/projects/handler.ts` | `requireActor` compares the expected actor to the request's authenticated actor. `publishOwnerRevision` still checks stored-project authority and expected revision and appends an immutable successor. | `serverResult` |

`loadSettings` is only a convenience scenario sequence composed of the separate
read actions; the step relation retains every await boundary. Unlike an alias
of `init`, it does not reset state. The older `ui_project_setup` abstract
save/activation model and `ui_owner_bounty_funds` balance/child model do not prove
these actor and callback transitions.

## Authored application conformance

Seven new `@registry` definitions in `tests/e2e/security-bounty.spec.ts` reuse
the existing local Pages Functions, populated D1 registry, disposable sessions,
and GitHub fixture. They cover:

- An actual permission response for A held across a cookie change to B, followed
  by a fresh B permission check without a synthetic focus or reload.
- B replacing the cookie before publication preflight; no PUT may be sent, and
  the parent refresh must open B's unedited current settings.
- A's accepted revision held while B loads and publishes its successor; A's
  late response must not replace B's displayed revision or amount.
- Departure during the preflight session read; no publication may follow.
- Three publication failures: known access refusal, transient failure with a
  different actor, and transient failure with the same actor. The first keeps a
  local permission retry; the second refreshes B's parent identity; only the
  last keeps A's edited form, and its retry uses the real publication handler.

The refusal and transient branches inject explicit HTTP responses; they do
not pretend to test a new backend authorization policy. Accepted publications
and their stored revisions use the real existing API/database workflow.

## Remaining boundaries and execution status

The model distinguishes browser state, the cookie captured at mutation
dispatch, backend acceptance, and later session observations. A subsequent
cookie change cannot change the actor of a request already sent. Session
responses are observations of their dispatched request, not a guarantee that
an unrelated tab cannot change the cookie immediately afterwards. Repository
and provider truth remain external inputs. The public revision GET does not
become private or gain server-side authority merely because the client sends
an expected-actor header; the client checks protect the editor's association.

An accepted backend revision remains accepted even if the client loses the
response, leaves, or changes account. No attempt is made to erase it. Current
form values are captured before publication; normal Edit/Review behavior is
unchanged. This model excludes full form validity, precise asset metadata,
funding and settlement, and storage, which have separate models and checks.

No tests, type/lint/format checks, parser, simulator, prover, browser, app or
service were run. All 20 scenarios and seven added browser definitions are
unexecuted, in accordance with the user's instruction to skip checks. This is
source-review evidence only.
