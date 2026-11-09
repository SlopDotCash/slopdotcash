# Vetting evidence client ownership

This source-only follow-up adds two focused client models and refines the
existing backend grant-admission model. No parser, test,
simulation, verifier, application, browser or service was run. Model scenarios
remain unexecuted. The root lane owns runtime and regression source changes.
This audit was reconciled by reading that lane's stable `VettingEvidence.tsx`
changes; it does not claim that those changes were executed.

## Source findings

The old inventory state stored only the returned overview. `useProjectSession`
does enter `checking` on focus, visibility and restored history, and the page
hides private content during that state. It is therefore incorrect to claim
that an ordinary focus refresh never reruns its inventory effect. However,
the previous overview survived checking. A subsequent signed-in actor could
render that old overview before the effect cleared it. The effect depended
on the status, not the actor ID, and the request carried no expected actor
and had no fresh response-time actor check. App mounted the same page without
an actor key. This is a source-visible ownership gap, not an observed paint.

The old `EvidenceItem` also retained a running async callback after a selected
object, page or session transition unmounted it. A returned streamed grant
could click a download anchor after departure. Buffered bytes could complete
hashing and start a blob download after departure. React ignoring a departed
text state setter did not cancel those browser side effects. The backend's
operator checks and actor/object-bound single-use grants remained intact.
However, `operator()` did not consume the optional expected-actor header.
If A requested a grant while the current authenticated session was a different
designated operator B, the grant could be issued and audited to B. This was
an unintended cross-account action even though B independently had operator
authority; it did not allow a nonoperator to gain a grant or let B consume a
grant already bound to A.

## Source correction and model boundary

`ui_vetting_inventory` covers two observed actors, two lookup identities and
two inventory requests. Its 11 named scenarios remain unexecuted. The saved
overview has an actor and lookup identity; rendering requires both to match.
An inventory HTTP response is separate from
the fresh session confirmation before publication. Checking hides prior
data; a changed or signed-out actor cannot receive its earlier request's
result. A thrown inventory session check leaves a local error, with the
inventory already absent; it does not automatically refresh and repeat the
request. Retry can start another request. A returned actor mismatch or a
current reader's identity-loss callback clears the saved inventory and
increments the session hook revision. The model represents that revision
change as the hook's immediately visible `checking` state. A departed or
superseded inventory request cannot refresh a new view.

`ui_vetting_reader` covers text, buffered binary and native streamed modes,
two reader lifetimes/objects/actors and two request identities. Its 21 named
scenarios remain unexecuted. It separates fresh checks before grant,
body/native request and final text/blob publication.
The browser controller records abort on replacement or departure. Grant
issuance and consumption may outlive a client cancellation, but they do
not authorize a departed callback to display or click. A native anchor click
means only that a download was requested, not that private bytes were delivered.
The backend still decides whether the session can consume that exact grant.
The buffered body request now carries the expected actor as well as its grant.
The reader's failure wrapper discards departed attempts first. An authoritative
401/403/404/410 refusal invalidates the parent inventory; other failures run
another fresh actor check before the error can be retained. A failed or
mismatched session observation also invalidates the parent, once for that
attempt. These are source-read statements, not executed failure evidence.
The reader model represents this with an explicit `failure-check` phase.
Grant/body/hash failure can enter that phase without retaining an error yet.
A matching fresh session may retain the error; a different or unavailable
session removes the reader through parent invalidation. A departed or
superseded attempt cannot invalidate the newer parent. `authorityRefusal`
instead invalidates an owned grant/body request immediately, even when the
current session actor still matches. Neither refusal path can later publish
success. The shared hook's independent rendering schedule remains outside
this model.

`vetting_evidence_access` now models `requireActor` admission before grant
issuance. A missing session refuses first. A malformed expected-actor header
then refuses with `invalid_expected_actor`; a valid different actor refuses
with `actor_changed`. An absent header remains supported, and a matching
header does not grant operator authority: the designated-operator allowlist
must still accept the authenticated actor. The three existing read/expiry/
spent-grant scenario names remain, with admitted setup. Six new authored
scenarios cover matching, mismatch, absent, invalid, nonoperator and anonymous
requests, for nine unexecuted scenarios in this model.

This admission model has two authenticated actor identities, one absent
session, four expected-header classes, one grant/object and two clock ticks.
It abstracts header parsing to valid/invalid classes and operator membership
to the source allowlist predicate. It does not model an allowlist change
during an already admitted request or prove the separate read-time operator
check, which remains required by the handler.

