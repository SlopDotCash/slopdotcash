# Owner request recovery across component lifetimes

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

`ui_owner_recovery_lifetime.qnt` models two instances sharing one same-tab
storage slot, an original attempt (including a legacy form), one retry with a
fresh ID, a check per instance, pending/finalized-failure/finalized-success
outcomes, one wallet result per attempt, storage failures, and explicit user
clearing. Its thirteen named scenarios include the old A/new B deletion order,
live-instance ownership refusal, legacy A versus identified B, a departed
pending response, retained still-owned wallet evidence, ignored replaced or
cleared wallet tails, changed evidence in the same attempt, and failed
removal/hash-write/creation. The same-attempt evidence dimension has two
classes (hash absent/present), not arbitrary hash strings.

UUID uniqueness, exact transaction verification and React's unmount delivery
are assumptions at this boundary. The finite model does not prove browser
execution, arbitrary remount histories, cross-tab coordination, or old client
versions that do not write an attempt ID. A legacy record uses exact-value
comparison; new attempts break an otherwise identical-value retry. All thirteen
scenarios and the complete model are **unexecuted** for this revision.
