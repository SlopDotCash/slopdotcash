import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { emptyPointsJournal, type PointsJournal } from "../src/lib/points";
import {
  assertHistoricalAssessmentFreshness,
  type HistoricalAssessmentScope,
  historicalAssessmentRecordingConditions,
  readHistoricalAssessmentCatalog,
  readHistoricalAssessmentJournalHeads,
} from "./historical-assessment-catalog";
import { classifyHistoricalAssessmentScope } from "./historical-assessment-reconciliation";
import {
  type HistoricalReplayReceipt,
  verifyHistoricalReplayQualification,
} from "./historical-replay-qualification";
import { verifyHistoricalValueReplay } from "./historical-value-replay";
import { HISTORICAL_POINTS_AUDIT_WINDOW } from "./reviewed-historical-points";

const scope: HistoricalAssessmentScope = {
  projectId: "fixture",
  repositoryNodeId: "R_audit",
  revision: 5,
  manifestSha256: "a".repeat(64),
  expectedPointsDigest: "b".repeat(64),
};
const recordedAt = "2026-11-19T12:00:00.000Z";
const headSha = "c".repeat(40);
const sourceDigest = "d".repeat(64);
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");

function database(
  repositories = [{ id: "fixture/repo" }],
  baseline?: PointsJournal,
) {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const filename of [
    "0019_project_registry.sql",
    "0038_slopbot_value_journal.sql",
    "0046_slopbot_work_unit_journal.sql",
  ]) {
    db.exec(
      readFileSync(
        new URL(`../migrations/${filename}`, import.meta.url),
        "utf8",
      ),
    );
  }
  db.exec(`
    CREATE TABLE project_enforcements (id TEXT PRIMARY KEY);
    CREATE TABLE points_batches (
      digest TEXT PRIMARY KEY, generated_at TEXT NOT NULL,
      coverage TEXT NOT NULL CHECK(json_valid(coverage)),
      revision_count INTEGER NOT NULL
    );
    INSERT INTO project_enforcements VALUES ('known');
  `);
  const manifest = JSON.stringify({
    id: scope.projectId,
    status: "active",
    authority: { repositoryNodeId: scope.repositoryNodeId },
    repositories,
  });
  db.query(`INSERT INTO project_revisions (
    project_id, revision, manifest, manifest_sha256, reason, created_at
  ) VALUES (?, ?, ?, ?, 'fixture', ?)`).run(
    scope.projectId,
    scope.revision,
    manifest,
    scope.manifestSha256,
    recordedAt,
  );
  db.query(`INSERT INTO projects (
    id, status, revision, manifest, manifest_sha256, created_at, updated_at
  ) VALUES (?, 'active', ?, ?, ?, ?, ?)`).run(
    scope.projectId,
    scope.revision,
    manifest,
    scope.manifestSha256,
    recordedAt,
    recordedAt,
  );
  db.query("INSERT INTO points_batches VALUES (?, ?, '[]', ?)").run(
    baseline ? sha(JSON.stringify(baseline)) : scope.expectedPointsDigest,
    recordedAt,
    baseline?.revisions.length ?? 120,
  );
  return db;
}

const query = (db: Database, sql: string) =>
  db.query<Record<string, unknown>, []>(sql).all();

test.each(["assessment", "baseline", "registry", "enforcement"] as const)(
  "read-only historical replay rechecks its %s checkpoint",
  async (change) => {
    using db = database();
    const read = async (sql: string) => {
      expect(sql).toMatch(/^SELECT\b/u);
      return query(db, sql);
    };
    const { heads } = await readHistoricalAssessmentCatalog(scope, read);
    legacy(db, "PR_unrelated", { project: "outside", repo: "R_other" });
    await expect(
      assertHistoricalAssessmentFreshness(scope, heads, read),
    ).resolves.toBeUndefined();

    switch (change) {
      case "assessment":
        joint(db, ["PR_new"]);
        break;
      case "baseline":
        db.query("INSERT INTO points_batches VALUES (?, ?, '[]', ?)").run(
          "d".repeat(64),
          "2026-11-19T12:01:00.000Z",
          heads.d1PointsCount,
        );
        break;
      case "registry":
        db.exec(`
          INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at)
          SELECT id, revision + 1, json_set(manifest, '$.status', 'paused'), 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'fixture pause', updated_at FROM projects;
          UPDATE projects SET revision = revision + 1, status = 'paused',
            manifest = json_set(manifest, '$.status', 'paused'), manifest_sha256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        `);
        break;
      case "enforcement":
        db.exec("INSERT INTO project_enforcements VALUES ('new')");
        break;
    }
    await expect(
      assertHistoricalAssessmentFreshness(scope, heads, read),
    ).rejects.toThrow("qualification changed during collection");
  },
);

