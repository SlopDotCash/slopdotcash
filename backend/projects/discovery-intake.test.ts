import { expect, test } from "bun:test";
import type { IntakeCount } from "../../src/lib/intake-cap.mjs";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import {
  handleProjectArtifactRequest,
  type SkillPublicationDependencies,
} from "./skill-publication";

const NOW = new Date("2026-11-17T12:00:00Z");
const OBSERVED = "2026-11-17T11:17:00.000Z";

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

// Open security programs stay listed whatever their pool funding, so these
// projects isolate the intake cap from the funding rule.
const capped = record("capped-project", {
  securityBounty: { status: "open" },
  slopbot: { automaticClosure: false, intakeCap: 20 },
});
const open = record("open-project", { securityBounty: { status: "open" } });

function counts(openOutside: number, observedAt = OBSERVED) {
  return new Map<string, IntakeCount[]>([
    ["capped-project", [{ openOutside, observedAt }]],
    // A project without the setting is never paused by its count.
    ["open-project", [{ openOutside: 9_999, observedAt }]],
  ]);
}

async function discovered(
  intakeCounts?: SkillPublicationDependencies["intakeCounts"],
): Promise<string[]> {
  const response = await handleProjectArtifactRequest(
    new Request("https://slop.cash/.well-known/slop/projects.json"),
    {
      getProject: async () => null,
      listProjects: async () => [capped, open],
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
      poolFunding: async () => null,
      ...(intakeCounts ? { intakeCounts } : {}),
      now: () => NOW,
    },
  );
  expect(response?.status).toBe(200);
  const body = (await response?.json()) as {
    projects: { project_id: string }[];
  };
  return body.projects.map((entry) => entry.project_id);
}

test("discovery leaves out a project at its intake cap and lists it again below it", async () => {
  expect(await discovered(async () => counts(20))).toEqual(["open-project"]);
  expect(await discovered(async () => counts(45))).toEqual(["open-project"]);
  expect(await discovered(async () => counts(19))).toEqual([
    "capped-project",
    "open-project",
  ]);
});

test("discovery lists every project when the count cannot be read", async () => {
  const all = ["capped-project", "open-project"];
  expect(await discovered()).toEqual(all);
  expect(await discovered(async () => null)).toEqual(all);
  expect(await discovered(async () => new Map())).toEqual(all);
  expect(
    await discovered(async () => {
      throw new Error("D1 unavailable");
    }),
  ).toEqual(all);
  // A count older than three days no longer pauses.
  expect(
    await discovered(async () => counts(45, "2026-11-14T11:59:59.000Z")),
  ).toEqual(all);
});
