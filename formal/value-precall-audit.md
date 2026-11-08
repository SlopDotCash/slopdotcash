# Valuation lease checks before provider calls

This follow-up starts from `b2cf0141c` with the separate unsigned-retirement fix
already committed. It serves the existing Slopbot spending and source-ownership
requirements. No provider, signer or deployed configuration changed.

The real consumer/SQLite/provider-HTTP test reproduced two failures:

- Expiring the request and source leases while the final installation-repository
  check was outstanding still allowed one provider request to start.
- After adding a final ownership recheck, delaying its source-ownership SELECT
  across lease expiry still allowed a request. The SELECT compared its rows
  with a JavaScript timestamp bound before the delay.

`mayCall` now repeats request and source ownership checks after the remote
installation check. Both ownership readers compare deadlines with the later of
their supplied timestamp and SQLite's execution clock. A forward test clock
continues to make the check stricter; a queued statement cannot use an earlier
timestamp to accept an already expired lease.

`value-pipeline.test.ts` expires leases in both windows and requires zero initial
provider requests. An authorized successor then performs the single inference,
publishes the joint result, and lets the first delivery read that current result.
Both attempts/reservations remain recorded under the existing conservative
budget policy; only the successor has a provider cost. An older indirect-work
fixture now uses the real lease clock while keeping its GitHub evidence dates.

The existing `bot_value_pipeline` model adds explicit pending/final pre-call
checks and a named expiry trace. Its seven scenarios, 500 seeded 60-step traces,
and exhaustive 3,943-state TLC check pass. All 68 value test cases pass with 454
assertions, including the existing mid-inference, publication, queued-write and
overlap cases. Typecheck and changed-file formatting also pass with Bun 1.3.14
and Node 24.15.0. Logs and hashes are retained under ignored
`evidence/formal/value-precall-*` and `value-queued-precall-*`.

The model treats each final ownership read as an observation at execution time.
It does not make the external provider request atomic with D1, prove provider
billing truth, or remove the need to retain responses from calls already in
flight when a lease expires. Publication keeps its separate database fence.
