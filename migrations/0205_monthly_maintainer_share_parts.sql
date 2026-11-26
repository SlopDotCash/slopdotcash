-- A maintainer decision record grows by about 210 bytes with each decided
-- outside pull request, so a busy month's record does not fit in one
-- statement under D1's 100 KB limit, and the monthly import is one
-- transaction: one refused statement stores no project of the file. The
-- import stages the record's exact text here in parts; the statement that
-- writes monthly_maintainer_shares joins them in sequence order, and the
-- import then removes them.
CREATE TABLE monthly_maintainer_share_parts (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence >= 0),
 part TEXT NOT NULL,
 PRIMARY KEY(project_id,period,sequence)
) STRICT;
