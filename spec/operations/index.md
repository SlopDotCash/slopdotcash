# Operations and delivery

PRD sections 9, 11 and 12 require idempotent private notices, current-authority
queues, separated local and production environments, and source-bound releases.

- [Daily backups and restoration](./backup.md)
- [Isolated local identity](./local.md)
- [Notifications](./notifications.md)
- [Release and operational qualification](./release.md)

Administrators manage permitted listing and restriction actions. Moderators
handle escalated disputes. A role-scoped queue rechecks authority on each read
and refuses stale or unavailable checks. Incomplete ordinary assessments remain
one Inbox item per source until completion, visible only to current maintainers
and administrators. Account changes clear retained private views.
