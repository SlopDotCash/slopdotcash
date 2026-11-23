import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sha256Hex } from "../src/lib/sha256";
import { valueHistory } from "../workers/slopbot/value-journal";
import { readWorkUnitHistory } from "../workers/slopbot/value-work-unit-consumption";
import { workUnitHistory } from "../workers/slopbot/value-work-unit-journal";
import type { HistoricalAssessmentCatalog } from "./historical-assessment-catalog";
import { createHistoricalAssessmentTransport } from "./historical-assessment-transport";
import {
  fetchValueHistoryPage,
  fetchWorkUnitHistoryPage,
  loadValueInputs,
} from "./value-ingestion";

const scope = {
  projectId: "eliza",
  repository: "elizaOS/eliza",
  repositoryNodeId: "R_kgDOMT5cIg",
};
const recordedAt = "2026-11-19T12:00:00.000Z";
const sourceDigest = "a".repeat(64);
const headSha = "b".repeat(40);
const pullId = (number: number) => `PR_fixture_${number}`;
const source = (number: number) => ({
  repository: scope.repository,
  repositoryNodeId: scope.repositoryNodeId,
  repositoryDatabaseId: 1,
  pullRequestNodeId: pullId(number),
  pullRequestNumber: number,
  headSha,
  mergeSha: "c".repeat(40),
  policySha: "d".repeat(40),
  occurredAt: "2026-10-19T12:00:00.000Z",
  sourceDigest,
});

function valueRow(
  sequence: number,
  number: number,
  supersedes: string | null = null,
  detail = "",
) {
  const record_json = JSON.stringify({
    ...source(number),
    schemaVersion: "slop-value-record:v1",
    projectId: scope.projectId,
    supersedes,
    revisionReason: supersedes ? "fixture successor" : null,
    detail,
  });
  return {
    sequence,
    record_digest: sha256Hex(record_json),
    record_json,
    recorded_at: recordedAt,
    repository_node_id: scope.repositoryNodeId,
    pull_request_node_id: pullId(number),
    head_sha: headSha,
    source_digest: sourceDigest,
    supersedes,
  };
}

function jointRow(
  sequence: number,
  numbers: number[],
  supersedes: string[] = [],
  legacyPredecessors: string[] = [],
) {
  const record_json = JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId: scope.projectId,
    sourceDigest,
    sources: numbers.map(source),
    claims: [],
    units: [],
    supersedes,
    legacyPredecessors,
    assessedAt: recordedAt,
    producerRevision: "e".repeat(40),
    revisionReason:
      supersedes.length || legacyPredecessors.length
        ? "fixture successor"
        : null,
  });
  return {
    sequence,
    record_digest: sha256Hex(record_json),
    record_json,
    recorded_at: recordedAt,
    project_id: scope.projectId,
    source_digest: sourceDigest,
    source_keys_json: JSON.stringify(
      numbers.map((number) => [scope.repositoryNodeId, pullId(number)]),
    ),
  };
}

function frozen(
  legacy: HistoricalAssessmentCatalog["legacy"],
  joint: HistoricalAssessmentCatalog["joint"],
): HistoricalAssessmentCatalog {
  return {
    legacy,
    joint,
    heads: {
      legacyThrough: legacy.at(-1)?.sequence ?? 0,
      jointThrough: joint.at(-1)?.sequence ?? 0,
      legacyRepoCount: legacy.length,
      jointScopedCount: joint.length,
      d1PointsDigest: "f".repeat(64),
      d1PointsCount: 1,
      enforcementGeneration: 0,
      registryRevision: 5,
      registryManifestSha256: "1".repeat(64),
    },
  };
}

function grouped() {
  const migrated = valueRow(1, 1);
  const first = jointRow(1, [1], [], [migrated.record_digest]);
  const sibling = jointRow(3, [2]);
  const current = jointRow(
    5,
    [1, 2],
    [first.record_digest, sibling.record_digest],
    [migrated.record_digest],
  );
  const unrelated = jointRow(8, [3]);
  return {
    migrated,
    first,
    sibling,
    current,
    unrelated,
    catalog: frozen([migrated], [first, sibling, current, unrelated]),
  };
}

