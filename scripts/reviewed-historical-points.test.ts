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

function duplicateRetirementFixture() {
  const f = fixture();
  const original = f.baseline.revisions[0].award;
  const earlierAward = {
    ...original,
    key: pointKey("feed", actor.id, "merged-pull-request", "PR_earlier"),
    sourceId: "PR_earlier",
    sourceUrl: "https://github.com/feedforagents/feed/pull/2",
    workUnitId: "earlier",
    occurredAt: "2026-10-14T00:00:00.000Z",
  };
  const baseline = appendPointAwards(
    f.baseline,
    [earlierAward],
    "e".repeat(64),
    "slop-score-v2",
    time,
  );
  const current = latestPoints(baseline);
  const originalRow = current.get(original.key);
  const earlierRow = current.get(earlierAward.key);
  if (!originalRow || !earlierRow || !original.workUnitId)
    throw Error("fixture");
  const candidate = f.packet.corrections.candidates[0];
  if (candidate.proof.status !== "complete") throw Error("fixture");
  const source = structuredClone(candidate.proof.sources[0]);
  source.commits[0].parentShas = ["a".repeat(40)];
  source.commits[0].files = [{ path: "work.ts", additions: 1, deletions: 0 }];
  const earlier = {
    ...structuredClone(source),
    sourceId: earlierAward.sourceId,
    sourceUrl: earlierAward.sourceUrl,
    occurredAt: earlierAward.occurredAt,
  };
  source.commits[0].firstAcceptedSourceId = earlier.sourceId;
  earlier.commits[0].firstAcceptedSourceId = earlier.sourceId;
  const coverage = [
    {
      commitSha: source.commits[0].sha,
      path: "work.ts",
      sourceId: earlier.sourceId,
    },
  ];
  const evidence = JSON.stringify({
    sourceId: source.sourceId,
    workUnitId: original.workUnitId,
    sourceSha256: hash(source),
    earlierSourcesSha256: hash([earlier]),
    coverageSha256: hash(coverage),
  });
  const retirement: NonNullable<
    HistoricalPointsPacket["duplicateRetirements"]
  >[number] = {
    sourceId: source.sourceId,
    workUnitId: original.workUnitId,
    source,
    earlierSources: [earlier],
    coverage,
    evidence,
    evidenceSha256: sha256Hex(evidence),
    expectedPredecessors: [{ key: original.key, revisionId: originalRow.id }],
  };
  f.packet.baselineDigest = hash(baseline);
  f.packet.baselineRevisionCount = baseline.revisions.length;
  f.packet.corrections.baseline = createPointsCorrectionBaseline(baseline);
  candidate.proof = { status: "held" };
  f.packet.corrections.candidates.push({
    ...structuredClone(candidate),
    id: "earlier",
    sourceId: earlier.sourceId,
    sourceUrl: earlier.sourceUrl,
    occurredAt: earlierAward.occurredAt,
    workUnitId: "earlier",
    sourceIds: [earlier.sourceId],
    expectedPredecessors: [
      { key: earlierAward.key, revisionId: earlierRow.id },
    ],
  });
  f.packet.sourceAudit.sources.push({
    id: earlier.sourceId,
    number: 2,
    headSha: earlier.headSha,
    mergedAt: earlierAward.occurredAt,
  });
  f.packet.duplicateRetirements = [retirement];
  const expected = appendPointAwards(
    baseline,
    [{ ...original, amount: 0 }],
    hash(retirement),
    "slop-score-v2",
    time,
    new Map([
      [
        original.key,
        {
          sourceId: `owner_duplicate_${retirement.evidenceSha256}`,
          effectiveAt: time,
          reason:
            "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
        },
      ],
    ]),
  );
  f.packet.candidateDigest = hash(expected);
  return { ...f, baseline, expected, retirement };
}

test("reviewed duplicate retirement removes only a fully covered later pool", () => {
  const f = duplicateRetirementFixture();
  const result = reconstructHistoricalPoints(
    f.packet,
    f.baseline,
    time,
    new Map(),
  );
  expect(result).toEqual(f.expected);
  expect(
    [...latestPoints(result).values()].map((row) => row.award.amount).sort(),
  ).toEqual([0, 30]);
});

