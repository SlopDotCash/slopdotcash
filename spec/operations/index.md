# Operations and delivery

PRD sections 9, 11 and 12 require idempotent private notices, current-authority
queues, separated local and production environments, and source-bound releases.

- [Daily backups and restoration](./backup.md)
- [Local validator funding command](./localCommand.md)
- [Local Solana validator stages](./localValidator.md)
- [Notifications](./notifications.md)
- [Moderator and steward Inbox items](./moderation.md)
- [Release and operational qualification](./release.md)
- [Publication lock per environment](./publicationLock.md)
- [Private-reporting intake health](./intakeHealth.md)
- [Mainnet escrow qualification](./escrowQualification.md)
- [Release and verification coverage](./releaseCoverage.md)
- [Independent payment job runs](./paymentJobs.md)
- [Scheduled payments runs](./paymentRun.md)
- [Extended escrow acceptance suite](./extendedQualification.md)
- [EVM upgrade preservation verification](./upgradeVerification.md)

Administrators manage permitted listing and restriction actions. Moderators
handle escalated disputes. A role-scoped queue rechecks authority on each read
and refuses stale or unavailable checks. Incomplete ordinary assessments remain
one Inbox item per source until completion, visible only to current maintainers
and administrators; that queue is the Slopbot
[incomplete-assessment Inbox](../slopbot/assessmentInbox.md). Account changes clear retained private views;
no rule here models that yet.
