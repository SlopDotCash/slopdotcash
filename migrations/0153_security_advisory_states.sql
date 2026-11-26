-- The state GitHub last reported for a program's private vulnerability
-- report: triage, draft, published or closed. The automatic import already
-- lists every report of a program's repository; it keeps each one's state
-- here so the Inbox can show whether the advisory behind a case is still
-- open on GitHub. Display only: no decision, award or payment reads it, and
-- Slop never writes an advisory's state to GitHub. A row is rewritten only
-- when GitHub's state changes, so changed_at is when Slop first saw it.
CREATE TABLE security_advisory_states (
 repository TEXT NOT NULL,
 ghsa TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('triage', 'draft', 'published', 'closed')),
 changed_at TEXT NOT NULL,
 PRIMARY KEY (repository, ghsa)
);
