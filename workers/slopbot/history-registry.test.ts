// HTTP readback only: stored records are controlled fixtures, not model evidence.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import { findRegisteredRepositoryById } from "../../src/lib/repositories.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import worker from "./index";

const repository = "Example/new-history";
const projectId = "new-history";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const at = "2026-10-25T00:00:00.000Z";

function fixture() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const original = JSON.parse(
    JSON.stringify(findProject("asi")).replaceAll(
      "SlopDotCash/asi",
      repository,
    ),
  );
  if (!original) throw new Error("Missing registry fixture");
  const project = assertProjectDefinition({
    ...original,
    id: projectId,
    slug: projectId,
    funding: { ...original.funding, recordsPath: `funding/${projectId}` },
    skill: {
      id: `contribute-to-${projectId}`,
      sourcePath: `skills/contribute-to-${projectId}`,
      publicPath: `/projects/${projectId}/skill.md`,
      publishAtRoot: false,
    },
    reviewSkill: {
      id: `review-${projectId}-contributions`,
      sourcePath: `skills/review-${projectId}-contributions`,
    },
    repositories: [
      {
        ...original.repositories[0],
        id: repository,
        githubUrl: `https://github.com/${repository}`,
        aliases: ["Example/old-history"],
      },
    ],
  });
  function revision(
    status: "active" | "paused",
    listingTier = project.listingTier,
  ) {
    const next = assertProjectDefinition({ ...project, status, listingTier });
    const manifest = JSON.stringify(next);
    const row = sqlite
      .query("SELECT revision FROM projects WHERE id = ?")
      .get(projectId) as { revision: number } | null;
    const number = (row?.revision ?? 0) + 1;
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
      [
        projectId,
        number,
        manifest,
        digest(manifest),
        "HTTP history regression",
        at,
      ],
    );
    if (row)
      sqlite.run(
        "UPDATE projects SET status=?,revision=?,manifest=?,manifest_sha256=? WHERE id=?",
        [status, number, manifest, digest(manifest), projectId],
      );
    else
      sqlite.run(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        [projectId, status, number, manifest, digest(manifest), at, at],
      );
  }
  revision("active");
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [repository.toLowerCase(), projectId],
  );
  const record = JSON.stringify({
    repository,
    pullRequestNumber: 7,
    repositoryNodeId: "R_history",
    pullRequestNodeId: "PR_history",
    headSha: "a".repeat(40),
    sourceDigest: "b".repeat(64),
    supersedes: null,
    revisionReason: null,
  });
  sqlite.run(
    "INSERT INTO slopbot_value_journal(record_digest,assessment_key,repository_node_id,pull_request_node_id,head_sha,source_digest,supersedes,record_json,recorded_at) VALUES (?,?,?,?,?,?,NULL,?,?)",
    [
      digest(record),
      "c".repeat(64),
      "R_history",
      "PR_history",
      "a".repeat(40),
      "b".repeat(64),
      record,
      at,
    ],
  );
  const joint = JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId,
    sourceDigest: "d".repeat(64),
    sources: [
      {
        repository,
        pullRequestNumber: 8,
        repositoryNodeId: "R_history",
        pullRequestNodeId: "PR_joint",
      },
    ],
    claims: [],
    supersedes: [],
    legacyPredecessors: [],
    revisionReason: null,
  });
  sqlite.run(
    "INSERT INTO slopbot_work_unit_journal(record_digest,assessment_key,project_id,source_digest,record_json,recorded_at) VALUES (?,?,?,?,?,?)",
    [digest(joint), "e".repeat(64), projectId, "d".repeat(64), joint, at],
  );
  sqlite.run(
    "INSERT INTO slopbot_penalties(item_node_id,repository_id,project_id,author_github_id,category,table_version,debit_thirds,period,moderator_review,review_key,recorded_at) VALUES ('PR_debit', 123, ?, '456', 'spam', 'v1', 3, '2026-10', 0, 'review', ?)",
    [projectId, at],
  );
  const env = {
    SLOPBOT_DB: db,
    SLOPBOT_QUEUE: {
      send() {
        throw new Error("Read route attempted to queue work");
      },
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => worker.fetch(request, env),
  });
  return {
    sqlite,
    revision,
    record,
    joint,
    get: (path: string) => fetch(new URL(path, server.url)),
    close: () => {
      server.stop(true);
      sqlite.close();
    },
  };
}

for (const kind of [
  "value-assessments",
  "work-unit-assessments",
  "penalties",
] as const) {
  test(`live registered ${kind} remain readable after pause and retirement`, async () => {
    expect(findRegisteredRepositoryById(repository)).toBeNull();
    const f = fixture();
    const path =
      kind === "penalties"
        ? `/v1/penalties?project=${projectId}`
        : `/v1/${kind}?repository=${encodeURIComponent(repository.toLowerCase())}&pull=${kind === "work-unit-assessments" ? 8 : 7}`;
    try {
      for (const state of ["active", "paused", "retired"] as const) {
        if (state !== "active")
          f.revision("paused", state === "retired" ? "retired" : undefined);
        const response = await f.get(path);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const result = await response.json();
        expect(result.records).toHaveLength(1);
        if (kind !== "penalties") {
          expect(result.repository).toBe(repository);
          expect(result.records[0].record_json).toBe(
            kind === "value-assessments" ? f.record : f.joint,
          );
          expect(result.records[0].record_digest).toBe(
            digest(result.records[0].record_json),
          );
        } else expect(result.records[0].item_node_id).toBe("PR_debit");
      }
      if (kind !== "penalties") {
        const alias = await f.get(
          `/v1/${kind}?repository=Example%2Fold-history&pull=${kind === "work-unit-assessments" ? 8 : 7}`,
        );
        expect(alias.status).toBe(200);
        expect((await alias.json()).records).toHaveLength(1);
      }
      const unknown = await f.get(
        kind === "penalties"
          ? "/v1/penalties?project=unregistered"
          : `/v1/${kind}?repository=Example%2Funregistered&pull=7`,
      );
      expect(unknown.status).toBe(400);
      const invalid = await f.get(
        `${path}&after=${kind === "penalties" ? "%2F" : "-1"}`,
      );
      expect(invalid.status).toBe(400);
      f.sqlite.close();
      expect((await f.get(path)).status).toBe(503);
    } finally {
      f.close();
    }
  });
}
