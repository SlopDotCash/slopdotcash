// Slopbot's registry identity for a repository an owner appended to a
// project (PRD section 4): its own GitHub ids decide, never the first
// repository's authority.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  registeredHistoryRepository,
  repositoryCapabilities,
} from "./registry";

const ADDED = "acme-tools/extra";
const at = "2026-11-12T00:00:00.000Z";

function fixture() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const original = fixtureProject("asi");
  const project = assertProjectDefinition({
    ...original,
    repositories: [
      ...original.repositories,
      {
        id: ADDED,
        displayName: ADDED,
        githubUrl: `https://github.com/${ADDED}`,
        description: "Extra tooling used by the research framework.",
        integrationBranch: "main",
        githubId: "555000111",
        nodeId: "R_extra",
        countsFrom: "2026-12-01T00:00:00.000Z",
      },
    ],
  });
  const manifest = JSON.stringify(project);
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
    [project.id, 1, manifest, digest, "Appended repository fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    [project.id, "active", 1, manifest, digest, at, at],
  );
  for (const key of ["slopdotcash/asi", "elizaos/asi", ADDED.toLowerCase()])
    sqlite.run(
      "INSERT OR IGNORE INTO project_repositories(repository_key,project_id) VALUES (?,?)",
      [key, project.id],
    );
  return { db, project };
}

test("an appended repository is reviewed only under its own numeric GitHub id", async () => {
  const { db, project } = fixture();
  const job = { owner: "acme-tools", repo: "extra" };
  expect(
    (await repositoryCapabilities(db, { ...job, repositoryId: 555000111 }))
      .projectId,
  ).toBe(project.id);
  // A reused name under another GitHub id is refused like the first
  // repository's, even if it equals the first repository's id.
  expect(
    await repositoryCapabilities(db, { ...job, repositoryId: 555000112 }),
  ).toMatchObject({ projectId: null, project: null });
  expect(
    await repositoryCapabilities(db, {
      ...job,
      repositoryId: Number(project.authority.repositoryId),
    }),
  ).toMatchObject({ projectId: null, project: null });
  // The first repository is unchanged.
  expect(
    (
      await repositoryCapabilities(db, {
        owner: "SlopDotCash",
        repo: "asi",
        repositoryId: Number(project.authority.repositoryId),
      })
    ).projectId,
  ).toBe(project.id);
  expect(
    (
      await repositoryCapabilities(db, {
        owner: "SlopDotCash",
        repo: "asi",
        repositoryId: 555000111,
      })
    ).projectId,
  ).toBeNull();
});

test("history reads resolve an appended repository by name or by its own node id", async () => {
  const { db, project } = fixture();
  expect(await registeredHistoryRepository(db, ADDED)).toEqual({
    id: ADDED,
    nodeId: "R_extra",
  });
  expect(await registeredHistoryRepository(db, "", "R_extra")).toEqual({
    id: ADDED,
    nodeId: "R_extra",
  });
  expect(
    await registeredHistoryRepository(
      db,
      "",
      project.authority.repositoryNodeId,
    ),
  ).toEqual({
    id: project.repositories[0].id,
    nodeId: project.authority.repositoryNodeId,
  });
  expect(await registeredHistoryRepository(db, "", "R_unknown")).toBeNull();
});
