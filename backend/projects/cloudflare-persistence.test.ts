// The live repository key index must carry every path a manifest claims —
// the repository id and its aliases. A rename or transfer appends the
// current path as an alias while the id keeps the original path, so writing
// only the id leaves Slopbot's live registry lookup resolving neither name.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import {
  findProject,
  type ProjectDefinition,
} from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { repositoryCapabilities } from "../../workers/slopbot/registry";
import { CloudflareProjectPersistence } from "./cloudflare-persistence";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const T = "2026-10-24T00:00:00.000Z";
const R = "2026-10-24T01:00:00.000Z";
const ACTOR = { githubId: "900000002", githubLogin: "applicant" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function asiFixture(): ProjectDefinition {
  const found = findProject("asi");
  if (!found) throw new Error("asi fixture missing");
  return structuredClone(found);
}

function repositoryKeys(sqlite: ReturnType<typeof sqliteD1>["sqlite"]) {
  return sqlite
    .query("SELECT repository_key FROM project_repositories ORDER BY 1")
    .all()
    .map((row) => (row as { repository_key: string }).repository_key);
}

async function createPaused(
  persistence: CloudflareProjectPersistence,
  manifest: ProjectDefinition,
) {
  const text = JSON.stringify(manifest);
  expect(
    await persistence.createProject({
      manifest,
      manifestText: text,
      manifestSha256: sha(text),
      reason: "Created through self-service setup",
      actor: ACTOR,
      at: T,
      referrer: null,
    }),
  ).toBe("created");
}

async function appendRevision(
  persistence: CloudflareProjectPersistence,
  manifest: ProjectDefinition,
  reason: string,
) {
  const text = JSON.stringify(manifest);
  expect(
    await persistence.appendProjectRevision(
      {
        projectId: "asi",
        expectedRevision: 1,
        manifest,
        manifestText: text,
        manifestSha256: sha(text),
        reason,
        actor: ACTOR,
        at: R,
      },
      0,
    ),
  ).toBe("updated");
}

test("renamed repository (alias is the current name) resolves in the live registry", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);

  // The asi fixture's real shape: the repository was transferred, so
  // repositories[0].id is the original name "elizaOS/asi" and the CURRENT
  // name "SlopDotCash/asi" is the appended alias / githubUrl.
  const manifest: ProjectDefinition = {
    ...asiFixture(),
    status: "paused", // new projects are created paused
  };
  await createPaused(persistence, manifest);

  // The key index must cover every registered identity (id + aliases),
  // which is the set assertProjectRegistry treats as claimed and the set
  // migrations/0019 calls "unique across the whole registry".
  expect(repositoryKeys(sqlite)).toEqual(["elizaos/asi", "slopdotcash/asi"]);

  // Activate the project with an otherwise unchanged revision.
  const active = { ...manifest, status: "active" } as ProjectDefinition;
  await appendRevision(persistence, active, "Activate");
  expect(repositoryKeys(sqlite)).toEqual(["elizaos/asi", "slopdotcash/asi"]);

  // A Slopbot job for the repository's current name must resolve.
  const resolved = await repositoryCapabilities(db as never, {
    owner: "SlopDotCash",
    repo: "asi",
    repositoryId: 1332593244,
  });
  expect(resolved.projectId).toBe("asi");
  expect(resolved.capabilities.mayOfferContributorWork).toBe(true);
});

test("a legal transfer revision (alias append) keeps the repository resolvable", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);

  // Start pre-transfer: id is the current name, no aliases, and every
  // repository-bound URL (authority proof, license, inbound terms, links)
  // sits under the original name, as the schema requires.
  const replaced = JSON.parse(
    JSON.stringify(asiFixture()).replaceAll("SlopDotCash/asi", "elizaOS/asi"),
  ) as ProjectDefinition;
  const before: ProjectDefinition = {
    ...replaced,
    status: "paused",
    repositories: [
      {
        ...replaced.repositories[0],
        aliases: undefined,
        displayName: "elizaOS/asi",
        githubUrl: "https://github.com/elizaOS/asi",
      },
    ],
  };
  await createPaused(persistence, before);

  // Control: before the transfer, the original name resolves to the project.
  const beforeResolution = await repositoryCapabilities(db as never, {
    owner: "elizaOS",
    repo: "asi",
    repositoryId: 1332593244,
  });
  expect(beforeResolution.projectId).toBe("asi");

  // The transfer revision is exactly the one the registry rules allow:
  // same id, one appended alias equal to the new current path,
  // displayName/githubUrl moved to it. Its end state is the asi fixture's
  // own recorded registry state, i.e. the outcome of a real transfer.
  const after: ProjectDefinition = { ...asiFixture(), status: "active" };
  await appendRevision(persistence, after, "Record repository transfer");

  expect(repositoryKeys(sqlite)).toEqual(["elizaos/asi", "slopdotcash/asi"]);

  const resolved = await repositoryCapabilities(db as never, {
    owner: "SlopDotCash",
    repo: "asi",
    repositoryId: 1332593244,
  });
  expect(resolved.projectId).toBe("asi");
  expect(resolved.capabilities.mayOfferContributorWork).toBe(true);
});
