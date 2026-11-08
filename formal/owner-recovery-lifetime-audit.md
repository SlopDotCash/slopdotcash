# Wallet request recovery across component lifetimes

This correction starts at `1fb9a74e0`. It is based on source inspection only.
The user directed the team to skip checks and focus on pushing. No test,
typecheck, build, formatter, browser, simulation, or formal verifier was run
for these source or model changes. No runtime reproduction is claimed.

## Source-confirmed failure order

`OwnerCommitment` and `OwnerReserveRelease` awaited a transaction check and
then removed their captured session-storage key without checking whether
their component instance remained mounted or that key still held the checked
request. Their parent keys cause a remount on selected award or manifest
change; ordinary navigation can also create another instance. Unmounting does
not cancel an already-started wallet-provider or HTTP promise.

The failing order needs no false user assertion:

1. Instance A checks a stored transaction and waits.
2. Navigation or parent replacement removes A. A new instance reads the same
   storage slot and checks that transaction independently.
3. The new check verifies a finalized failure, removes that attempt, and the
   user submits a retry B under the same logical project/period slot.
4. A's slower check returns and removes B's marker. A later reload no longer
   has the pending record that should block another send.

The same ownership problem applied to a delayed wallet hash: a result from A
could overwrite B after another instance resolved and replaced A's record.

## Correction

Both components now mark departed instances and ignore their verification
responses before any storage mutation or result presentation. New requests
have a fresh optional `attemptId`. Existing records remain readable without
it. The shared `pending-attempt.ts` helper compares a current attempt ID, or
the complete serialized legacy record when no ID exists, before a wallet-result
update. Verification-result updates and removals require the complete captured
record to match, including its ID and hash. Thus new evidence for the same
attempt cannot be overwritten or cleared by an older check. The comparison
and write have no intervening await in this tab.
Creating a new request requires an empty slot, so delayed preparation cannot
blindly overwrite a request created by another instance.

A wallet promise is different from a verification response: a returned hash
may still update its own stored attempt after unmount. If the slot was cleared
or replaced, the result cannot recreate it or overwrite the replacement. An
active view displays the returned identifier when that happens. A departed
view does not have a new presentation surface; the identifier must remain in
the wallet's activity. No sidecar history or unconditional retention claim was
added. This preserves the existing explicit user-reset boundary while making
loss of slot ownership explicit.

`OwnerCommitment` also retains its definitive wallet-decline cleanup after
departure. That tail may remove only its exact original no-hash record, so it
cannot remove a replacement request or newly recorded evidence. Ordinary
departed verification responses still make no storage changes.

Storage exceptions retain the unresolved in-memory request and report an
error or the returned identifier. A failed remove never clears local pending
state. The unreadable-record reset also compares its captured raw record
before removal. The reserve-release reset now uses its existing action-error
presentation if storage fails.

The patch does not change transaction construction, authorized amounts,
network identity, chain receipt/finality checks, or the backend's partial
payment semantics. `DirectBountyPayment` keeps its journal after verification;
the reviewed unconditional-delete path was not present there. Its separate
parent/keyed-child and multi-leg boundaries are not proved by this model.

## Model boundary

The initial `ui_owner_recovery_lifetime.qnt` models two instances sharing one same-tab
storage slot, an original attempt (including a legacy form), one retry with a
fresh ID, a check per instance, pending/finalized-failure/finalized-success
outcomes, one wallet result per attempt, storage failures, and explicit user
clearing. Saved-pending and live-wallet-tail initial states are separate.
The instance awaiting a wallet result cannot check, clear, or retry while
`useAction` is busy; a remounted instance can inspect the shared marker.
Its fourteen named scenarios include the old A/new B deletion order,
live-instance ownership refusal, legacy A versus identified B, a departed
pending response, retained still-owned wallet evidence, ignored replaced or
cleared wallet tails, changed evidence in the same attempt, and failed
removal/hash-write/creation. The same-attempt evidence dimension has two
classes (hash absent/present), not arbitrary hash strings.

UUID uniqueness, exact transaction verification and React's unmount delivery
are assumptions at this boundary. The finite model does not prove browser
execution, arbitrary remount histories, cross-tab coordination, or old client
versions that do not write an attempt ID. A legacy record uses exact-value
comparison; new attempts break an otherwise identical-value retry. All fourteen
scenarios and the complete model are **unexecuted** for this revision.

A source-only model correction separates the live wallet prompt from an
ordinary restored pending record. Tail scenarios use the departed first
instance and a second instance; the same-attempt evidence-change scenario
checks in the second instance while the first wallet promise returns. This
does not change runtime code or add execution evidence.

## Follow-up from `6f5aee920`

The same source-confirmed ordering remained in `VaultActions.tsx` and
`AutomaticMonthlyPayment.tsx`. Both removed their shared logical slot after
an awaited check, wrote returned hashes without attempt ownership, and could
deliver a departed component's `onFinalized` callback. A newer mounted view
could verify the old transaction first, advance from approval to deposit or
retry a failed transaction, and record its new request before the old callback
removed that request. The existing keys bind network/vault (and the asset for
deposit/withdrawal); they intentionally span successive requests, so the key
alone cannot distinguish those attempts.

Those two components now reuse the optional attempt ID, empty-slot creation,
exact-record completion update/removal, still-owned wallet-result update, and
departed-verification guard. Legacy records and the distinction between fixed
wallet-returned identifiers and editable recovery candidates are preserved.
Token approval still reports approval only; only a finalized deposit or
withdrawal calls its transfer-completion callback. A finalized monthly setting
calls its setting callback, without claiming a payment. Wallet-decline tails
can remove only their own exact original marker. Layout and styles are unchanged.

The owner-flow audit also identified a storage-failure mismatch introduced by
using the in-memory request as the removal snapshot. If the wallet returns H
but saving H fails, the component retains H in memory while the stored record
still has no hash. A later exact successful check of H then failed the local
record comparison, even though nobody replaced the attempt. All four callers
now retain the last successfully stored record separately. A check captures
that record before its await; successful verification may clear it only if
that exact stored value is still present. New evidence or a different attempt
written during the wait still causes refusal. A failed write does not advance
the stored snapshot, and a failed removal does not clear the local request.

The shared model now has five action kinds: owner commitment, reserve release,
vault approval, vault transfer, and monthly setting. It keeps the existing
per-instance wallet-busy rule and separates in-memory hash evidence from each
instance's last successful stored snapshot. Five further scenarios cover
verification after a failed hash write, approval without transfer, completed
transfer, a departed approval check after a retry, and a setting completion
without payment. A separate preflight state also models navigation during the
earlier asynchronous review: each `beforeSend` now checks the mounted lifetime
before creating a record or requesting the wallet. This does not block a hash
from an already-open wallet promise from updating its still-owned record.
Departed-preflight refusal and cleanup have separate scenarios.

Every expected refusal is terminal in its named scenario. The previous busy
scenario chained `.fail()` and then read state; that structure is removed,
with check, clear and preparation refusals split into independent scenarios.
Its **23 named scenarios and all changed source are
unvalidated**. No tests, syntax/type/lint/format checks, models or browser runs
were executed for this follow-up.

These are still same-tab control-flow models. Exact EVM/Solana transaction
matching and finality remain in the unchanged adapters. Explicit clearing or
replacement ends ownership of a slot; a later wallet result cannot recreate
it, and no additional history storage is introduced. Old client versions,
separate tabs, malicious storage mutation, and unbounded retries remain outside
this finite source-level argument.
