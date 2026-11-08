# Security delivery and direct-Solana retirement refinements

This pass compared actions and guards with the implementation at `1d8913ca4`,
not only the lexical state catalog. The existing models remain partial:
`api_mail_delivery` had no delivered/bounced/suppressed reconciliation from an
ambiguous send, no negative receipt after provider acceptance, and no retained
attempt/destination/evidence identity. `api_award_recovery` treats retirement
as a supplied boolean. Those abstractions do not establish the newly modeled
properties below. No production implementation was changed in this pass.

## Notification delivery

`notification_delivery.qnt` models one outbox through its actual five-attempt
limit. It separates provider acceptance from delivery; includes stale sending
claims becoming ambiguous, definite non-send retry and backoff, and both
accepted and ambiguous reconciliation. A held receipt read can interleave with
another receipt or a later attempt. Commit requires the captured state,
attempt, destination digest and a previously unused evidence ID. A late worker's
state completion cannot overwrite a row that no longer belongs to its sending
attempt. This claim did not cover its separate preparation metadata writes;
the later source-only correction and full boundary are recorded in
`notification-attempt-ownership-audit.md`. This historical validation does not
cover that correction.

The two destination and evidence identities are representatives. Time is an
explicit due/not-due event, not a proof of elapsed seconds or provider timing.
The model describes the outbox commit protocol. It does not assume that an
email can be recalled after provider acceptance or that consent changes cancel
an in-flight request. The implementation resolves recipient and consent during
preparation; external provider truth remains an input.

`notification_escalation.qnt` distinguishes an action notice from an
informational report receipt. Reading is separate from acknowledgment. An
informational receipt cannot escalate merely because it remains unacknowledged,
but delivery failure can still escalate it. Local suppression sends nothing
and does not escalate; independently evidenced provider suppression is failure.
An immediate ambiguous/exhausted send and a scheduled overdue/failure scan
have separate guards. One authorized backup can receive one durable notice;
later authority revocation does not erase existing history. Configuration
validation, address privacy and the full set of notice-producing event kinds
are outside this model. Migration links cover these queue/receipt semantics,
not all populated-upgrade behavior of their schema rebuilds.

Existing real-handler/SQLite tests in `workers/notify/security.test.ts` and
`backend/notifications/email.test.ts` cover generic mail, acknowledgment,
informational receipts, role loss, backup eligibility, suppression, bounded
retry, stale/duplicate provider evidence and pre-pilot history. The new
`formal/tests/notification-delivery.test.ts` uses the actual migrated database,
claim generator, delivery recorder and reconciler for previously unmodeled
multi-step paths. It covers accepted-to-negative-receipt retry, a later
ambiguous-to-delivered result, stale attempt/destination refusal, concurrent
duplicate evidence, a stale worker, and transaction rollback when the evidence
append fails. Mail transport is not invoked by this focused test.

## Direct-Solana retirement

`direct_solana_retirement.qnt` covers two retained messages and two provider
observations compressed into one aggregate observation per message. The
model starts after retained-message size/shape/count/uniqueness and payer
validation. Its signature transition means a successful exact-message
Ed25519 check; malformed base64/base58, duplicate or foreign message IDs,
noncanonical payers and invalid signatures are not modeled. The linked
implementation test exercises wrong-message signature refusal; other byte
checks remain in existing implementation tests. The trusted-pair input represents distinct recognized operators,
matching genesis and valid retained block anchors. Every message must expire
before a raw-sign challenge is available. Every message needs its exact payer
signature before history evaluation. A found transaction prevents retirement;
malformed observations refuse even if another message was found. Matching
finalized failed receipts can retire a message without an absence scan.
Otherwise retained absence coverage must complete and agree for both providers.
One incomplete or conflicting message leaves history unresolved.

Two retained pages represent progress on both provider histories; completion
also requires matching history digests. The implementation processes up to
32 blocks per provider per invocation. An invalid RPC observation can return
early and override a previously observed payment; the model's malformed result
has this precedence. The model does not prove RPC honesty,
cryptographic security, arbitrary history length, or the database scan journal's
compare-and-swap refinement. The successor schema checks in migrations 0112 and
0113 remain with the existing payment models and tests; they are not newly
claimed by this retirement admission model.

`formal/tests/direct-solana-retirement.test.ts` calls the actual verifier with
two complete unsigned legacy messages and real Ed25519 signatures. Only RPC
observations are controlled through loopback HTTP. It checks one live message
blocks every challenge, each expired message needs a signature, a signature
for another message is refused, matching failed receipts retire, disagreement
holds, and an observed payment takes precedence over a different message's
unresolved failure agreement. This is verifier conformance, not live-chain
truth. The existing `backend/security/direct-solana-api.integration.ts`
separately exercises actual disposable-chain transfers, API authorization,
expiry, retained absence/failure proof, immutable successor creation and paid
reconciliation through SQLite.

## Remaining explicit boundaries

The root agent owns the dedicated `SolanaBountyRecovery` UI refinement. That
component signs expired messages and caches signatures after signing; it is
not a payment sender and must not inherit the generic transaction model's
persist-before-send or paid transition. The private report's combined Slop
screening/GitHub-forwarding projection, intake handoff freshness, enrollment
mail's queued/sending/sent/unknown transport, and full populated migration
lineage remain separate identified work. A source link or passing sample does
not establish complete implementation refinement.

## Validation

Nineteen named Quint scenarios and 1,000 sampled traces of 30 steps per model
pass. The notification/database run passed 38 tests with 324 assertions; the
final two-message retirement verifier test passed 12 assertions. Typecheck and
changed-test formatting pass. Full finite verification remains a separate root
gate, not implied by these simulations.

The existing native direct-Solana API workflow passed all three scenarios:
SOL full award, SOL 75/25 with a finalized failed original, and SPL 75/25. It
used the pinned container and unchanged assertions in an ignored copy of the
workflow, with absolute imports and a 15-second cleanup wait instead of five
seconds so the contained launcher can complete verified cleanup. A transparent
response observer retained synthetic `signature-required` and `history-check`
case responses for the UI conformance lane. The process exited zero and the
container receipt says stopped. This verifies the exercised real API/SQLite/
local-chain paths; it is not a production-provider or deployment claim. Logs,
source hashes and captures remain under ignored `evidence/formal/security-composition/`.
