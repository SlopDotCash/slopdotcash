/** Proves a paused project is registered but never collected. */

import { describe, expect, it } from "vitest";
import type { ProjectDefinition } from "./projects.mjs";
import { PROJECTS } from "./projects.mjs";
import {
  collectTargetRepositories,
  PRIMARY_REPOSITORY,
  TARGET_REPOSITORIES,
} from "./repositories.mjs";

function project(
  id: string,
  status: "active" | "paused",
  repositories: Array<{ id: string; githubUrl: string }>,
): ProjectDefinition {
  return {
    id,
    status,
    authority: { repositoryNodeId: `R_${id}` },
    repositories: repositories.map((repository) => ({
      ...repository,
      displayName: repository.id,
      description: `${id} repository`,
      integrationBranch: "main",
    })),
  } as unknown as ProjectDefinition;
}

const ELIZA = project("eliza", "active", [
  { id: "elizaOS/eliza", githubUrl: "https://github.com/elizaOS/eliza" },
]);
const ASI = project("asi", "active", [
  { id: "elizaOS/asi", githubUrl: "https://github.com/SlopDotCash/asi" },
]);
const PAUSED = project("monna", "paused", [
  { id: "someone/monna", githubUrl: "https://github.com/someone/monna" },
]);

describe("collectTargetRepositories", () => {
  it("collects only active projects from the current registry", () => {
    expect(
      TARGET_REPOSITORIES.every(
        (repository) =>
          PROJECTS.find((entry) => entry.id === repository.projectId)
            ?.status === "active",
      ),
    ).toBe(true);
    expect(collectTargetRepositories(PROJECTS)).toEqual([
      ...TARGET_REPOSITORIES,
    ]);
    expect(TARGET_REPOSITORIES.map((repository) => repository.id)).toEqual([
      "elizaOS/eliza",
      "elizaOS/asi",
      "heirlabs/element-sdk",
      "elizaOS/proximityprize",
    ]);
    expect(PRIMARY_REPOSITORY.id).toBe("elizaOS/eliza");
    expect(PRIMARY_REPOSITORY.role).toBe("primary");
  });

  it("collects no rows for a paused project", () => {
    const collected = collectTargetRepositories([ELIZA, ASI, PAUSED]);
    expect(collected.map((repository) => repository.id)).toEqual([
      "elizaOS/eliza",
      "elizaOS/asi",
    ]);
    expect(
      collected.some((repository) => repository.projectId === "monna"),
    ).toBe(false);
  });

  it("keeps an active project whose authority is unverified", () => {
    // heir-elements-sdk is active with authority.state "unverified", legal
    // under project-schema because its receipts are pending and its payments
    // are disabled. Gating on authority rather than status would drop it.
    const heir = PROJECTS.find((entry) => entry.id === "heir-elements-sdk");
    expect(heir?.status).toBe("active");
    expect(heir?.authority.state).toBe("unverified");
    expect(
      TARGET_REPOSITORIES.some(
        (repository) => repository.projectId === "heir-elements-sdk",
      ),
    ).toBe(true);
  });

  it("promotes the next active project when the first one is paused", () => {
    const pausedEliza = project("eliza", "paused", [
      { id: "elizaOS/eliza", githubUrl: "https://github.com/elizaOS/eliza" },
    ]);
    const collected = collectTargetRepositories([pausedEliza, ASI]);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      id: "elizaOS/asi",
      projectId: "asi",
      role: "primary",
    });
  });

  it("returns nothing when every project is paused", () => {
    expect(collectTargetRepositories([PAUSED])).toEqual([]);
  });
});
