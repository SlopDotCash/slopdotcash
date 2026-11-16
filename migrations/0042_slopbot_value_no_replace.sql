-- SQLite INSERT OR REPLACE deletes conflicting rows without invoking delete
-- triggers unless recursive_triggers is enabled. Protect every unique key,
-- including the one-root and one-successor constraints, before insertion.
CREATE TRIGGER slopbot_value_no_replace BEFORE INSERT ON slopbot_value_journal
WHEN EXISTS (
 SELECT 1 FROM slopbot_value_journal
 WHERE sequence = NEW.sequence
    OR record_digest = NEW.record_digest
    OR assessment_key = NEW.assessment_key
    OR (supersedes IS NULL AND NEW.supersedes IS NULL
        AND repository_node_id = NEW.repository_node_id
        AND pull_request_node_id = NEW.pull_request_node_id)
    OR (NEW.supersedes IS NOT NULL AND supersedes = NEW.supersedes)
)
BEGIN SELECT RAISE(ABORT, 'value journal records cannot be replaced'); END;
