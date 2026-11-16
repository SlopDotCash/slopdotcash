-- SCR-06: one atomic revision may combine several prior source groups.
-- JSON contains safe source bindings and rationales, never source bodies.
CREATE TABLE slopbot_work_unit_journal (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 record_digest TEXT NOT NULL UNIQUE CHECK(length(record_digest) = 64),
 assessment_key TEXT NOT NULL UNIQUE CHECK(length(assessment_key) = 64),
 project_id TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest) = 64),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 recorded_at TEXT NOT NULL,
 CHECK(json_extract(record_json, '$.schemaVersion') IS 'slop-work-unit-record:v1'),
 CHECK(json_extract(record_json, '$.projectId') IS project_id),
 CHECK(json_extract(record_json, '$.sourceDigest') IS source_digest),
 CHECK(json_type(record_json, '$.sources') IS 'array' AND json_array_length(record_json, '$.sources') > 0),
 CHECK(json_type(record_json, '$.claims') IS 'array'),
 CHECK(json_type(record_json, '$.supersedes') IS 'array'),
 CHECK(json_type(record_json, '$.legacyPredecessors') IS 'array'),
 CHECK((json_array_length(record_json, '$.supersedes') = 0
       AND json_array_length(record_json, '$.legacyPredecessors') = 0
       AND json_extract(record_json, '$.revisionReason') IS NULL)
    OR ((json_array_length(record_json, '$.supersedes') > 0
         OR json_array_length(record_json, '$.legacyPredecessors') > 0)
        AND COALESCE(length(trim(json_extract(record_json, '$.revisionReason'))), 0) > 0))
) STRICT;
CREATE TABLE slopbot_work_unit_sources (
 record_digest TEXT NOT NULL REFERENCES slopbot_work_unit_journal(record_digest),
 repository_node_id TEXT NOT NULL,
 pull_request_node_id TEXT NOT NULL,
 PRIMARY KEY(record_digest, repository_node_id, pull_request_node_id)
) STRICT;
CREATE INDEX slopbot_work_unit_source_lookup
 ON slopbot_work_unit_sources(repository_node_id, pull_request_node_id);
CREATE TABLE slopbot_work_unit_claims (
 record_digest TEXT NOT NULL REFERENCES slopbot_work_unit_journal(record_digest),
 claim_id TEXT NOT NULL CHECK(length(claim_id) = 64),
 PRIMARY KEY(record_digest, claim_id)
) STRICT;
CREATE INDEX slopbot_work_unit_claim_lookup ON slopbot_work_unit_claims(claim_id);
CREATE TABLE slopbot_work_unit_predecessors (
 record_digest TEXT NOT NULL REFERENCES slopbot_work_unit_journal(record_digest),
 predecessor_digest TEXT NOT NULL UNIQUE REFERENCES slopbot_work_unit_journal(record_digest),
 PRIMARY KEY(record_digest, predecessor_digest)
) STRICT;

