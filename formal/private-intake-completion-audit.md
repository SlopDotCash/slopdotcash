# Private report receipt and browser completion

Source-only correction based on the aligned `3d5104b00` branch. This changes
`src/PrivateReportForm.tsx`, refines `ui_private_intake.qnt`, and adds eight browser
regression definitions in the existing `security-bounty.spec.ts` workflow.
The model has 21 named scenarios. All new scenarios and browser definitions
are **unexecuted**. No parser, test, browser, application or prover was run.

## Confirmed source path

The form checked `currentProjectSession` before the POST, and its body included
`expectedReporterGithubId`. The backend `acceptStoredReport` authenticated the
request and bound its reporter to that expected actor. A later cookie change
could not change the actor of a request already dispatched.

The response still had a separate browser lifetime. After a successful POST,
the old form checked only its DOM ref and route, deleted its storage key, and
navigated to the returned Inbox receipt. If actor A's accepted response was held
while the cookie changed to B without a focus/session observation, the old form
was still mounted and navigated B. The Inbox backend continued to enforce B's
access; this was an old browser completion acting after a silent identity
change, not a demonstrated backend private-report disclosure.

The old `ui_private_intake.actorChanged` action immediately cleared the form.
It could not express cookie change before the parent's next observation, or a
server-accepted report followed by failed browser session verification.

## Corrected source behavior

- The request retains its original report/key and binds the expected actor in
  both the existing body field and the shared expected-actor header.
- A usable receipt ID, using the existing submission-ID contract in the backend
  and Security Inbox route, is required before the form declares acceptance.
  Malformed success bodies keep the original idempotent payload for recovery.
- A received valid receipt is recorded separately from the next session read.
  The private composer is hidden immediately; a failed or mismatched session
  read never turns this known acceptance into “Report not confirmed.”
- Only the current request, still mounted on the same route, may navigate after
  a matching fresh session observation. A mismatch or unknown session stays on
  the form with receipt status and an explicit session-only recovery button.
  That button cannot submit another report.
- Before acceptance, a failure receives a fresh identity check. Unknown identity
  hides the private body and submission controls while retaining the exact
  original payload/key. A session-only retry restores the review for the same
  actor without automatically POSTing. Confirmed identity loss empties the old
  in-memory draft and removes only its captured unchanged storage record.
- Exact captured storage bytes govern every completion removal. Replacement
  records survive. If an attempted write fails, a readable prior record is
  captured only when it equals this same draft. Unreadable/unowned storage is
  never cleared speculatively. After closing a draft, the persistence effect
  does not recreate an empty old record over a replacement.
- A validation refusal rotates the in-memory draft key, but its storage write
  also requires the exact captured record. Lost ownership retains the rotated
  draft in memory with a storage warning. Its passive effect cannot bypass that
  comparison. An explicit new user edit can persist again normally.
- Layout lifetime and operation ownership gate late responses, errors and the
  final busy-state change. A departed response cannot clear a remounted form's
  draft, change its busy state or navigate it.

Existing parent session observations still remount the actor-keyed form and
clear tab drafts under `usePrivateDraftSession`. The correction does not turn
arbitrary failures into a global sign-out event. It adds no new report, award,
screening, notification or on-chain authority.

## Model relation and bounds

`ui_private_intake` now separates browser cookie, parent/form identity, dispatch
cookie, backend admission, valid receipt delivery, session-response capture,
response delivery and browser navigation. The model has two form lifetimes,
two request lifetimes, two actor identities plus signed-out, two report/key
classes and five storage classes (absent, original, attempted, replacement,
owned corrected draft).
An accepted mutation stays recorded even if the browser never receives it.
The shared Inbox handler's exact access checks and screening/database lifecycle
remain in their backend models; this projection does not re-prove them.

Named scenarios include unchanged-payload retry after a lost response, malformed
receipt refusal, dispatch actor mismatch, acceptance followed by silent actor
change, known receipt plus unavailable session, receipt-only retry without a
second POST, exact-storage replacement, departed response/postflight/finally,
validation refusal, failed-write recovery, unknown-identity hiding, and a
same-actor session-only restoration of the original review.

`PrivateReportSummary.tsx` is no longer attributed to this model: its screening,
forwarding and action projection is a separate state family. The remaining
source links cover the form, its parent's observed identity/remount, tab draft
clearing and the request admission/receipt facts on which this UI depends.

## Authored implementation evidence

The eight new `@registry @private-intake` browser definitions use existing real
project creation, private-report POST/replay and Inbox read handlers against the
local migrated database. They intercept delivery timing, deliberately lose/
damage an accepted response, or hold a real validation refusal:

1. Hold A's accepted POST, switch the cookie to B without a focus event, replace
   the old storage slot, and release. Expect no navigation, no private preview,
   preserved replacement bytes, B's real receipt read refused, then A's explicit
   receipt retry opens the existing receipt with one POST total.
2. Fail the session read after a known receipt, then restore it. Expect receipt
   status throughout and one POST total.
3. Hold the postflight session read, leave through the real SPA link, restore a
   newer form/draft, then deliver the old read. Expect no clear or navigation.
4. Accept the POST but lose its response while identity changes. Expect private
   text removed while the original actor's durable receipt still exists.
5. Lose an accepted response and fail identity recheck. Expect hidden private
   body with exact draft/key retained; session-only recovery restores review
   without a POST, and a later explicit retry returns the same backend receipt.
6. Return an incomplete success body after actual acceptance. Expect uncertain
   retry of identical bytes/key and a valid replay receipt, never undefined
   receipt navigation.
7. Submit an invalid CVSS vector through the form, hold its real 400 response,
   then deliver it. Expect an owned rotated draft and an explicit user correction
   followed by successful submission with the new key.
8. Repeat the real 400 flow after replacing the same storage slot. Expect exact
   replacement bytes retained, a memory-only warning, then normal persistence
   only after the user's explicit edit and successful new-key submission.

These are definitions, not passing evidence. Real desktop/mobile execution,
keyboard/accessibility review and UI video remain pending under the user's
skip-checks instruction. Cookie/session observations are not instantaneous
revocation: a cookie can change again after a successful observation. Storage
exceptions can prevent cleanup; retaining data in unreadable storage is not
reported as successful removal. No new cross-tab storage/locking claim is made.
