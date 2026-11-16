-- Reserve the permanent object identity before R2 receives any bytes.
-- Safe metadata survives a lost response or a failed attachment transaction.
CREATE TABLE trace_write_reservations (
  run_id TEXT PRIMARY KEY REFERENCES trace_runs(id),
  github_user_id TEXT NOT NULL,
  trace_sha256 TEXT NOT NULL CHECK(length(trace_sha256) = 64),
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER trace_write_reservations_no_update
BEFORE UPDATE ON trace_write_reservations
BEGIN SELECT RAISE(ABORT, 'Trace write reservations are immutable'); END;
CREATE TRIGGER trace_write_reservations_no_delete
BEFORE DELETE ON trace_write_reservations
BEGIN SELECT RAISE(ABORT, 'Trace write reservations are permanent'); END;
