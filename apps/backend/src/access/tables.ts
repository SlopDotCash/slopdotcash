// spec/backend/access.md, "A moderator bans each responsible account the investigation identified"; spec/backend/access.md, "One moderator decision reinstates selected accounts, each on its own appeal or the project's open request"

export const writes = ["project_maintainer_bans", "project_account_reinstatements"] as const;
