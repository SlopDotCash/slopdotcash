# Notification attempt and escalation ownership

This source-only change follows the review at `929f07d06`. No tests, parsers,
formatters, type checks, simulations, verifiers, applications or browsers were
run. Every added scenario and regression below is unexecuted. Earlier receipts
for the unchanged parts of notification delivery do not validate these bytes.

## Confirmed source transitions

`retryWithoutProviderCall` formerly wrote `next_attempt_at` by delivery ID
alone before the guarded state completion. The security and activity drains
also wrote `destination_digest` by ID alone. A worker delayed across stale
claim retirement, independent non-acceptance reconciliation and a successor
attempt could therefore change that successor's timing or destination even
though its state completion was refused. The existing late-completion model
and test exercised the guarded state write only.

`recordDelivery` now changes state and optional retry timing together under
the existing `sending` and exact-attempt predicate. Its event append requires
that update to have changed a row. A repeated same-time completion cannot
append another event. `retryWithoutProviderCall` reports `superseded` on a
lost attempt rather than announcing exhaustion or triggering escalation for
a write it did not own. The attempt limit and exponential backoff are unchanged.

Both drains use `recordDeliveryDestination` with the same ownership predicate.
If it changes no row, that worker stops before contacting the provider. They
also call `ownsDeliveryAttempt` after asynchronous unsubscribe preparation.
A failure of that read follows the existing no-provider retry path; a known
lost claim stops. This is the last local observation, not a transaction with
Cloudflare Email. Retirement can still happen after it and before the actual
send. An already started send can also finish after retirement. Neither case
lets its late state completion overwrite a newer attempt, but no exactly-once
delivery or recall guarantee is made. Independent provider evidence is still
required to retry ambiguity. Existing consent and authority reads remain
preparation observations, not a claim that later withdrawal recalls mail.

`escalate` formerly checked only the acknowledgment in its captured delivery
row before awaiting backup access. The primary recipient could acknowledge
through the real case handler during that wait or the preceding send, yet a
backup notice was still inserted. The INSERT now rechecks the primary's
unacknowledged state and absence of an existing escalation in its transaction.
The marker update requires that INSERT to have changed a row. Acknowledgment
before this commit prevents a new backup; acknowledgment after it retains
the already committed history. Backup GitHub access is still an external
observation, not an atomic database fact or a new authority guarantee.

## Source and model correspondence

- `notification_attempt_ownership`: two consecutive retries from the existing
  five-attempt budget, starting with a digest from an earlier attempt, two
  destination identities, one retained local worker
  per attempt, destination write, final local check, provider start/completion,
  retirement, independently permitted retry, and stale metadata refusal. Its
  seven scenarios explicitly retain the last-check-to-provider gap.
- `notification_delivery`: the existing six scenarios retain the five-attempt
  bound, due/backoff classes and exact attempt/destination/evidence reconciliation.
  Its `oldCompletion` action means the guarded state completion, not all work
  a live old process could perform; the new attempt model covers that boundary.
- `notification_escalation`: ten scenarios, retaining its original seven names.
  Preparation and commit are now separate. Two new acknowledgment interleavings
  stop the INSERT. A later external access change does not erase the prior
  observation. The revoked-backup scenario now uses scheduled escalation from
  `bounced`, where backup access is the reason for refusal.
  The later source-only current-eligibility correction preserves these ten and
  adds six scenarios; see `notification-escalation-current-state-audit.md`.
- `api_email_consent`: seven scenarios with one token and three preference
  revisions. The revision is captured at Verify admission, matching
  `verifyEmail`, rather than when the email is requested. An intervening opt-out
  fences that pending Verify; pressing Verify again after the opt-out may grant
  the requested consent. Expiry after admitted verification retains the existing
  request-time comparison. The detailed `email_enrollment_delivery` model
  remains responsible for two request keys, transport and clock classes.
- `bot_notice_delivery`: clarified that one durable claim permits one private
  notify-service request. It never proved one physical email per claim.
- `notification_admin_fanout`: seven scenarios for that service request across
  two configured administrators, including partial acceptance, continuation
  after one failure, lost response and crash. Fulfilled binding calls establish
  only provider acceptance; thrown calls remain unknown. The parent records a
  non-202 or missing service response as ambiguous and does not blindly resend.

No model establishes arbitrary address grammar, cryptography, real provider
truth, D1 transaction implementation or JavaScript/SQL refinement.

## Authored regression definitions

`workers/notify/security.test.ts` adds three cases. One calls the actual
acknowledgment handler during the substituted provider call and requires no
later backup. Two use the existing migrated database and real claim generator
to retire the attempt before its destination write or final ownership read,
then require no provider invocation. Other initial deliveries are explicitly
suppressed to isolate the target; the escalation queue remains a separate state.

`backend/notifications/email.test.ts` adds the analogous two activity cases,
using the existing preference/event/dispatch fixture and a real essential
notification. The provider is never live.

`formal/tests/notification-delivery.test.ts` adds one migrated-SQLite workflow:
retire attempt one, reconcile non-acceptance, claim/complete attempt two, and
require old destination/retry writes to leave its metadata unchanged. It also
requires same-time duplicate completion to add no duplicate delivery event.
These are six authored cases, not six observed passes. Existing five-attempt,
quota, consent, enrollment, partial admin delivery and in-flight send tests
were preserved and were not run in this task.
