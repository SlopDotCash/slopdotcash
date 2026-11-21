-- Operator decision, 17 November 2026: a refused model reply records which
-- part failed (a field name, array position or JSON type, never reply text),
-- so schema-invalid verdicts can be fixed. One row per refused call.
CREATE TABLE slopbot_call_failure_details (
 call_id INTEGER PRIMARY KEY REFERENCES slopbot_costs(id),
 detail TEXT NOT NULL CHECK(length(detail) BETWEEN 1 AND 200),
 recorded_at TEXT NOT NULL
) STRICT;
