import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ProjectRecord } from "../backend/projects/contracts";
import {
  handleProjectArtifactRequest,
  type SkillPublicationDependencies,
  type SkillTemplateIndex,
} from "../backend/projects/skill-publication";
import { PROJECT_SKILL_TEMPLATES } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/project-skill-publication.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { applicationManifest } from "../tests/project-application-manifest";

const PROJECT_ID = "open-registry";
const ROOT = resolve(import.meta.dir, "..");

function files(sourcePath: string): string[] {
  const directory = join(ROOT, sourcePath);
  return readdirSync(directory, { recursive: true })
    .map(String)
    .filter((entry) => statSync(join(directory, entry)).isFile())
    .map((entry) => relative(directory, join(directory, entry)))
    .sort();
}

/** An artifact slop.cash serves for a cleared project, from the real templates. */
async function served(path: string): Promise<Uint8Array> {
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
  const group = async (sourcePath: string) => ({
    sourcePath,
    files: await Promise.all(
      files(sourcePath).map(async (file) => ({
        path: file,
        sha256: await sha256Hex(readFileSync(join(ROOT, sourcePath, file))),
      })),
    ),
  });
  const index: SkillTemplateIndex = {
    schemaVersion: "1",
    repository: "SlopDotCash/slopdotcash",
    commit: "d".repeat(40),
    templateSha256: "d".repeat(64),
    revisionStatus: "committed",
    contributor: await group(PROJECT_SKILL_TEMPLATES.contributor),
    reviewer: await group(PROJECT_SKILL_TEMPLATES.reviewer),
    renderer: {
      paths: ["scripts/render-install-guide.mjs"],
      sources: [],
      revisionStatus: "committed",
    },
    acceptedRevisions: ["current main head"],
  };
  const dependencies: SkillPublicationDependencies = {
    getProject: async (id) => (id === PROJECT_ID ? record : null),
    listProjects: async () => [record],
    listEnforcements: async () => [],
    enforcementGeneration: async () => 0,
    loadTemplate: async () => ({
      index,
      readFile: async (file) => new Uint8Array(readFileSync(join(ROOT, file))),
    }),
    vettingClearance: async (_project, templateSha256) => ({
      state: "cleared",
      assessment: {
        id: "assessment-1",
        revision: 1,
        state: "clean",
        commitSha: "c".repeat(40),
        templateSha256,
        policyVersion: null,
        requestedAt: "2026-10-18T00:00:00.000Z",
        completedAt: "2026-10-18T01:00:00.000Z",
        modelRuns: [],
        artifacts: 0,
        heldArtifacts: 0,
      },
    }),
  };
  const response = await handleProjectArtifactRequest(
    new Request(`https://slop.cash/projects/${PROJECT_ID}/${path}`),
    dependencies,
  );
  expect(response?.status).toBe(200);
  return new Uint8Array(await (response as Response).arrayBuffer());
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("the served contributor archive ships the run-receipt script its skill runs", async () => {
  expect(text(await served("skill.md"))).toContain(
    "scripts/run-receipt.mjs authorize`",
  );
  expect(
    text(await served("downloads/contribute-to-open-registry.skill")),
  ).toContain("contribute-to-open-registry/scripts/run-receipt.mjs");
});
