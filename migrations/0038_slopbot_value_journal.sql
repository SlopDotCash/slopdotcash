-- Provisional assessment history (SCR-06). No payout or penalty authority.
CREATE TABLE slopbot_value_journal (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 record_digest TEXT NOT NULL UNIQUE CHECK(length(record_digest) = 64),
 assessment_key TEXT NOT NULL UNIQUE CHECK(length(assessment_key) = 64),
 repository_node_id TEXT NOT NULL,
 pull_request_node_id TEXT NOT NULL,
 head_sha TEXT NOT NULL CHECK(length(head_sha) = 40),
 source_digest TEXT NOT NULL CHECK(length(source_digest) = 64),
 supersedes TEXT UNIQUE REFERENCES slopbot_value_journal(record_digest),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 recorded_at TEXT NOT NULL,
 CHECK(json_extract(record_json, '$.repositoryNodeId') IS repository_node_id),
 CHECK(json_extract(record_json, '$.pullRequestNodeId') IS pull_request_node_id),
 CHECK(json_extract(record_json, '$.headSha') IS head_sha),
 CHECK(json_extract(record_json, '$.sourceDigest') IS source_digest),
 CHECK(json_extract(record_json, '$.supersedes') IS supersedes),
 CHECK((supersedes IS NULL AND json_extract(record_json, '$.revisionReason') IS NULL)
   OR (supersedes IS NOT NULL AND COALESCE(length(trim(json_extract(record_json, '$.revisionReason'))), 0) > 0))
) STRICT;
CREATE UNIQUE INDEX slopbot_value_one_root
 ON slopbot_value_journal(repository_node_id, pull_request_node_id)
 WHERE supersedes IS NULL;
CREATE INDEX slopbot_value_source
 ON slopbot_value_journal(repository_node_id, pull_request_node_id, sequence);
CREATE TRIGGER slopbot_value_same_source
BEFORE INSERT ON slopbot_value_journal WHEN NEW.supersedes IS NOT NULL
BEGIN
 SELECT RAISE(ABORT, 'value successor must reference the same pull request')
 WHERE NOT EXISTS (
  SELECT 1 FROM slopbot_value_journal
  WHERE record_digest = NEW.supersedes
    AND repository_node_id = NEW.repository_node_id
    AND pull_request_node_id = NEW.pull_request_node_id
 );
END;
CREATE TRIGGER slopbot_value_no_update BEFORE UPDATE ON slopbot_value_journal
BEGIN SELECT RAISE(ABORT, 'value journal is append-only'); END;
CREATE TRIGGER slopbot_value_no_delete BEFORE DELETE ON slopbot_value_journal
BEGIN SELECT RAISE(ABORT, 'value journal is append-only'); END;
