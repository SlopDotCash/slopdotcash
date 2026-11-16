-- Community project security vetting (PRD VET-01 to VET-08, MVP-12).
-- An admin queues an assessment of one exact project revision. The external
-- secure-VM service signs its result; the API checks the signature and the
-- strict result contract, then records the disposition once. Assessments and
-- quarantine records are append-only: a result can never be edited, deleted
-- or replaced, and a new scan is a new assessment.

CREATE TABLE vetting_assessments (
  id TEXT PRIMARY KEY CHECK (id GLOB 'vet_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  -- SHA-256 of the manifest with its status set to paused. An activation
  -- revision that changes only the status keeps this digest.
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  -- The queue assigns the exact integration-branch commit and the content
  -- digest of the skill template inputs to scan. The result must report both,
  -- and a clearance counts only while they are still the live branch head and
  -- template digest.
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40 AND commit_sha NOT GLOB '*[^0-9a-f]*'),
  template_sha256 TEXT NOT NULL CHECK (length(template_sha256) = 64 AND template_sha256 NOT GLOB '*[^0-9a-f]*'),
  requested_by_github_id TEXT NOT NULL CHECK (requested_by_github_id GLOB '[1-9]*'),
  requested_by_github_login TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  request_reason TEXT NOT NULL CHECK (length(request_reason) BETWEEN 1 AND 1000),
  state TEXT NOT NULL CHECK (state IN ('pending', 'incomplete', 'clean', 'malicious')),
  policy_version TEXT,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  result_sha256 TEXT CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
  signing_key_sha256 TEXT CHECK (signing_key_sha256 IS NULL OR length(signing_key_sha256) = 64),
  completed_at TEXT,
  FOREIGN KEY (project_id, revision) REFERENCES project_revisions(project_id, revision),
  CHECK (
    (state = 'pending' AND policy_version IS NULL AND
      result IS NULL AND result_sha256 IS NULL AND signing_key_sha256 IS NULL AND
      completed_at IS NULL) OR
    (state <> 'pending' AND policy_version IS NOT NULL AND
      result IS NOT NULL AND result_sha256 IS NOT NULL AND
      signing_key_sha256 IS NOT NULL AND completed_at IS NOT NULL AND
      json_extract(result, '$.assessmentId') = id AND
      json_extract(result, '$.disposition') = state AND
      json_extract(result, '$.assessed.commitSha') = commit_sha AND
      json_extract(result, '$.assessed.templateSha256') = template_sha256)
  )
) STRICT;

-- One queued scan per revision at a time.
CREATE UNIQUE INDEX vetting_assessments_one_pending
  ON vetting_assessments(project_id, revision) WHERE state = 'pending';
CREATE INDEX vetting_assessments_project
  ON vetting_assessments(project_id, revision, requested_at);
CREATE INDEX vetting_assessments_state
  ON vetting_assessments(state, requested_at);

CREATE TRIGGER vetting_assessments_no_delete
BEFORE DELETE ON vetting_assessments
BEGIN
  SELECT RAISE(ABORT, 'vetting assessments are permanent');
END;

-- The only allowed update records the one result of a pending assessment.
CREATE TRIGGER vetting_assessments_result_once
BEFORE UPDATE ON vetting_assessments
WHEN OLD.state <> 'pending' OR NEW.state = 'pending' OR
  NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR
  NEW.revision <> OLD.revision OR NEW.manifest_sha256 <> OLD.manifest_sha256 OR
  NEW.content_sha256 <> OLD.content_sha256 OR
  NEW.commit_sha <> OLD.commit_sha OR NEW.template_sha256 <> OLD.template_sha256 OR
  NEW.requested_by_github_id <> OLD.requested_by_github_id OR
  NEW.requested_by_github_login <> OLD.requested_by_github_login OR
  NEW.requested_at <> OLD.requested_at OR NEW.request_reason <> OLD.request_reason
BEGIN
  SELECT RAISE(ABORT, 'a vetting result is recorded once');
END;

-- Artifact quarantine records (VET-04): every fetched, unpacked, generated or
-- decrypted binary or obfuscated payload the VM reported, with its lineage
-- and its explicit execution state.
CREATE TABLE vetting_artifacts (
  assessment_id TEXT NOT NULL REFERENCES vetting_assessments(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  parent_sha256 TEXT CHECK (parent_sha256 IS NULL OR length(parent_sha256) = 64),
  origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 500),
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  artifact_type TEXT NOT NULL CHECK (artifact_type IN (
    'binary', 'archive', 'obfuscated-script', 'native-module', 'wasm',
    'bytecode', 'second-stage', 'other'
  )),
  state TEXT NOT NULL CHECK (state IN ('quarantined', 'released', 'blocked')),
  analysis TEXT NOT NULL CHECK (analysis IN (
    'pending', 'static-clean', 'detonation-clean', 'suspicious', 'malicious'
  )),
  requested_execution INTEGER NOT NULL CHECK (requested_execution IN (0, 1)),
  PRIMARY KEY (assessment_id, ordinal),
  -- An artifact leaves quarantine only with a clean analysis.
  CHECK (state <> 'released' OR analysis IN ('static-clean', 'detonation-clean'))
) STRICT;

CREATE INDEX vetting_artifacts_sha256 ON vetting_artifacts(sha256);

CREATE TRIGGER vetting_artifacts_no_update
BEFORE UPDATE ON vetting_artifacts
BEGIN
  SELECT RAISE(ABORT, 'artifact quarantine records are immutable');
END;

CREATE TRIGGER vetting_artifacts_no_delete
BEFORE DELETE ON vetting_artifacts
BEGIN
  SELECT RAISE(ABORT, 'artifact quarantine records are permanent');
END;

-- Artifacts belong only to an assessment whose result is being recorded.
CREATE TRIGGER vetting_artifacts_need_result
BEFORE INSERT ON vetting_artifacts
WHEN NOT EXISTS (
  SELECT 1 FROM vetting_assessments
   WHERE id = NEW.assessment_id AND state <> 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'artifacts need a recorded vetting result');
END;
