# Pending application account and completion state

This source-only change extends the existing stored-application workflow.
No tests, parsers, checkers, simulations, verifiers, browsers or applications
were run. All scenarios and the extended registry browser definition remain
unexecuted.

## Confirmed source paths

`PendingApplicationsForAccount` was keyed by the parent session actor, but its
inventory request carried no expected actor. A cookie change before server
admission could return another account's private applications into that view.
A cookie change after admission could also leave the previous account's
response visible. The key only handled identity changes the parent had
already observed; it did not observe a silent cookie change during delivery.

The existing backend `requireSession` already calls `requireActor` and can
enforce `x-slop-expected-github-id`. The list and publication wrappers now send
that existing optional header when given the initiating actor. Other callers
retain their current interface and behavior. The list checks the current
session after reading the response and before rendering any applications.

Publication checks the initiating actor before sending and after receiving
the result. Known access loss removes the parent list. Other failures check
identity before showing the ordinary retry, including the existing Slopbot
installation link. A failed identity read during a successful response enters
that same error handling; a second fresh read may confirm the original actor,
or clear the list if identity is still unavailable. The code does not claim
continuous knowledge of the session between observations.

The child now checks its mounted lifetime after each wait. A publication
already accepted by the server remains accepted after departure, but its old
completion cannot mount a setup panel and trigger another setup check. An
in-flight latch still blocks duplicate submissions in a mounted item.

## Model and conformance boundary

`ui_pending_applications` separates two view lifetimes, two actors, one
immutable application per actor, inventory admission, response delivery,
identity observations, publication admission and durable publication facts.
The browser captures the Cookie header when it dispatches each request;
later server admission uses that captured actor, even after a browser cookie
change. A separate dispatch transition represents a change between the last
session observation and the actual request.
It covers ordinary empty results, retries, known refusal, unavailable identity,
duplicate clicks, departure, stale responses and remount. Published facts are
not undone by a missing response. A response can be old when the session has
changed; the invariant does not pretend every displayed value continuously
matches a cookie before a fresh observation occurs.

The model abstracts JSON/schema validity, application payloads, arbitrary
application counts, repository checks, scan work and database transactions.
Those are external predicates or existing backend model families. Stored
revision conflicts remain ordinary retry responses until a new inventory
omits the no-longer-publishable application. A model mapping does not prove
the React implementation refines it.

Session-query results are atomic observations in this model. A separately
delayed session HTTP response is not represented. Source review corrected an
earlier model error that read the mutable browser cookie during later server
admission; the model now retains the actor captured at request dispatch.
Neither review nor this correction is an executed model result.

The existing registry browser workflow is extended to hold the actual Pages
Functions/D1 inventory response for account A, silently replace its cookie
with the seeded account B, then release A's response. It requires the old
application to disappear and an account-change message. Restoring A continues
the original installation-refusal, publish-once, immutable revision, keyboard,
accessibility and project-navigation assertions. The added held-response order
is authored but has not run. It neither signs in to a live provider nor changes
production data.
