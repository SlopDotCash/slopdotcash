/**
 * A delisting appends a revision whose manifest is paused and retired:
 * the project leaves every page and list, while its history still resolves
 * (AGENTS.md, "Add a project"). Its recorded cycles are that history — the
 * cycle archive and the profile payment history keep linking to them — so
 * the project a cycle page resolves must come from history once the listed
 * registry no longer carries it, with the project's real name.
 *
 * This test copies the tree with the frozen fixture registry, retires
 * eliza there, and runs the real cycle-index builder plus the registry
 * resolvers in a separate process so they read the retired registry.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCheckout } from "../tests/fixture-checkout";

let root = "";

beforeAll(() => {
  root = fixtureCheckout("retired-cycle-arrival-");
  const registryPath = join(root, "src/lib/project-registry.generated.mjs");
  writeFileSync(
    registryPath,
    `${readFileSync(registryPath, "utf8")}\nconst retiredProject = RAW_PROJECT_DEFINITIONS.find((p) => p.id === "eliza");\nretiredProject.status = "paused";\nretiredProject.listingTier = "retired";\n`,
  );
  writeFileSync(
    join(root, "retired-cycle-check.ts"),
    `
import { syncCycleIndex } from "./scripts/sync-cycle-index";
import { findCycleProject, findHistoricalProject, findProject } from "./src/lib/projects.mjs";
const index = await syncCycleIndex();
const cycleProject = findCycleProject("eliza");
const record =
  cycleProject === null
    ? null
    : (index.cycles.find(
        (cycle) =>
          cycle.projectId === cycleProject.id && cycle.cycleId === "2026-09",
      ) ?? null);
console.log(
  JSON.stringify({
    record: record
      ? { contributors: record.contributors.length, state: record.state }
      : null,
    listed: findProject("eliza")?.id ?? null,
    cycleProject: cycleProject
      ? {
          id: cycleProject.id,
          name: cycleProject.name,
          listingTier: cycleProject.listingTier,
          status: cycleProject.status,
        }
      : null,
    listedProject: findCycleProject("asi")
      ? { id: findCycleProject("asi").id, listingTier: findCycleProject("asi").listingTier }
      : null,
    unknown: findCycleProject("no-such-project"),
    // The id lookup normalizes case and surrounding space, like the
    // listed registry lookup: the schema pins slug to id, so the
    // slug fallback and the history lookup must agree on both.
    cycleUpper: findCycleProject("ELIZA")?.id ?? null,
    cycleSpaced: findCycleProject(" eliza ")?.id ?? null,
    historicalUpper: findHistoricalProject("ELIZA")?.id ?? null,
  }),
);
`,
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

test("a retired project's recorded cycle still resolves", () => {
  const result = spawnSync(
    process.execPath,
    ["run", "retired-cycle-check.ts"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 180000,
    },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || String(result.error));
  const out = JSON.parse(result.stdout) as {
    record: { contributors: number; state: string } | null;
    listed: string | null;
    cycleProject: {
      id: string;
      name: string;
      listingTier: string;
      status: string;
    } | null;
    listedProject: { id: string; listingTier: string } | null;
    unknown: unknown;
    cycleUpper: string | null;
    cycleSpaced: string | null;
    historicalUpper: string | null;
  };
  // The frozen record is real and keeps its contributors.
  expect(out.record).not.toBeNull();
  expect(out.record?.contributors).toBe(41);
  // Retirement still removes the project from the listed registry.
  expect(out.listed).toBeNull();
  // The cycle route's resolver finds the retired project in history, with
  // its real name and its retired state intact.
  expect(out.cycleProject).toEqual({
    id: "eliza",
    name: "Eliza",
    listingTier: "retired",
    status: "paused",
  });
  // A listed project still resolves to its listed manifest, and an unknown
  // id still resolves to nothing.
  expect(out.listedProject?.id).toBe("asi");
  expect(out.listedProject?.listingTier).not.toBe("retired");
  expect(out.unknown).toBeNull();
  // Uppercase and spaced ids resolve to the same retired project.
  expect(out.cycleUpper).toBe("eliza");
  expect(out.cycleSpaced).toBe("eliza");
  expect(out.historicalUpper).toBe("eliza");
}, 240000);
