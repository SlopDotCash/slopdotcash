-- The joint value history route finds a pull request's records by repository
-- and pull request number. Without an index that lookup parses every journal
-- record's JSON on every call, which a full data collection repeats about
-- ten thousand times against the production database. This derived index
-- holds the same three values the lookup compares, copied unchanged from each
-- record's sources. Columns carry no declared type so a stored value compares
-- exactly as the JSON value it was copied from.
CREATE TABLE slopbot_work_unit_source_numbers (
 record_digest TEXT NOT NULL REFERENCES slopbot_work_unit_journal(record_digest),
 repository,
 repository_node_id,
 pull_request_number
);
CREATE INDEX slopbot_work_unit_source_number_by_node
 ON slopbot_work_unit_source_numbers(repository_node_id, pull_request_number);
CREATE INDEX slopbot_work_unit_source_number_by_name
 ON slopbot_work_unit_source_numbers(repository, pull_request_number);
INSERT INTO slopbot_work_unit_source_numbers
SELECT j.record_digest, json_extract(s.value, '$.repository'),
 json_extract(s.value, '$.repositoryNodeId'), json_extract(s.value, '$.pullRequestNumber')
FROM slopbot_work_unit_journal j, json_each(j.record_json, '$.sources') s;
CREATE TRIGGER slopbot_work_unit_index_numbers AFTER INSERT ON slopbot_work_unit_journal
BEGIN
 INSERT INTO slopbot_work_unit_source_numbers
 SELECT NEW.record_digest, json_extract(value, '$.repository'),
  json_extract(value, '$.repositoryNodeId'), json_extract(value, '$.pullRequestNumber')
 FROM json_each(NEW.record_json, '$.sources');
END;
-- Bind the index to the parent bytes, as the other derived indexes are.
CREATE TRIGGER slopbot_work_unit_source_number_binding BEFORE INSERT ON slopbot_work_unit_source_numbers
WHEN NOT EXISTS (SELECT 1 FROM slopbot_work_unit_journal j, json_each(j.record_json, '$.sources') s
  WHERE j.record_digest = NEW.record_digest
   AND json_extract(s.value, '$.repository') IS NEW.repository
   AND json_extract(s.value, '$.repositoryNodeId') IS NEW.repository_node_id
   AND json_extract(s.value, '$.pullRequestNumber') IS NEW.pull_request_number)
BEGIN SELECT RAISE(ABORT, 'joint source number index does not match immutable parent'); END;
CREATE TRIGGER slopbot_work_unit_source_numbers_no_update BEFORE UPDATE ON slopbot_work_unit_source_numbers
BEGIN SELECT RAISE(ABORT, 'joint source number index is immutable'); END;
CREATE TRIGGER slopbot_work_unit_source_numbers_no_delete BEFORE DELETE ON slopbot_work_unit_source_numbers
BEGIN SELECT RAISE(ABORT, 'joint source number index is immutable'); END;
