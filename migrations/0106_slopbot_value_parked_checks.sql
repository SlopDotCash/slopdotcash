-- The parked-request sweep checks a bounded number of repositories per run.
-- Record when each parked repository was last checked so the sweep rotates:
-- never-checked repositories first, then the least recently checked. Every
-- parked repository is therefore rechecked within ceil(parked / limit) runs.
CREATE TABLE slopbot_value_parked_checks (
 repository_id INTEGER NOT NULL,
 owner TEXT NOT NULL,
 repo TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 PRIMARY KEY (repository_id, owner, repo)
) STRICT;
CREATE INDEX slopbot_value_parked_checks_due
 ON slopbot_value_parked_checks(checked_at);