test("duplicate coverage can bind a previously rewarded joint claim", async () => {
  const f = duplicateRetirementFixture(),
    r = f.retirement;
  const claimId = "d".repeat(64);
  const record = {
    sources: [
      {
        pullRequestNodeId: r.earlierSources[0].sourceId,
        repositoryNodeId: "R_feed",
        headSha: r.earlierSources[0].headSha,
        occurredAt: r.earlierSources[0].occurredAt,
      },
    ],
    projectId: "feed",
    claims: [
      {
        id: claimId,
        repositoryNodeId: "R_feed",
        commitSha: r.source.commits[0].sha,
        path: "work.ts",
        creditPullRequestId: r.earlierSources[0].sourceId,
      },
    ],
    units: [
      {
        workUnitId: "earlier",
        claimIds: [claimId],
        assessment: { status: "assessed", tier: "small" },
      },
    ],
  };
  const recordJson = JSON.stringify(record);
  r.coverage[0].rewardedUnit = {
    recordDigest: hash(record),
    recordJson,
    claimId,
    workUnitId: "earlier",
    awardSourceId: r.earlierSources[0].sourceId,
  };
  const dossier = JSON.parse(r.evidence);
  dossier.coverageSha256 = hash(r.coverage);
  r.evidence = JSON.stringify(dossier);
  r.evidenceSha256 = sha256Hex(r.evidence);
  const prior = f.baseline.revisions[0].award;
  f.packet.candidateDigest = hash(
    appendPointAwards(
      f.baseline,
      [{ ...prior, amount: 0 }],
      hash(r),
      "slop-score-v2",
      time,
      new Map([
        [
          prior.key,
          {
            sourceId: `owner_duplicate_${r.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    ),
  );
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map())
      .revisions,
  ).toHaveLength(3);
  let calls = 0;
  await verifyHistoricalValueRecords(f.packet, async () => {
    calls++;
    return [{ record_digest: hash(record), record_json: recordJson }];
  });
  expect(calls).toBe(1);
  const originalUnit = structuredClone(r.coverage[0].rewardedUnit);
  for (const fault of ["head", "zero", "source"] as const) {
    const altered = structuredClone(record);
    if (fault === "head") altered.sources[0].headSha = "f".repeat(40);
    if (fault === "zero") altered.units[0].assessment.tier = "none";
    const binding = {
      ...originalUnit,
      recordJson: JSON.stringify(altered),
      recordDigest: hash(altered),
    };
    if (fault === "source") binding.awardSourceId = "PR_wrong";
    r.coverage[0].rewardedUnit = binding;
    const changedDossier = JSON.parse(r.evidence);
    changedDossier.coverageSha256 = hash(r.coverage);
    r.evidence = JSON.stringify(changedDossier);
    r.evidenceSha256 = sha256Hex(r.evidence);
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow("Rewarded unit");
  }
  r.coverage[0].rewardedUnit = originalUnit;
  r.coverage[0].rewardedUnit.claimId = "e".repeat(64);
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow();
});

for (const fault of [
  "same-source",
  "missing-coverage",
  "changed-lines",
  "later-source",
  "unrewarded",
  "stale-predecessor",
  "extra-coverage",
  "incomplete",
  "source-head",
  "retired-coverage",
  "unproved-merge",
] as const) {
  test(`duplicate retirement refuses ${fault}`, () => {
    const f = duplicateRetirementFixture(),
      r = f.retirement;
    if (fault === "same-source") r.earlierSources[0].sourceId = r.sourceId;
    if (fault === "missing-coverage") r.coverage = [];
    if (fault === "changed-lines") {
      const file = r.earlierSources[0].commits[0].files?.[0];
      if (!file) throw Error("fixture");
      file.additions++;
    }
    if (fault === "later-source")
      r.earlierSources[0].occurredAt = "2026-10-16T00:00:00.000Z";
    if (fault === "unrewarded") r.earlierSources[0].sourceId = "PR_unrewarded";
    if (fault === "stale-predecessor")
      r.expectedPredecessors[0].revisionId = "f".repeat(64);
    if (fault === "extra-coverage")
      r.coverage.push({ ...r.coverage[0], path: "foreign.ts" });
    if (fault === "incomplete") r.source.complete = false;
    if (fault === "source-head") r.source.headSha = "f".repeat(40);
    if (fault === "retired-coverage")
      f.packet.duplicateRetirements?.push({
        ...structuredClone(r),
        sourceId: r.earlierSources[0].sourceId,
      });
    if (fault === "unproved-merge") {
      r.source.commits[0].parentCount = 2;
      r.source.commits[0].parentShas = ["a".repeat(40), "c".repeat(40)];
    }
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });
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
  const github = {
    graphql: async <T>(_query: string, variables?: Record<string, unknown>) => {
      expect(variables?.query).toBe(
        "repo:feedforagents/feed is:pr is:merged merged:2026-09-27T00:00:00Z..2026-10-31T23:59:59Z",
      );
      return structuredClone(response) as T;
    },
  };
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
      const inclusiveEnd = (end: string) =>
        new Date(Date.parse(end) - 1000).toISOString().replace(".000Z", "Z");
      const whole =
        query.endsWith(`..${inclusiveEnd(through)}`) &&
        query.includes(`merged:${from.replace(".000Z", "Z")}..`);
      const left = query.endsWith(`..${inclusiveEnd(middle)}`);
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
    sourceId: prior.award.sourceId,
    workUnitId: prior.award.workUnitId,
    sourceSha256: "a".repeat(64),
    acceptedClaimIds: ["c".repeat(64)],
    recipients: [{ githubId: "43", weight: "1" }],
  });
  f.packet.recipientCorrections = [
    {
      sourceId: prior.award.sourceId,
      workUnitId: prior.award.workUnitId,
      recipients: [{ actor: original, githubId: "43", weight: "1" }],
      evidence,
      evidenceSha256: sha256Hex(evidence),
      claimIds: ["c".repeat(64)],
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
    if (fault === "identity") c.recipients[0].githubId = "44";
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });

test("manual original introduced outside prior journal still obeys participation ban", () => {
  const f = recipientExceptionFixture();
  expect(() =>
    reconstructHistoricalPoints(
      f.packet,
      f.baseline,
      time,
      new Map([[btoa("04:User43"), "2026-10-01T00:00:00.000Z"]]),
    ),
  ).toThrow();
});

test("owner-reviewed multiple origins use canonical weighted remainder without changing total", () => {
  const f = recipientExceptionFixture();
  const c = f.packet.recipientCorrections[0];
  const prior = f.baseline.revisions[0].award;
  c.recipients.push({
    actor: { id: btoa("04:User44"), login: "second-origin" },
    githubId: "44",
    weight: "2",
  });
  const dossier = JSON.parse(c.evidence);
  dossier.recipients = [
    { githubId: "43", weight: "1" },
    { githubId: "44", weight: "2" },
  ];
  c.evidence = JSON.stringify(dossier);
  c.evidenceSha256 = sha256Hex(c.evidence);
  const awards = [
    {
      ...prior,
      key: pointKey(
        "feed",
        btoa("04:User43"),
        "merged-pull-request",
        prior.sourceId,
      ),
      actor: c.recipients[0].actor,
      amount: 10,
    },
    {
      ...prior,
      key: pointKey(
        "feed",
        btoa("04:User44"),
        "merged-pull-request",
        prior.sourceId,
      ),
      actor: c.recipients[1].actor,
      amount: 20,
    },
    { ...prior, amount: 0 },
  ];
  c.expectedAfter = awards.map((a) => ({
    key: a.key,
    actorId: a.actor.id,
    amount: a.amount,
    occurredAt: a.occurredAt,
  }));
  const expected = appendPointAwards(
    f.baseline,
    awards,
    hash(c),
    "slop-score-v2",
    time,
    new Map(
      awards.map((a) => [
        a.key,
        {
          sourceId: `owner_october_${c.evidenceSha256}`,
          effectiveAt: time,
          reason: OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
        },
      ]),
    ),
  );
  f.packet.candidateDigest = hash(expected);
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(expected);
});