Byte-length and digest predicates stand for the existing exact-byte checks.
UTF-8 decoding, streamed backend verification, expiry, grant cryptography,
HTTP failure production and browser download delivery are not proved by
these client models. `vetting_evidence_access`, `vetting_download_stream` and
`vetting_stream_authority` remain separate backend models. Cookie changes are
distinct from the hook observing a new session: previously displayed text is
not claimed to disappear at the instant an unobserved cookie changes. Reader
invalidation is a macro that includes the parent's state update and resulting
reader removal; no grace period for publishing private data is introduced.
The shared `useAction` hook's busy/error continuation ordering is also outside
the reader's ownership invariant: the source does not give that hook an
attempt token. The model's error flag records a reader refusal, not a proof
that a stale generic hook callback cannot update an error or busy indicator.

## Existing conformance references

`tests/e2e/admin-evidence-layout.spec.ts` includes **evidence deep links load
only after sign-in and select one reasoned reader**: ordinary lookup, grant,
digest mismatch, exact text and selection are checked with controlled HTTP.
`tests/e2e/registry.spec.ts` includes **a designated operator inspects retained
vetting bytes with reasoned access** against the local registry workflow.
`tests/e2e/evidence-download.spec.ts` includes **large private evidence
downloads with a single-use browser grant**, with downloaded length/digest
assertions. These source references do not establish a run of the new actor,
superseded-response or departed-download paths. No prior result is promoted
to exact-source acceptance of this correction.

The root lane also added source for holding an actual Pages/D1/R2
`download-grant` response, navigating away through the SPA Home link, and
requiring that no download starts after release. The same browser workflow
then returns for its existing exact-byte download. That new scenario was
read only and remains unexecuted here. An inventory actor-swap regression
requires separate source and execution evidence; no result is claimed here.

## Action correspondence

- Inventory `start`/`response`/`confirm` project the inventory request and
  following `currentProjectSession` call. `owns` projects the effect's active
  flag together with its captured actor and lookup dependencies. `visible`
  projects the `loaded.actorId` and `loaded.lookupKey` render predicate.
- `sessionChecking`/`sessionObserved` project the existing session hook,
  including focus, visible-tab and restored-history refresh. Those events
  are distinct from changing the session cookie.
- Reader `start` captures the actor, object and attempt and replaces the
  previous body controller. `checkGrant`, `checkUse` and `publish` project
  the fresh actor checks before grant, body/native download and final
  text/blob publication. These actions include the immediately following
  synchronous side effect; arbitrary JavaScript scheduling is not proved.
- Reader `grantReply` can retain a server-issued grant after the view has
  departed. `consume` is the separately authorized server event; its Boolean
  authority predicate includes operator status, expiry and exact token
  binding. `bodyReply` and `hashReply` project length and digest checks.
- Reader `failureCheck` projects the catch-path `requireActor` call before
  preserving a generic error. `authorityRefusal` projects the separate
  401/403/404/410 branch that invalidates without that extra request. Both
  retain the attempt-ownership guard before notifying the parent.
- `depart`/`remount` project component cleanup and the actor-plus-object key.
  They abort the browser controller and remove display ownership, without
  reversing any immutable server grant-consumption fact.

Request IDs are unique and used once within each model run. Two IDs permit
one old/new response interleaving and one retry; they do not establish an
unbounded number of requests. The two reader epochs model one replacement.
These models have safety predicates only, with no eventual-network-success
or download-completion claim.


## Authored browser regression orders

The existing presentation workflow now holds an operator inventory response,
changes the session-response actor without a focus/navigation event, and
requires the old inventory to remain absent when the next actor is denied.
This uses explicit response doubles; it is not real operator authorization.
The same presentation workflow also holds a grant response, changes the
session actor, returns an authoritative refusal and requires the old reader
and inventory to be removed.
The actual Pages/D1/R2 large-evidence workflow now holds a real download grant,
leaves through the SPA Home link, and requires no abandoned download after
release before returning to complete the original byte-verified download.
These definitions remain unexecuted here. Exact-source browser, accessibility,
console/network and walkthrough evidence still remain to be collected.

The actual handler/SQLite test **private retained bytes remain inspectable
without granting clean clearance** in `scripts/vetting-api.test.ts` was also
extended. Its authored checks cover expected-actor mismatch for inventory,
ordinary grant and download grant without new grant/audit rows, malformed
header rejection, and matching/absent-header positive requests. That test
source was read, but it was not executed in this lane.
