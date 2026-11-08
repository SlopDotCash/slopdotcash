# Queued monthly allocation cutoff

A real migrated-SQLite regression reproduced an owner allocation edit that
passes the automatic cutoff check before its INSERT is queued, then commits
after the cutoff. The old statement used only the JavaScript timestamp captured
before execution. This could change the amounts the coordinator later freezes,
even though the owner-change window had closed.

The INSERT now checks SQLite's execution clock as well as the captured clock.
The current automatic-payment setting remains part of the same statement:
turning automatic payment off permits later edits; turning it on blocks them
at the deadline. The existing immutable-month, sequence, account-ban and amount
checks remain in effect. No payment, allocation cap or permission is changed.

The regression uses a valid positive-integer schedule, the previous UTC month,
a real future deadline, and the actual allocation service and migrated SQLite.
It delays only statement delivery until the wall-clock deadline passes.
Before: the promise resolves and stores the edit. After: it returns
`cutoff_passed` and stores no change. The complete monthly suite passes 62 tests
and 502 assertions. Earlier fixture diagnostics are kept as failures.

`monthly_cutoff_queue` splits request admission from SQL execution. Its five
named scenarios cover early commit, queued expiry, current opt-out, current
opt-in and a separately frozen month. TLC explores 44 distinct states. One
write and one cutoff bound the model. GitHub authority, amount validation,
unbounded edit histories, distributed clock accuracy and final chain
settlement are outside this model.

The existing native D1 monthly-order workflow also exercises early, queued-late
and opted-out edits through the production service. It passes all three paths and keeps foreign keys valid. Repeating the same
native workflow with only the production service restored to the old source
returns HTTP 200 and sequence 2 where HTTP 409 is required. Its results are
recorded in the ignored evidence receipt; a SQLite test alone does not establish the
Cloudflare wrapper's execution behavior. Cloudflare documents ordered
transactional [batch execution](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch);
SQLite documents evaluation of
[`now` by the VFS clock](https://www.sqlite.org/lang_datefunc.html#time_values).
The cutoff fence is inside the single INSERT, not a separate read.
