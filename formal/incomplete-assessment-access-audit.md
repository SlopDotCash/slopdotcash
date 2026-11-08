# Incomplete-assessment and vetting actor boundaries

This source-only change follows `b592aced0`. All added tests and model scenarios
are unexecuted. No parser, formatter, type check, test, browser, application,
simulation or verifier was run.

The incomplete-assessment child already removed its own page before fetching
and used an expected-actor header. It did not notify Inbox when a response or
the following session check detected a different account. A paginated A view
could therefore fail after a silent switch to B while the parent still showed
A's other private notification metadata. Both the HTTP-refusal path and a
successful old response followed by a changed session had this gap.

The child now checks the fresh session after successes and failures. A known
different or absent actor uses Inbox's existing identity-change callback;
an unknown session, access refusal or wrong response recipient asks the parent
to reload. The parent then hides its private view while rechecking. A temporary
failure retains only the existing parent view after a fresh matching actor
check; the child page remains empty with its retry. The effect's AbortController
guards checks, callbacks and completion so a departed or replaced request cannot
change a newer parent's account. Initial data remains the actor-checked parent
response. This does not introduce a client mutex or make Retry run a paid scan.

`ui_incomplete_assessments` has eleven scenarios: matching pagination, same-actor
failure, same-actor refusal, changed actor after success/refusal/transport failure,
session outage, signout, departed response, superseded page and initial retry.
Bounds are two requests, two pages, two actors plus signed-out and two lifetimes.
Payload grammar, current backend repository authority and atomic session
observations are inputs. `api_incomplete_assessments` remains the separate
durable gap projection; this UI model does not claim to prove worker execution.

The existing real-handler/SQLite browser workflow in
`tests/e2e/incomplete-assessments.spec.ts` now retains an A-only notification and
adds two interleavings: hold A's successful page until the fixture identity is B,
then switch before another page dispatch so the real handler refuses A's header.
Both require the parent's A notice to disappear without a reload or focus event.
The provider identity is a declared fixture, not a live GitHub session. Existing
pagination, empty, inaccessible, outage and recovery assertions remain.

The admin vetting routes separately used `deps.session` without checking the
expected actor header. The common `requireAdmin` now invokes `requireActor`
against that same captured session before checking `session.admin`. A valid
mismatched header returns 403 `actor_changed`; malformed returns 400
`invalid_expected_actor`; signed-out stays 401 `unauthorized`; a matching
non-admin stays 403 `forbidden`. An absent header keeps the legacy session
policy. Signed scanner routes still use their separate service signature and
do not acquire browser authority from this header.

`vetting_admin_actor` has seven scenarios with two actors plus no session,
absent/malformed/two valid header classes and one admin or signed-service
request. The added real-handler regression exercises all four protected
admin route shapes, ensures refusals write no assessment/exemption, and retains
matching/absent-header reads, matching-header scan creation and the independent
signed service path. It does not replace the service signature, scan policy,
operator grant, database or provider models. No runtime validation is claimed.
