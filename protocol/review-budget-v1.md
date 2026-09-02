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
retroactively.

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

## Evidence and settlement

Only accepted `substantive-review` score events participate in the additive
line. Self-review, bot review, post-merge review, duplicates, and excluded
evidence remain ineligible under the scoring contract.

Slop does not hold keys, sign, or broadcast either line. A review amount may be
called paid only after finalized public evidence reconciles its immutable
intent, source, destination, asset, principal, and fee. Projected, under review,
approved, scheduled, paid, unclaimed, held, and excluded remain distinct states.
