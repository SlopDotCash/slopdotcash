-- Routine decisions on private security reports (PRD section 8, operator
-- decision of 17 November 2026). Slop's screening decides the routine cases:
-- a duplicate, a report that matches a published "Does not qualify" line, and
-- a report without proof. Everything else is acknowledged and ranked for the
-- program owner. A model never approves or pays an award.
--
-- Neither table holds report text, a reporter name or model free text. A
-- decision keeps only fixed vocabulary, the published line it relied on, the
-- earlier case it relied on, and which model calls were made.

-- One pass of the job. A new pass starts only when no pass began within the
-- minimum interval, so the insert is also the lease.
CREATE TABLE security_routine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  source TEXT NOT NULL CHECK (source IN ('request', 'admin')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  examined INTEGER NOT NULL DEFAULT 0 CHECK (examined >= 0),
  recorded INTEGER NOT NULL DEFAULT 0 CHECK (recorded >= 0)
) STRICT;

CREATE INDEX security_routine_runs_started ON security_routine_runs(started_at);

CREATE TRIGGER security_routine_runs_no_delete
BEFORE DELETE ON security_routine_runs
BEGIN
  SELECT RAISE(ABORT, 'routine decision runs are permanent');
END;

-- A pass finishes once; its identity and start never change.
CREATE TRIGGER security_routine_runs_finish_once
BEFORE UPDATE ON security_routine_runs
WHEN OLD.finished_at IS NOT NULL OR NEW.id IS NOT OLD.id OR
  NEW.mode IS NOT OLD.mode OR NEW.source IS NOT OLD.source OR
  NEW.started_at IS NOT OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'a finished routine decision run is immutable');
END;

-- One decision about one case revision. `dry_run` rows record the decision
-- the job would make and never change a case (`applied = 0`). A `live` row is
-- written in the same batch as the case change it describes. `unavailable`
-- means a model call failed; it is retried and decides nothing.
CREATE TABLE security_routine_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES security_routine_runs(id),
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  case_revision INTEGER NOT NULL CHECK (case_revision > 0),
  report_version INTEGER CHECK (report_version IS NULL OR report_version > 0),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'duplicate', 'does-not-qualify', 'needs-proof', 'no-proof-received',
    'acknowledged', 'unavailable'
  )),
  basis TEXT NOT NULL CHECK (basis IN ('digest', 'two-calls', 'clock', 'hold')),
  -- Why a case that might have closed was left for the program owner.
  hold_reason TEXT CHECK (hold_reason IS NULL OR hold_reason IN (
    'loss-plausible', 'calls-disagreed', 'analysis-unavailable',
    'github-advisory', 'report-not-stored', 'proof-still-missing'
  )),
  -- The published "Does not qualify" line both calls named.
  exclusion_line TEXT CHECK (
    exclusion_line IS NULL OR length(exclusion_line) BETWEEN 3 AND 300
  ),
  -- The earlier case this report duplicates.
  duplicate_of TEXT REFERENCES security_cases(id),
  proof_due_at TEXT,
  loss_plausible INTEGER CHECK (loss_plausible IS NULL OR loss_plausible IN (0, 1)),
  plausible_severity TEXT CHECK (plausible_severity IS NULL OR plausible_severity IN (
    'critical', 'high', 'medium', 'low', 'informational', 'unresolved'
  )),
  proof_present INTEGER CHECK (proof_present IS NULL OR proof_present IN (0, 1)),
  prompt_revision TEXT,
  -- Each model call: provider, requested model, prompt label and whether it
  -- answered. Never the request or the answer.
  calls TEXT NOT NULL CHECK (json_valid(calls)),
  model_calls INTEGER NOT NULL CHECK (model_calls IN (0, 2)),
  applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
  applied_case_revision INTEGER,
  decided_at TEXT NOT NULL,
  UNIQUE (case_id, case_revision, mode, attempt),
  CHECK (outcome <> 'duplicate' OR duplicate_of IS NOT NULL),
  CHECK (outcome <> 'does-not-qualify' OR exclusion_line IS NOT NULL),
  CHECK (outcome <> 'needs-proof' OR proof_due_at IS NOT NULL),
  CHECK (outcome <> 'unavailable' OR applied = 0),
  CHECK (mode = 'live' OR applied = 0),
  CHECK ((applied = 1) = (applied_case_revision IS NOT NULL)),
  CHECK ((basis = 'two-calls') <= (model_calls = 2))
) STRICT;

CREATE INDEX security_routine_decisions_case
  ON security_routine_decisions(case_id, id);
CREATE INDEX security_routine_decisions_day
  ON security_routine_decisions(decided_at);

CREATE TRIGGER security_routine_decisions_no_update
BEFORE UPDATE ON security_routine_decisions
BEGIN
  SELECT RAISE(ABORT, 'routine decisions are immutable');
END;

CREATE TRIGGER security_routine_decisions_no_delete
BEFORE DELETE ON security_routine_decisions
BEGIN
  SELECT RAISE(ABORT, 'routine decisions are permanent');
END;
