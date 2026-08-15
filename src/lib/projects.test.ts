/** Verifies launch project policy, ownership, and fail-closed lookups. */

import { describe, expect, it } from "vitest";
import {
  findProject,
  findProjectByRepositoryId,
  PROJECTS,
} from "./projects.mjs";
import { TARGET_REPOSITORIES } from "./repositories.mjs";

describe("project registry", () => {
  it("defines the two launch projects with distinct reward semantics", () => {
    expect(PROJECTS.map((project) => project.id)).toEqual([
      "eliza",
      "asi",
      "delta-star",
    ]);
    expect(findProject("eliza")?.reward).toMatchObject({
      kind: "monthly-pool",
      monthlyCapMinor: "10000000000",
      rewardStartAt: "2026-07-07T00:00:00.000Z",
    });
    expect(findProject("asi")?.reward).toMatchObject({
      kind: "monthly-pool",
      monthlyCapMinor: "5000000000",
      rewardStartAt: "2026-08-12T00:00:00.000Z",
    });
    expect(findProject("delta-star")?.reward).toMatchObject({
      kind: "external-prize-share",
      monthlyCapMinor: "0",
    });
  });

  it("owns every target repository exactly once", () => {
    expect(
      TARGET_REPOSITORIES.map((repository) => [
        repository.id,
        repository.projectId,
      ]),
    ).toEqual([
      ["elizaOS/eliza", "eliza"],
      ["elizaOS/asi", "asi"],
      ["elizaOS/proximityprize", "delta-star"],
    ]);
    expect(findProjectByRepositoryId("ELIZAOS/ELIZA")?.id).toBe("eliza");
    expect(findProjectByRepositoryId("unknown/repository")).toBeNull();
  });

  it("allows every model while requiring a concrete disclosure", () => {
    for (const project of PROJECTS) {
      expect(project.modelPolicy).toEqual({
        mode: "open-declared",
        disclosureRequired: true,
      });
    }
  });
});
