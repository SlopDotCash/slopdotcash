# Email editor and account-check composition

This follow-up starts at `1f0dafd45aa172ca5b65bb22fb16da99e35fbb1a`.
It corrects the existing account-bound email enrollment flow in PRD section 3
and NOT-01; it does not add an email or account feature.

## Confirmed failure

The real local Anvil bounty journey filled an email address and security-email
consent, then held a preference GET during a focus recheck. Both layouts lost
the input and showed Loading. Every observed project-session response still
named actor `900000013`. The original evidence is retained by the private-intake
lane under `evidence/formal/bounty-anvil-ui/`; no payment step was reached.

`InboxEmail.load(true)` intentionally retains an existing editor during a
background check and disables sending. Its parent `AccountPage` instead
rendered the child only while the project-session hook said signed-in. For a
valid private-session-only reporter with no Points membership, checking made
that condition false and destroyed the child's address and consent state.
This was a parent/child transition defect, not a reason to weaken the test.

## Corrected boundary

The account page retains a confirmed email actor while a check is pending.
Only this email subtree is retained. Retaining the whole account view would
keep unrelated authority controls visible; storing email drafts in durable
browser storage would add a different capability. The fix reuses the existing
in-memory editor and its error/retry controls. Existing wallet, owner and Points control
conditions are unchanged. The child receives the parent check state, so its
switches, submit button and both mutation handlers remain blocked. Text and
consent can still be edited locally while an ordinary same-account refresh is
pending. The child's own live preflight, expected-actor request header and
post-request check remain required.

The child also receives the expected parent actor. A preference read that
finds another actor is refused before exposing a new editable form under the
old key. The existing Retry path rechecks the parent and creates the new
actor's editor. A browser probe caught this intermediate mismatch: a B draft
created under the A key was lost when the later parent focus check confirmed
B. The optional unbound read mode remains for fresh blocked error children;
it does not confer write authority.

A confirmed different actor changes the React key; a confirmed sign-out removes
the editor. An independently observed Points member mismatch also removes the
old editor before the project-session read returns. Known GitHub node IDs are
compared by their existing numeric-ID decoder. Null membership is valid for a
private-session-only account. An undecodable non-null ID is different: only an
unchanged raw observation can retain the prior editor during checking; a new
raw ID removes it. This is not proof that arbitrary opaque IDs name one actor.

A successful local sign-out needs a separate signal from null membership.
`PointsProvider` increments an in-memory sign-out revision only for explicit
`setMe(null)` account actions. That revision invalidates the retained email
observation immediately, before a potentially delayed project-session read.
A real browser counterexample against the intermediate candidate retained the
old textbox during such a held read; its log, screenshot and trace are kept in
`evidence/formal/email-focus/local-signout-before/`. An initial `/points/me`
null response does not increment this signal. Its initial 401 branch has no
established mounted-editor path; this change does not reinterpret that branch.

Known signed-out and changed-actor paths reset both the local editor and its
actor reference, including explicit 401 responses. A separate probe showed a
child-detected sign-out could otherwise restore its old draft after the same
actor signed back in. These resets are separate from transient read errors.

Transient parent errors retain a previously confirmed actor's internal draft,
but the child shows its existing error/retry UI and no editable form. A retry
for the same actor recovers the draft; a different actor gets a fresh child.
An initial error with no confirmed email actor uses a fresh, blocked error-only
child. It cannot become editable before the parent has confirmed identity.
The existing initial-preflight regression caught a candidate custom fallback
that had changed the error controls; the final version reuses `InboxEmail`.

## Model and evidence limits

`ui_email_parent` composes parent identity checks, child preference checks,
editor identity/lifetime, independent Points observations, sign-out, error and
retry. It bounds two known actors, two undecodable raw observations, three
bound-editor generations, one local sign-out and one write. `mounted` means a
bound editor, not every DOM child: a fresh blocked error-only child is represented
by `failureVisible` without a bound editor. Changed membership keys enter the
parent checking state in the same transition, matching `useProjectSession`'s
revision fence. Old child completion cannot restore a replaced editor.

GitHub-ID byte parsing, provider authentication and network fairness remain
external predicates. The model is a manual composition abstraction, not a
mechanical React refinement proof or a claim that every browser event ordering
is verified. The real Anvil journey remains separate from focused tests whose
HTTP identity and preference authorities are deterministic fixtures. Focus
signals are explicitly dispatched; these tests verify the application handlers,
not operating-system focus delivery. The synthetic OAuth window stays open,
so the fixture explicitly returns to the main page before checking its render.

## Finite verification

With pinned Bun 1.3.14, Node 24.15.0 and Quint 0.33.1, the model passed type
checking, 16 named scenarios and 500 seeded traces of 60 transitions. TLC
exhausted 28,812 distinct states (375,815 generated). The receipt records
unchanged source and model hashes. As with the repository's other finite
models, deadlock checking is disabled by the backend; progress is demonstrated
only by the named scenarios, not unconditional network fairness.

The earlier browser attempts remain separate evidence. One candidate retained
an old editor after explicit local sign-out; another allowed a child to accept
B before its parent had rebound from A; a third hid but did not clear the draft
after child-observed sign-out. Each was reproduced before the final correction.
The existing preflight test also rejected a custom error fallback that changed
its message/controls. Test-only failures from an unclosed synthetic OAuth
window and the old Retry selector are recorded separately; no runtime change
or timeout increase was made to mask them.

## Final browser validation

The frozen source passed **54/54** selected cases in 4.3 minutes with pinned
Bun 1.3.14 and Node 24.15.0. This includes 44 new cases across Chromium and
Firefox desktop/mobile viewports, plus 10 existing account-session, email-action
and initial-preflight cases selected by the standard project configurations.
There were zero skips, flaky cases or unexpected browser diagnostics in all
54 diagnostics attachments. Intentional 401/503 cases retain their declared
expected failures. Typecheck, lint, format and the isolated build passed; lint
retained the existing repository warnings.

The same-actor check verifies keyboard focus, editable address and retained
consent while Send is disabled. Other cases verify parent and child account
changes, local sign-out before its held read, error/retry to the same or another
actor, and explicit HTTP401 cleanup. The existing preflight test still proves
that a changed account receives no unintended write. Accessibility checks run
on the ready and error views. The existing account suite supplies its text-size
and keyboard checks; this is not native zoom, OS focus, provider or physical
device acceptance.

`evidence/formal/email-focus/` retains the final results, source hashes, model
receipts, before failures, screenshots and videos. The 24-second
`email-editor-walkthrough.mp4` combines reviewed captured frames and recordings.
Canceled candidate runs are not passes and remain separate from `final-54/`.
The combined integration revision still needs its own inventory refresh,
required checks and real local-chain workflow repeat. This local result does
not claim merge, deployment, public provider delivery or real-money acceptance.
