# Additive review budget v1

A project may publish a second, named monthly cash line for accepted review
work. This line is additive by construction: review events remain in the shared
contributor pool exactly as they are scored today, and a review budget pays on
top of that unchanged treatment. It never replaces, relabels, or reduces the
advertised contributor pool.

## Activation

An absent `reward.reviewBudget` preserves current behavior byte for byte. A
pledged, disabled, or underfunded review line is public context only and changes
nothing. Allocation becomes operative only after a positive review amount has
its own active, reviewed funding commitment and the manifest declares the line
committed and enabled. Existing open and closed cycles are never changed
retroactively. `effectiveAt` must be the first instant of a future UTC month
when the line is added or funded. The allocator applies the line only when that
instant is at or before the cycle's opening boundary.

Public surfaces show the committed amount and the monthly cap as separate
values. Allocation may never exceed `committedMinor`, even when
`monthlyCapMinor` is higher. The trusted project-transition gate rejects adding
or funding a review budget in the same change that reduces the contributor
pool cap. A later, separately reviewed contributor-cap change remains governed
by the project's public reward policy and cannot be presented as funding the
review line.

The reward-level fee applies identically to approved review principal. Because
both lines settle to the same registered wallet, the minimum-transfer rule is
evaluated against each recipient's combined cycle total. Reporting must still
publish shared-pool and additive-review amounts as distinct line items.

Proposal and approved-allocation rows publish `lines.sharedPool` and
`lines.reviewBudget`; aggregate fields remain their exact sum for backwards
compatibility. The review line binds the accepted review event IDs used as its
weights. Unsigned transfer plans and finalized settlement recipients preserve
the same split while transferring the combined recipient total, so a line
below the dust floor cannot strand an otherwise payable combined allocation.

## Evidence and settlement

Only accepted `substantive-review` score events participate in the additive
line. Self-review, bot review, post-merge review, duplicates, and excluded
evidence remain ineligible under the scoring contract.

The additive line is intentionally tier-only. Its weights use each accepted
review event's base `scoreThirds` and ignore `evidenceBonusBasisPoints`.
Finalized private-trace evidence may still increase that review's weight in the
shared contributor pool under Score v2; it never changes the separate review
line. This avoids paying the same trace bonus from both funding lines.

Slop does not hold keys, sign, or broadcast either line. A review amount may be
called paid only after finalized public evidence reconciles its immutable
intent, source, destination, asset, principal, and fee. Projected, under review,
approved, scheduled, paid, unclaimed, held, and excluded remain distinct states.
