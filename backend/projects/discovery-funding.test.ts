import { expect, test } from "bun:test";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { handleProjectArtifactRequest } from "./skill-publication";

const NOW = new Date("2026-11-16T12:00:00Z");

function record(
  id: string,
  overrides: Record<string, unknown> = {},
): ProjectRecord {
  const manifest = applicationManifest(id, `example/${id}`, {
    status: "active",
    ...overrides,
  }) as unknown as ProjectDefinition;
  return {
    id,
    status: manifest.status,
    revision: 1,
    manifest,
    manifestSha256: "0".repeat(64),
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    sourceApplicationId: null,
    referrer: null,
  };
}

const pool = record("pool-project");
const overridden = record("overridden-project", {
  reward: {
    ...pool.manifest.reward,
    cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "0" }],
  },
});
const security = record("security-project", {
  securityBounty: { status: "open" },
  reward: { ...pool.manifest.reward, monthlyCapMinor: "0" },
});
const paused = record("paused-project", { status: "paused" });
const retired = record("retired-project", { listingTier: "retired" });

async function discovered(now: Date): Promise<string[]> {
  const response = await handleProjectArtifactRequest(
    new Request("https://slop.cash/.well-known/slop/projects.json"),
    {
      getProject: async () => null,
      listProjects: async () => [pool, overridden, security, paused, retired],
      listEnforcements: async () => [],
      loadTemplate: async () => ({
        index: { templateSha256: "a".repeat(64) } as never,
        readFile: async () => new Uint8Array(),
      }),
      vettingClearance: async () => ({
        state: "cleared",
        assessment: null,
        grandfathered: true,
      }),
      now: () => now,
    },
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  const body = (await response?.json()) as {
    projects: { project_id: string }[];
  };
  return body.projects.map((entry) => entry.project_id);
}

test("discovery lists active pools with a positive current UTC amount and open bounties", async () => {
  expect(await discovered(NOW)).toEqual(["pool-project", "security-project"]);
  expect(await discovered(new Date("2026-12-01T00:00:00Z"))).toEqual([
    "pool-project",
    "overridden-project",
    "security-project",
  ]);
});
