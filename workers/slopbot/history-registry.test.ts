// HTTP readback only: stored records are controlled fixtures, not model evidence.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import {
  fetchValueHistoryPage,
  fetchWorkUnitHistoryPage,
} from "../../scripts/value-ingestion";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import { findRegisteredRepositoryById } from "../../src/lib/repositories.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import worker from "./index";
import { readValueDecisionFromHistory } from "./value-consumption";
import type { ValueEvidence } from "./value-evidence";
import { readWorkUnitHistory } from "./value-work-unit-consumption";

const repository = "Example/new-history";
const projectId = "new-history";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const at = "2026-10-25T00:00:00.000Z";

function fixture(
  recordRepository = repository,
  currentRepository = repository,
  nodeId = "R_history",
) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const original = JSON.parse(
    JSON.stringify(findProject("asi")).replaceAll(
      "SlopDotCash/asi",
      currentRepository,
    ),
  );
  if (!original) throw new Error("Missing registry fixture");
  const project = assertProjectDefinition({
    ...original,
    authority: { ...original.authority, repositoryNodeId: nodeId },
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
        id: currentRepository,
        githubUrl: `https://github.com/${currentRepository}`,
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
    [currentRepository.toLowerCase(), projectId],
  );
  const record = JSON.stringify({
    schemaVersion: "slop-value-record:v1",
    projectId,
    repository: recordRepository,
    pullRequestNumber: 7,
    repositoryNodeId: nodeId,
    repositoryDatabaseId: 123,
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
      nodeId,
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
    producerRevision: "a".repeat(40),
    assessedAt: at,
    sources: [
      {
        repository: recordRepository,
        pullRequestNumber: 8,
        repositoryNodeId: nodeId,
        repositoryDatabaseId: 123,
        pullRequestNodeId: "PR_joint",
        headSha: "a".repeat(40),
        mergeSha: null,
        policySha: "a".repeat(40),
        sourceDigest: "b".repeat(64),
        occurredAt: at,
      },
    ],
    claims: [],
    units: [],
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

test("ingestion reads existing history through HTTP when registries use different names", async () => {
  const registered = findProject("asi");
  if (!registered) throw new Error("Missing registry fixture");
  const name = registered.repositories[0].id;
  const nodeId = registered.authority.repositoryNodeId;
  const f = fixture(name, "elizaOS/asi", nodeId);
  const requested: string[] = [];
  const transport = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://slopbot.slop.cash");
    requested.push(String(url));
    return f.get(url.pathname + url.search);
  }) as typeof fetch;
  try {
    const single = await fetchValueHistoryPage(name, 7, 0, transport, nodeId);
    expect(single.records[0].record_json).toBe(f.record);
    expect(single.records[0].record_digest).toBe(digest(f.record));
    const joint = await fetchWorkUnitHistoryPage(
      name,
      8,
      0,
      null,
      transport,
      nodeId,
    );
    expect(joint.records[0].record_json).toBe(f.joint);
    expect(joint.records[0].record_digest).toBe(digest(f.joint));
    expect(requested.map((url) => new URL(url).pathname)).toEqual([
      "/v1/value-assessments",
      "/v1/work-unit-assessments",
    ]);
    for (const request of requested) {
      const url = new URL(request);
      expect(url.searchParams.get("repositoryNodeId")).toBe(nodeId);
      expect(url.searchParams.has("repository")).toBe(false);
    }
    await expect(
      fetchValueHistoryPage(name, 7, 0, transport, "R_other"),
    ).rejects.toThrow("identity differs");
    expect(requested).toHaveLength(2);
  } finally {
    f.close();
  }
});

test("history consumers retain registered aliases and reject a different immutable source", async () => {
  const registered = findRegisteredRepositoryById("SlopDotCash/asi");
  if (!registered) throw new Error("Missing registry fixture");
  const repositories = [
    {
      ...registered,
      id: "Example/previous-registration",
      aliases: [repository],
      projectId,
      expectedNodeId: "R_history",
    },
  ];
  const f = fixture();
  const single = async () =>
    (
      await f.get("/v1/value-assessments?repositoryNodeId=R_history&pull=7")
    ).json();
  const joint = async () =>
    (
      await f.get("/v1/work-unit-assessments?repositoryNodeId=R_history&pull=8")
    ).json();
  // Only history identity is under test. This incomplete evidence cannot award Points.
  const evidence = {
    repository: repositories[0].id,
    repositoryNodeId: "R_history",
    repositoryDatabaseId: 123,
    pull: { node_id: "PR_history", number: 7 },
    implementationActorNodeIds: [],
    limitations: ["History readback only"],
  } as unknown as ValueEvidence;
  try {
    const result = await readValueDecisionFromHistory(
      single,
      evidence,
      { sha: "a".repeat(40), text: "History readback" },
      undefined,
      repositories,
    );
    expect(result.status).toBe("incomplete");
    expect(result.history[0].record_json).toBe(f.record);
    const graph = await readWorkUnitHistory(
      joint,
      { repositoryNodeId: "R_history", pullRequestNodeId: "PR_joint" },
      repositories,
    );
    expect(graph.current?.row.record_json).toBe(f.joint);
    await expect(
      readValueDecisionFromHistory(
        single,
        { ...evidence, repositoryNodeId: "R_other" },
        { sha: "a".repeat(40), text: "History readback" },
        undefined,
        repositories,
      ),
    ).rejects.toThrow("identity or predecessor");
    await expect(
      readWorkUnitHistory(
        joint,
        { repositoryNodeId: "R_other", pullRequestNodeId: "PR_joint" },
        repositories,
      ),
    ).rejects.toThrow("requested source");
  } finally {
    f.close();
  }
});

for (const kind of [
  "value-assessments",
  "work-unit-assessments",
  "penalties",
] as const) {
  if (kind !== "penalties")
    test(`immutable repository identity reads ${kind} across registry names`, async () => {
      const f = fixture("Example/old-history");
      const path = `/v1/${kind}?repositoryNodeId=R_history&pull=${kind === "work-unit-assessments" ? 8 : 7}&after=0`;
      try {
        for (const state of ["active", "paused", "retired"] as const) {
          if (state !== "active")
            f.revision("paused", state === "retired" ? "retired" : undefined);
          const response = await f.get(path);
          expect(response.status).toBe(200);
          const result = await response.json();
          expect(result.repositoryNodeId).toBe("R_history");
          expect(result.repository).toBe(repository);
          expect(result.records).toHaveLength(1);
          const raw = kind === "value-assessments" ? f.record : f.joint;
          expect(result.records[0].record_json).toBe(raw);
          expect(result.records[0].record_digest).toBe(digest(raw));
        }
        expect(
          (await f.get(path.replace("R_history", "R_unknown"))).status,
        ).toBe(400);
        expect((await f.get(`${path}&repository=Example/other`)).status).toBe(
          400,
        );
        f.sqlite.close();
        expect((await f.get(path)).status).toBe(503);
      } finally {
        f.close();
      }
    });

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
