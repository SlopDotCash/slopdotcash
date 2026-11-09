import type { Page } from "@playwright/test";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";

/** Synthetic maintainer access for wallet workflows on the owner settings page. */
export async function serveProjectMaintainer(
  page: Page,
  currentProject: () => ProjectDefinition,
) {
  const { id } = currentProject();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "1", githubLogin: "local-owner", admin: false },
      },
    }),
  );
  await page.route(
    new RegExp(`/api/v1/project-setup/${id}(?:/check)?$`),
    (route) => {
      const project = currentProject();
      return route.fulfill({
        json: {
          viewer: { githubId: "1" },
          setup: {
            projectId: id,
            name: project.name,
            slug: project.slug,
            revision: 1,
            status: project.status,
            state: "ready",
            nextAction: {
              kind: "none",
              message: "Project active.",
              href: null,
            },
            checks: {
              authority: { state: "verified", message: "Verified." },
              installation: { state: "installed", message: "Installed." },
              scan: { state: "cleared", message: "Cleared." },
            },
            funding: { mode: "none" },
            activatedRevision: null,
            checkedAt: new Date().toISOString(),
          },
        },
      });
    },
  );
  await page.route(new RegExp(`/api/v1/projects/${id}(?:\\?.*)?$`), (route) =>
    route.fulfill({ json: { project: currentProject(), revision: 1 } }),
  );
}

/** The enforcement summary of an unrestricted project. */
export function clearProjectEnforcement(
  moderation: "moderator" | "unconfigured" = "unconfigured",
) {
  return {
    state: "clear",
    appeal: "none",
    projectAppeal: "none",
    since: null,
    restrictedBy: [],
    nextSequence: 1,
    revisionPending: false,
    moderation,
    decisionRequired: false,
    bannedMaintainers: [],
    records: [],
  };
}

/** One unrestricted project as the admin projects API returns it. */
export function adminProjectRecord(
  project: ProjectDefinition,
  {
    manifest = project,
    status = project.status,
    revision = 1,
    manifestSha256 = "a".repeat(64),
    createdAt = "2026-10-22T00:00:00.000Z",
    updatedAt = createdAt,
    moderation = "unconfigured",
  }: {
    manifest?: ProjectDefinition;
    status?: string;
    revision?: number;
    manifestSha256?: string;
    createdAt?: string;
    updatedAt?: string;
    moderation?: "moderator" | "unconfigured";
  } = {},
) {
  return {
    id: project.id,
    status,
    revision,
    manifest,
    manifestSha256,
    createdAt,
    updatedAt,
    sourceApplicationId: null,
    enforcement: clearProjectEnforcement(moderation),
  };
}
