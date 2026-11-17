// spec/backend/projects.md, "A project is one row of immutable revisions and separate application records"; spec/backend/projectRegistry.md, "Each permanent repository id and each path key belongs to at most one project"

export const writes = ["projects", "project_revisions", "project_repositories", "project_applications"] as const;