test("matches the deployed per-source SQL and retains both predecessor roots", async () => {
  const { catalog, current } = grouped();
  const transport = createHistoricalAssessmentTransport(catalog, scope);
  using database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "0038_slopbot_value_journal.sql",
    "0046_slopbot_work_unit_journal.sql",
  ]) {
    database.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  }
  for (const row of catalog.legacy) {
    database
      .query(
        `INSERT INTO slopbot_value_journal(sequence,record_digest,assessment_key,repository_node_id,pull_request_node_id,head_sha,source_digest,supersedes,record_json,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.sequence,
        row.record_digest,
        row.record_digest,
        row.repository_node_id,
        row.pull_request_node_id,
        row.head_sha,
        row.source_digest,
        row.supersedes,
        row.record_json,
        row.recorded_at,
      );
  }
  for (const row of catalog.joint) {
    database
      .query(
        `INSERT INTO slopbot_work_unit_journal(sequence,record_digest,assessment_key,project_id,source_digest,record_json,recorded_at) VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        row.sequence,
        row.record_digest,
        row.record_digest,
        row.project_id,
        row.source_digest,
        row.record_json,
        row.recorded_at,
      );
  }
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...args: (string | number | null)[]) => ({
        first: async () => database.query(sql).get(...args),
      }),
    }),
  } as unknown as Parameters<typeof workUnitHistory>[0];
  for (const number of [1, 2, 3, 99]) {
    expect(
      await fetchValueHistoryPage(
        scope.repository,
        number,
        0,
        transport,
        scope.repositoryNodeId,
      ),
    ).toEqual(
      await valueHistory(
        d1,
        scope.repository,
        number,
        0,
        scope.repositoryNodeId,
      ),
    );
    expect(
      await fetchWorkUnitHistoryPage(
        scope.repository,
        number,
        0,
        null,
        transport,
        scope.repositoryNodeId,
      ),
    ).toEqual(
      await workUnitHistory(
        d1,
        scope.repository,
        number,
        0,
        null,
        scope.repositoryNodeId,
      ),
    );
  }
  const replayed = await readWorkUnitHistory(
    (after, through) =>
      fetchWorkUnitHistoryPage(
        scope.repository,
        2,
        after,
        through,
        transport,
        scope.repositoryNodeId,
      ),
    { repositoryNodeId: scope.repositoryNodeId, pullRequestNodeId: pullId(2) },
  );
  expect(replayed.throughSequence).toBe(8);
  expect(replayed.history.map((row) => row.sequence)).toEqual([1, 3, 5]);
  expect(replayed.current?.row.record_json).toBe(current.record_json);
});

test("passes the existing loadValueInputs entry point and preserves unavailable joint coverage", async () => {
  const { catalog, current } = grouped();
  const transport = createHistoricalAssessmentTransport(catalog, scope);
  const fixture = {
    async get(path: string) {
      expect(path.toLowerCase()).toBe("/repos/elizaos/eliza");
      return { node_id: scope.repositoryNodeId, private: false };
    },
    async graphql() {
      throw Error("Unexpected GitHub GraphQL call");
    },
    async fileText() {
      throw Error("Unexpected GitHub file call");
    },
  } as unknown as Parameters<typeof loadValueInputs>[0];
  const result = await loadValueInputs(
    fixture,
    [
      {
        id: pullId(1),
        url: `https://github.com/${scope.repository}/pull/1`,
        number: 1,
        headRefOid: headSha,
        updatedAt: recordedAt,
        mergedAt: source(1).occurredAt,
      },
    ],
    transport,
    async (ids) => {
      expect(ids).toEqual([pullId(2)]);
      return ids;
    },
    [],
  );
  expect(result.heldWorkUnits).toEqual([
    {
      recordDigest: current.record_digest,
      sourceNodeIds: [pullId(1), pullId(2)],
      unavailableNodeIds: [pullId(2)],
    },
  ]);
  expect(result.jointValueDecisions.get(pullId(1))?.status).toBe("unresolved");
});