CREATE TRIGGER slopbot_work_unit_validate BEFORE INSERT ON slopbot_work_unit_journal
BEGIN
 SELECT RAISE(ABORT, 'joint value history cannot be replaced') WHERE EXISTS (
  SELECT 1 FROM slopbot_work_unit_journal WHERE sequence = NEW.sequence
   OR record_digest = NEW.record_digest OR assessment_key = NEW.assessment_key
 );
 SELECT RAISE(ABORT, 'joint predecessor is missing, stale or from another project') WHERE EXISTS (
  SELECT 1 FROM json_each(NEW.record_json, '$.supersedes') p
  LEFT JOIN slopbot_work_unit_journal old ON old.record_digest = p.value
  WHERE old.record_digest IS NULL OR old.project_id != NEW.project_id OR EXISTS (
   SELECT 1 FROM slopbot_work_unit_predecessors used WHERE used.predecessor_digest = p.value
  )
 );
 SELECT RAISE(ABORT, 'joint successor must retain every predecessor source') WHERE EXISTS (
  SELECT 1 FROM slopbot_work_unit_sources old
  JOIN json_each(NEW.record_json, '$.supersedes') p ON p.value = old.record_digest
  WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW.record_json, '$.sources') s
   WHERE json_extract(s.value, '$.repositoryNodeId') = old.repository_node_id
    AND json_extract(s.value, '$.pullRequestNodeId') = old.pull_request_node_id)
 );
 SELECT RAISE(ABORT, 'joint revision omits a current source predecessor') WHERE EXISTS (
  SELECT 1 FROM slopbot_work_unit_sources old
  JOIN json_each(NEW.record_json, '$.sources') s
   ON json_extract(s.value, '$.repositoryNodeId') = old.repository_node_id
   AND json_extract(s.value, '$.pullRequestNodeId') = old.pull_request_node_id
  WHERE NOT EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors used WHERE used.predecessor_digest = old.record_digest)
   AND NOT EXISTS (SELECT 1 FROM json_each(NEW.record_json, '$.supersedes') p WHERE p.value = old.record_digest)
 );
 SELECT RAISE(ABORT, 'joint revision omits a current claim predecessor') WHERE EXISTS (
  SELECT 1 FROM slopbot_work_unit_claims old
  JOIN json_each(NEW.record_json, '$.claims') c ON json_extract(c.value, '$.id') = old.claim_id
  WHERE NOT EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors used WHERE used.predecessor_digest = old.record_digest)
   AND NOT EXISTS (SELECT 1 FROM json_each(NEW.record_json, '$.supersedes') p WHERE p.value = old.record_digest)
 );
 SELECT RAISE(ABORT, 'legacy value predecessor is stale or outside the joint sources') WHERE EXISTS (
  SELECT 1 FROM json_each(NEW.record_json, '$.legacyPredecessors') p
  LEFT JOIN slopbot_value_journal old ON old.record_digest = p.value
  WHERE old.record_digest IS NULL
   OR EXISTS (SELECT 1 FROM slopbot_value_journal child WHERE child.supersedes = old.record_digest)
   OR NOT EXISTS (SELECT 1 FROM json_each(NEW.record_json, '$.sources') s
     WHERE json_extract(s.value, '$.repositoryNodeId') = old.repository_node_id
      AND json_extract(s.value, '$.pullRequestNodeId') = old.pull_request_node_id)
 );
 SELECT RAISE(ABORT, 'joint revision omits current legacy history') WHERE EXISTS (
  SELECT 1 FROM slopbot_value_journal old
  JOIN json_each(NEW.record_json, '$.sources') s
   ON json_extract(s.value, '$.repositoryNodeId') = old.repository_node_id
   AND json_extract(s.value, '$.pullRequestNodeId') = old.pull_request_node_id
  WHERE NOT EXISTS (SELECT 1 FROM slopbot_value_journal child WHERE child.supersedes = old.record_digest)
   AND NOT EXISTS (SELECT 1 FROM json_each(NEW.record_json, '$.legacyPredecessors') p WHERE p.value = old.record_digest)
 );
END;
CREATE TRIGGER slopbot_work_unit_index AFTER INSERT ON slopbot_work_unit_journal
BEGIN
 INSERT INTO slopbot_work_unit_sources
 SELECT NEW.record_digest, json_extract(value, '$.repositoryNodeId'), json_extract(value, '$.pullRequestNodeId')
 FROM json_each(NEW.record_json, '$.sources');
 INSERT INTO slopbot_work_unit_claims
 SELECT NEW.record_digest, json_extract(value, '$.id') FROM json_each(NEW.record_json, '$.claims');
 INSERT INTO slopbot_work_unit_predecessors
 SELECT NEW.record_digest, value FROM json_each(NEW.record_json, '$.supersedes');
END;
-- After migration of a source, the old writer must not fork its new history.
CREATE TRIGGER slopbot_value_joint_authority BEFORE INSERT ON slopbot_value_journal
WHEN EXISTS (SELECT 1 FROM slopbot_work_unit_sources
 WHERE repository_node_id = NEW.repository_node_id AND pull_request_node_id = NEW.pull_request_node_id)
