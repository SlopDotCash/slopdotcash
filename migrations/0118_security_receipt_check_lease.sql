-- One receipt check per project at a time, with a short cooldown: a row
-- records the last reconcile that started, so concurrent and back-to-back
-- full GitHub pulls for the same project cannot burn the advisory quota.
-- The row is kept as the cooldown marker and ages out on the next acquire.
CREATE TABLE security_receipt_check_leases (
  project_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  actor_github_id TEXT NOT NULL
) STRICT;
