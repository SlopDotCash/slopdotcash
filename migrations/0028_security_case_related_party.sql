-- Related-party review for private security bounty awards (PRD SEC-04,
-- SEC-12; MVP-13). A case records whether its reporter is a related party.
-- An eligible related-party award reserves nothing until an independent
-- reviewer approves it; a refusal makes the award ineligible and appealable.

-- `not-assessed` until the technical decision. `related` comes from the
-- decider's declaration or from the reporter being a program approver or
-- the sponsor account; it is never inferred from other collaboration.
ALTER TABLE security_cases ADD COLUMN related_party TEXT NOT NULL
  DEFAULT 'not-assessed'
  CHECK (related_party IN ('not-assessed', 'unrelated', 'related'));
ALTER TABLE security_cases ADD COLUMN related_party_review TEXT NOT NULL
  DEFAULT 'not-applicable'
  CHECK (related_party_review IN ('not-applicable', 'pending', 'approved', 'refused'));
ALTER TABLE security_cases ADD COLUMN related_party_reviewer_github_id TEXT;