test("advances after both the row limit and the encoded byte limit", async () => {
  const rows: HistoricalAssessmentCatalog["legacy"] = [];
  for (let index = 0; index < 101; index++) {
    rows.push(valueRow((index + 1) * 2, 4, rows.at(-1)?.record_digest));
  }
  const transport = createHistoricalAssessmentTransport(
    frozen(rows, []),
    scope,
  );
  const first = await fetchValueHistoryPage(
    scope.repository,
    4,
    0,
    transport,
    scope.repositoryNodeId,
  );
  expect(first.records).toHaveLength(100);
  expect(first.nextAfter).toBe(200);
  const last = await fetchValueHistoryPage(
    scope.repository,
    4,
    200,
    transport,
    scope.repositoryNodeId,
  );
  expect(last.records.map((row) => row.sequence)).toEqual([202]);
  expect(last.nextAfter).toBeNull();

  const large: HistoricalAssessmentCatalog["legacy"] = [];
  const detail = '"'.repeat(900_000);
  for (let index = 0; index < 4; index++) {
    large.push(valueRow(index + 1, 5, large.at(-1)?.record_digest, detail));
  }
  const largeTransport = createHistoricalAssessmentTransport(
    frozen(large, []),
    scope,
  );
  const largeFirst = await fetchValueHistoryPage(
    scope.repository,
    5,
    0,
    largeTransport,
    scope.repositoryNodeId,
  );
  expect(largeFirst.records.map((row) => row.sequence)).toEqual([1, 2]);
  expect(largeFirst.nextAfter).toBe(2);
  const largeLast = await fetchValueHistoryPage(
    scope.repository,
    5,
    2,
    largeTransport,
    scope.repositoryNodeId,
  );
  expect(largeLast.records.map((row) => row.sequence)).toEqual([3, 4]);
  expect(largeLast.records[1].record_json).toBe(large[3].record_json);
  expect(largeLast.nextAfter).toBeNull();
});

test("the canonical joint consumer walks a captured lineage across pages", async () => {
  const rows: HistoricalAssessmentCatalog["joint"] = [];
  for (let index = 0; index < 101; index++) {
    const prior = rows.at(-1);
    rows.push(
      jointRow((index + 1) * 2, [6], prior ? [prior.record_digest] : []),
    );
  }
  rows.push(jointRow(300, [7]));
  const transport = createHistoricalAssessmentTransport(
    frozen([], rows),
    scope,
  );
  const cursors: [number, number | null][] = [];
  const read = await readWorkUnitHistory(
    (after, through) => {
      cursors.push([after, through]);
      return fetchWorkUnitHistoryPage(
        scope.repository,
        6,
        after,
        through,
        transport,
        scope.repositoryNodeId,
      );
    },
    { repositoryNodeId: scope.repositoryNodeId, pullRequestNodeId: pullId(6) },
  );
  expect(cursors).toEqual([
    [0, null],
    [200, 300],
  ]);
  expect(read.history).toHaveLength(101);
  expect(read.current?.row.record_digest).toBe(rows[100].record_digest);
  expect(read.throughSequence).toBe(300);
});

test("refuses invalid scope, missing ancestors, and requests outside the captured history", async () => {
  const { catalog, current, migrated } = grouped();
  expect(() =>
    createHistoricalAssessmentTransport(frozen([migrated], [current]), scope),
  ).toThrow("incomplete or out of scope");
  expect(() =>
    createHistoricalAssessmentTransport(catalog, {
      ...scope,
      repositoryNodeId: "R_unrelated",
    }),
  ).toThrow("incomplete or out of scope");
  const transport = createHistoricalAssessmentTransport(catalog, scope);
  const url = `https://slopbot.slop.cash/v1/work-unit-assessments?repositoryNodeId=${scope.repositoryNodeId}&pull=1`;
  for (const invalid of [
    `${url}&through=5`,
    `${url}&after=1`,
    `${url}&pull=2`,
    url.replace(scope.repositoryNodeId, "R_unrelated"),
    url.replace("slopbot.slop.cash", "elsewhere.invalid"),
  ])
    expect((await transport(invalid)).status).toBe(400);
  expect((await transport(url, { method: "POST" })).status).toBe(400);
  expect((await transport(`${url}&through=8`)).status).toBe(200);
});
