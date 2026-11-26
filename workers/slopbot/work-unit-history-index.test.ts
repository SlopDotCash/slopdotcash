import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { workUnitHistory } from "./value-work-unit-journal";

const at = "2026-11-25T00:00:00.000Z";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

type Source = { repository: string; nodeId: string; number: number };

/**
 * The lookup as it was before the source number index: every journal record
 * is parsed to find the ones that name the pull request. The indexed lookup
 * must return exactly what this returns.
 */
const SCAN_LOOKUP = (identity: "repository" | "repositoryNodeId") =>
  `WITH RECURSIVE
    bounds AS (SELECT COALESCE(MAX(sequence), 0) AS maximum,
      COALESCE(?, MAX(sequence), 0) AS through_sequence FROM slopbot_work_unit_journal),
    lineage(record_digest) AS (
      SELECT j.record_digest FROM slopbot_work_unit_journal j, bounds b
      WHERE j.sequence <= b.through_sequence AND EXISTS (
        SELECT 1 FROM json_each(j.record_json, '$.sources') s
        WHERE json_extract(s.value, '$.${identity}') = ?
          AND json_extract(s.value, '$.pullRequestNumber') = ?)
      UNION
      SELECT p.predecessor_digest FROM slopbot_work_unit_predecessors p
      JOIN lineage l ON p.record_digest = l.record_digest
    )
    SELECT b.maximum, b.through_sequence,
      (SELECT COUNT(*) FROM lineage) AS total_records,
      (SELECT json_group_array(json_object('sequence', sequence,
        'record_digest', record_digest, 'record_json', record_json, 'recorded_at', recorded_at))
       FROM (SELECT j.sequence, j.record_digest, j.record_json, j.recorded_at
         FROM slopbot_work_unit_journal j JOIN lineage l ON l.record_digest = j.record_digest
         WHERE j.sequence > ? ORDER BY j.sequence LIMIT 101)) AS records_json
    FROM bounds b`;

function journal() {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  let count = 0;
  const append = (sources: Source[], supersedes: string[] = []) => {
    count += 1;
    const record = JSON.stringify({
      schemaVersion: "slop-work-unit-record:v1",
      projectId: "history-index",
      sourceDigest: digest(`source ${count}`),
      producerRevision: "a".repeat(40),
      assessedAt: at,
      sources: sources.map((source) => ({
        repository: source.repository,
        pullRequestNumber: source.number,
        repositoryNodeId: source.nodeId,
        repositoryDatabaseId: 123,
        pullRequestNodeId: `PR_${source.nodeId}_${source.number}`,
        headSha: "a".repeat(40),
        mergeSha: null,
        policySha: "a".repeat(40),
        sourceDigest: "b".repeat(64),
        occurredAt: at,
      })),
      claims: [],
      units: [],
      supersedes,
      legacyPredecessors: [],
      revisionReason: supersedes.length > 0 ? "Joined related work" : null,
    });
    sqlite.run(
      "INSERT INTO slopbot_work_unit_journal(record_digest,assessment_key,project_id,source_digest,record_json,recorded_at) VALUES (?,?,?,?,?,?)",
      [
        digest(record),
        digest(`assessment ${count}`),
        "history-index",
        digest(`source ${count}`),
        record,
        at,
      ],
    );
    return digest(record);
  };
  const one: Source = { repository: "owner/one", nodeId: "R_one", number: 8 };
  const nine = { ...one, number: 9 };
  const ten = { ...one, number: 10 };
  // The same pull request number in another repository must never match.
  const other: Source = { repository: "owner/two", nodeId: "R_two", number: 8 };
  // A renamed repository keeps its node id and is stored under the new name.
  const renamed = { ...one, repository: "owner/renamed", number: 11 };
  const first = append([one]);
  append([other]);
  const joined = append([one, nine], [first]);
  const separate = append([ten]);
  append([one, nine, ten], [joined, separate]);
  append([renamed]);
  for (let number = 100; number < 160; number += 1)
    append([{ ...one, number }]);
  return { db, sqlite };
}

const QUERIES: [string, number, string | undefined][] = [
  ["owner/one", 8, "R_one"],
  ["owner/one", 8, undefined],
  ["owner/one", 9, "R_one"],
  ["owner/one", 10, undefined],
  ["owner/two", 8, "R_two"],
  ["owner/two", 8, undefined],
  ["owner/two", 9, "R_two"],
  ["owner/one", 11, "R_one"],
  ["owner/one", 11, undefined],
  ["owner/renamed", 11, undefined],
  ["owner/one", 120, "R_one"],
  ["owner/missing", 8, "R_missing"],
];
const BOUNDS: [number, number | null][] = [
  [0, null],
  [0, 1],
  [0, 3],
  [0, 5],
  [1, 5],
  [3, 66],
  [5, 66],
];

