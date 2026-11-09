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
    await persistence.createProject(
      {
        manifest,
        manifestText: text,
        manifestSha256: sha(text),
        reason: "Created through self-service setup",
        actor: ACTOR,
        at: T,
        referrer: null,
      },
      await persistence.enforcementGeneration(),
    ),
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

test("a repository path acquired by another project before commit refuses the whole revision", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);
  const original = JSON.parse(
    JSON.stringify(asiFixture()).replaceAll("SlopDotCash/asi", "elizaOS/asi"),
  ) as ProjectDefinition;
  const before: ProjectDefinition = {
    ...original,
    status: "paused",
    repositories: [
      {
        ...original.repositories[0],
        aliases: undefined,
        displayName: "elizaOS/asi",
        githubUrl: "https://github.com/elizaOS/asi",
      },
    ],
  };
  await createPaused(persistence, before);
  const other = findProject("canonry");
  if (!other) throw new Error("Second fixture missing");
  await createPaused(persistence, {
    ...structuredClone(other),
    status: "paused",
  });
  // Another committed writer acquires the proposed path after the caller's
  // registry snapshot. The unique D1 index is the final authority at commit.
  sqlite
    .query(
      "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    )
    .run("slopdotcash/asi", other.id);
  const after = { ...asiFixture(), status: "active" } as ProjectDefinition;
  const text = JSON.stringify(after);
  const result = await persistence.appendProjectRevision(
    {
      projectId: "asi",
      expectedRevision: 1,
      manifest: after,
      manifestText: text,
      manifestSha256: sha(text),
      reason: "Record transfer",
      actor: ACTOR,
      at: R,
    },
    0,
  );
  expect({
    result,
    revision: (await persistence.getProject("asi"))?.revision,
    aliasOwner: (
      sqlite
        .query(
          "SELECT project_id FROM project_repositories WHERE repository_key=?",
        )
        .get("slopdotcash/asi") as { project_id: string }
    ).project_id,
  }).toEqual({ result: "conflict", revision: 1, aliasOwner: other.id });
});

function revisionInput(manifest: ProjectDefinition, expectedRevision = 1) {
  const manifestText = JSON.stringify(manifest);
  return {
    projectId: manifest.id, expectedRevision, manifest, manifestText,
    manifestSha256: sha(manifestText), reason: "Reviewed source-only regression",
    actor: ACTOR, at: R,
  };
}

test("an enforcement generation mismatch leaves revision and pointer unchanged", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);
  const manifest = { ...asiFixture(), status: "paused" } as ProjectDefinition;
  try {
    await createPaused(persistence, manifest);
    const before = await persistence.getProject(manifest.id);
    const result = await persistence.appendProjectRevision(
      revisionInput({ ...manifest, headline: "A changed but uncommitted headline." }),
      (await persistence.enforcementGeneration()) + 1,
    );
    expect(result).toBe("conflict");
    expect(await persistence.getProject(manifest.id)).toEqual(before);
    expect((await persistence.listRevisions()).map((row) => row.revision)).toEqual([1]);
  } finally { sqlite.close(); }
});

test("a new assessment fences an append checked against earlier admission state", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);
  const manifest = { ...asiFixture(), status: "paused" } as ProjectDefinition;
  try {
    await createPaused(persistence, manifest);
    const expectedClearanceGeneration = await persistence.clearanceGeneration(manifest.id);
    const current = await persistence.getProject(manifest.id);
    if (!current) throw new Error("Missing project");
    sqlite.query(`INSERT INTO vetting_assessments
      (id,project_id,revision,manifest_sha256,content_sha256,commit_sha,template_sha256,
       requested_by_github_id,requested_by_github_login,requested_at,request_reason,state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')`)
      .run("vet_revisionrace0001", manifest.id, 1, current.manifestSha256, "a".repeat(64),
        "b".repeat(40), "c".repeat(64), ACTOR.githubId, ACTOR.githubLogin, R, "Refresh admission evidence");
    expect(await persistence.clearanceGeneration(manifest.id)).not.toBe(expectedClearanceGeneration);
    const result = await persistence.appendProjectRevision({
      ...revisionInput({ ...manifest, headline: "Candidate checked before the new assessment." }),
      expectedClearanceGeneration,
    }, await persistence.enforcementGeneration());
    expect(result).toBe("conflict");
    expect((await persistence.getProject(manifest.id))?.revision).toBe(1);
    expect((await persistence.listRevisions()).map((row) => row.revision)).toEqual([1]);
  } finally { sqlite.close(); }
});

test("a committed revision survives a lost batch reply and same-base retry cannot append again", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);
  const manifest = { ...asiFixture(), status: "paused" } as ProjectDefinition;
  let loseReply = true;
  const losing: typeof db = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      const result = await db.batch(statements);
      if (loseReply) { loseReply = false; throw new Error("revision batch reply lost"); }
      return result;
    },
  };
  try {
    await createPaused(persistence, manifest);
    const input = revisionInput({ ...manifest, headline: "The committed revision remains recorded." });
    const writer = new CloudflareProjectPersistence(losing);
    await expect(writer.appendProjectRevision(input, 0)).rejects.toThrow("revision batch reply lost");
    expect((await persistence.getProject(manifest.id))?.revision).toBe(2);
    const retained = sqlite.query("SELECT * FROM notifications ORDER BY event_key,recipient_github_id").all();
    expect(await writer.appendProjectRevision(input, 0)).toBe("conflict");
    expect((await persistence.listRevisions()).map((row) => row.revision)).toEqual([1, 2]);
    expect(sqlite.query("SELECT * FROM notifications ORDER BY event_key,recipient_github_id").all()).toEqual(retained);
  } finally { sqlite.close(); }
});

test("a late notification write failure rolls back its revision and current pointer", async () => {
  const { db, sqlite } = sqliteD1(migrations);
  const persistence = new CloudflareProjectPersistence(db);
  const manifest = { ...asiFixture(), status: "paused" } as ProjectDefinition;
  try {
    await createPaused(persistence, manifest);
    const before = await persistence.getProject(manifest.id);
    const aliases = repositoryKeys(sqlite);
    sqlite.exec(`CREATE TRIGGER reject_test_revision_notice BEFORE INSERT ON notifications
      WHEN NEW.event_key LIKE 'project-revision:%'
      BEGIN SELECT RAISE(ABORT,'fixture revision notice unavailable'); END`);
    await expect(persistence.appendProjectRevision(
      revisionInput({ ...manifest, headline: "A candidate whose last statement refuses." }), 0,
    )).rejects.toThrow("fixture revision notice unavailable");
    expect(await persistence.getProject(manifest.id)).toEqual(before);
    expect((await persistence.listRevisions()).map((row) => row.revision)).toEqual([1]);
    expect(repositoryKeys(sqlite)).toEqual(aliases);
    expect(sqlite.query("SELECT event_key FROM notifications WHERE event_key LIKE 'project-revision:%'").all()).toEqual([]);
  } finally { sqlite.close(); }
});
