/**
 * A repository that scored before the D1 registry keeps its project id in
 * contributor points and profiles. Re-registering it under a new id would key
 * a second award for the same merged pull request, so the registry refuses it
 * at admission and keeps accepting the historical id.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import {
  findHistoricalProject,
  type ProjectDefinition,
} from "../src/lib/projects.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const LEGACY_ID = "thenetwork";
const LEGACY_REPOSITORY = "eliza-research/thenetwork";
const CONFLICT = `project registry lists ${LEGACY_REPOSITORY} under id the-network; contributor history keeps it under id ${LEGACY_ID}`;

/** The frozen fixture registry still lists the legacy projects under their ids. */
function fixtureProject(id: string): ProjectDefinition {
  const project = findHistoricalProject(id);
  if (!project) throw new Error(`fixture project ${id} is missing`);
  return JSON.parse(JSON.stringify(project)) as ProjectDefinition;
}

/** The same manifest under another id, the way the form slug would produce it. */
function renamed(project: ProjectDefinition, id: string): ProjectDefinition {
  return {
    ...project,
    id,
    slug: id,
    skill: {
      ...project.skill,
      id: `contribute-to-${id}`,
      sourcePath: `skills/contribute-to-${id}`,
      publicPath: `/projects/${id}/skill.md`,
    },
    reviewSkill: {
      id: `review-${id}-contributions`,
      sourcePath: `skills/review-${id}-contributions`,
    },
    funding: { ...project.funding, recordsPath: `funding/${id}` },
  };
}

test("the registry refuses a legacy repository under a new project id", () => {
  const project = fixtureProject(LEGACY_ID);
  expect(project.repositories[0]?.id).toBe(LEGACY_REPOSITORY);
  expect(() =>
    assertProjectRegistry([renamed(project, "the-network")]),
  ).toThrow(CONFLICT);
  expect(assertProjectRegistry([project])).toHaveLength(1);
});

test("a legacy alias is bound to the same historical id", () => {
  const asi = fixtureProject("asi");
  const [repository] = asi.repositories;
  expect(repository?.id).toBe("elizaOS/asi");
  expect(repository?.aliases).toEqual(["SlopDotCash/asi"]);
  const transferred = {
    ...asi,
    repositories: [
      { ...repository, id: "SlopDotCash/asi", aliases: ["elizaOS/asi"] },
    ],
  } as ProjectDefinition;
  expect(assertProjectRegistry([transferred])).toHaveLength(1);
  expect(() =>
    assertProjectRegistry([renamed(transferred, "asi-research")]),
  ).toThrow("contributor history keeps it under id asi");
});

/** The creation route as /projects/new reaches it, on the real migrations. */
async function submit(id: string): Promise<{ status: number; body: unknown }> {
  const deps: ProjectApiDependencies = {
    persistence: new CloudflareProjectPersistence(
      sqliteD1(
        readdirSync(new URL("../migrations/", import.meta.url))
          .filter((name) => name.endsWith(".sql"))
          .sort(),
      ).db,
    ),
    adminGithubIds: new Set(["900000001"]),
    moderatorGithubIds: new Set(),
    vettingClearance: async () => ({ state: "unscanned" }),
    now: () => new Date("2026-10-19T12:00:00.000Z"),
    randomId: () => "00000000-0000-4000-8000-000000000001",
    sessionActor: async () => ({
      githubId: "900000002",
      githubLogin: "applicant",
    }),
    readTokenMetadata: async () => {
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
    },
    repositoryControl: async () => ({
      state: "proven",
      reason: "@applicant owns the repository",
    }),
  };
  const response = await handleProjectApi(
    new Request("https://slop.cash/api/v1/projects", {
      method: "POST",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        manifest: applicationManifest(id, LEGACY_REPOSITORY),
      }),
    }),
    deps,
  );
  if (!response) throw new Error("project route was not handled");
  return { status: response.status, body: await response.json() };
}

test("a project for a legacy repository must reuse its historical id", async () => {
  const conflict = await submit("the-network");
  expect(conflict.status).toBe(409);
  expect(conflict.body).toEqual({
    error: "registry_conflict",
    message: CONFLICT,
  });
  const accepted = await submit(LEGACY_ID);
  expect(accepted.status).toBe(201);
});
