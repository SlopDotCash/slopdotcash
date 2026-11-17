// spec/backend/access.md, "A moderator bans each responsible account on that confirmed-malicious decision"; spec/backend/access.md, "One moderator decision reinstates selected accounts, each on its own appeal"

export const writes = ["project_maintainer_bans", "project_account_reinstatements"] as const;
