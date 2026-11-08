# Project authority and setup request ownership

This change starts from the source reviewed at `450de123c`. It was authored
under the instruction to skip checks. No test, parser, formatter, typecheck,
model run, simulation, prover, browser or application was executed. The two
new models contain twenty-five named scenarios; all are unexecuted. Six new
browser regression definitions are also unexecuted.

## Confirmed source paths

`useProjectMaintainer` read actor A from `useProjectSession`, then made a
separate unbound project-authority request. It discarded the returned
`viewer.githubId` and recorded any successful response as authority for A.
If the browser session became B before dispatch, B's successful response
could therefore open A's captured gate. A response sent under A could also
arrive after a silent change to B. Ordinary focus events already invalidated
the hook's earlier effect; the missing case did not require such an event.

The hook now supplies A through the existing expected-actor header, checks
the returned viewer, and makes a fresh session observation before recording
success or refusal. The API still decides current repository authority. A
backend request captures its cookie and expected-actor header at dispatch;
a later browser cookie change cannot rewrite an already-sent request. A
refused authority response for the same actor remains a refusal, while a
changed or unavailable identity produces the existing retry error view.

`ProjectSetupStatusPanel` made automatic, manual and tab-return setup checks
without an initiating actor. This POST can request a scan or activate a
project; it is not only a public status read. Failure left the old setup
projection visible. Its prior unmount behavior did not prove a departed
parent callback: React ignores a completed state setter on an unmounted
component. The missing explicit lifetime fences mattered before dispatch
and for retaining or publishing data within the still-mounted view.

The panel now requires the actor supplied by its successful parent flow. Its
inner component is keyed by actor and project. It checks the actor before
sending the bound POST and after receiving its result, checks the returned
project ID, and fences completion with its mounted/request identity. A
departed preflight cannot start the POST. An already accepted server check
can finish after departure, without publishing into the new panel. No
accepted setup change, scan, revision or activation is rolled back.

An access refusal, changed/missing actor, unavailable identity check or
wrong-project response clears the setup and reports null to `onSetup`.
Thus the parent cannot retain the old scan-exemption projection through the
panel's refusal. A temporary request failure retains the previous setup
only after a fresh same-actor observation. The error and retry remain
visible, and busy is released for the current request. A callback from an
earlier instance cannot clear a newer instance's busy state or notify its
parent. The initial setup is still immediately displayed: it is a trusted
result of the parent's actor-bound create/publish flow, not a newly inferred
authorization inside this panel.

## Source-to-model relation

| Source | Reviewed transition slice |
| --- | --- |
| `src/lib/project-api.ts`, `useProjectMaintainer` | Separate session result, authority dispatch, returned viewer, fresh success/error identity check, focus invalidation, retry and detached completion. |
| `src/ProjectProposalPage.tsx`, `src/Presentation.tsx`, `src/EscrowFunding.tsx` | Consume the hook's actor-scoped authority gate. Form mutation and wallet semantics remain in their own models. |
| `src/ProjectSetupStatus.tsx` | Trusted initial setup, empty auto-check, one current request, preflight, dispatch, result, final identity observation, refusal clearing, same-actor error retention, retry, parent notification, actor/project remount and departure. |
| `src/PendingProjectApplications.tsx` | Pass the already captured application's actor to its resulting setup panel. Inventory/publication lifetimes remain in `ui_pending_applications`. |
| `backend/http.ts` | The existing optional expected-actor admission check. |
| `backend/projects/handler.ts` | Authority response identifies its authenticated viewer; setup check consumes the captured authenticated actor. Actual GitHub checks, scan admission, database revisions and activation policy are not re-proved here. |

`ui_project_authority` has two actor representatives plus signed-out, two
projects, two request IDs and two component lifetimes. Its eleven scenarios
separate a cookie change before dispatch from one after dispatch, wrong
returned viewer, same-actor refusal, request error, unknown final identity,
focus, project change, departure and a newer actor's successful result.

`ui_setup_check_lifetime` has the same actor/project/request/lifetime bounds.
Its fourteen scenarios cover trusted initial and empty states, preflight
refusal, expected-actor refusal, accepted work whose response loses its
owner, access-error teardown, same-actor temporary retention, unavailable
identity, wrong-project response, departure before/after dispatch and retry.
The `accepted` set records an accepted setup operation, not proof that a
project activated or that a scan passed. The backend's other models retain
those distinctions. Parent notifications are represented by the current
panel data projection; actual React effect scheduling remains a browser
conformance boundary.

`ui_focus_session` continues to cover the session hook's focus, visibility
and restored-history generation behavior. It does not by itself establish
the separate authority request's correctness. `useProjectSession` also
retains its cached snapshot while disabled; re-enabling with an unchanged
revision can expose that snapshot before the refresh effect executes.
`AccountPage` is the current enabled-toggle caller and has additional
member/sign-out and child request guards. This review did not establish an
unsafe action from that transient state and does not claim it was fixed or
covered by either new model.

## Authored conformance and remaining boundaries

`tests/e2e/project-access-retry.spec.ts` adds three authority cases: a
mismatched returned viewer; a held real-handler response followed by a
different session observation; and an actual handler refusal when the
expected actor differs from its captured fixture actor. The latter uses
the existing native-D1 project fixture. Session changes are explicit test
observations, not live identity-provider events.

Three setup cases use the real project route and native-D1 fixture with a
controlled queued-scan projection. They cover a refused refresh that removes
the checks, a same-actor outage that retains them and then recovers, and a
held successful check whose later session observation changes actor. The
real initial/check handler is still called; the queued and failure responses
are declared transport/provider doubles. The shared maintainer fixture now
includes the viewer identity that the actual authority endpoint returns.

These definitions do not provide runtime evidence for cancellation, two
projects remounting, all scan/provider outcomes, arbitrary identities,
payload parsing, or the initial parent's complete create/publish flow.
Known HTTP refusals are observed when `projectApiRequest` rejects after its
response read, not necessarily at receipt of headers. Cookie changes are
detected at the next explicit session observation; no instantaneous browser
identity notification or cancellation of an accepted server operation is
claimed. No absence-of-state-errors claim follows from this source review.
