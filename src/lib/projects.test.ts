/** Verifies launch project policy, ownership, and fail-closed lookups. */

import { describe, expect, it } from "vitest";
import {
  findProject,
  findProjectByRepositoryId,
  PROJECTS,
} from "./projects.mjs";
import { findTargetRepository, TARGET_REPOSITORIES } from "./repositories.mjs";

describe("project registry", () => {
  it("defines the launch projects with distinct reward semantics", () => {
    expect(findProject("eliza")?.reward).toMatchObject({
      kind: "monthly-pool",
      monthlyCapMinor: "5000000000",
      rewardStartAt: "2026-07-07T00:00:00.000Z",
    });
    expect(findProject("asi")?.reward).toMatchObject({
      kind: "monthly-pool",
      monthlyCapMinor: "1000000000",
      rewardStartAt: "2026-08-12T00:00:00.000Z",
    });
    expect(findProject("heir-elements-sdk")?.reward).toMatchObject({
      kind: "monthly-pool",
      monthlyCapMinor: "100000000",
      rewardStartAt: "2026-08-16T01:15:28.387Z",
    });
    expect(findProject("heir-elements-sdk")?.links.creator).toBe(
      "https://github.com/awidearray",
    );
    expect(findProject("delta-star")?.reward).toMatchObject({
      kind: "external-prize-share",
      monthlyCapMinor: "0",
    });
  });

  it("migrates Heir without rewriting repository identity or activating proprietary code", () => {
    expect(findProject("heir-elements-sdk")).toMatchObject({
      status: "paused",
      authority: { repositoryId: "1013158722" },
      repositories: [{ id: "heirlabs/element-sdk" }],
    });
    expect(findProject("heir-desk-sdk")).toMatchObject({
      status: "paused",
      authority: { repositoryId: "1319094945", state: "unverified" },
      repositories: [{ id: "heirlabs/elements-sdk" }],
      terms: {
        repositoryLicense: {
          state: "verified",
          spdx: "LicenseRef-Heir-Proprietary",
        },
        receiptPolicy: { state: "pending-authority-activation" },
      },
      reward: { committedMinor: "0", paymentMode: "disabled" },
    });
  });

  it("owns every target repository exactly once", () => {
    expect(
      TARGET_REPOSITORIES.map((repository) => [
        repository.id,
        repository.projectId,
      ]),
    ).toEqual(
      PROJECTS.filter((project) => project.status === "active").flatMap(
        (project) =>
          project.repositories.map((repository) => [repository.id, project.id]),
      ),
    );
    expect(
      new Set(TARGET_REPOSITORIES.map((repository) => repository.id)).size,
    ).toBe(TARGET_REPOSITORIES.length);
    expect(findProjectByRepositoryId("ELIZAOS/ELIZA")?.id).toBe("eliza");
    expect(findProjectByRepositoryId("SlopDotCash/proximityprize")?.id).toBe(
      "delta-star",
    );
    expect(findProjectByRepositoryId("SlopDotCash/asi")?.id).toBe("asi");
    expect(findTargetRepository("SlopDotCash", "proximityprize")).toMatchObject(
      {
        id: "elizaOS/proximityprize",
        owner: "SlopDotCash",
        name: "proximityprize",
        expectedNodeId: "R_kgDOT48hJQ",
      },
    );
    expect(findTargetRepository("SlopDotCash", "asi")).toMatchObject({
      id: "elizaOS/asi",
      owner: "SlopDotCash",
      name: "asi",
      expectedNodeId: "R_kgDOT23CXA",
    });
    expect(findProjectByRepositoryId("unknown/repository")).toBeNull();
  });

  it.each(["monna-agent-permission-diff", "monna-visual-strategy-canvas"])(
    "keeps %s a paused, unfunded proposal",
    (id) => {
      expect(findProject(id)).toMatchObject({
        status: "paused",
        listingTier: "community",
        authority: { state: "unverified", proof: null },
        terms: {
          receiptPolicy: {
            state: "pending-authority-activation",
            bindings: [],
          },
          copyright: { model: "unknown" },
          inbound: { mode: "unknown" },
        },
        reward: {
          monthlyCapMinor: "0",
          committedMinor: "0",
          paymentMode: "disabled",
        },
      });
    },
  );

  it("keeps Darling paused and outside the collection inventory", () => {
    expect(findProject("darling-arm64")).toMatchObject({
      status: "paused",
      authority: { state: "unverified", proof: null },
      reward: { committedMinor: "0", paymentMode: "disabled" },
    });
    expect(
      TARGET_REPOSITORIES.some(
        (repository) => repository.projectId === "darling-arm64",
      ),
    ).toBe(false);
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
