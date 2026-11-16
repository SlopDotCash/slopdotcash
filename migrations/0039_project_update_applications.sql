-- Updates use the same review queue and retain their immutable base revision.
ALTER TABLE project_applications ADD COLUMN expected_revision INTEGER CHECK (expected_revision IS NULL OR expected_revision > 0);
ALTER TABLE project_applications ADD COLUMN change_reason TEXT CHECK (change_reason IS NULL OR length(change_reason) BETWEEN 1 AND 1000);
