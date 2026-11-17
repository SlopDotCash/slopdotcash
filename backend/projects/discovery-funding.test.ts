import { expect, test } from "bun:test";
import type { PoolFundingIndex } from "../../src/lib/pool-funding";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import {
  handleProjectArtifactRequest,
  type SkillPublicationDependencies,
} from "./skill-publication";

const NOW = new Date("2026-11-16T12:00:00Z");
const VAULT = "0x4f891b8c3d3fab9150fcdc94176b96863cd02899";

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

const pool = record("pool-project", {
  escrow: { deployments: [{ network: "base-mainnet", vault: VAULT }] },
});
const security = record("security-project", {
  securityBounty: { status: "open" },
});

function funded(freeBalance: string): PoolFundingIndex {
  return new Map([
    [
      "pool-project",
      [
        {
          network: "base-mainnet",
          vault: VAULT,
          freeBalance,
          blockTime: "2026-11-16T11:00:00Z",
          observedAt: "2026-11-16T11:05:00Z",
        },
      ],
    ],
  ]);
}

async function discovered(
  poolFunding: SkillPublicationDependencies["poolFunding"],
): Promise<string[]> {
  const response = await handleProjectArtifactRequest(
    new Request("https://slop.cash/.well-known/slop/projects.json"),
    {
      getProject: async () => null,
      listProjects: async () => [pool, security],
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
      poolFunding,
      now: () => NOW,
    },
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  const body = (await response?.json()) as {
    projects: { project_id: string }[];
  };
  return body.projects.map((entry) => entry.project_id);
}

test("discovery leaves out a monthly pool that is not funded this month", async () => {
  // November needs the $1,000 cap plus nothing owed for October.
  expect(await discovered(async () => funded("999999999"))).toEqual([
    "security-project",
  ]);
  expect(await discovered(async () => new Map())).toEqual(["security-project"]);
});

test("discovery lists the pool once its vault funds this month", async () => {
  expect(await discovered(async () => funded("1000000000"))).toEqual([
    "pool-project",
    "security-project",
  ]);
});

test("discovery lists every cleared project when funding cannot be read", async () => {
  expect(
    await discovered(async () => {
      throw new Error("D1 unavailable");
    }),
  ).toEqual(["pool-project", "security-project"]);
  expect(await discovered(async () => null)).toEqual([
    "pool-project",
    "security-project",
  ]);
});
