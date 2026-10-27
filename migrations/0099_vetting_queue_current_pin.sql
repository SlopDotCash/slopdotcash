-- A pending scan of an old commit or template must not block a fresh scan.
-- createAssessment atomically refuses an identical current pending request;
-- superseded assessments stay unchanged in the permanent audit history.
DROP INDEX vetting_assessments_one_pending;
CREATE INDEX vetting_assessments_project_queue
ON vetting_assessments(project_id);
