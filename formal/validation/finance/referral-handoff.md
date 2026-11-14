# Focused referral and lifecycle verification

The specification at commit 33cbe2e6f preserves exact accrual amounts, ordered
filings, lifetime wallet pins, publication and claim receipts, expired-lease
recovery, and the distributor's authority, gas and rescue rules. The comparison
records the complete pinned referral core, store and contract hashes and the
owning specifications. [Source comparison](referral-source-audit.json)

The guided journeys exercise 172 events across 33 cases. They reach all 40
transitions and all 11 reachability goals across the four referral units. They
verify equivalent monetary padding for a rate denominator, token unit and
finalized root entries, and refuse different entry order, length, wallet or
amount. [Guided journeys](referral-journeys.json) · [Entry equality](referral-entry-equality.json)

The weighted simulation uses two fixed seeds with 100 traces of up to 20 events
per unit and seed. Every transition and goal in the three sampled units was
reached under both seeds. All six samples passed their invariants and generated
TypeScript replay. Publication reached Uncertain in 24 and 33 traces, Claimed
in 52 and 58, and Voided in 46 and 42. All three literal simulation fixtures
matched the complete states built by generated transitions.
[Weighted simulation](referral-weighted-goals.json) · [Fixture equivalence](referral-fixture-equivalence.json)

The earlier focused run proved all six activation-control obligations on the
current source. Its accrual and distributor simulations, and the separate
accrual and publication simulation, remain historical results tied to their
original source hashes. The final full-tree check owns the proof outcomes for
accrual, publication and distributor. [Earlier focused run](referral-completion.json)

The lifecycle repair evidence reports 114 proved conversion obligations and
32 proved contributor-allocation obligations. The 74 reserve-release obligations
include seven still open on amount equality, addition, subtraction and the
aggregate step. The review found no remaining counterstate for those seven.
[Lifecycle proof results](lifecycle-repair.json) · [Repaired counterexamples](lifecycle-counterexamples.json)
