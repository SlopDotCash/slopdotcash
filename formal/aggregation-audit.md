# Exact Points aggregation

A schema-valid retained journal can contain one earned Point and two signed
adjustments of `-Number.MAX_SAFE_INTEGER`. The old `pointMembers` code accumulated
the adjustments as JavaScript numbers without a final range check. It returned
`-18014398509481980` for an exact total of `-18014398509481981`.
This is a constructed accepted-input regression, not evidence that ordinary
bounded reconciliation produced such a journal in production.

The correction uses the reviewed `sumBuckets` BigInt implementation for signed
totals and rejects results outside the safe-number range before conversion is
published. Earned totals still must pass their existing check before signed
adjustments; a later debit cannot make an overflowing earned total acceptable.
Ordered penalty consumption uses the same exact bucket core without changing
actor/project/month boundaries or request order.

`bucket_aggregation.qnt` models two signed entries and two ordered requests in
two buckets. Entry values range from -1 to 1; starting balances and requests
range from 0 to 2. Its generated traces are replayed through production
`sumBuckets` and `consumeBuckets`. `points_total_precision.qnt` represents the
safe-number limit by 5 and covers earned overflow, signed negative overflow,
the exact boundary, signed cancellation and an unsafe month behind a safe
lifetime total. The actual large-number refusal
is checked by the retained-journal regression.

The focused Points and Quint workflow run passed 13 tests and 1,616 assertions,
including 100 generated bucket traces. The independently reviewed pure-kernel
proof supplies arbitrary-length integer aggregation and ordered-consumption
contracts. The strict six-module combined run passed after this integration:
29 selected functions and 855 obligations, including 155 for aggregation.
Neither a finite model nor that selected proof covers every
caller or every possible published journal.
