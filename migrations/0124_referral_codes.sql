-- Custom referral codes (PRD section 11, "Referral program"). A code is a
-- name a signed-in member chooses for their own referral link:
-- `/referral/<code>` forwards to the project form with that member's GitHub
-- login as the referrer. The code is only a pointer to the account; capture
-- rules, the immutable project record and accrual are unchanged.
--
-- `code_key` is the lowercase form, so codes are unique without regard to
-- case. A member has at most one code in use (`retired_at IS NULL`). A code
-- they replace stays in this table, so no other account can ever take a name
-- that once forwarded to someone else.
CREATE TABLE referral_codes (
  code_key TEXT PRIMARY KEY CHECK (code_key = lower(code)),
  code TEXT NOT NULL CHECK (
    length(code) BETWEEN 3 AND 32 AND code NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  github_id TEXT NOT NULL CHECK (
    github_id GLOB '[1-9]*' AND github_id NOT GLOB '*[^0-9]*'
  ),
  created_at TEXT NOT NULL,
  retired_at TEXT
) STRICT;

CREATE UNIQUE INDEX referral_codes_in_use ON referral_codes(github_id)
WHERE retired_at IS NULL;
CREATE INDEX referral_codes_account ON referral_codes(github_id);

CREATE TRIGGER referral_codes_owner_fixed
BEFORE UPDATE ON referral_codes
WHEN NEW.code_key IS NOT OLD.code_key
  OR NEW.github_id IS NOT OLD.github_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'referral code owner is permanent'); END;

CREATE TRIGGER referral_codes_no_delete
BEFORE DELETE ON referral_codes
BEGIN SELECT RAISE(ABORT, 'referral codes are permanent'); END;
