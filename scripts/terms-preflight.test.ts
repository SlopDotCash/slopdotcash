import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  handleProjectArtifactRequest,
  type SkillPublicationDependencies,
} from "../backend/projects/skill-publication";
import type { ProjectRecord } from "../src/lib/project-contracts";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { applicationManifest } from "../tests/project-application-manifest";

type TermsPreflight = {
  preflight(
    projectId: string,
    options?: { testAuthority?: string },
  ): Promise<Record<string, unknown>>;
};

// The shared skill script has no declaration file; type only what this test uses.
const { preflight }: TermsPreflight = await import(
  new URL(
    "../skills/project-contributor-template/scripts/terms-preflight.mjs",
    import.meta.url,
  ).href
);

const PROJECT_ID = "open-registry";
let authority = "";

beforeAll(() => {
  authority = mkdtempSync(join(tmpdir(), "slop-terms-preflight-"));
});
afterAll(() => {
  rmSync(authority, { recursive: true, force: true });
});

/** The terms.json body slop.cash serves for an approved project. */
async function servedTerms(): Promise<Record<string, unknown>> {
  const manifest = applicationManifest(
    PROJECT_ID,
    "example/open-registry",
  ) as unknown as ProjectDefinition;
  const record: ProjectRecord = {
    id: PROJECT_ID,
    status: manifest.status,
    revision: 1,
    manifest,
    manifestSha256: "0".repeat(64),
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    sourceApplicationId: null,
    referrer: null,
  };
  const unused = async (): Promise<never> => {
    throw new Error("terms.json does not render skills");
  };
  const dependencies: SkillPublicationDependencies = {
    getProject: async (id) => (id === PROJECT_ID ? record : null),
    listProjects: async () => [record],
    listEnforcements: async () => [],
    loadTemplate: unused,
    vettingClearance: unused,
  };
  const response = await handleProjectArtifactRequest(
    new Request(`https://slop.cash/projects/${PROJECT_ID}/terms.json`),
    dependencies,
  );
  expect(response?.status).toBe(200);
  return (await response?.json()) as Record<string, unknown>;
}

function acknowledge(policy: Record<string, unknown>) {
  const directory = join(authority, "projects", PROJECT_ID);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "terms.json"), JSON.stringify(policy));
  return preflight(PROJECT_ID, {
    testAuthority: pathToFileURL(authority).href,
  });
}

test("acknowledges the terms.json slop.cash serves for a project without a bounty program", async () => {
  const policy = await servedTerms();
  expect(policy.securityBounty).toBeNull();
  expect(await acknowledge(policy)).toMatchObject({
    policyRevision: "draft-1",
    licenseSha256: null,
    inboundTermsSha256: null,
    prizeRulesSha256: null,
  });
});

test("acknowledges public security bounty terms and a policy served before them", async () => {
  const { securityBounty: _bounty, ...earlier } = await servedTerms();
  const program = { version: "1", status: "open", rewardMode: "bounty-only" };
  expect(
    await acknowledge({ ...earlier, securityBounty: program }),
  ).toMatchObject({ policyRevision: "draft-1" });
  expect(await acknowledge(earlier)).toMatchObject({
    policyRevision: "draft-1",
  });
});
