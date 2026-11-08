# Admin mutation identity and reviewed request

This follow-up starts from `b592aced0`. It was authored without running
checks, parsers, tests, models, provers, browsers or applications. Its
twenty-two named model scenarios and four new browser definitions remain
unexecuted. It preserves the preceding resource-deadline and private-list
corrections.

## Source findings

`ProjectEditor` and the delist control sent mutations without binding the
actor that supplied their displayed data. Their 401/403 handlers showed an
error while the ready private parent and its controls remained. The editor's
earlier mounted/draft comparison fixed a separate save-completion race; it
did not establish current actor ownership or invalidate the private parent.

The enforcement preview had a second, independent input race. Its fields
were editable while the preview POST waited. A request for Quarantine could
complete after the action field changed to Ban. The confirmation label used
the returned Quarantine preview, while confirmation rebuilt a Ban request
from the newer input. The same rebuilding used a newer project revision or
enforcement sequence if the parent refreshed after preview. The backend
correctly validated what it received; that did not prove it was what the user
had reviewed.

## Correction

`src/lib/admin-request.ts` supplies shared actor/error utilities. A fresh
observation must name the initiating actor and retain its admin role. An
unknown identity has a distinct error type, not an invented HTTP status.
Known access refusals remain refusals. Other errors are retained for display
only after a fresh matching admin observation. The caller owns all mounted
and in-flight guards and checks them after each wait. A selected-account
`account_changed` response is not automatically treated as a session change;
that backend error can require a new enforcement preview instead.

Editor saves, delists, enforcement previews and confirmations send the
existing expected-actor header. They perform pre/post actor observations
and fence UI/parent callbacks by their own lifetime. Known access or identity
loss advances the Admin parent's session revision, immediately replacing its
old ready subtree with the existing checking gate. Local editor draft bytes
remain for recovery. The shared request utilities also support the separately
owned vetting callers; those implementations have their own model/audit.

An accepted editor response still performs the prior exact-byte conditional
draft cleanup before its mounted check. This preserves the existing recovery
contract: a departed accepted save may remove its unchanged submitted bytes,
but it cannot remove a newer serialized payload. It does not undo a backend
revision. A mounted editor with newer edits stays open, exits busy, and keeps
the existing explicit submitted-version feedback. Ordinary current success
still reloads the list and returns to overview.

Enforcement now stores the reviewed request with the returned preview. The
source fingerprint includes actor, project, action, trimmed reason/evidence,
account input, expected revision and expected sequence. A changed fingerprint
before or after preview I/O refuses that result and keeps the current input.
Returning exactly to the original semantic payload can still accept its
response; this is a payload comparison, not an arbitrary edit prohibition.

The returned project, action, revision and sequence must match the captured
request. When accounts are involved, the confirmation stores the server's
resolved account identities with that request. Confirmation sends this
stored request; it never rebuilds a request with newer form values or newer
props. A changed revision/sequence hides the old confirmation, and a server
change unseen by the browser still reaches the existing backend conflict
check with the captured older values. The source does not add a new server
preview-token policy.

## Source/model relation

`ui_admin_mutation_identity` covers `Admin.tsx` saves/delists and the common
mutation lifetime used by enforcement, together with the new shared actor
utilities and the existing backend expected-actor admission. It has two
actors plus signed-out, two requests, two component lifetimes and three draft
representatives. Twelve scenarios distinguish preflight from captured
dispatch identity, accepted server work from UI success, exact stored-payload
cleanup, current/departed callbacks, known refusal, unavailable identity,
same-actor error retention and duplicate-start refusal. Disk failures and
draft serialization remain in the earlier editor/draft models.

`ui_admin_enforcement_intent` covers the enforcement fingerprint and frozen
confirmation payload. Two input representatives stand for the full request;
revisions and sequences independently range from one to two. Its ten
scenarios cover unchanged confirmation, edit during preview, exact input
reversion, mismatched response refusal, changed client revision/sequence,
changed server revision/sequence, resolved-account refusal and cancel/review
again. Actor and component lifetime are separate from this intent model.

The existing `ui_admin_review` retains the backend policy abstraction, and
`ui_admin_editor_lifetime` retains the stored-byte/draft comparison. Neither
alone represented the new identity or preview request composition. No model
claims the browser infers authority from a button, draft or wallet.

## Authored conformance and limits

`tests/e2e/admin-editor-lifetime.spec.ts` retains its two original late-save
and edit-during-save definitions. Four new definitions add:

- 401 and 403 save responses that remove the private parent and retain the
  submitted local draft;
- a held Quarantine preview while the input changes to Ban, refusal of the
  old preview, and a new confirmation whose body exactly matches the second
  preview request;
- a displayed preview invalidated by the adjacent delist flow's new project
  revision, without sending an enforcement request.

These are controlled Admin route and response definitions, not executed
browser evidence or a live GitHub/moderator test. The existing registry
enforcement suite continues to cover the real API policy when run separately.
Backend role/sequence rules, account lookup, actual append-only persistence,
browser scheduling, session-provider correctness and cross-document storage
semantics remain external refinement boundaries. No checks were run and no
absence-of-state-errors claim is made.
