-- Explicit human owner decisions for normal repository admission. This is
-- separate from the fixed migration-0075 set and never records a passed scan.
CREATE TABLE vetting_admission_exemptions (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE CHECK(id GLOB 'vex_*' AND length(id) BETWEEN 8 AND 80),
 project_id TEXT NOT NULL REFERENCES projects(id),
 revision INTEGER NOT NULL,
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
 repository_id TEXT NOT NULL,
 repository_node_id TEXT NOT NULL,
 steward_id TEXT NOT NULL,
 steward_node_id TEXT NOT NULL,
 granted_by_github_id TEXT NOT NULL,
 granted_by_github_login TEXT NOT NULL,
 granted_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 decision_reference TEXT NOT NULL CHECK(length(decision_reference) BETWEEN 1 AND 500),
 covered_assessment_ids TEXT NOT NULL CHECK(json_valid(covered_assessment_ids) AND json_type(covered_assessment_ids)='array'),
 FOREIGN KEY(project_id,revision) REFERENCES project_revisions(project_id,revision)
) STRICT;
CREATE INDEX vetting_admission_exemption_project ON vetting_admission_exemptions(project_id,sequence);
CREATE TABLE vetting_admission_exemption_revocations (
 exemption_id TEXT PRIMARY KEY REFERENCES vetting_admission_exemptions(id),
 revoked_by_github_id TEXT NOT NULL,
 revoked_by_github_login TEXT NOT NULL,
 revoked_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 decision_reference TEXT NOT NULL CHECK(length(decision_reference) BETWEEN 1 AND 500)
) STRICT;
CREATE TRIGGER vetting_admission_exemptions_no_update BEFORE UPDATE ON vetting_admission_exemptions
BEGIN SELECT RAISE(ABORT,'admission exemptions are immutable'); END;
CREATE TRIGGER vetting_admission_exemptions_no_delete BEFORE DELETE ON vetting_admission_exemptions
BEGIN SELECT RAISE(ABORT,'admission exemptions are permanent'); END;
CREATE TRIGGER vetting_admission_revocations_no_update BEFORE UPDATE ON vetting_admission_exemption_revocations
BEGIN SELECT RAISE(ABORT,'admission revocations are immutable'); END;
CREATE TRIGGER vetting_admission_revocations_no_delete BEFORE DELETE ON vetting_admission_exemption_revocations
BEGIN SELECT RAISE(ABORT,'admission revocations are permanent'); END;
