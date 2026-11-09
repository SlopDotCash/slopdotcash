# Scanner access-audit retention

This source-only model maps migration `0067_vetting_audit_retention.sql` and
`pruneAccessAudit` in `workers/vetting-backup/core.ts` (lines 505–510). It restores
the explicit migration mapping after backup publication received its separate
model. No runtime code or test was changed, and no parser, checker, test,
application or service ran for this addition. Only source metadata inventories
are regenerated.

The Worker skips pruning when backup mode is disabled. Otherwise its SQL
selects rows by the strict textual comparison
`created_at < strftime(..., 'now', '-1 year')`. The migration independently
protects every attempted deletion: an unparseable `julianday(created_at)` or a
parsed date equal to or newer than `julianday('now', '-1 year')` raises `ABORT`.
This applies to direct DELETE statements as well as the scheduler. The index
supports selection; it grants no deletion authority.

`vetting_audit_retention` has 14 named scenarios and six row representatives:
canonical old, equal and newer timestamps; invalid strings sorting before and
after the SQL cutoff; and a parseable equal timestamp using a space instead of
the canonical `T`. The last representative can be selected lexically while
still being refused by the parsed-date trigger. Earlier row deletions are
staged within one DELETE. A later trigger refusal discards all staged deletions,
so neither row order nor a partly completed scan yields a partial commit.

The clock samples November 8, 2026 and two subsequent calendar months at a
fixed UTC day/time. Rows use the corresponding October–December 2025 positions.
The model subtracts twelve calendar months, not 365 days. It does not claim to
verify SQLite's complete date parser, leap-day normalization or subsecond
formatting. Lexical ranks and parsed timestamps are distinct finite inputs.

Invocation-time observation does not authorize a deletion: the actual SQL
execution captures the then-current database cutoff. Within one modeled
statement, row selection and trigger checks share that captured cutoff, even if
the external clock advances before another row is inspected. A later statement
captures a fresh cutoff. This is the SQLite statement-clock consistency premise,
not a new caller-supplied date or runtime clock override. SQLite documents
[one `now` value per statement step](https://www.sqlite.org/lang_datefunc.html)
and [ABORT rollback of the current statement](https://www.sqlite.org/lang_conflict.html).

The invariant keeps every deleted row valid and strictly older than its recorded
execution cutoff, preserves all invalid rows, and requires all-or-nothing
results for mixed-row statements. The scenarios cover mode-off behavior,
equal/newer/invalid refusal, both lexical-versus-parsed divergences, mixed-row
rollback, delayed execution, clock advance during a statement, and later eligible
deletion. No arbitrary timestamp mutation or concurrent D1 writer is modeled.

Existing source definitions in
`workers/vetting-backup/qualification-retention.ts` (lines 343–400) seed old,
current and late-sorting invalid records, check disabled and enabled scheduling,
refuse direct current/invalid deletion, and retain the audit update guard. They
were read, not executed here. They do not themselves cover the equal boundary,
early-sorting invalid row, mixed-statement rollback or delayed execution now
represented by this model. Those runtime checks and model execution remain open.
