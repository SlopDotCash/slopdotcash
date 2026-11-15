import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  appendPointAwards,
  emptyPointsJournal,
  latestPoints,
  OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
  type PointAward,
  pointKey,
} from "../src/lib/points";
import {
  applyPointsImplementationCorrections,
  createPointsCorrectionBaseline,
  type PointsImplementationCorrectionManifest,
} from "../src/lib/points-implementation-corrections";
import { sha256Hex } from "../src/lib/sha256";
import { sqliteD1 } from "../tests/sqlite-d1";
import { pointsSql } from "./generate-points";
import {
  decodeHistoricalPacket,
  type HistoricalPointsPacket,
  reconstructHistoricalPoints,
} from "./reviewed-historical-points";
import {
  historicalPointsSql,
  verifyHistoricalCensus,
  verifyHistoricalProtection,
  verifyHistoricalValueRecords,
} from "./run-reviewed-historical-points";

const hash = (value: unknown) => sha256Hex(JSON.stringify(value));
const time = "2026-11-15T01:00:00.000Z";
const actor = { id: btoa("04:User42"), login: "origin", kind: "User" as const };
function fixture() {
  const award: PointAward = {
    key: pointKey("feed", actor.id, "merged-pull-request", "PR_source"),
    actor: { id: actor.id, login: actor.login },
    projectId: "feed",
    category: "merged-pull-request",
    amount: 30,
    occurredAt: "2026-10-15T00:00:00.000Z",
    sourceId: "PR_source",
    sourceUrl: "https://github.com/feedforagents/feed/pull/1",
    workUnitId: "source",
    provisional: false,
  };
  const baseline = appendPointAwards(
    emptyPointsJournal(time),
    [award],
    "a".repeat(64),
    "slop-score-v2",
    time,
  );
  const corrections: PointsImplementationCorrectionManifest = {
    schemaVersion: "1",
    rule: "historical-implementation-allocation-v1",
    generatedAt: time,
    baseline: createPointsCorrectionBaseline(baseline),
    candidates: [
      {
        id: "correction_source",
        kind: "pull-request",
        projectId: "feed",
        sourceId: award.sourceId,
        sourceUrl: award.sourceUrl,
        occurredAt: award.occurredAt,
        workUnitId: award.workUnitId,
        sourceIds: [award.sourceId],
        expectedPredecessors: [
          { key: award.key, revisionId: baseline.revisions[0].id },
        ],
        proof: {
          status: "complete",
          censusDigest: "c".repeat(64),
          sources: [
            {
              repository: "feedforagents/feed",
              repositoryNodeId: "R_feed",
              sourceId: award.sourceId,
              sourceUrl: award.sourceUrl,
              headSha: "b".repeat(40),
              occurredAt: award.occurredAt,
              author: actor,
              complete: true,
              commitCount: 1,
              commits: [
                {
                  sha: "b".repeat(40),
                  parentCount: 1,
                  author: actor,
                  additions: 1,
                  deletions: 0,
                  firstAcceptedSourceId: award.sourceId,
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const candidate = applyPointsImplementationCorrections(
    baseline,
    corrections,
    [{ candidateId: "correction_source", eligible: true }],
    time,
    new Map(),
  ).journal;
  const packet: HistoricalPointsPacket = {
    schemaVersion: "1",
    projectId: "feed",
    producerGithubId: "42",
    reviewerGithubId: "42",
    reviewedAt: time,
    baselineDigest: hash(baseline),
    baselineRevisionCount: baseline.revisions.length,
    candidateDigest: hash(candidate),
    revision: 1,
    manifestSha256: "d".repeat(64),
    sourceAudit: {
      repository: "feedforagents/feed",
      repositoryNodeId: "R_feed",
      from: "2026-09-27T00:00:00.000Z",
      through: "2026-11-01T00:00:00.000Z",
      sources: [
        {
          id: "PR_source",
          number: 1,
          headSha: "b".repeat(40),
          mergedAt: award.occurredAt,
        },
      ],
    },
    valueSnapshot: null,
    valueKeys: [],
    corrections,
    recipientCorrections: [],
  };
  return { packet, baseline, candidate };
}
test("reviewed packet reproduces canonical one-project candidate and rejects altered bytes", () => {
  const f = fixture(),
    bytes = Buffer.from(JSON.stringify(f.packet));
  expect(
    decodeHistoricalPacket(
      gzipSync(bytes).toString("base64"),
      sha256Hex(bytes),
    ),
  ).toEqual(f.packet);
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.candidate);
  expect(() =>
    decodeHistoricalPacket(gzipSync(bytes).toString("base64"), "0".repeat(64)),
  ).toThrow();
});
for (const fault of [
  "baseline",
  "project",
  "candidate",
  "window",
  "keys",
] as const)
  test(`reviewed historical packet refuses ${fault}`, () => {
    const f = fixture();
    if (fault === "baseline") f.packet.baselineDigest = "e".repeat(64);
    if (fault === "project")
      f.packet.corrections.candidates[0].projectId = "eliza";
    if (fault === "candidate") f.packet.candidateDigest = "e".repeat(64);
    if (fault === "window")
      f.packet.sourceAudit.from = "2026-10-01T00:00:00.000Z";
    if (fault === "keys") f.packet.valueKeys = ["unknown"];
    if (fault === "window")
      expect(() =>
        decodeHistoricalPacket(
          gzipSync(Buffer.from(JSON.stringify(f.packet))).toString("base64"),
          hash(f.packet),
        ),
      ).toThrow();
    else
      expect(() =>
        reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
      ).toThrow();
  });
test("canonical historical writer replays and refuses a registry race", () => {
  const f = fixture(),
    { sqlite } = sqliteD1();
  try {
    sqlite.exec(pointsSql(f.baseline));
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('feed',1,'{}',?,'fixture',?)",
      )
      .run(f.packet.manifestSha256, time);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('feed','active',1,'{}',?,?,?)",
      )
      .run(f.packet.manifestSha256, time, time);
    const sql = historicalPointsSql(f.packet, f.candidate, 0);
    const apply = () =>
      sqlite
        .transaction(() => {
          for (const statement of sql.trimEnd().split("\n"))
            sqlite.exec(statement);
        })
        .immediate();
    apply();
    apply();
    expect(sqlite.query("SELECT COUNT(*) n FROM points_batches").get()).toEqual(
      { n: 1 },
    );
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('feed',2,'{}',?,'fixture',?)",
      )
      .run(f.packet.manifestSha256, time);
    sqlite.exec("UPDATE projects SET revision=2 WHERE id='feed'");
    expect(
      sqlite.query("SELECT revision FROM projects WHERE id='feed'").get(),
    ).toEqual({ revision: 2 });
    expect(apply).toThrow();
  } finally {
    sqlite.close();
  }
});
test("historical census requires the complete immutable source identity", async () => {
  const f = fixture();
  const source = f.packet.sourceAudit.sources[0];
  const response = {
    search: {
      issueCount: 1,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: source.id,
          number: source.number,
          headRefOid: source.headSha,
          mergedAt: source.mergedAt,
          repository: { id: "R_feed" },
        },
      ],
    },
  };
  const github = { graphql: async <T>() => structuredClone(response) as T };
  await verifyHistoricalCensus(f.packet, github);
  response.search.nodes[0].headRefOid = "c".repeat(40);
  await expect(verifyHistoricalCensus(f.packet, github)).rejects.toThrow();
});
test("private protection requires both exact clear periods and missing value journals refuse", async () => {
  const f = fixture();
  const rows = [
    { project_id: "feed", period: "2026-09", protected: 0 },
    { project_id: "feed", period: "2026-10", protected: 0 },
  ];
  await verifyHistoricalProtection(f.packet, async () => rows);
  rows[1].protected = 1;
  await expect(
    verifyHistoricalProtection(f.packet, async () => rows),
  ).rejects.toThrow();
  f.packet.valueSnapshot = {
    valueAssessmentCoverage: [{ recordDigest: "b".repeat(64) }],
  } as never;
  await expect(
    verifyHistoricalValueRecords(f.packet, async () => []),
  ).rejects.toThrow();
});

test("canonical writer refuses a protected economic correction atomically", () => {
  const f = fixture(),
    { sqlite } = sqliteD1();
  try {
    sqlite.exec(pointsSql(f.baseline));
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('feed',1,'{}',?,'fixture',?)",
      )
      .run(f.packet.manifestSha256, time);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('feed','active',1,'{}',?,?,?)",
      )
      .run(f.packet.manifestSha256, time, time);
    const award = { ...f.baseline.revisions[0].award, amount: 40 };
    const changed = appendPointAwards(
      f.baseline,
      [award],
      "f".repeat(64),
      "slop-score-v2",
      "2026-11-15T01:00:01.000Z",
    );
    const sql = historicalPointsSql(f.packet, changed, 0);
    sqlite
      .query(
        "INSERT INTO payment_direct_transfers VALUES('solana-mainnet','synthetic','feed','2026-10','42',?,'origin','solana','synthetic','1',?,'synthetic','synthetic',?)",
      )
      .run(actor.id, time, time);
    expect(() =>
      sqlite
        .transaction(() => {
          for (const statement of sql.trimEnd().split("\n"))
            sqlite.exec(statement);
        })
        .immediate(),
    ).toThrow();
    expect(
      sqlite.query("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toEqual({ n: 1 });
    expect(sqlite.query("SELECT COUNT(*) n FROM points_staging").get()).toEqual(
      { n: 0 },
    );
  } finally {
    sqlite.close();
  }
});

test("historical census splits a result set beyond GitHub's page cap", async () => {
  const f = fixture(),
    from = f.packet.sourceAudit.from,
    through = f.packet.sourceAudit.through;
  const middle = new Date(
    Math.floor((Date.parse(from) + Date.parse(through)) / 2000) * 1000,
  ).toISOString();
  f.packet.sourceAudit.sources = Array.from({ length: 1000 }, (_, i) => ({
    id: `PR_large_${i}`,
    number: i + 1,
    headSha: "b".repeat(40),
    mergedAt: i < 500 ? "2026-10-01T00:00:00.000Z" : "2026-10-20T00:00:00.000Z",
  }));
  let calls = 0;
  const github = {
    async graphql<T>(
      _query: string,
      variables?: Record<string, unknown>,
    ): Promise<T> {
      calls++;
      const query = String(variables?.query);
      const whole =
        query.includes(`>=${from}`) && query.includes(`<${through}`);
      const left = query.includes(`<${middle}`);
      const selected = whole
        ? []
        : f.packet.sourceAudit.sources.slice(left ? 0 : 500, left ? 500 : 1000);
      const offset = Number(variables?.after ?? 0),
        nodes = selected.slice(offset, offset + 100).map((s) => ({
          id: s.id,
          number: s.number,
          headRefOid: s.headSha,
          mergedAt: s.mergedAt,
          repository: { id: "R_feed" },
        }));
      return {
        search: {
          issueCount: whole ? 1000 : 500,
          nodes,
          pageInfo: {
            hasNextPage: offset + 100 < selected.length,
            endCursor: String(offset + 100),
          },
        },
      } as T;
    },
  };
  await verifyHistoricalCensus(f.packet, github);
  expect(calls).toBe(11);
});

function recipientExceptionFixture() {
  const f = fixture();
  f.packet.corrections.candidates[0].proof = { status: "held" };
  const original = { id: btoa("04:User43"), login: "verified-origin" };
  const prior = f.baseline.revisions[0];
  const key = pointKey(
    "feed",
    original.id,
    "merged-pull-request",
    prior.award.sourceId,
  );
  const evidence = JSON.stringify({
    source: "synthetic complete owner review",
    claimIds: ["claim_verified"],
    originalGithubId: "43",
  });
  f.packet.recipientCorrections = [
    {
      sourceId: prior.award.sourceId,
      workUnitId: prior.award.workUnitId,
      originalActor: original,
      originalGithubId: "43",
      evidence,
      evidenceSha256: sha256Hex(evidence),
      claimIds: ["claim_verified"],
      expectedPredecessors: [{ key: prior.award.key, revisionId: prior.id }],
      expectedAfter: [
        {
          key,
          actorId: original.id,
          amount: 30,
          occurredAt: prior.award.occurredAt,
        },
        {
          key: prior.award.key,
          actorId: actor.id,
          amount: 0,
          occurredAt: prior.award.occurredAt,
        },
      ],
    },
  ];
  const awards = [
    { ...prior.award, key, actor: original },
    { ...prior.award, amount: 0 },
  ];
  const correction = f.packet.recipientCorrections[0];
  const candidate = appendPointAwards(
    f.baseline,
    awards,
    hash(correction),
    "slop-score-v2",
    time,
    new Map(
      awards.map((a) => [
        a.key,
        {
          sourceId: `owner_october_${correction.evidenceSha256}`,
          effectiveAt: time,
          reason: OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
        },
      ]),
    ),
  );
  f.packet.candidateDigest = hash(candidate);
  return { ...f, candidate };
}
test("explicit owner recipient exception conserves the recorded pool and preserves canonical hold", () => {
  const f = recipientExceptionFixture();
  const result = reconstructHistoricalPoints(
    f.packet,
    f.baseline,
    time,
    new Map(),
  );
  expect(result).toEqual(f.candidate);
  expect(f.packet.corrections.candidates[0].proof.status).toBe("held");
  expect(
    [...latestPoints(result).values()].map((r) => r.award.amount).sort(),
  ).toEqual([0, 30]);
});
for (const fault of ["dossier", "predecessor", "amount", "identity"] as const)
  test(`owner recipient exception refuses altered ${fault}`, () => {
    const f = recipientExceptionFixture(),
      c = f.packet.recipientCorrections[0];
    if (fault === "dossier") c.evidence += "changed";
    if (fault === "predecessor")
      c.expectedPredecessors[0].revisionId = "0".repeat(64);
    if (fault === "amount") c.expectedAfter[0].amount = 31;
    if (fault === "identity") c.originalGithubId = "44";
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });
