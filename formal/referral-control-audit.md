# Referral control and historical maximum

This review found omitted application-owned transitions behind the existing
`referral_distribution` abstraction: owner/poster handoff, post spacing, pause
and unpause, and the 365-day rescue clock. The program remains inactive unless
separately approved; no token, signer, network setting or deployment changed.

`referral_control_plane.qnt` adds three role identities, two representative
posts, four balance units and six clock positions. It covers owner-only
changes, two-step ownership and cancellation, separation from the poster,
pause, immediate post/claim availability, and rescue refusal/success. Rescue
delay three represents the contract's immutable relative duration. Post
spacing is modeled in the separate history model, not coupled to this clock.
A void does not erase the last posted root's rescue clock; unpause
restarts it. The model does not prove token behavior or Merkle proofs. A failed
transfer is represented by an unchanged transaction. The previous-root stack
is separately modeled by `referral_root_history`, not flattened into a claim
that every void leaves no root.

`referral_root_history.qnt` covers five immutable epochs, totals 1–5, cap 2,
clock 1–7, and a one-tick spacing requirement. The first root is fixed at the
full cap of 2 and time 1; later roots retain all five total representatives.
This is an explicit starting-amount bound, not proof for every first amount.
It distinguishes the most recent
non-voided post time from the greatest non-voided total. Posting appends its
prior maximum. Voiding the latest unclaimed epoch restores that maximum and
finds the previous live timestamp; successive append/void cycles preserve
both. Claim sealing and strict spacing have refusal scenarios. Funding,
claimed amounts, role checks and transfer accounting remain with the existing
distribution model and actual contract tests.

## Confirmed contract discrepancy

The original `previousLiveMarks` returned the total from the most recent
non-voided epoch. That value is not necessarily the historical maximum used
by `postRoot`. Actual Foundry execution reproduced totals 100, 90, 95 followed
by voiding 95: `highWaterTotal` incorrectly became 90 although the 100 epoch
was still non-voided. A later total of 200 with `epochCap=100` was therefore
refused. This reduced the permitted growth unexpectedly; it was not a token
theft or automatic activation finding.

The correction stores each append's prior maximum in a private mapping and
restores it on void. It preserves the public epoch tuple and ABI. A new mapping
entry adds storage cost per post; rollback of the maximum is constant-time.
The existing backward scan still finds the latest non-voided timestamp, with
the same history-dependent worst case as before. No new scan across all totals
was introduced. This non-upgradeable contract requires a separately reviewed
deployment to use revised bytecode; this patch does not alter any deployed
contract. The old and new compiled ABIs were compared and matched.

The native gas-report fixture measured the first post at 153,574 gas before
and 155,964 after. Its multi-post spacing scenario's largest post grew from
170,663 to 192,953 gas; void grew from 57,529 to 59,565. These are measurements
of the named fixture paths, not universal gas limits. The extra nonzero
snapshot write trades bounded per-post storage/gas for constant-time maximum
rollback. The already-existing backward timestamp lookup is unchanged.

The subsystem guide incorrectly described a seven-day pending claim window
and pause freezing that window. It now describes the current immediate-claim
contract, void-before-first-claim guard, and separate rescue delay. No policy
duration or source behavior changed for this documentation correction.

## Evidence and limits

The original focused Foundry regression fails at the incorrect maximum.
The corrected regression verifies that an older higher total survives lower
epochs, then checks multiple append/void cycles and the distinct latest-live
timestamp. The existing R6/R7/R8/R9/R16 tests supply actual contract conformance
for post spacing, role changes, pause, rescue timing and restoration of marks.
All 22 referral contract tests pass after the change. Native EVM test execution
uses the repository's pinned Solidity 0.8.30 compiler; no live chain is used.
Before/after logs, ABI snapshots and gas reports remain in ignored
`evidence/formal/referral-control/`.

The first full-history verification attempt reached the 180-second limit
with 2,712,618 distinct states and 1,178,682 still queued. Its model and receipt
are retained separately and are not counted as passing evidence. The bounded
first-root form above removes the initial clock-origin duplication and narrows
the first amount while preserving the decreasing-total and repeated-void
counterexample families. One earlier concurrent verifier attempt was discarded
because the isolated source was briefly swapped for the before/after gas
comparison. Only subsequent frozen-source receipts qualify this change.

Final frozen verification passed: the role/rescue model explored 26,028
distinct states (depth 18), and root history explored 1,557,550 distinct states
(depth 17), both with empty queues and unchanged source/model hashes. The
history verifier stage took 105.5 seconds including translation. All 13 named
scenarios and the repository's 500 seeded 60-step simulations also pass.
These are finite model results, not a proof that arbitrary epoch histories or
external token implementations refine the models.
