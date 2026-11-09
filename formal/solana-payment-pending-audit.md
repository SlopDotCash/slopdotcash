# Solana direct-payment pending records

This source-only correction starts at
`e4ee8a3c79b035999d3da98f008f57c674c989d2`. The user directed the team to
skip checks and focus on source work and pushing preparation. No test,
browser, parser, type, lint, format, simulation or model-verification command
was run for this change. The traces below are source-confirmed interleavings,
not a claim of runtime reproduction or completed acceptance.

The applicable requirements are PRD section 8, "Pay a private award" (reuse
existing recovery and require finalized proof before paid), section 10's
payment/recovery boundary, and STATE-02 through STATE-04. The patch adds no
control, layout, financial permission, send, history store or signing policy.

## Source trace and correction

`src/SecurityBounty.tsx` selects `SolanaBountyPayment` under a case/generation/
message key. `src/SolanaBountyPayment.tsx` binds its session-storage key to
that case, generation, message ID and authenticated actor. `guard()` performs
fresh actor and authorization checks; the parent still checks the current
case generation and issued Solana plan. The selected wallet and payer must
still agree. None of those checks made a captured pending object current.

The original failure order is:

1. Instance A's `send()` reaches `beforeSend`, saves the transaction with
   `signature: null`, and waits for the wallet.
2. A departs. B mounts the same case/generation/message and actor slot and
   loads that pending record. B enters candidate C and clicks verify.
3. B's `check()` awaits `guard(true)` with its old pending object captured.
4. A's already-open wallet returns signature H and saves H to that slot.
5. B resumes and saves `{ ...pending, candidate: C }`. Its old null signature
   replaces H before verification of C, which may fail.

`check()` now captures `storedPending.current` before the awaited guard.
Immediately before writing it checks the mounted lifetime and calls the
existing `updatePendingRecord` helper with that exact acknowledged record.
If A saved H, B's comparison fails without writing or calling `verify(C)`.
A reload can then read H. If B's candidate write occurs first, A rereads the
still-owned record and merges H while preserving B's current candidate.
Editing the candidate field, including while an action is pending, keeps its
existing meaning: it is user-supplied verification evidence, not a replacement
for a wallet-returned signature or proof that a payment finalized.

New `beforeSend` records contain the existing optional `attemptId` field,
using `crypto.randomUUID()`. Creation uses `createPendingAttempt`, so it cannot
replace an occupied slot. The callback also checks `mounted.current` at the
last synchronous boundary: departure during preflight or adapter preparation
cannot create a marker or start a wallet prompt. This is separate from an
already-open prompt. A valid result from an open prompt can still update its
owned slot after departure, without updating the departed component's UI.
The wallet result refuses a cleared/replaced attempt or a different recorded
signature. It does not recreate a missing slot. A known wallet decline removes
only the exact original no-signature/no-candidate record through
`clearPendingAttempt`; it cannot remove newer candidate or signature evidence.

The wallet-result merge preserves current candidate fields by reading the
owned record before `updatePendingAttempt`. There is no await between this
read, ownership checks and write. These operations use the same logical slot;
no sidecar or additional history store is introduced.

## Failed persistence and legacy records

`storedPending.current` changes only after a successful storage load or write.
If the wallet returns H but storage throws, the live component keeps H in its
existing pending state and shows the existing submitted-signature storage
error. Its acknowledged snapshot stays at the actual earlier stored bytes.
A later verification can compare that earlier snapshot, persist H plus the
selected candidate when storage works again, and continue. It does not falsely
compare the unsaved H against storage and report a replacement. An actual
intervening write still refuses the stale comparison. A failed candidate write
keeps the stored record and does not call verification.

The storage-key version remains v1. Legacy records without `attemptId` are
accepted by `validPendingAttemptId` and keep exact-record comparison for
verification. New attempts use IDs to distinguish retries even if their other
fields happen to match. Existing malformed-record refusal remains; the patch
never discards unreadable storage to enable a send. Existing parsers for the
Solana wire transaction, signatures, current actor, generation and payer are
still the authority predicates for these operations.

## Models and unexecuted scenarios

`formal/models/ui_solana_payment_pending.qnt` is a bounded model of two
component instances sharing same-tab storage, with two actor/message slot
classes, one original wallet prompt, one replacement, one site-data clear and
one reload. It separates the rendered pending record, last acknowledged
stored snapshot, editable candidate and captured verification input. Signature
1 represents H; 2 and 3 represent other valid evidence, and 4 represents invalid
editor text. Draft -1 is unset, while explicit empty draft 0 suppresses a stored signature. Attempt 3 represents a legacy record. Empty records have zeroed
fields. A successful `finishCheck` means the existing `verify` callback was
admitted; it is not a finalized chain or paid state.

The nineteen named, **unexecuted** scenarios cover:

- H saved before stale C resumes: C cannot erase H or start verification.
- C saved before H returns: the owned H update preserves C.
- Reload after refusal reads H.
- H save failure retains local H and the actual acknowledged snapshot for retry.
- Candidate save failure starts no verification.
- Exact legacy-record verification remains available.
- Departure before `beforeSend` opens no prompt or marker; its rejected preflight can settle without writing.
- An occupied slot or failed creation opens no prompt.
- An open wallet tail may save to its still-owned departed slot.
- A cleared slot stays absent; a replacement stays intact.
- A decline cannot clear a newer candidate.
- A departed check writes nothing and starts no verification.
- Actor/plan refusal writes nothing and starts no verification.
- A separate actor/message slot is not changed by A's wallet result.
- Invalid editor text and an explicitly emptied input start no verification, even when a wallet signature is stored. Completed invocations clear their captured snapshots and prompt identity in the model.

`ui_bounty_payment_parent.qnt` separately now requires the original mounted
lifetime at `recordBeforePrompt`, for both the already-corrected EVM sender and
this Solana sender. It retains the reviewed State, `finishedPrompt`, factored
nondeterministic choices and existing finite bounds. The old departure witness
now opens the prompt before departure; new witnesses refuse EVM/Solana
preflight departure and retain an already-open Solana tail. These changed
parent scenarios are also **unexecuted**. Earlier parent results do not certify
this revision.

## Assumptions and remaining acceptance

The shared helpers compare and write synchronously within one browser task.
This assumes coherent same-tab `sessionStorage` visibility with no writer
interleaving inside that synchronous section. It is not a cross-tab CAS
protocol: cloned tabs have separate session-storage areas. The model's explicit
site-data clear and new-document replacement represent external changes, not
a new application reset control. UUID uniqueness, valid legacy parsing,
immutable message bytes, parent-key/lifetime delivery, provider callback order,
and exact API/chain verification remain external predicates. It does not prove
arbitrary remount sequences, incompatible older clients, multi-window races or
all malformed JSON/transaction encodings.

The existing `tests/e2e/bounty-solana-flow.spec.ts` remains a real-flow reference,
not evidence that these newly named interleavings have run. Required follow-up
is a real delayed wallet A/remount B/candidate C browser regression, both result
orders, failed H persistence and retry, the last-boundary departure case, and
normal signed-payment recovery on the final integrated source. No new browser
or chain result, full correctness claim, or production acceptance is asserted.