function legacy(
  db: Database,
  pull: string,
  {
    project = scope.projectId,
    repo = scope.repositoryNodeId,
    supersedes = null,
    detail = "",
  }: {
    project?: string;
    repo?: string;
    supersedes?: string | null;
    detail?: string;
  } = {},
) {
  const raw = JSON.stringify({
    schemaVersion: "slop-value-record:v1",
    projectId: project,
    repositoryNodeId: repo,
    pullRequestNodeId: pull,
    headSha,
    sourceDigest,
    supersedes,
    revisionReason: supersedes ? "successor" : null,
    detail,
  });
  const digest = sha(raw);
  db.query(`INSERT INTO slopbot_value_journal (
    record_digest, assessment_key, repository_node_id, pull_request_node_id,
    head_sha, source_digest, supersedes, record_json, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    digest,
    sha(`legacy ${raw}`),
    repo,
    pull,
    headSha,
    sourceDigest,
    supersedes,
    raw,
    recordedAt,
  );
  return { digest, raw };
}

function joint(
  db: Database,
  pulls: string[],
  {
    project = scope.projectId,
    repo = scope.repositoryNodeId,
    supersedes = [],
  }: { project?: string; repo?: string; supersedes?: string[] } = {},
) {
  const raw = JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId: project,
    sourceDigest,
    sources: pulls.map((pullRequestNodeId) => ({
      repositoryNodeId: repo,
      pullRequestNodeId,
    })),
    claims: [],
    supersedes,
    legacyPredecessors: [],
    revisionReason: supersedes.length ? "successor" : null,
  });
  const digest = sha(raw);
  db.query(`INSERT INTO slopbot_work_unit_journal (
      record_digest, assessment_key, project_id, source_digest, record_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
    digest,
    sha(`joint ${raw}`),
    project,
    sourceDigest,
    raw,
    recordedAt,
  );
  return { digest, raw };
}

test("a reviewed replay reopens the exact donor heads and refuses relevant appends", async () => {
  const baseline = emptyPointsJournal(recordedAt);
  using db = database(undefined, baseline);
  const expectedPointsDigest = sha(JSON.stringify(baseline));
  const exactScope = { ...scope, expectedPointsDigest };
  const read = async (sql: string) => {
    expect(sql).toMatch(/^SELECT\b/u);
    return query(db, sql);
  };
  const catalog = await readHistoricalAssessmentCatalog(exactScope, read);
  const audit = {
    repository: "fixture/repo",
    repositoryNodeId: scope.repositoryNodeId,
    ...HISTORICAL_POINTS_AUDIT_WINDOW,
    sources: [
      {
        id: "PR_reviewed",
        number: 1,
        headSha,
        mergedAt: "2026-10-20T18:00:00.000Z",
      },
    ],
  };
  const packet = {
    projectId: scope.projectId,
    sourceAudit: audit,
    revision: scope.revision,
    manifestSha256: scope.manifestSha256,
    baselineDigest: expectedPointsDigest,
    baselineRevisionCount: baseline.revisions.length,
    valueSnapshot: null,
    valueKeys: [],
  };
  const receipt = await classifyHistoricalAssessmentScope(
    catalog,
    audit,
    packet.projectId,
  );
  const qualificationSha256 = verifyHistoricalValueReplay(
    packet,
    baseline,
    receipt,
    null,
  );
  const reviewed = {
    ...packet,
    replayQualification: {
      runId: 10,
      attempt: 2,
      artifactId: 20,
      qualificationSha256,
    },
  };
  const sourceCommit = "1".repeat(40);
  const donor: HistoricalReplayReceipt = {
    schemaVersion: "1",
    projectId: packet.projectId,
    mode: "assessment-replay",
    status: "no-scoped-active-assessments",
    sourceCommit,
    sourceDigest: receipt.scope.sourceAuditSha256,
    sourceCount: audit.sources.length,
    sourceRepositoryNodeId: audit.repositoryNodeId,
    sourceFrom: audit.from,
    sourceThrough: audit.through,
    expectedPointsDigest,
    baselineRevisionCount: baseline.revisions.length,
    registryRevision: scope.revision,
    registryManifestSha256: scope.manifestSha256,
    enforcementGeneration: 1,
    jointThrough: 0,
    legacyThrough: 0,
    jointRecords: 0,
    legacyRecords: 0,
    receiptDigest: receipt.receiptSha256,
    replay: {
      snapshotSha256: null,
      valueCoverageCount: 0,
      closedUnmergedCoverageCount: 0,
      valueEventCount: 0,
      qualificationSha256,
    },
  };
  joint(db, ["PR_unrelated"], { project: "other", repo: "R_other" });
  legacy(db, "PR_unrelated_legacy", { project: "other", repo: "R_other" });
  const verify = (input = reviewed, recorded = donor) =>
    verifyHistoricalReplayQualification(
      input,
      baseline,
      recorded,
      sourceCommit,
      1,
      read,
    );
  await expect(verify()).resolves.toEqual({
    heads: catalog.heads,
    closedReviews: new Map(),
    receipt,
  });
  await expect(
    verify(reviewed, { ...donor, sourceCommit: "3".repeat(40) }),
  ).rejects.toThrow("differs from the reviewed packet");
  await expect(verify(reviewed, { ...donor, jointThrough: 2 })).rejects.toThrow(
    "scope head unavailable",
  );
  const altered = "0".repeat(64);
  await expect(
    verify(
      {
        ...reviewed,
        replayQualification: {
          ...reviewed.replayQualification,
          qualificationSha256: altered,
        },
      },
      { ...donor, replay: { ...donor.replay, qualificationSha256: altered } },
    ),
  ).rejects.toThrow("differs from the trusted qualification");
  joint(db, [audit.sources[0].id]);
  await expect(verify()).rejects.toThrow(
    "qualification changed during collection",
  );
});

test("the captured dual head alone proves an empty scoped catalog", async () => {
  using db = database();
  let reads = 0;
  const result = await readHistoricalAssessmentCatalog(scope, async (sql) => {
    reads += 1;
    expect(sql).toMatch(/^SELECT\b/u);
    return query(db, sql);
  });
  expect(reads).toBe(1);
  expect(result).toEqual({
    heads: {
      jointThrough: 0,
      legacyThrough: 0,
      jointScopedCount: 0,
      legacyRepoCount: 0,
      d1PointsDigest: scope.expectedPointsDigest,
      d1PointsCount: 120,
      enforcementGeneration: 1,
      registryRevision: scope.revision,
      registryManifestSha256: scope.manifestSha256,
    },
    joint: [],
    legacy: [],
  });
});

test("recording conditions reject applicable assessment appends only", async () => {
  using db = database();
  joint(db, ["PR_known"]);
  legacy(db, "PR_known_legacy");
  const heads = await readHistoricalAssessmentJournalHeads(async (sql) =>
    query(db, sql),
  );
  expect(heads).toEqual({ jointThrough: 1, legacyThrough: 1 });
  const [jointCondition, legacyCondition] =
    historicalAssessmentRecordingConditions(scope, heads);
  const check = () =>
    query(
      db,
      `SELECT ${jointCondition} AS joint_ok, ${legacyCondition} AS legacy_ok`,
    );
  joint(db, ["PR_outside"], { project: "other", repo: "R_other" });
  legacy(db, "PR_outside_legacy", { project: "other", repo: "R_other" });
  expect(check()).toEqual([{ joint_ok: 1, legacy_ok: 1 }]);
  joint(db, ["PR_cross_project_index"], { project: "other" });
  expect(check()).toEqual([{ joint_ok: 0, legacy_ok: 1 }]);
  legacy(db, "PR_late_legacy");
  expect(check()).toEqual([{ joint_ok: 0, legacy_ok: 0 }]);
});

test("fixed keyset pages include predecessors and ignore concurrent appends", async () => {
  using db = database();
  joint(db, ["PR_other"], { project: "outside", repo: "R_outside" });
  legacy(db, "PR_old_outside", { project: "outside", repo: "R_outside" });
  const oldLegacy = legacy(db, "PR_legacy");
  const latestLegacy = legacy(db, "PR_legacy", {
    supersedes: oldLegacy.digest,
  });
  const parent = joint(db, ["PR_z", "PR_a"]);
  for (let i = 0; i < 100; i++) joint(db, [`PR_joint_${i}`]);
  const leaf = joint(db, ["PR_z", "PR_a"], { supersedes: [parent.digest] });
  const input = { ...scope };
  let reads = 0;
  const result = await readHistoricalAssessmentCatalog(input, async (sql) => {
    const rows = query(db, sql);
    reads += 1;
    if (reads === 1) {
      input.repositoryNodeId = "R_outside";
      joint(db, ["PR_late_accepted"]);
      legacy(db, "PR_legacy_later", { repo: scope.repositoryNodeId });
    }
    return rows;
  });
  expect(reads).toBe(7);
  expect(result.heads).toMatchObject({
    jointThrough: 103,
    jointScopedCount: 102,
    legacyThrough: 3,
    legacyRepoCount: 2,
  });
  expect(result.joint.map(({ sequence }) => sequence)).toEqual(
    Array.from({ length: 102 }, (_, index) => index + 2),
  );
  expect(result.joint[0]).toEqual({
    sequence: 2,
    record_digest: parent.digest,
    record_json: parent.raw,
    recorded_at: recordedAt,
    project_id: scope.projectId,
    source_digest: sourceDigest,
    source_keys_json: JSON.stringify([
      [scope.repositoryNodeId, "PR_a"],
      [scope.repositoryNodeId, "PR_z"],
    ]),
  });
  expect(result.joint[101].record_digest).toBe(leaf.digest);
  expect(result.legacy).toEqual([
    {
      sequence: 2,
      record_digest: oldLegacy.digest,
      record_json: oldLegacy.raw,
      recorded_at: recordedAt,
      repository_node_id: scope.repositoryNodeId,
      pull_request_node_id: "PR_legacy",
      head_sha: headSha,
      source_digest: sourceDigest,
      supersedes: null,
    },
    {
      sequence: 3,
      record_digest: latestLegacy.digest,
      record_json: latestLegacy.raw,
      recorded_at: recordedAt,
      repository_node_id: scope.repositoryNodeId,
      pull_request_node_id: "PR_legacy",
      head_sha: headSha,
      source_digest: sourceDigest,
      supersedes: oldLegacy.digest,
    },
  ]);
});

test("the byte budget splits body pages without truncating valid records", async () => {
  using db = database();
  const detail = "💡".repeat(270_000);
  const first = legacy(db, "PR_first", { detail });
  const second = legacy(db, "PR_second", { detail });
  const pages: string[] = [];
  const result = await readHistoricalAssessmentCatalog(scope, async (sql) => {
    if (sql.includes("r.sequence IN")) pages.push(sql);
    return query(db, sql);
  });
  expect(pages).toHaveLength(2);
  expect(result.legacy.map((row) => row.record_digest)).toEqual([
    first.digest,
    second.digest,
  ]);
  expect(result.legacy[0].record_json).toBe(first.raw);
  expect(result.legacy[1].record_json).toBe(second.raw);
});

test("a changed active Points checkpoint or registry fails before scanning journals", async () => {
  using db = database();
  let reads = 0;
  const reader = async (sql: string) => {
    reads += 1;
    return query(db, sql);
  };
  await expect(
    readHistoricalAssessmentCatalog({ ...scope, revision: 6 }, reader),
  ).rejects.toThrow("scope head unavailable");
  expect(reads).toBe(1);
  await expect(
    readHistoricalAssessmentCatalog(
      { ...scope, expectedPointsDigest: "f".repeat(64) },
      reader,
    ),
  ).rejects.toThrow("Points checkpoint");
  expect(reads).toBe(2);
  await expect(
    readHistoricalAssessmentCatalog(
      { ...scope, repositoryNodeId: "R_quote'" },
      reader,
    ),
  ).rejects.toThrow("immutable binding");
  expect(reads).toBe(2);
});

test("same-repository wrong-project assessment and cross-repository members fail closed", async () => {
  using db = database();
  joint(db, ["PR_mislabeled"], { project: "outside" });
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) => query(db, sql)),
  ).rejects.toThrow("differs from project scope");
  await expect(
    readHistoricalAssessmentCatalog(
      { ...scope, repositoryNodeId: "R_different" },
      async (sql) => query(db, sql),
    ),
  ).rejects.toThrow("scope head unavailable");

  using registeredMany = database([
    { id: "fixture/repo" },
    { id: "fixture/other" },
  ]);
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) =>
      query(registeredMany, sql),
    ),
  ).rejects.toThrow("scope head unavailable");

  using mixed = database();
  joint(mixed, ["PR_elsewhere"], { repo: "R_different" });
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) => query(mixed, sql)),
  ).rejects.toThrow("another repository");
  using wrongLegacy = database();
  legacy(wrongLegacy, "PR_mislabeled", { project: "outside" });
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) =>
      query(wrongLegacy, sql),
    ),
  ).rejects.toThrow("differs from its indexed scope");
});

test("missing rows, altered body bytes and source-index loss fail closed", async () => {
  using db = database();
  const stored = joint(db, ["PR_audit"]);
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) =>
      sql.includes("AS record_bytes") ? [] : query(db, sql),
    ),
  ).rejects.toThrow("incomplete descriptor page");
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) =>
      sql.includes("r.sequence IN") ? [] : query(db, sql),
    ),
  ).rejects.toThrow("incomplete body page");
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) => {
      const rows = query(db, sql);
      return sql.includes("r.sequence IN")
        ? rows.map((row) => ({
            ...row,
            record_json: stored.raw.replace("PR_audit", "PR_drift"),
          }))
        : rows;
    }),
  ).rejects.toThrow("stored bytes do not match");

  db.exec("DROP TRIGGER slopbot_work_unit_sources_no_delete");
  db.query("DELETE FROM slopbot_work_unit_sources WHERE record_digest = ?").run(
    stored.digest,
  );
  await expect(
    readHistoricalAssessmentCatalog(scope, async (sql) => query(db, sql)),
  ).rejects.toThrow("source index differs");
});
