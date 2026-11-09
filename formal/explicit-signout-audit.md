# Successful explicit signout and private browser views

This review found an application-owned invalidation gap. The account header
deleted the shared session through `POST /api/v1/points/signout` and updated the
Points context, but separate private views could retain their existing actor
snapshot until focus, a new request, or navigation. A pending Inbox write also
suppressed the usual focus refresh. A delayed pre-signout response could then
complete in the same mounted view.

The correction publishes a same-tab session-change notification only after the
explicit signout request succeeds. Failed requests and ordinary null/error
session observations do not broadcast signout. Subscription callbacks retire
the private view's generation or wallet attempt immediately, before old promise
callbacks can publish. Accepted server writes are not undone.

## Source and model relation

`models/ui_explicit_signout.qnt` is a finite control projection with 15 named
scenarios. It bounds one successful signout, three hook requests, one independent
private action, one already-open wallet request, and one email-link action. The
actor observation is reduced to signed-in/signed-out/error. This is not a proof
of cookie delivery, authorization, React scheduling, browser transport, wallet
behavior, or every transition inside the mapped files.

| Source | Reviewed transition and corresponding model action |
| --- | --- |
| `src/Points.tsx` | `PointsNav.signout` emits after successful request completion: `beginSignout`, `confirmSignout`; rejected request: `refuseSignout`. Points membership cleanup keeps its existing behavior. |
| `src/lib/project-api.ts` | `notifyProjectSessionChanged` increments the tab epoch before notifying; `useProjectSession` captures it per read and rejects stale publication: `beginRead`, `readReply`, `confirmSignout`. Disable/enable retains the original hook boundary while the epoch prevents a pre-signout snapshot from reappearing: `disable`, `enable`. |
| `src/Inbox.tsx` | The subscription clears the recipient/private children and retires the generation even during `act`; it aborts the current list load. Aborted preflight/body reads cannot initiate their next phase. `privateReadAccepted`, `beginAction`, `acceptAction`, `actionReply`, `confirmSignout` separate accepted writes from visible completion. |
| `src/Earnings.tsx` | The subscription aborts the account read, clears private data/consent/picker, and increments `walletAttempt`. Existing per-step checks stop an old connection before register/challenge/sign or another chain. `requestWallet`, `walletReply`, `confirmSignout` project this ownership boundary; detailed family/claim transitions remain in `ui_earnings_wallet_lifetime`. |
| `src/OwnerAwards.tsx` | The subscription retires its generation and clears the owner view/drafts/status. Existing guarded calls refuse follow-up work. Recovery components are hidden on known signout without deleting their stored pending attempts: `privateReadAccepted`, `actionReply`, `confirmSignout`, invariant `marker`. Existing owner recovery models retain their financial and storage rules. |
| `src/InboxEmail.tsx` | Only the authenticated verify-link branch loses actor/attempt ownership; a delayed actor lookup or verify completion cannot bind, clear the token, or publish success. The unauthenticated unsubscribe capability keeps its independent flow: `openMail`, `beginMail`, `mailReply`, `confirmSignout`. |

The model's independent private action combines the shared completion-ownership
boundary; it does not equate Inbox notification writes, awards, and wallet
authorization business rules. `acceptAction` can occur after signout because a
request already dispatched with A's cookie/header can still be admitted for A.
It does not authorize a new request with B's later cookie. No new payment or
financial authority is derived from the notification.

## Authored conformance definitions

`tests/e2e/explicit-signout-lifetime.spec.ts` adds nine built-page browser cases
with synthetic HTTP authorities, the normal header signout control, and an
explicit wallet double. They cover a late Admin session response, a rejected
signout, idle and active-write Inbox teardown, a held standalone account read,
an already-open wallet connection, an owner-awards refresh, authenticated mail
verification, and unauthenticated opt-out. The tests assert retained accepted
writes and verification tokens where appropriate, and assert that late
completion cannot restore the private UI or start wallet registration.

These are source-authored definitions, not recorded browser results. They do
not exercise a live identity service, actual browser cookies, wallet keys,
on-chain transfers, email transport, or storage failures. The existing actual
handler/SQLite and wallet lifecycle suites remain complementary evidence.

## Explicit boundaries

- The notification is local to this JavaScript tab. Other-tab signout, remote
  revocation and silent cookie replacement still depend on existing focus,
  visibility, response identity, expected-actor and per-action checks.
- A disabled hook does not subscribe or fetch; its retained snapshot is hidden
  when its recorded epoch is old. Enabling without a session-change event keeps
  the existing hook behavior until its effect starts the next read.
- The model preserves a stored pending marker as a boolean witness. It does not
  model marker bytes, CAS, storage availability, or recovery success; the existing
  per-attempt models own those transitions.
- Public profile/history data is not private session state. It is not cleared.
  Private descendants of the affected hook, Inbox recipient, and Earnings data
  gates are removed by those parent gates, without extra subscriptions.
- No runtime checks, type/lint/format checks, browser runs, model parsing,
  simulation or verification were executed for this change, following the
  user's instruction to skip checks. The model and all nine new browser cases
  are unvalidated source at this handoff.