BEGIN SELECT RAISE(ABORT, 'source now requires a joint value revision'); END;
CREATE TRIGGER slopbot_work_unit_no_update BEFORE UPDATE ON slopbot_work_unit_journal
BEGIN SELECT RAISE(ABORT, 'joint value journal is append-only'); END;
CREATE TRIGGER slopbot_work_unit_no_delete BEFORE DELETE ON slopbot_work_unit_journal
BEGIN SELECT RAISE(ABORT, 'joint value journal is append-only'); END;
CREATE TRIGGER slopbot_work_unit_sources_no_update BEFORE UPDATE ON slopbot_work_unit_sources
BEGIN SELECT RAISE(ABORT, 'joint source index is immutable'); END;
CREATE TRIGGER slopbot_work_unit_sources_no_delete BEFORE DELETE ON slopbot_work_unit_sources
BEGIN SELECT RAISE(ABORT, 'joint source index is immutable'); END;
CREATE TRIGGER slopbot_work_unit_claims_no_update BEFORE UPDATE ON slopbot_work_unit_claims
BEGIN SELECT RAISE(ABORT, 'joint claim index is immutable'); END;
CREATE TRIGGER slopbot_work_unit_claims_no_delete BEFORE DELETE ON slopbot_work_unit_claims
BEGIN SELECT RAISE(ABORT, 'joint claim index is immutable'); END;
CREATE TRIGGER slopbot_work_unit_predecessors_no_update BEFORE UPDATE ON slopbot_work_unit_predecessors
BEGIN SELECT RAISE(ABORT, 'joint predecessor index is immutable'); END;
-- Bind derived indexes to the parent bytes and reject REPLACE before SQLite's
-- implicit deletion (which otherwise need not invoke delete triggers).
CREATE TRIGGER slopbot_work_unit_source_binding BEFORE INSERT ON slopbot_work_unit_sources
WHEN EXISTS (SELECT 1 FROM slopbot_work_unit_sources old
 WHERE old.record_digest = NEW.record_digest AND old.repository_node_id = NEW.repository_node_id
  AND old.pull_request_node_id = NEW.pull_request_node_id)
 OR NOT EXISTS (SELECT 1 FROM slopbot_work_unit_journal j, json_each(j.record_json, '$.sources') s
  WHERE j.record_digest = NEW.record_digest
   AND json_extract(s.value, '$.repositoryNodeId') = NEW.repository_node_id
   AND json_extract(s.value, '$.pullRequestNodeId') = NEW.pull_request_node_id)
BEGIN SELECT RAISE(ABORT, 'joint source index does not match immutable parent'); END;
CREATE TRIGGER slopbot_work_unit_claim_binding BEFORE INSERT ON slopbot_work_unit_claims
WHEN EXISTS (SELECT 1 FROM slopbot_work_unit_claims old
 WHERE old.record_digest = NEW.record_digest AND old.claim_id = NEW.claim_id)
 OR NOT EXISTS (SELECT 1 FROM slopbot_work_unit_journal j, json_each(j.record_json, '$.claims') c
  WHERE j.record_digest = NEW.record_digest AND json_extract(c.value, '$.id') = NEW.claim_id)
BEGIN SELECT RAISE(ABORT, 'joint claim index does not match immutable parent'); END;
CREATE TRIGGER slopbot_work_unit_predecessor_binding BEFORE INSERT ON slopbot_work_unit_predecessors
WHEN EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors old WHERE old.predecessor_digest = NEW.predecessor_digest)
 OR NOT EXISTS (SELECT 1 FROM slopbot_work_unit_journal j, json_each(j.record_json, '$.supersedes') p
  WHERE j.record_digest = NEW.record_digest AND p.value = NEW.predecessor_digest)
BEGIN SELECT RAISE(ABORT, 'joint predecessor index does not match immutable parent'); END;
CREATE TRIGGER slopbot_work_unit_predecessors_no_delete BEFORE DELETE ON slopbot_work_unit_predecessors
BEGIN SELECT RAISE(ABORT, 'joint predecessor index is immutable'); END;
