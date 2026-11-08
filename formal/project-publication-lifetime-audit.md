# Project creation and revision completion

This is a source-only review of the publication changes drafted after
`450de123c`. No checks, parsers, tests, model runs, provers, browsers or
applications were run. The sixteen named model scenarios and two added
browser regression definitions are unexecuted.

## Reviewed source and ownership

`ProjectProposalForm.submit` captures the initiating session actor and the
serialized draft payload before waiting. It requires that actor before
calling `createProject`, sends the expected-actor header, and requires the
actor again after the result. A departed form cannot start creation after a
pending preflight or consume an already accepted result. The successful
state retains its initiating actor when it mounts the setup panel. Referrer
cleanup compares the captured payload with the latest payload; changed
local work keeps its referrer rather than being cleaned by the old result.

`ProjectUpdatePage` keys its editor by project and the authority hook's
actor. `ProjectUpdateForm.publish` captures its current draft, expected
revision and actor, uses the same preflight/header/final-observation
sequence, and checks its mounted lifetime before all result handling. An
accepted server revision still exists when its old view departs or the
final actor observation changes. Its old completion cannot set the new
view's base, successful-publication notice or draft.

The update form keeps the existing edit-during-save rule. Its comparison is
the captured draft object's identity, not merely a comparison of text.
Unchanged work clears the local draft after publication. Any new draft
object stays in the form and is rebased on the returned revision, including
when the user typed different text and then restored the original text.
The persistent draft-store slot and queued-write protocol remain in
`ui_draft_slots`; this model does not claim a new storage transaction.

Known account/access loss follows the existing parent recheck path. Other
failures get a fresh actor check before their error is displayed. If the
error-path identity check itself is unavailable, the current source retains
the local editor and shows an error; it does not report success or bypass
the next submission's fresh preflight. A failure of the success-path check
can therefore cause one further identity read through the common error
handler. This retained-draft boundary is represented explicitly, not
silently modeled as a successful identity check or immediate logout.

## Model relation and finite limits

`ui_project_publication_lifetime` covers the create/revision functions and
their caller lifetime, plus the existing expected-actor admission predicate
in `backend/http.ts` and expected-revision predicate in
`backend/projects/handler.ts`. It separates preflight observation, request
dispatch, captured cookie/header admission, server commit, response,
success-path observation, error-path observation and UI publication.

A cookie change before dispatch can cause the expected-actor check to
refuse the request. A change after dispatch does not rewrite its identity:
the server may accept the captured A request, while B cannot receive the
old result as its own successful publication. The server commit and the
browser success notice are distinct states. Lost responses and detached
successes retain accepted server revisions.

The model has two actors plus signed-out, two requests, two component
lifetimes, three payload representatives, two local edit epochs, and server
revisions zero through three. Create mode starts at zero; revision mode
starts at one. Payload values abstract all fields and the epoch separately
represents revision-draft object identity. Creation compares the payload
and referrer instead. The optional persistence action represents one
successful or failed flush of the current payload; disk ordering,
cross-tab slot allocation, browser storage exceptions and draft migration
stay with the draft-store model and its existing browser coverage.

The model does not replace manifest validation, GitHub authority checks,
repository admission, funding arithmetic, immutable revision persistence,
setup activation, referrer eligibility or backend transaction guarantees.
Those are existing domain boundaries. It also does not claim that a
browser instantly observes an arbitrary cookie change, or that an accepted
write can be canceled by leaving the page.

## Authored implementation conformance

The existing `project-save.spec.ts` edit-during-save scenario is preserved.
It publishes the submitted text, retains subsequently typed text, reloads
the newer draft and publishes it against the next revision. Its synthetic
authority response now includes its actual fixture actor (`4242`).

Two new scenarios use `projectImageApiFixture` with real project handlers
and native D1. Each holds an already accepted PUT response, proves the
stored revision advanced, replaces the editor through SPA navigation or
an actual fixture actor change, saves newer local work, and then releases
the old response. Both assert that the newer draft survives, no old
successful-publication notice appears, and the accepted server revision
still contains the originally submitted text. The actor case uses the
fixture's existing `x-fixture-role: other` path (actor `4244`). That fixture
grants both actors repository authority, so the test does not pretend to
prove B lacks access. Neither scenario has been executed.

Three added creation scenarios in `project-proposal.spec.ts` use the existing
rendered wizard with explicit API/session doubles. They cover a changed actor
before submission, a changed actor while an accepted reply waits, and a stale
session observation followed by an expected-actor refusal. They assert that
the wrong-account success screen is absent and that the captured header is
sent. These definitions are unexecuted and are not durable backend evidence.

The related viewer-shape review also corrected the two synthetic successful
authority responses in `site.spec.ts` and the `project-draft-storage.spec.ts`
helper to return their session actor (`4242`). The shared wallet/owner
maintainer helper returns actor `1`. Real registry and security-bounty
requests retain the real API response; explicit refusal fixtures remain
refusals. The production client does not accept missing viewer identity as
a compatibility fallback.
