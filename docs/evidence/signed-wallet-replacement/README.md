# Signed wallet replacement

PRD sections 6 and 11. The repository owner directly approved both policies
in the 27 October 2026 review: keep the verified wallet active until a
replacement signs, and use email plus the existing signed recovery flow
without the unused operator proposal endpoint. The [#1467 comment](https://github.com/SlopDotCash/slopdotcash/issues/1467#issuecomment-6437990392)
is the recorded summary, not the sole approval source.

A registered replacement used to displace the authorized payout wallet before
its signature. A rejected signature therefore made the account show the new
unconfirmed wallet and paused the old destination. The same claim selection
blocked dispatch and pending binding recovery.

The derived `effective_payment_wallet_claims` view now keeps the last authorized
wallet active through unsigned successors. A valid authorization switches it;
first registration remains unconfirmed until signed. Registration and challenge
issuance still use the raw claim leaf. The existing immutable lineage, signature,
replay, uncertain-attempt, cancellation and funded-award controls remain.

Apply migration `0100_effective_payment_wallets.sql` before deploying the readers.
No historical rows are rewritten. The unused admin proposal endpoint is removed;
recovery remains email to the operator followed by the existing signed flow.

## Browser evidence

- [Before: rejected signature pauses the old destination](https://github.com/SlopDotCash/slopdotcash/releases/download/pr-evidence-1522-3fc60aa8/before.webm).
- [After: rejected signature preserves the verified wallet, desktop](https://github.com/SlopDotCash/slopdotcash/releases/download/pr-evidence-1522-3fc60aa8/after-desktop.webm).
- [After: mobile and tablet reflow](https://github.com/SlopDotCash/slopdotcash/releases/download/pr-evidence-1522-3fc60aa8/after-mobile.webm).
- [Capture provenance and SHA-256 hashes](https://github.com/SlopDotCash/slopdotcash/releases/download/pr-evidence-1522-3fc60aa8/provenance.json).

These recordings use the actual local Account page with synthetic wallet-provider
and API fixtures; addresses are repeated-digit test values. No real wallet,
session, signature, provider, chain submission or production action appears.
The before recording uses source `bb953334c6e1f2c938b2e41364fe7cf778717a63` and its
matching response fixture. The after recordings use source
`3fc60aa80158d6075f18626db69adbbdee67b519` and the preserved active-wallet
response. All three recordings have passing Playwright assertions; the backend transition
is independently exercised through actual API handlers, SQLite migrations and
cryptographic test-wallet signatures in `wallet-replacement.test.ts`.
The evidence is a non-latest prerelease tied to the reviewed source; it is not
a production release or activation.

The local build input is a retained production leaderboard snapshot prepared by
`prepare-pr-ledger.ts`. It is not fresh live source completeness or publication
acceptance. No deployment is claimed.

Provenance: OpenAI gpt-6.1-sol, Codex desktop subscription, self-reported;
exactVariant null, speed tier unverified. No paid model call.

## Validation

- Independent review reproduced three failed API regressions on the exact
  parent source and passed 23 API, migration, rotation and notification tests
  (168 assertions) on `3fc60aa8`. The new desktop/mobile recordings passed
  both targeted cases with zero unexpected browser diagnostics. Cleanup of
  the video files and approval provenance changes no executable source.
- Failed-before API proof: registering a replacement made `/payments/me` return
  the unconfirmed replacement, and the unused operator endpoint returned 201.
- Four API/cryptographic/dispatch/retirement regressions pass, including wrong,
  stale, expired and replayed authorization; skipped unsigned descendants;
  first registration; retained signed attempts; and removal of the dead endpoint.
- The full wallet-picker browser file passes on desktop and mobile: 38 passed,
  four intentional viewport skips. Screenshots were inspected at both widths.
- Local Base/Robinhood payment integration, recovery, reconciliation, registry,
  binding-trigger and all security-payment qualification modes pass. These use
  disposable local chains and synthetic test keys, not live signing.
- Existing lineage constraints enforce one root per actor/chain, one successor,
  immutable rows and the same actor/chain on every predecessor link (migration
  0021). The derived selection does not order by timestamps or guess among roots.

The retained binding-trigger regression proves an unsigned replacement does not
cancel an existing signed binding: the same signed bytes remain retryable. After
the replacement signs, the prior cancellation fee cap and finalized-original
winner reconciliation still apply. The notification regression likewise keeps
its held notice for an uncertain old attempt after a signed replacement, rather
than manufacturing a hold merely from unsigned registration.

The scoring protocol's subscription sentence is reconciled with the already
approved PRD. It changes no grade, import or publication.
