# Populated notification schema upgrades

The prior `api_inbox` model covers committing a notice, reading it and
acknowledging it. It does not represent copying a populated notification table
or adding a destination-version field. `notification_schema_upgrade.qnt`
adds that migration composition without changing production SQL.

| Migration | Transition checked |
| --- | --- |
| 0030 | Add the private outbox and insert trigger without mailing prior Inbox history. |
| 0033 | Retain the existing activity outbox and its destination version as the surrounding mail schema. |
| 0063 | Copy notices, remove insert triggers, replace the table, restore every field, then recreate triggers and widen event kinds. |
| 0065 | Preserve the same populated state while adding appeal notices. |
| 0079 | Preserve the same populated state while adding scam-review notices. |
| 0111 | Add empty verification/destination tables and nullable security consent/binding fields; bind only subsequent inserted queue rows. |

The finite model has two historical notices with different read states, two
pre-binding security/activity delivery records with evidence, and at most two
later notices. It exposes the copy/drop/restore phases and preserves full-row
payload identities. Re-inserting history while the triggers are absent adds
no queue rows. A new verified destination does not rewrite an old queue
binding, and duplicate future source events still have one queue entry.

All eight scenarios pass. Type checking and 500 seeded traces of at most 60
steps pass with seed `20261107`. Exhaustive TLC checking explores 150 distinct
states (696 generated). The model and mapped source hashes remained unchanged
during those checks.

The real SQLite conformance is in `workers/notify/security.test.ts`. The
expanded populated-upgrade regression compares all old notice fields, both
outboxes and their existing delivery evidence after each table rebuild. It
checks the new nullable columns explicitly, confirms that consent creates no
retrospective mail, exercises a future notice through
`notifySecurityReportReceived`, and verifies one delivery after replay.
All 20 tests in that file pass, with 214 assertions. The previous pre-pilot
case remains in place and still checks that historical Inbox notices expose
no dead acknowledgment action.

The binding/send projection covers registered user-verified destinations.
Legacy operator-pilot delivery, provider retries, reconciliation and
escalation remain in the dedicated delivery models and tests. The model
assumes application writes do not interleave with a table rebuild; it does
not prove Cloudflare migration atomicity, process-crash recovery or arbitrary
SQL refinement. `api_dev_migrations` separately covers the local runner's
transaction boundary. Passing this finite model is not a claim that every
possible historical database is valid.