test("the indexed history lookup returns what the journal scan returned", async () => {
  const { db, sqlite } = journal();
  try {
    for (const [repository, number, nodeId] of QUERIES)
      for (const [after, through] of BOUNDS) {
        const expected = sqlite
          .query(
            SCAN_LOOKUP(
              nodeId === undefined ? "repository" : "repositoryNodeId",
            ),
          )
          .get(through, nodeId ?? repository, number, after) as {
          maximum: number;
          through_sequence: number;
          total_records: number;
          records_json: string;
        };
        const records = JSON.parse(expected.records_json);
        expect(
          await workUnitHistory(db, repository, number, after, through, nodeId),
        ).toEqual({
          records,
          nextAfter: null,
          throughSequence: expected.through_sequence,
          totalRecords: expected.total_records,
        });
      }
    // The fixture exercises a real lineage, not only empty answers.
    const full = await workUnitHistory(db, "owner/one", 8, 0, null, "R_one");
    expect(full.totalRecords).toBe(4);
    expect(full.records.map((record) => record.sequence)).toEqual([1, 3, 4, 5]);
  } finally {
    sqlite.close();
  }
});

test("the history lookup does not read every journal record", async () => {
  const { db, sqlite } = journal();
  try {
    const statements: string[] = [];
    const recording = {
      ...db,
      prepare: (sql: string) => {
        statements.push(sql);
        return db.prepare(sql);
      },
    } as typeof db;
    for (const nodeId of ["R_one", undefined]) {
      statements.length = 0;
      await workUnitHistory(recording, "owner/one", 8, 0, null, nodeId);
      expect(statements).toHaveLength(1);
      const plan = (
        sqlite
          .query(`EXPLAIN QUERY PLAN ${statements[0]}`)
          .all(null, nodeId ?? "owner/one", 8, 0) as { detail: string }[]
      ).map((row) => row.detail);
      // The record's JSON is parsed only for the page that is returned.
      expect(plan.filter((detail) => detail.includes("json_each"))).toEqual([]);
      expect(
        plan.filter((detail) =>
          /^SCAN (j|slopbot_work_unit_journal)\b/u.test(detail),
        ),
      ).toEqual([]);
      expect(
        plan.some((detail) =>
          detail.includes(
            nodeId === undefined
              ? "slopbot_work_unit_source_number_by_name"
              : "slopbot_work_unit_source_number_by_node",
          ),
        ),
      ).toBe(true);
    }
  } finally {
    sqlite.close();
  }
});

test("the source number index mirrors each record and cannot be changed", () => {
  const { sqlite } = journal();
  try {
    const indexed = sqlite
      .query(
        "SELECT record_digest, repository, repository_node_id, pull_request_number FROM slopbot_work_unit_source_numbers ORDER BY 1,2,3,4",
      )
      .all();
    const parsed = sqlite
      .query(
        `SELECT j.record_digest, json_extract(s.value, '$.repository') AS repository,
          json_extract(s.value, '$.repositoryNodeId') AS repository_node_id,
          json_extract(s.value, '$.pullRequestNumber') AS pull_request_number
         FROM slopbot_work_unit_journal j, json_each(j.record_json, '$.sources') s ORDER BY 1,2,3,4`,
      )
      .all();
    expect(indexed).toEqual(parsed);
    expect(indexed.length).toBeGreaterThan(60);
    expect(() =>
      sqlite.run(
        "UPDATE slopbot_work_unit_source_numbers SET pull_request_number = 1",
      ),
    ).toThrow("joint source number index is immutable");
    expect(() =>
      sqlite.run("DELETE FROM slopbot_work_unit_source_numbers"),
    ).toThrow("joint source number index is immutable");
    const { record_digest } = indexed[0] as { record_digest: string };
    expect(() =>
      sqlite.run(
        "INSERT INTO slopbot_work_unit_source_numbers VALUES (?, 'owner/one', 'R_one', 999)",
        [record_digest],
      ),
    ).toThrow("joint source number index does not match immutable parent");
  } finally {
    sqlite.close();
  }
});
