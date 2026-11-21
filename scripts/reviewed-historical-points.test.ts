import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { shareImplementationPoints } from "../src/lib/implementation-allocation";
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
  verifyHistoricalAcceptedSquashes,
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

function unchangedPromotionFixture() {
  const f = duplicateRetirementFixture(),
    retirement = f.retirement;
  const source = retirement.source;
  if (!source.occurredAt) throw Error("fixture merge date");
  const ordinary = source.commits[0];
  const ordinaryParents = ordinary.parentShas;
  if (!ordinaryParents?.length) throw Error("fixture parents");
  const base = "d".repeat(40),
    merge = "e".repeat(40),
    head = "f".repeat(40);
  const resolvedTree = "1".repeat(40),
    acceptedTree = "2".repeat(40);
  const patch = `diff --git a/work.ts b/work.ts
index ${"3".repeat(40)}..${"4".repeat(40)} 100644
--- a/work.ts
+++ b/work.ts
@@ -1,2 +1 @@
 kept
-obsolete
`;
  source.headSha = head;
  source.commits.push({
    sha: head,
    parentCount: 2,
    parentShas: [base, ordinary.sha],
    author: ordinary.author,
    additions: null,
    deletions: null,
    firstAcceptedSourceId: source.sourceId,
    files: [{ path: "work.ts", additions: 0, deletions: 1 }],
    mergeResolution: {
      commitSha: head,
      parents: [base, ordinary.sha],
      gitVersion: "git version 2.56.0",
      automaticTree: "5".repeat(40),
      resolvedTree,
      hadConflicts: true,
      patch,
      patchSha256: sha256Hex(patch),
      paths: ["work.ts"],
    },
  });
  source.commitCount++;
  retirement.unchangedPromotion = {
    sourceDigest: "6".repeat(64),
    pull: {
      node_id: source.sourceId,
      number: 1,
      html_url: source.sourceUrl,
      title: "Unchanged promotion",
      body: null,
      user: { node_id: actor.id, login: actor.login, type: actor.kind },
      merged_by: { node_id: actor.id, login: actor.login, type: actor.kind },
      state: "closed",
      merged_at: source.occurredAt,
      closed_at: source.occurredAt,
      merge_commit_sha: merge,
      updated_at: source.occurredAt,
      head: { sha: head },
      base: { sha: base, ref: "main" },
      changed_files: 0,
      comments: 0,
      review_comments: 0,
      commits: 2,
    },
    merge: {
      sha: merge,
      parents: [{ sha: base }, { sha: head }],
      stats: { additions: 0, deletions: 0, total: 0 },
      files: [],
    },
    commits: [
      { sha: base, tree: { sha: resolvedTree }, parents: [] },
      {
        sha: head,
        tree: { sha: resolvedTree },
        parents: [{ sha: base }, { sha: ordinary.sha }],
      },
      {
        sha: merge,
        tree: { sha: resolvedTree },
        parents: [{ sha: base }, { sha: head }],
      },
      {
        sha: ordinary.sha,
        tree: { sha: acceptedTree },
        parents: ordinaryParents.map((sha) => ({ sha })),
      },
      {
        sha: ordinaryParents[0],
        tree: { sha: acceptedTree },
        parents: [],
      },
    ],
  };
  f.packet.sourceAudit.sources[0].headSha = head;
  const bind = () => {
    const proof = retirement.unchangedPromotion;
    if (!proof) throw Error("fixture proof");
    proof.sourceDigest = hash({
      pull: proof.pull,
      merge: proof.merge,
      commits: proof.commits,
    });
    retirement.evidence = JSON.stringify({
      sourceId: retirement.sourceId,
      workUnitId: retirement.workUnitId,
      sourceSha256: hash(source),
      earlierSourcesSha256: hash(retirement.earlierSources),
      coverageSha256: hash(retirement.coverage),
      unchangedPromotionSha256: hash(retirement.unchangedPromotion),
    });
    retirement.evidenceSha256 = sha256Hex(retirement.evidence);
    const original = [...latestPoints(f.baseline).values()].find(
      (r) => r.award.sourceId === source.sourceId,
    );
    if (!original) throw Error("fixture award");
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...original.award, amount: 0 }],
      hash(retirement),
      "slop-score-v2",
      time,
      new Map([
        [
          original.award.key,
          {
            sourceId: `owner_duplicate_${retirement.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
  };
  bind();
  return { ...f, bind };
}

test("manual duplicate retirement admits only an unchanged promotion with all ordinary paths covered", () => {
  const f = unchangedPromotionFixture();
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
});
for (const fault of [
  "changed-tree",
  "missing-parent",
  "extra-ordinary",
  "different-merge-parents",
  "stale-prefix",
  "changed-resolution",
  "extra-proof",
  "source-digest",
] as const)
  test(`unchanged promotion refuses ${fault}`, () => {
    const f = unchangedPromotionFixture(),
      proof = f.retirement.unchangedPromotion;
    if (!proof) throw Error("fixture proof");
    if (fault === "changed-tree") proof.commits[1].tree.sha = "9".repeat(40);
    if (fault === "missing-parent") proof.commits.pop();
    if (fault === "extra-ordinary")
      f.retirement.source.commits[0].files?.push({
        path: "other.ts",
        additions: 1,
        deletions: 0,
      });
    if (fault === "different-merge-parents") proof.merge.parents.reverse();
    if (fault === "changed-resolution") {
      const resolution = f.retirement.source.commits[1].mergeResolution;
      if (!resolution) throw Error("fixture resolution");
      resolution.resolvedTree = "9".repeat(40);
    }
    if (fault === "extra-proof")
      proof.commits.push({
        sha: "8".repeat(40),
        tree: { sha: "8".repeat(40) },
        parents: [],
      });
    f.bind();
    if (fault === "stale-prefix") f.packet.baselineDigest = "0".repeat(64);
    if (fault === "source-digest") proof.sourceDigest = "0".repeat(64);
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });

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
  for (const fault of ["head", "zero", "source", "repository"] as const) {
    const altered = structuredClone(record);
    if (fault === "head") altered.sources[0].headSha = "f".repeat(40);
    if (fault === "repository")
      altered.sources[0].repositoryNodeId = "R_foreign";
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

function promotionRestClient(
  f: ReturnType<typeof acceptedSquashFixture>,
  observed = f.promotion.commits.nodes.map((row) => ({
    sha: row.commit.oid,
    parents: row.commit.parents.nodes.map((parent) => ({ sha: parent.oid })),
  })),
) {
  const pull = {
    node_id: f.retirement.sourceId,
    head: { sha: f.retirement.source.headSha },
    base: { sha: "c".repeat(40) },
    commits: f.retirement.source.commitCount,
    merge_commit_sha: f.retirement.acceptedPromotion?.mergeSha,
    merged_at: f.retirement.source.occurredAt,
  };
  return async <T>(path: string): Promise<T> => {
    if (path.includes("/compare/"))
      return { total_commits: pull.commits, commits: observed } as T;
    if (path.includes("/commits?"))
      return (path.includes("page=1") ? observed : []) as T;
    if (path.includes("/pulls/")) return pull as T;
    return { node_id: f.retirement.source.repositoryNodeId } as T;
  };
}

function acceptedSquashFixture(bot = false) {
  const f = duplicateRetirementFixture();
  const retirement = f.retirement,
    earlier = retirement.earlierSources[0];
  const rawHead = `tree ${"2".repeat(40)}\nparent ${"a".repeat(40)}\nauthor Origin <origin@example.com> 1 +0000\ncommitter Origin <origin@example.com> 1 +0000\n\nOriginal head\n`;
  const rawAccepted = `tree ${"3".repeat(40)}\nparent ${"b".repeat(40)}\nauthor Origin <origin@example.com> 1 +0000\ncommitter Maintainer <maintainer@example.com> 2 +0000\n\nAccepted squash\n`;
  const oid = (raw: string) =>
    createHash("sha1")
      .update(`commit ${Buffer.byteLength(raw)}\0`)
      .update(raw)
      .digest("hex");
  const sourceCommit = retirement.source.commits[0];
  sourceCommit.sha = oid(rawAccepted);
  sourceCommit.parentShas = ["b".repeat(40)];
  sourceCommit.firstAcceptedSourceId = retirement.sourceId;
  if (bot) sourceCommit.author = { id: "BOT", login: "robot", kind: "Bot" };
  const squash = {
    sourceId: earlier.sourceId,
    sourceUrl: earlier.sourceUrl,
    repositoryNodeId: earlier.repositoryNodeId,
    headSha: oid(rawHead),
    occurredAt: earlier.occurredAt ?? "",
    author: bot ? sourceCommit.author : earlier.author,
    commit: {
      ...structuredClone(sourceCommit),
      firstAcceptedSourceId: earlier.sourceId,
    },
    headCommit: rawHead,
    acceptedCommit: rawAccepted,
  };
  retirement.earlierSources = [];
  retirement.acceptedSquashes = [squash];
  retirement.coverage[0].commitSha = sourceCommit.sha;
  f.packet.sourceAudit.sources[1].headSha = squash.headSha;
  const promotionHead = `tree ${"2".repeat(40)}\nparent ${sourceCommit.sha}\nparent ${"c".repeat(40)}\nauthor Owner <owner@example.com> 3 +0000\ncommitter Owner <owner@example.com> 3 +0000\n\nPromotion head\n`;
  retirement.source.headSha = oid(promotionHead);
  retirement.source.commits.push({
    sha: retirement.source.headSha,
    parentCount: 2,
    parentShas: [sourceCommit.sha, "c".repeat(40)],
    author: actor,
    additions: null,
    deletions: null,
    firstAcceptedSourceId: retirement.sourceId,
    files: [],
    mergeResolution: {
      commitSha: retirement.source.headSha,
      parents: [sourceCommit.sha, "c".repeat(40)],
      gitVersion: "git version 2.56.0",
      automaticTree: "2".repeat(40),
      resolvedTree: "2".repeat(40),
      hadConflicts: false,
      patch: "",
      patchSha256: sha256Hex(""),
      paths: [],
    },
  });
  retirement.source.commitCount++;
  f.packet.sourceAudit.sources[0].headSha = retirement.source.headSha;
  const acceptedPromotionRaw = `tree ${"2".repeat(40)}\nparent ${"c".repeat(40)}\nparent ${retirement.source.headSha}\nauthor Owner <owner@example.com> 4 +0000\ncommitter Owner <owner@example.com> 4 +0000\n\nAccepted promotion\n`;
  retirement.acceptedPromotion = {
    headCommit: promotionHead,
    mergeCommit: acceptedPromotionRaw,
    mergeSha: oid(acceptedPromotionRaw),
  };
  const bind = () => {
    retirement.evidence = JSON.stringify({
      sourceId: retirement.sourceId,
      workUnitId: retirement.workUnitId,
      sourceSha256: hash(retirement.source),
      earlierSourcesSha256: hash(retirement.earlierSources),
      coverageSha256: hash(retirement.coverage),
      acceptedSquashesSha256: hash(retirement.acceptedSquashes),
      acceptedPromotionSha256: retirement.acceptedPromotion
        ? hash(retirement.acceptedPromotion)
        : null,
    });
    retirement.evidenceSha256 = sha256Hex(retirement.evidence);
    const row = [...latestPoints(f.baseline).values()].find(
      (r) => r.award.sourceId === retirement.sourceId,
    );
    if (!row) throw Error("Missing original fixture row");
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...row.award, amount: 0 }],
      hash(retirement),
      "slop-score-v2",
      time,
      new Map([
        [
          row.award.key,
          {
            sourceId: `owner_duplicate_${retirement.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
  };
  bind();
  const current = {
    id: squash.sourceId,
    number: 2,
    url: squash.sourceUrl,
    merged: true,
    mergedAt: squash.occurredAt,
    headRefOid: squash.headSha,
    repository: {
      id: squash.repositoryNodeId,
      nameWithOwner: "feedforagents/feed",
    },
    author: {
      id: squash.author?.id,
      login: squash.author?.login,
      __typename: squash.author?.kind,
    },
    mergeCommit: {
      oid: squash.commit.sha,
      author: {
        user: squash.commit.author
          ? {
              id: squash.commit.author.id,
              login: squash.commit.author.login,
              __typename: squash.commit.author.kind,
            }
          : null,
      },
      parents: {
        nodes: (squash.commit.parentShas ?? []).map((oid) => ({ oid })),
        pageInfo: { hasNextPage: false },
      },
    },
  };
  const promotion = {
    id: retirement.sourceId,
    headRefOid: retirement.source.headSha,
    mergedAt: retirement.source.occurredAt,
    repository: { id: retirement.source.repositoryNodeId },
    mergeCommit: { oid: retirement.acceptedPromotion.mergeSha },
    commits: {
      totalCount: retirement.source.commits.length,
      nodes: retirement.source.commits.map((commit) => ({
        commit: {
          oid: commit.sha,
          parents: {
            totalCount: commit.parentCount,
            nodes: (commit.parentShas ?? []).map((oid) => ({ oid })),
            pageInfo: { hasNextPage: false },
          },
        },
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
  return { ...f, squash, bind, current, promotion };
}

test("accepted squash retirement preserves an earlier human pool on a different base", async () => {
  const f = acceptedSquashFixture();
  await verifyHistoricalAcceptedSquashes(f.packet, {
    get: promotionRestClient(f),
    graphql: async <T>() =>
      ({
        nodes: [f.current],
        node: {
          id: f.retirement.sourceId,
          headRefOid: f.retirement.source.headSha,
          mergedAt: f.retirement.source.occurredAt,
          repository: { id: f.retirement.source.repositoryNodeId },
          mergeCommit: { oid: f.retirement.acceptedPromotion?.mergeSha },
          commits: f.promotion.commits,
        },
      }) as T,
  });
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
});

for (const fault of [
  "raw-head",
  "raw-accepted",
  "parent",
  "path",
  "author",
  "duplicate-coverage",
  "wrong-repository",
  "wrong-head",
  "late-acceptance",
  "unrewarded",
] as const)
  test(`accepted squash retirement refuses ${fault}`, () => {
    const f = acceptedSquashFixture();
    if (fault === "raw-head") f.squash.headCommit += "changed";
    if (fault === "raw-accepted") f.squash.acceptedCommit += "changed";
    if (fault === "parent") f.squash.commit.parentShas = ["c".repeat(40)];
    if (fault === "path" && f.squash.commit.files?.[0])
      f.squash.commit.files[0].path = "foreign.ts";
    if (fault === "author")
      f.squash.commit.author = { id: "OTHER", login: "other", kind: "User" };
    if (fault === "duplicate-coverage")
      f.retirement.coverage.push({ ...f.retirement.coverage[0] });
    if (fault === "wrong-repository") f.squash.repositoryNodeId = "R_other";
    if (fault === "wrong-head") f.squash.headSha = "c".repeat(40);
    if (fault === "late-acceptance")
      f.squash.occurredAt = f.retirement.source.occurredAt ?? "";
    if (fault === "unrewarded") {
      const row = [...latestPoints(f.baseline).values()].find(
        (r) => r.award.sourceId === f.squash.sourceId,
      );
      if (!row) throw Error("Missing prior fixture row");
      f.baseline = appendPointAwards(
        f.baseline,
        [{ ...row.award, amount: 0 }],
        "f".repeat(64),
        "slop-score-v2",
        time,
      );
      f.packet.baselineDigest = hash(f.baseline);
      f.packet.baselineRevisionCount = f.baseline.revisions.length;
      f.packet.corrections.baseline = createPointsCorrectionBaseline(
        f.baseline,
      );
    }
    f.bind();
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });

for (const fault of [
  "merge-sha",
  "source-id",
  "repository",
  "head",
  "date",
  "parent",
  "author",
  "commit-author",
  "commit-author-kind",
  "missing",
] as const)
  test(`fresh accepted squash authority refuses ${fault}`, async () => {
    const f = acceptedSquashFixture(),
      current = structuredClone(f.current);
    if (fault === "merge-sha") current.mergeCommit.oid = "c".repeat(40);
    if (fault === "source-id") current.id = "OTHER";
    if (fault === "repository") current.repository.id = "R_other";
    if (fault === "head") current.headRefOid = "c".repeat(40);
    if (fault === "date")
      current.mergedAt = f.retirement.source.occurredAt ?? "";
    if (fault === "parent")
      current.mergeCommit.parents.nodes[0].oid = "c".repeat(40);
    if (fault === "author") current.author.id = "OTHER";
    if (fault === "commit-author" && current.mergeCommit.author.user)
      current.mergeCommit.author.user.id = "OTHER";
    if (fault === "commit-author-kind" && current.mergeCommit.author.user)
      current.mergeCommit.author.user.__typename = "Bot";
    await expect(
      verifyHistoricalAcceptedSquashes(f.packet, {
        get: promotionRestClient(f),
        graphql: async <T>() =>
          ({
            nodes: [fault === "missing" ? null : current],
            node: {
              id: f.retirement.sourceId,
              headRefOid: f.retirement.source.headSha,
              mergedAt: f.retirement.source.occurredAt,
              repository: { id: f.retirement.source.repositoryNodeId },
              mergeCommit: { oid: f.retirement.acceptedPromotion?.mergeSha },
              commits: f.promotion.commits,
            },
          }) as T,
      }),
    ).rejects.toThrow();
  });

for (const fault of [
  "null-original",
  "unknown-kind",
  "wrong-kind",
  "file-count",
  "empty-files",
  "missing-coverage",
  "duplicate-source",
] as const)
  test(`accepted squash structural refusal ${fault}`, () => {
    const f = acceptedSquashFixture();
    if (fault === "null-original") f.squash.author = null;
    if (fault === "unknown-kind" && f.squash.author)
      f.squash.author.kind = "Organization";
    if (fault === "wrong-kind" && f.squash.commit.author)
      f.squash.commit.author.kind = "Bot";
    if (fault === "file-count") f.squash.commit.additions = 2;
    if (fault === "empty-files") f.squash.commit.files = [];
    if (fault === "missing-coverage") f.retirement.coverage = [];
    if (fault === "duplicate-source")
      f.retirement.acceptedSquashes?.push(structuredClone(f.squash));
    f.bind();
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });

test("accepted bot squash remains excluded without a human reward pool", () => {
  const f = acceptedSquashFixture(true);
  const row = [...latestPoints(f.baseline).values()].find(
    (r) => r.award.sourceId === f.squash.sourceId,
  );
  if (!row) throw Error("Missing prior fixture row");
  Object.assign(
    f.baseline,
    appendPointAwards(
      f.baseline,
      [{ ...row.award, amount: 0 }],
      "f".repeat(64),
      "slop-score-v2",
      time,
    ),
  );
  f.packet.baselineDigest = hash(f.baseline);
  f.packet.baselineRevisionCount = f.baseline.revisions.length;
  f.packet.corrections.baseline = createPointsCorrectionBaseline(f.baseline);
  const priorCandidate = f.packet.corrections.candidates.find(
    (candidate) => candidate.sourceId === f.squash.sourceId,
  );
  const priorRow = latestPoints(f.baseline).get(row.award.key);
  if (!priorCandidate || !priorRow) throw Error("Missing prior fixture");
  priorCandidate.expectedPredecessors = [
    { key: row.award.key, revisionId: priorRow.id },
  ];
  f.bind();
  expect(
    hash(reconstructHistoricalPoints(f.packet, f.baseline, time, new Map())),
  ).toEqual(f.packet.candidateDigest);
  f.squash.author = actor;
  f.bind();
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow();
});

test("fresh squash identity recognizes GitHub's reserved bot commit login", async () => {
  const f = acceptedSquashFixture(true);
  if (!f.current.mergeCommit.author.user) throw Error("Missing bot fixture");
  f.current.mergeCommit.author.user.__typename = "User";
  f.current.mergeCommit.author.user.login = "robot[bot]";
  await verifyHistoricalAcceptedSquashes(f.packet, {
    get: promotionRestClient(f),
    graphql: async <T>() =>
      ({
        nodes: [f.current],
        node: {
          id: f.retirement.sourceId,
          headRefOid: f.retirement.source.headSha,
          mergedAt: f.retirement.source.occurredAt,
          repository: { id: f.retirement.source.repositoryNodeId },
          mergeCommit: { oid: f.retirement.acceptedPromotion?.mergeSha },
          commits: f.promotion.commits,
        },
      }) as T,
  });
  f.current.mergeCommit.author.user.login = "robot";
  await expect(
    verifyHistoricalAcceptedSquashes(f.packet, {
      get: promotionRestClient(f),
      graphql: async <T>() =>
        ({
          nodes: [f.current],
          node: {
            id: f.retirement.sourceId,
            headRefOid: f.retirement.source.headSha,
            mergedAt: f.retirement.source.occurredAt,
            repository: { id: f.retirement.source.repositoryNodeId },
            mergeCommit: { oid: f.retirement.acceptedPromotion?.mergeSha },
            commits: f.promotion.commits,
          },
        }) as T,
    }),
  ).rejects.toThrow();
});

test("owner-reviewed origins with a tied remainder break it by actor ID like the automatic split", () => {
  const f = recipientExceptionFixture();
  const c = f.packet.recipientCorrections[0];
  const prior = f.baseline.revisions[0].award;
  // 30 Points at 1:3 leave both recipients a remainder of one half. Login order
  // (alpha before zeta) is the reverse of immutable actor ID order.
  const alpha = { id: btoa("04:User43"), login: "alpha-origin" };
  const zeta = { id: btoa("04:User44"), login: "zeta-origin" };
  expect(zeta.id < alpha.id).toBe(true);
  c.recipients = [
    { actor: alpha, githubId: "43", weight: "1" },
    { actor: zeta, githubId: "44", weight: "3" },
  ];
  const dossier = JSON.parse(c.evidence);
  dossier.recipients = [
    { githubId: "43", weight: "1" },
    { githubId: "44", weight: "3" },
  ];
  c.evidence = JSON.stringify(dossier);
  c.evidenceSha256 = sha256Hex(c.evidence);
  const automatic = shareImplementationPoints(
    prior.amount,
    [alpha.id, zeta.id],
    new Map([
      [alpha.id, 1n],
      [zeta.id, 3n],
    ]),
  );
  expect(automatic).toEqual([7, 23]);
  const awards = [
    ...[alpha, zeta].map((recipient, index) => ({
      ...prior,
      key: pointKey(
        "feed",
        recipient.id,
        "merged-pull-request",
        prior.sourceId,
      ),
      actor: recipient,
      amount: automatic[index],
    })),
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

for (const fault of ["missing", "changed-tree", "changed-parent"] as const)
  test(`accepted squash promotion refuses ${fault}`, () => {
    const f = acceptedSquashFixture();
    const proof = f.retirement.acceptedPromotion;
    if (!proof) throw Error("Missing fixture");
    if (fault === "missing") delete f.retirement.acceptedPromotion;
    if (fault === "changed-tree")
      proof.mergeCommit = proof.mergeCommit.replace(
        `tree ${"2".repeat(40)}`,
        `tree ${"5".repeat(40)}`,
      );
    if (fault === "changed-parent")
      proof.mergeCommit = proof.mergeCommit.replace(
        `parent ${f.retirement.source.headSha}`,
        `parent ${"5".repeat(40)}`,
      );
    if (fault !== "missing")
      proof.mergeSha = createHash("sha1")
        .update(`commit ${Buffer.byteLength(proof.mergeCommit)}\0`)
        .update(proof.mergeCommit)
        .digest("hex");
    f.bind();
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });

test("fresh accepted squash promotion refuses a changed final merge", async () => {
  const f = acceptedSquashFixture();
  await expect(
    verifyHistoricalAcceptedSquashes(f.packet, {
      get: promotionRestClient(f),
      graphql: async <T>() =>
        ({
          node: {
            id: f.retirement.sourceId,
            headRefOid: f.retirement.source.headSha,
            mergedAt: f.retirement.source.occurredAt,
            repository: { id: f.retirement.source.repositoryNodeId },
            mergeCommit: { oid: "f".repeat(40) },
          },
        }) as T,
    }),
  ).rejects.toThrow();
});

for (const fault of [
  "omitted",
  "substituted",
  "wrong-parent",
  "duplicate",
  "count",
  "head",
  "merge",
] as const)
  test(`fresh promotion membership refuses ${fault}`, async () => {
    const f = acceptedSquashFixture();
    const observed = f.promotion.commits.nodes.map((row) => ({
      sha: row.commit.oid,
      parents: row.commit.parents.nodes.map((parent) => ({ sha: parent.oid })),
    }));
    if (fault === "omitted") observed.pop();
    if (fault === "substituted") observed[0].sha = "f".repeat(40);
    if (fault === "wrong-parent") observed[0].parents[0].sha = "f".repeat(40);
    if (fault === "duplicate") observed[1] = observed[0];
    const get = promotionRestClient(f, observed);
    await expect(
      verifyHistoricalAcceptedSquashes(f.packet, {
        graphql: async <T>() =>
          ({ node: f.promotion, nodes: [f.current] }) as T,
        get: async <T>(path: string) => {
          const value = await get<{
            commits: number;
            head: { sha: string };
            merge_commit_sha: string;
          }>(path);
          if (path.includes("/pulls/") && !path.includes("/commits")) {
            if (fault === "count") value.commits++;
            if (fault === "head") value.head.sha = "f".repeat(40);
            if (fault === "merge") value.merge_commit_sha = "f".repeat(40);
          }
          return value as T;
        },
      }),
    ).rejects.toThrow();
  });

test("fresh promotion membership uses the immutable range beyond GitHub's listing cap", async () => {
  const f = acceptedSquashFixture();
  let compared = false;
  const get = promotionRestClient(f);
  await verifyHistoricalAcceptedSquashes(f.packet, {
    graphql: async <T>() => ({ node: f.promotion, nodes: [f.current] }) as T,
    get: async <T>(path: string) => {
      if (path.includes("/compare/")) compared = true;
      return get<T>(path);
    },
  });
  expect(compared).toBe(true);
});

test("fresh squash promotion verifies all 416 immutable-range commits after a capped listing", async () => {
  const f = acceptedSquashFixture();
  const extra = Array.from({ length: 414 }, (_, i) => ({
    sha: (1000 + i).toString(16).padStart(40, "0"),
    parentCount: 1,
    parentShas: ["c".repeat(40)],
    author: actor,
    additions: 1,
    deletions: 0,
    firstAcceptedSourceId: f.retirement.sourceId,
    files: [{ path: `extra-${i}.ts`, additions: 1, deletions: 0 }],
  }));
  f.retirement.source.commits.push(...extra);
  f.retirement.source.commitCount = 416;
  const all = f.retirement.source.commits.map((c) => ({
    sha: c.sha,
    parents: (c.parentShas ?? []).map((sha) => ({ sha })),
  }));
  let compares = 0;
  await verifyHistoricalAcceptedSquashes(f.packet, {
    graphql: async <T>() => ({ node: f.promotion, nodes: [f.current] }) as T,
    get: async <T>(path: string) => {
      const page = Number(
        new URL(`https://api.github.com${path}`).searchParams.get("page"),
      );
      if (path.includes("/compare/")) {
        compares++;
        return {
          total_commits: 416,
          commits: all.slice((page - 1) * 100, page * 100),
        } as T;
      }
      if (path.includes("/commits?"))
        return all.slice((page - 1) * 100, Math.min(page * 100, 250)) as T;
      if (path.includes("/pulls/"))
        return {
          node_id: f.retirement.sourceId,
          head: { sha: f.retirement.source.headSha },
          base: { sha: "c".repeat(40) },
          commits: 416,
          merge_commit_sha: f.retirement.acceptedPromotion?.mergeSha,
          merged_at: f.retirement.source.occurredAt,
        } as T;
      return { node_id: f.retirement.source.repositoryNodeId } as T;
    },
  });
  expect(compares).toBe(5);
});

function earlierAcceptanceFixture() {
  const f = duplicateRetirementFixture();
  const source = f.retirement.source;
  const earlier = f.retirement.earlierSources[0];
  const baseRaw = `tree ${"f".repeat(40)}\nauthor Human <human@example.test> 1 +0000\ncommitter Human <human@example.test> 1 +0000\n\nbase\n`;
  const baseSha = createHash("sha1")
    .update(`commit ${Buffer.byteLength(baseRaw)}\0`)
    .update(baseRaw)
    .digest("hex");
  const raw = `tree ${"f".repeat(40)}\nparent ${baseSha}\nauthor Human <human@example.test> 1 +0000\ncommitter Human <human@example.test> 1 +0000\n\nwork\n`;
  const sha = createHash("sha1")
    .update(`commit ${Buffer.byteLength(raw)}\0`)
    .update(raw)
    .digest("hex");
  for (const item of [source, earlier]) {
    item.headSha = sha;
    item.commits[0].sha = sha;
    item.commits[0].parentShas = [baseSha];
  }
  f.packet.sourceAudit.sources.forEach((item) => {
    item.headSha = sha;
  });
  const mergeRaw = `tree ${"f".repeat(40)}\nparent ${baseSha}\nparent ${sha}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\naccept\n`;
  const mergeSha = createHash("sha1")
    .update(`commit ${Buffer.byteLength(mergeRaw)}\0`)
    .update(mergeRaw)
    .digest("hex");
  f.retirement.acceptedPromotion = {
    headCommit: raw,
    mergeCommit: mergeRaw,
    mergeSha,
  };
  f.retirement.coverage = [];
  f.retirement.earlierAcceptanceProof = {
    commits: [{ sha, sourceId: earlier.sourceId }],
    sourceBaseSha: baseSha,
    objects: [
      { sha, raw },
      { sha: baseSha, raw: baseRaw },
    ],
    contextSources: [
      {
        id: earlier.sourceId,
        number: 2,
        headSha: sha,
        baseSha,
        mergedAt: earlier.occurredAt ?? "",
        mergeSha: sha,
      },
    ],
  };
  const dossier = JSON.parse(f.retirement.evidence);
  Object.assign(dossier, {
    sourceSha256: hash(source),
    earlierSourcesSha256: hash(f.retirement.earlierSources),
    coverageSha256: hash([]),
    earlierAcceptanceProofSha256: hash(f.retirement.earlierAcceptanceProof),
    acceptedPromotionSha256: hash(f.retirement.acceptedPromotion),
  });
  f.retirement.evidence = JSON.stringify(dossier);
  f.retirement.evidenceSha256 = sha256Hex(f.retirement.evidence);
  const original = f.baseline.revisions[0].award;
  f.expected = appendPointAwards(
    f.baseline,
    [{ ...original, amount: 0 }],
    hash(f.retirement),
    "slop-score-v2",
    time,
    new Map([
      [
        original.key,
        {
          sourceId: `owner_duplicate_${f.retirement.evidenceSha256}`,
          effectiveAt: time,
          reason:
            "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
        },
      ],
    ]),
  );
  f.packet.candidateDigest = hash(f.expected);
  return f;
}

function mixedSubmittedAndSquashFixture(perPathNative = false) {
  const f = earlierAcceptanceFixture();
  const retirement = f.retirement;
  const proof = retirement.earlierAcceptanceProof;
  const prior = retirement.earlierSources[0];
  if (!proof) throw Error("fixture proof");
  const oid = (raw: string) =>
    createHash("sha1")
      .update(`commit ${Buffer.byteLength(raw)}\0`)
      .update(raw)
      .digest("hex");
  const rawSquash = `tree ${"f".repeat(40)}\nparent ${proof.sourceBaseSha}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\nsquash work\n`;
  const squashSha = oid(rawSquash);
  let nativeHead = retirement.source.headSha;
  let submittedHeadCommit = proof.objects[0].raw;
  if (perPathNative) {
    submittedHeadCommit = `tree ${"f".repeat(40)}\nparent ${nativeHead}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\nsubmitted follow-up\n`;
    const submittedSha = oid(submittedHeadCommit);
    const submittedCommit = {
      ...prior.commits[0],
      sha: submittedSha,
      parentShas: [nativeHead],
      files: [{ path: "submitted.ts", additions: 1, deletions: 0 }],
    };
    prior.headSha = submittedSha;
    prior.commits.push(submittedCommit);
    prior.commitCount = prior.commits.length;
    retirement.source.commits.push(structuredClone(submittedCommit));
    proof.contextSources[0].headSha = submittedSha;
    proof.objects.push({ sha: submittedSha, raw: submittedHeadCommit });
    const audited = f.packet.sourceAudit.sources.find(
      (source) => source.id === prior.sourceId,
    );
    if (!audited) throw Error("fixture prior audit");
    audited.headSha = submittedSha;
    nativeHead = submittedSha;
  }
  const rawHead = `tree ${"f".repeat(40)}\nparent ${nativeHead}\nparent ${squashSha}\nauthor Human <human@example.test> 3 +0000\ncommitter Human <human@example.test> 3 +0000\n\npromotion head\n`;
  const headSha = oid(rawHead);
  const rawMerge = `tree ${"f".repeat(40)}\nparent ${proof.sourceBaseSha}\nparent ${headSha}\nauthor Human <human@example.test> 4 +0000\ncommitter Human <human@example.test> 4 +0000\n\naccepted promotion\n`;
  const squashCommit = {
    sha: squashSha,
    parentCount: 1,
    parentShas: [proof.sourceBaseSha],
    author: prior.author,
    additions: 1,
    deletions: 0,
    firstAcceptedSourceId: retirement.sourceId,
    files: [{ path: "squashed.ts", additions: 1, deletions: 0 }],
  };
  retirement.acceptedSquashes = [
    {
      repositoryNodeId: prior.repositoryNodeId,
      sourceId: prior.sourceId,
      sourceUrl: prior.sourceUrl,
      headSha: prior.headSha,
      occurredAt: prior.occurredAt ?? "",
      author: prior.author,
      headCommit: submittedHeadCommit,
      acceptedCommit: rawSquash,
      commit: { ...squashCommit, firstAcceptedSourceId: prior.sourceId },
    },
  ];
  retirement.source.headSha = headSha;
  retirement.source.commits.push(squashCommit, {
    sha: headSha,
    parentCount: 2,
    parentShas: [nativeHead, squashSha],
    author: actor,
    additions: null,
    deletions: null,
    firstAcceptedSourceId: retirement.sourceId,
    files: [],
    mergeResolution: {
      commitSha: headSha,
      parents: [nativeHead, squashSha],
      gitVersion: "git version 2.56.0",
      automaticTree: "f".repeat(40),
      resolvedTree: "f".repeat(40),
      hadConflicts: false,
      patch: "",
      patchSha256: sha256Hex(""),
      paths: [],
    },
  });
  retirement.source.commitCount = retirement.source.commits.length;
  f.packet.sourceAudit.sources[0].headSha = headSha;
  proof.contextSources[0].mergeSha = squashSha;
  proof.objects.push(
    { sha: squashSha, raw: rawSquash },
    { sha: headSha, raw: rawHead },
  );
  retirement.coverage = [
    { commitSha: squashSha, path: "squashed.ts", sourceId: prior.sourceId },
    ...(perPathNative
      ? [
          {
            commitSha: nativeHead,
            path: "submitted.ts",
            sourceId: prior.sourceId,
          },
        ]
      : []),
  ];
  retirement.acceptedPromotion = {
    headCommit: rawHead,
    mergeCommit: rawMerge,
    mergeSha: oid(rawMerge),
  };
  const bind = () => {
    const dossier = JSON.parse(retirement.evidence);
    Object.assign(dossier, {
      sourceSha256: hash(retirement.source),
      earlierSourcesSha256: hash(retirement.earlierSources),
      coverageSha256: hash(retirement.coverage),
      earlierAcceptanceProofSha256: hash(proof),
      acceptedSquashesSha256: hash(retirement.acceptedSquashes),
      acceptedPromotionSha256: hash(retirement.acceptedPromotion),
    });
    retirement.evidence = JSON.stringify(dossier);
    retirement.evidenceSha256 = sha256Hex(retirement.evidence);
    const award = f.baseline.revisions[0].award;
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...award, amount: 0 }],
      hash(retirement),
      "slop-score-v2",
      time,
      new Map([
        [
          award.key,
          {
            sourceId: `owner_duplicate_${retirement.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
  };
  return Object.assign(f, { bind, prior, proof, squashSha });
}

test("one prior PR can cover its exact submitted commit and different squash output", () => {
  const f = mixedSubmittedAndSquashFixture();
  f.bind();
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
});

test("mixed source path coverage keeps submitted and accepted squash roles separate", () => {
  const f = mixedSubmittedAndSquashFixture(true);
  f.bind();
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
  const submitted = f.retirement.source.commits.find((commit) =>
    commit.files?.some((file) => file.path === "submitted.ts"),
  );
  if (!submitted?.files) throw Error("fixture submitted path");
  submitted.files[0].additions = 2;
  submitted.additions = 2;
  f.bind();
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow("Earlier source does not cover the exact duplicate claim");
});

for (const change of [
  "merge",
  "author",
  "kind",
  "head",
  "repo",
  "date",
  "url",
  "submitted-output",
  "output-path",
  "wrong-commit-path",
  "absent-context",
] as const) {
  test(`mixed submitted/squash proof refuses ${change}`, () => {
    const f = mixedSubmittedAndSquashFixture();
    const squash = f.retirement.acceptedSquashes?.[0];
    if (!squash?.author) throw Error("fixture squash");
    if (change === "merge")
      f.proof.contextSources[0].mergeSha = f.prior.headSha;
    if (change === "author")
      squash.author = { ...squash.author, id: "U_other" };
    if (change === "kind") squash.author = { ...squash.author, kind: "Bot" };
    if (change === "head") squash.headSha = "1".repeat(40);
    if (change === "repo") squash.repositoryNodeId = "R_other";
    if (change === "date") squash.occurredAt = "2026-10-11T01:00:00.000Z";
    if (change === "url")
      squash.sourceUrl = "https://github.com/feedforagents/feed/pull/3";
    if (change === "submitted-output") {
      f.prior.commits.push(squash.commit);
      f.prior.commitCount++;
    }
    if (change === "output-path") f.retirement.coverage = [];
    if (change === "wrong-commit-path")
      f.retirement.coverage[0].commitSha = f.prior.headSha;
    if (change === "absent-context") f.proof.contextSources = [];
    f.bind();
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });
}

for (const fault of ["none", "rest-merge", "graphql-squash"] as const) {
  test(`mixed source fresh authority check ${fault}`, async () => {
    const f = mixedSubmittedAndSquashFixture();
    const target = f.retirement.source;
    const context = f.proof.contextSources[0];
    const squash = f.retirement.acceptedSquashes?.[0];
    const promotion = f.retirement.acceptedPromotion;
    if (!squash?.author || !squash.commit.author || !promotion)
      throw Error("fixture mixed source");
    const repository = {
      id: f.prior.repositoryNodeId,
      nameWithOwner: f.prior.repository,
    };
    const graph = async <T>(query: string): Promise<T> =>
      (query.includes("HistoricalPromotionMerge")
        ? {
            node: {
              id: target.sourceId,
              headRefOid: target.headSha,
              mergedAt: target.occurredAt,
              repository,
              mergeCommit: { oid: promotion.mergeSha },
            },
          }
        : {
            nodes: [
              {
                id: squash.sourceId,
                url: squash.sourceUrl,
                merged: true,
                mergedAt: squash.occurredAt,
                headRefOid: squash.headSha,
                repository,
                author: { ...squash.author, __typename: squash.author?.kind },
                mergeCommit: {
                  oid:
                    fault === "graphql-squash"
                      ? f.prior.headSha
                      : squash.commit.sha,
                  author: {
                    user: {
                      ...squash.commit.author,
                      __typename: squash.commit.author?.kind,
                    },
                  },
                  parents: {
                    nodes: squash.commit.parentShas?.map((oid) => ({ oid })),
                    pageInfo: { hasNextPage: false },
                  },
                },
              },
            ],
          }) as T;
    const get = async <T>(path: string): Promise<T> => {
      if (!path.includes("/pulls/") && !path.includes("/compare/"))
        return { node_id: repository.id } as T;
      const earlier =
        path.includes("/pulls/2") || path.includes(f.prior.headSha);
      const source = earlier ? f.prior : target;
      const commits = source.commits.map((commit) => ({
        sha: commit.sha,
        parents: commit.parentShas?.map((sha) => ({ sha })),
        author: { node_id: commit.author?.id, type: commit.author?.kind },
      }));
      if (path.includes("/compare/"))
        return { total_commits: commits.length, commits } as T;
      if (path.includes("/commits?")) return commits as T;
      return {
        node_id: source.sourceId,
        head: { sha: source.headSha },
        base: { sha: earlier ? context.baseSha : f.proof.sourceBaseSha },
        commits: commits.length,
        merge_commit_sha: earlier
          ? fault === "rest-merge"
            ? f.prior.headSha
            : context.mergeSha
          : promotion.mergeSha,
        merged_at: source.occurredAt,
        user: { node_id: source.author?.id, type: source.author?.kind },
      } as T;
    };
    const read = verifyHistoricalAcceptedSquashes(f.packet, {
      graphql: graph,
      get,
    });
    if (fault === "none") await expect(read).resolves.toBeUndefined();
    else
      await expect(read).rejects.toThrow(
        fault === "rest-merge"
          ? "Earlier acceptance source changed"
          : "Accepted squash source changed",
      );
  });
}

test("earlier accepted native commit retires only its repeated promotion", () => {
  const f = earlierAcceptanceFixture();
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
});
for (const change of [
  "missing-object",
  "extra-object",
  "parents",
  "actor",
  "source",
  "historical-award",
]) {
  test(`earlier accepted proof refuses ${change}`, () => {
    const f = earlierAcceptanceFixture();
    const proof = f.retirement.earlierAcceptanceProof;
    if (!proof) throw Error("fixture proof");
    if (change === "missing-object") proof.objects = [];
    if (change === "extra-object")
      proof.objects.push({ sha: "c".repeat(40), raw: proof.objects[0].raw });
    if (change === "parents")
      f.retirement.source.commits[0].parentShas = ["c".repeat(40)];
    if (change === "actor")
      f.retirement.source.commits[0].author = {
        id: "other",
        login: "other",
        kind: "User",
      };
    if (change === "source") proof.commits[0].sourceId = "PR_foreign";
    if (change === "historical-award") {
      proof.contextSources[0].historicalAwardRevisionId = "f".repeat(64);
      f.retirement.earlierSources[0].sourceId = "PR_unrewarded";
    }
    expect(() =>
      reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
    ).toThrow();
  });
}

test("earlier acceptance rejects a changed declared source base", () => {
  const f = earlierAcceptanceFixture();
  const proof = f.retirement.earlierAcceptanceProof;
  if (!proof) throw Error("fixture proof");
  // The source head still contains its accepted parent, so hiding that parent
  // from the declared base must fail exact head-minus-base membership.
  proof.sourceBaseSha = f.retirement.source.headSha;
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow();
});
test("earlier acceptance refuses context metadata that differs from the audit", () => {
  const f = earlierAcceptanceFixture();
  const proof = f.retirement.earlierAcceptanceProof;
  if (!proof) throw Error("fixture proof");
  proof.contextSources[0].number = 99;
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow();
});

for (const fault of [
  "omitted-source",
  "omitted-context",
  "source-author",
  "base-change",
]) {
  test(`fresh earlier acceptance refuses ${fault}`, async () => {
    const f = earlierAcceptanceFixture();
    const source = f.retirement.source;
    const earlier = f.retirement.earlierSources[0];
    const proof = f.retirement.earlierAcceptanceProof;
    if (!proof) throw Error("fixture proof");
    const correctSourceCount = source.commitCount;
    const correctContextCount = earlier.commitCount;
    if (fault === "omitted-source") {
      source.commits = [];
      source.commitCount = 0;
    }
    if (fault === "omitted-context") {
      earlier.commits = [];
      earlier.commitCount = 0;
    }
    await expect(
      verifyHistoricalAcceptedSquashes(f.packet, {
        graphql: async <T>() =>
          ({
            node: {
              id: source.sourceId,
              headRefOid: source.headSha,
              mergedAt: source.occurredAt,
              repository: { id: source.repositoryNodeId },
              mergeCommit: { oid: f.retirement.acceptedPromotion?.mergeSha },
            },
          }) as T,
        get: async <T>(path: string) => {
          if (path === "/repos/feedforagents/feed")
            return { node_id: source.repositoryNodeId } as T;
          const isEarlier = path.includes("/pulls/2");
          const item = isEarlier ? earlier : source;
          if (path.includes("/commits?") || path.includes("/compare/")) {
            const entries = [
              {
                sha: source.headSha,
                parents: [{ sha: proof.sourceBaseSha }],
                author: { node_id: actor.id, login: actor.login, type: "User" },
              },
            ];
            return (
              path.includes("/compare/")
                ? { total_commits: 1, commits: entries }
                : entries
            ) as T;
          }
          return {
            node_id: item.sourceId,
            head: { sha: item.headSha },
            base: {
              sha:
                fault === "base-change" ? "c".repeat(40) : proof.sourceBaseSha,
            },
            commits: isEarlier ? correctContextCount : correctSourceCount,
            merged_at: item.occurredAt,
            merge_commit_sha: isEarlier
              ? proof.contextSources[0].mergeSha
              : f.retirement.acceptedPromotion?.mergeSha,
            user: {
              node_id: fault === "source-author" ? "wrong" : actor.id,
              login: actor.login,
              type: "User",
            },
          } as T;
        },
      }),
    ).rejects.toThrow();
  });
}

function historicalAcceptanceFixture() {
  const f = earlierAcceptanceFixture();
  const proof = f.retirement.earlierAcceptanceProof;
  if (!proof) throw Error("fixture proof");
  const earlier = f.retirement.earlierSources[0];
  const previous = [...latestPoints(f.baseline).values()].find(
    (row) => row.award.sourceId === earlier.sourceId,
  );
  if (!previous) throw Error("fixture previous");
  earlier.occurredAt = "2026-09-17T00:00:00.000Z";
  proof.contextSources[0].mergedAt = earlier.occurredAt;
  // Keep this context outside the October audit while retaining its raw identity.
  f.packet.sourceAudit.sources = f.packet.sourceAudit.sources.filter(
    (row) => row.id !== earlier.sourceId,
  );
  const history = structuredClone(f.baseline);
  history.revisions = history.revisions.filter(
    (row) => row.award.sourceId !== earlier.sourceId,
  );
  const positive = { ...previous.award, occurredAt: earlier.occurredAt };
  let baseline = appendPointAwards(
    history,
    [positive],
    "a".repeat(64),
    "slop-score-v2",
    "2026-11-15T01:00:00.000Z",
  );
  const awarded = latestPoints(baseline).get(positive.key);
  if (!awarded) throw Error("fixture awarded");
  proof.contextSources[0].historicalAwardRevisionId = awarded.id;
  baseline = appendPointAwards(
    baseline,
    [{ ...positive, amount: 0 }],
    "c".repeat(64),
    "slop-score-v2",
    time,
  );
  f.baseline = baseline;
  f.packet.baselineDigest = hash(baseline);
  f.packet.baselineRevisionCount = baseline.revisions.length;
  f.packet.corrections.baseline = createPointsCorrectionBaseline(baseline);
  f.packet.corrections.candidates = f.packet.corrections.candidates.filter(
    (row) => row.sourceId !== earlier.sourceId,
  );
  const dossier = JSON.parse(f.retirement.evidence);
  Object.assign(dossier, {
    earlierSourcesSha256: hash(f.retirement.earlierSources),
    earlierAcceptanceProofSha256: hash(proof),
    historicalPriorAcceptanceReviewed: true,
  });
  f.retirement.evidence = JSON.stringify(dossier);
  f.retirement.evidenceSha256 = sha256Hex(f.retirement.evidence);
  const original = baseline.revisions[0].award;
  f.expected = appendPointAwards(
    baseline,
    [{ ...original, amount: 0 }],
    hash(f.retirement),
    "slop-score-v2",
    "2026-11-15T01:00:01.000Z",
    new Map([
      [
        original.key,
        {
          sourceId: `owner_duplicate_${f.retirement.evidenceSha256}`,
          effectiveAt: "2026-11-15T01:00:01.000Z",
          reason:
            "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
        },
      ],
    ]),
  );
  f.packet.reviewedAt = "2026-11-15T01:00:01.000Z";
  f.packet.candidateDigest = hash(f.expected);
  return f;
}
test("explicit historical prior-acceptance review preserves a pre-October zeroed award", () => {
  const f = historicalAcceptanceFixture();
  expect(
    reconstructHistoricalPoints(
      f.packet,
      f.baseline,
      f.packet.reviewedAt,
      new Map(),
    ),
  ).toEqual(f.expected);
});
for (const fault of ["same-period", "adverse-decision", "missing-review"]) {
  test(`historical prior-acceptance review refuses ${fault}`, () => {
    const f = historicalAcceptanceFixture();
    const proof = f.retirement.earlierAcceptanceProof;
    if (!proof) throw Error("fixture proof");
    const prior = latestPoints(f.baseline).get(
      f.baseline.revisions.at(-1)?.award.key ?? "",
    );
    if (!prior) throw Error("fixture prior");
    if (fault === "same-period")
      f.retirement.earlierSources[0].occurredAt = "2026-10-01T00:00:00.000Z";
    if (fault === "adverse-decision") {
      const changed = { ...prior.award, provisional: !prior.award.provisional };
      const decisions =
        fault === "adverse-decision"
          ? new Map([
              [
                changed.key,
                {
                  sourceId: "adverse",
                  effectiveAt: time,
                  reason: "revoked",
                  delta: 0,
                },
              ],
            ])
          : undefined;
      f.baseline = appendPointAwards(
        f.baseline,
        [changed],
        "e".repeat(64),
        "slop-score-v2",
        time,
        decisions,
      );
      f.packet.baselineDigest = hash(f.baseline);
      f.packet.baselineRevisionCount = f.baseline.revisions.length;
      f.packet.corrections.baseline = createPointsCorrectionBaseline(
        f.baseline,
      );
    }
    if (fault === "missing-review") {
      const dossier = JSON.parse(f.retirement.evidence);
      delete dossier.historicalPriorAcceptanceReviewed;
      f.retirement.evidence = JSON.stringify(dossier);
      f.retirement.evidenceSha256 = sha256Hex(f.retirement.evidence);
    }
    expect(() =>
      reconstructHistoricalPoints(
        f.packet,
        f.baseline,
        f.packet.reviewedAt,
        new Map(),
      ),
    ).toThrow();
  });
}

test("earlier native proof preserves separate canonical joint-claim coverage", () => {
  const f = earlierAcceptanceFixture();
  const proof = f.retirement.earlierAcceptanceProof;
  if (!proof) throw Error("fixture proof");
  const prior = f.retirement.earlierSources[0];
  const parent = f.retirement.source.headSha;
  const raw = `tree ${"f".repeat(40)}\nparent ${parent}\nauthor Human <human@example.test> 3 +0000\ncommitter Human <human@example.test> 3 +0000\n\nabsorbed work\n`;
  const sha = createHash("sha1")
    .update(`commit ${Buffer.byteLength(raw)}\0`)
    .update(raw)
    .digest("hex");
  const context = structuredClone(prior);
  context.sourceId = "PR_absorbed";
  context.sourceUrl = "https://github.com/feedforagents/feed/pull/3";
  context.headSha = sha;
  context.occurredAt = "2026-10-13T00:00:00.000Z";
  context.commits[0] = {
    ...context.commits[0],
    sha,
    parentShas: [parent],
    firstAcceptedSourceId: context.sourceId,
    files: [{ path: "absorbed.ts", additions: 1, deletions: 0 }],
  };
  f.retirement.earlierSources.push(context);
  f.retirement.source.commits.push(structuredClone(context.commits[0]));
  f.retirement.source.commitCount = 2;
  f.retirement.source.headSha = sha;
  proof.objects.push({ sha, raw });
  proof.contextSources.push({
    id: context.sourceId,
    number: 3,
    headSha: sha,
    baseSha: parent,
    mergedAt: context.occurredAt,
    mergeSha: sha,
  });
  const auditedSource = f.packet.sourceAudit.sources.find(
    (item) => item.id === f.retirement.sourceId,
  );
  if (!auditedSource) throw Error("fixture source");
  auditedSource.headSha = sha;
  f.packet.sourceAudit.sources.push({
    id: context.sourceId,
    number: 3,
    headSha: sha,
    mergedAt: context.occurredAt,
  });
  const mergeRaw = `tree ${"f".repeat(40)}\nparent ${parent}\nparent ${sha}\nauthor Human <human@example.test> 4 +0000\ncommitter Human <human@example.test> 4 +0000\n\naccept\n`;
  f.retirement.acceptedPromotion = {
    headCommit: raw,
    mergeCommit: mergeRaw,
    mergeSha: createHash("sha1")
      .update(`commit ${Buffer.byteLength(mergeRaw)}\0`)
      .update(mergeRaw)
      .digest("hex"),
  };
  const claimId = "d".repeat(64);
  const record = {
    projectId: "feed",
    sources: [context, prior].map((item) => ({
      pullRequestNodeId: item.sourceId,
      repositoryNodeId: item.repositoryNodeId,
      headSha: item.headSha,
      occurredAt: item.occurredAt,
    })),
    claims: [
      {
        id: claimId,
        repositoryNodeId: "R_feed",
        commitSha: sha,
        path: "absorbed.ts",
        creditPullRequestId: "PR_original",
        carrierPullRequestIds: [context.sourceId],
      },
      { id: "e".repeat(64), creditPullRequestId: prior.sourceId },
    ],
    units: [
      {
        workUnitId: "earlier",
        claimIds: [claimId, "e".repeat(64)],
        assessment: { status: "assessed", tier: "small" },
      },
    ],
  };
  f.retirement.coverage = [
    {
      commitSha: sha,
      path: "absorbed.ts",
      sourceId: context.sourceId,
      rewardedUnit: {
        recordDigest: hash(record),
        recordJson: JSON.stringify(record),
        claimId,
        workUnitId: "earlier",
        awardSourceId: prior.sourceId,
      },
    },
  ];
  const bind = () => {
    const dossier = JSON.parse(f.retirement.evidence);
    Object.assign(dossier, {
      sourceSha256: hash(f.retirement.source),
      earlierSourcesSha256: hash(f.retirement.earlierSources),
      coverageSha256: hash(f.retirement.coverage),
      earlierAcceptanceProofSha256: hash(proof),
      acceptedPromotionSha256: hash(f.retirement.acceptedPromotion),
    });
    f.retirement.evidence = JSON.stringify(dossier);
    f.retirement.evidenceSha256 = sha256Hex(f.retirement.evidence);
    const award = f.baseline.revisions[0].award;
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...award, amount: 0 }],
      hash(f.retirement),
      "slop-score-v2",
      time,
      new Map([
        [
          award.key,
          {
            sourceId: `owner_duplicate_${f.retirement.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
  };
  bind();
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
  const boundUnit = f.retirement.coverage[0].rewardedUnit;
  if (!boundUnit) throw Error("fixture unit");
  const wrongCarrier = JSON.parse(boundUnit.recordJson);
  wrongCarrier.claims[0].carrierPullRequestIds = ["PR_foreign"];
  boundUnit.recordJson = JSON.stringify(wrongCarrier);
  boundUnit.recordDigest = hash(wrongCarrier);
  bind();
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow("Rewarded unit does not cover the duplicate claim");
  f.retirement.coverage = [];
  bind();
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow("Duplicate claim coverage is missing or repeated");
});

for (const fault of [
  "none",
  "parent",
  "tree",
  "version",
  "missing-parent",
] as const) {
  test(`earlier squash automatic merge proof ${fault}`, () => {
    const f = earlierAcceptanceFixture();
    const proof = f.retirement.earlierAcceptanceProof;
    if (!proof) throw Error("fixture proof");
    const context = proof.contextSources[0];
    const mergeRaw = `tree ${"a".repeat(40)}\nparent ${proof.sourceBaseSha}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\naccepted squash\n`;
    const mergeSha = createHash("sha1")
      .update(`commit ${Buffer.byteLength(mergeRaw)}\0`)
      .update(mergeRaw)
      .digest("hex");
    context.mergeSha = mergeSha;
    context.automaticMerge = {
      baseParentSha: proof.sourceBaseSha,
      gitVersion: "git version 2.56.0",
      automaticTree: "a".repeat(40),
    };
    proof.objects.push({ sha: mergeSha, raw: mergeRaw });
    if (fault === "parent")
      context.automaticMerge.baseParentSha = "b".repeat(40);
    if (fault === "tree") context.automaticMerge.automaticTree = "b".repeat(40);
    if (fault === "version")
      context.automaticMerge.gitVersion =
        "git version 2.56.1" as "git version 2.56.0";
    if (fault === "missing-parent")
      proof.objects = proof.objects.filter(
        (item) => item.sha !== proof.sourceBaseSha,
      );
    const dossier = JSON.parse(f.retirement.evidence);
    dossier.earlierAcceptanceProofSha256 = hash(proof);
    f.retirement.evidence = JSON.stringify(dossier);
    f.retirement.evidenceSha256 = sha256Hex(f.retirement.evidence);
    const award = f.baseline.revisions[0].award;
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...award, amount: 0 }],
      hash(f.retirement),
      "slop-score-v2",
      time,
      new Map([
        [
          award.key,
          {
            sourceId: `owner_duplicate_${f.retirement.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
    if (fault === "none")
      expect(
        reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
      ).toEqual(f.expected);
    else
      expect(() =>
        reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
      ).toThrow();
  });
}

for (const fault of [
  "none",
  "same-period",
  "missing-sha",
  "extra-sha",
  "human-source",
  "missing-review",
] as const) {
  test(`reviewed pre-October bot follow-up ${fault}`, () => {
    const f = historicalAcceptanceFixture();
    const proof = f.retirement.earlierAcceptanceProof;
    if (!proof) throw Error("fixture proof");
    const context = proof.contextSources[0];
    delete context.historicalAwardRevisionId;
    context.reviewedBotFollowupShas = [f.retirement.source.commits[0].sha];
    f.retirement.earlierSources[0].author = {
      id: "Bot_dependabot",
      login: "dependabot",
      kind: "Bot",
    };
    if (fault === "same-period") {
      f.retirement.earlierSources[0].occurredAt = "2026-10-01T00:00:00.000Z";
      context.mergedAt = "2026-10-01T00:00:00.000Z";
    }
    if (fault === "missing-sha") context.reviewedBotFollowupShas = [];
    if (fault === "extra-sha")
      context.reviewedBotFollowupShas.push("f".repeat(40));
    if (fault === "human-source") f.retirement.earlierSources[0].author = actor;
    const dossier = JSON.parse(f.retirement.evidence);
    if (fault === "missing-review")
      delete dossier.historicalPriorAcceptanceReviewed;
    dossier.earlierSourcesSha256 = hash(f.retirement.earlierSources);
    dossier.earlierAcceptanceProofSha256 = hash(proof);
    f.retirement.evidence = JSON.stringify(dossier);
    f.retirement.evidenceSha256 = sha256Hex(f.retirement.evidence);
    const award = f.baseline.revisions[0].award;
    const at = f.packet.reviewedAt;
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...award, amount: 0 }],
      hash(f.retirement),
      "slop-score-v2",
      at,
      new Map([
        [
          award.key,
          {
            sourceId: `owner_duplicate_${f.retirement.evidenceSha256}`,
            effectiveAt: at,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
    if (fault === "none")
      expect(
        reconstructHistoricalPoints(f.packet, f.baseline, at, new Map()),
      ).toEqual(f.expected);
    else
      expect(() =>
        reconstructHistoricalPoints(f.packet, f.baseline, at, new Map()),
      ).toThrow("Earlier bot follow-up review is invalid");
  });
}

test("canonical excluded bot unit retains no duplicate human award", async () => {
  const f = duplicateRetirementFixture(),
    r = f.retirement;
  const record = {
    projectId: "feed",
    sources: [
      {
        pullRequestNodeId: r.earlierSources[0].sourceId,
        repositoryNodeId: "R_feed",
        headSha: r.earlierSources[0].headSha,
        occurredAt: r.earlierSources[0].occurredAt,
      },
    ],
    claims: [
      {
        id: "d".repeat(64),
        repositoryNodeId: "R_feed",
        commitSha: r.source.commits[0].sha,
        path: "work.ts",
        creditPullRequestId: r.earlierSources[0].sourceId,
        implementationActorNodeIds: [] as string[],
      },
    ],
    units: [
      {
        workUnitId: "earlier",
        claimIds: ["d".repeat(64)],
        assessment: { status: "assessed", tier: "micro" },
      },
    ],
  };
  f.baseline = appendPointAwards(
    f.baseline,
    [{ ...f.baseline.revisions[1].award, amount: 0 }],
    "c".repeat(64),
    "slop-score-v2",
    time,
  );
  f.packet.baselineDigest = hash(f.baseline);
  f.packet.baselineRevisionCount = f.baseline.revisions.length;
  f.packet.corrections.baseline = createPointsCorrectionBaseline(f.baseline);
  const currentRows = latestPoints(f.baseline);
  for (const candidate of f.packet.corrections.candidates)
    candidate.expectedPredecessors = candidate.expectedPredecessors.map(
      (row) => ({
        key: row.key,
        revisionId: currentRows.get(row.key)?.id ?? row.revisionId,
      }),
    );
  const bind = () => {
    r.coverage[0].rewardedUnit = {
      recordDigest: hash(record),
      recordJson: JSON.stringify(record),
      claimId: "d".repeat(64),
      workUnitId: "earlier",
      awardSourceId: r.earlierSources[0].sourceId,
    };
    const dossier = JSON.parse(r.evidence);
    dossier.coverageSha256 = hash(r.coverage);
    r.evidence = JSON.stringify(dossier);
    r.evidenceSha256 = sha256Hex(r.evidence);
    const award = f.baseline.revisions[0].award;
    f.expected = appendPointAwards(
      f.baseline,
      [{ ...award, amount: 0 }],
      hash(r),
      "slop-score-v2",
      time,
      new Map([
        [
          award.key,
          {
            sourceId: `owner_duplicate_${r.evidenceSha256}`,
            effectiveAt: time,
            reason:
              "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
          },
        ],
      ]),
    );
    f.packet.candidateDigest = hash(f.expected);
  };
  bind();
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
  await expect(
    verifyHistoricalValueRecords(f.packet, async () => []),
  ).rejects.toThrow("Duplicate coverage record is missing or changed");
  record.claims[0].implementationActorNodeIds = [actor.id];
  bind();
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow("Duplicate claim lacks a retained rewarded pool");
  record.claims[0].implementationActorNodeIds = [];
  record.units[0].claimIds.push("e".repeat(64));
  bind();
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow("Duplicate claim lacks a retained rewarded pool");
});

test("joint retirement completion uses canonical code-unit identity ordering", () => {
  const f = duplicateRetirementFixture(),
    r = f.retirement;
  const owner = r.earlierSources[0];
  const higherId = "PR_z_";
  const lowerId = "PR_z3";
  // Underscore sorts before digits under localeCompare and after them by code unit.
  const record = {
    projectId: "feed",
    sources: [
      {
        pullRequestNodeId: owner.sourceId,
        repositoryNodeId: "R_feed",
        headSha: owner.headSha,
        occurredAt: owner.occurredAt,
      },
      { pullRequestNodeId: lowerId, occurredAt: owner.occurredAt },
      { pullRequestNodeId: higherId, occurredAt: owner.occurredAt },
    ],
    claims: [
      {
        id: "d".repeat(64),
        repositoryNodeId: "R_feed",
        commitSha: r.source.commits[0].sha,
        path: "work.ts",
        creditPullRequestId: owner.sourceId,
      },
      { id: "e".repeat(64), creditPullRequestId: lowerId },
      { id: "f".repeat(64), creditPullRequestId: higherId },
    ],
    units: [
      {
        workUnitId: "earlier",
        claimIds: ["d".repeat(64), "e".repeat(64), "f".repeat(64)],
        assessment: { status: "assessed", tier: "small" },
      },
    ],
  };
  const previous = f.baseline.revisions[1].award;
  f.baseline = appendPointAwards(
    f.baseline,
    [
      {
        ...previous,
        key: pointKey("feed", actor.id, "merged-pull-request", higherId),
        sourceId: higherId,
        sourceUrl: "https://github.com/feedforagents/feed/pull/4",
      },
    ],
    "c".repeat(64),
    "slop-score-v2",
    time,
  );
  f.packet.baselineDigest = hash(f.baseline);
  f.packet.baselineRevisionCount = f.baseline.revisions.length;
  f.packet.corrections.baseline = createPointsCorrectionBaseline(f.baseline);
  r.coverage[0].rewardedUnit = {
    recordDigest: hash(record),
    recordJson: JSON.stringify(record),
    claimId: "d".repeat(64),
    workUnitId: "earlier",
    awardSourceId: higherId,
  };
  const dossier = JSON.parse(r.evidence);
  dossier.coverageSha256 = hash(r.coverage);
  r.evidence = JSON.stringify(dossier);
  r.evidenceSha256 = sha256Hex(r.evidence);
  const award = f.baseline.revisions[0].award;
  f.expected = appendPointAwards(
    f.baseline,
    [{ ...award, amount: 0 }],
    hash(r),
    "slop-score-v2",
    time,
    new Map([
      [
        award.key,
        {
          sourceId: `owner_duplicate_${r.evidenceSha256}`,
          effectiveAt: time,
          reason:
            "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
        },
      ],
    ]),
  );
  f.packet.candidateDigest = hash(f.expected);
  expect(
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toEqual(f.expected);
});

for (const fault of [
  "none",
  "reversed",
  "changed-source",
  "invalid-earlier",
  "same-time",
  "missing-earlier",
  "cycle",
] as const) {
  test(`earlier validated retirement dependency ${fault}`, () => {
    const f = earlierAcceptanceFixture(),
      first = f.retirement;
    const originalProof = first.earlierAcceptanceProof;
    if (!originalProof || !first.acceptedPromotion)
      throw Error("fixture proof");
    const mergeRaw = first.acceptedPromotion.mergeCommit,
      mergeSha = first.acceptedPromotion.mergeSha;
    const parents: [string, string] = [
      originalProof.sourceBaseSha,
      first.source.headSha,
    ];
    const emptyMerge = {
      sha: mergeSha,
      parentCount: 2,
      parentShas: parents,
      author: actor,
      additions: null,
      deletions: null,
      firstAcceptedSourceId: first.sourceId,
      files: [],
      mergeResolution: {
        commitSha: mergeSha,
        parents,
        gitVersion: "git version 2.56.0" as const,
        automaticTree: "f".repeat(40),
        resolvedTree: "f".repeat(40),
        hadConflicts: false,
        patch: "",
        patchSha256: sha256Hex(""),
        paths: [],
      },
    };
    first.source.commits.push(emptyMerge);
    first.source.commitCount++;
    first.source.headSha = mergeSha;
    originalProof.objects.push({ sha: mergeSha, raw: mergeRaw });
    first.acceptedPromotion.headCommit = mergeRaw;
    const acceptanceRaw = `tree ${"f".repeat(40)}\nparent ${originalProof.sourceBaseSha}\nparent ${mergeSha}\nauthor Human <human@example.test> 4 +0000\ncommitter Human <human@example.test> 4 +0000\n\naccept promotion\n`;
    first.acceptedPromotion.mergeCommit = acceptanceRaw;
    first.acceptedPromotion.mergeSha = createHash("sha1")
      .update(`commit ${Buffer.byteLength(acceptanceRaw)}\0`)
      .update(acceptanceRaw)
      .digest("hex");
    const bind = (retirement: typeof first) => {
      const d = JSON.parse(retirement.evidence);
      Object.assign(d, {
        sourceId: retirement.sourceId,
        workUnitId: retirement.workUnitId,
        sourceSha256: hash(retirement.source),
        earlierSourcesSha256: hash(retirement.earlierSources),
        coverageSha256: hash(retirement.coverage),
        earlierAcceptanceProofSha256: hash(retirement.earlierAcceptanceProof),
        acceptedPromotionSha256: hash(retirement.acceptedPromotion),
      });
      retirement.evidence = JSON.stringify(d);
      retirement.evidenceSha256 = sha256Hex(retirement.evidence);
    };
    const audit = f.packet.sourceAudit.sources.find(
      (r) => r.id === first.sourceId,
    );
    if (!audit) throw Error("fixture audit");
    audit.headSha = mergeSha;
    const later = structuredClone(first);
    later.sourceId = "PR_later";
    later.workUnitId = "later";
    later.source = {
      ...structuredClone(first.source),
      sourceId: later.sourceId,
      sourceUrl: "https://github.com/feedforagents/feed/pull/3",
      occurredAt:
        fault === "same-time"
          ? first.source.occurredAt
          : "2026-10-16T00:00:00.000Z",
      commits: [structuredClone(emptyMerge)],
      commitCount: 1,
    };
    later.earlierSources = [structuredClone(first.source)];
    later.coverage = [];
    const proof = later.earlierAcceptanceProof;
    if (!proof) throw Error("fixture later");
    proof.commits = [{ sha: mergeSha, sourceId: first.sourceId }];
    proof.contextSources = [
      {
        id: first.sourceId,
        number: 1,
        headSha: mergeSha,
        baseSha: originalProof.sourceBaseSha,
        mergedAt: first.source.occurredAt as string,
        mergeSha,
      },
    ];
    if (fault === "changed-source")
      later.earlierSources[0].commits[0].additions = 999;
    if (fault === "invalid-earlier") {
      const resolution = first.source.commits[1].mergeResolution;
      if (!resolution) throw Error("fixture resolution");
      resolution.patch = "unverified";
    }
    bind(first);
    bind(later);
    const originalAward = f.baseline.revisions[0].award;
    const laterAward = {
      ...originalAward,
      key: pointKey("feed", actor.id, "merged-pull-request", later.sourceId),
      sourceId: later.sourceId,
      sourceUrl: later.source.sourceUrl,
      occurredAt: later.source.occurredAt as string,
      workUnitId: later.workUnitId,
    };
    f.baseline = appendPointAwards(
      f.baseline,
      [laterAward],
      "c".repeat(64),
      "slop-score-v2",
      time,
    );
    const lr = latestPoints(f.baseline).get(laterAward.key);
    if (!lr) throw Error("fixture row");
    later.expectedPredecessors = [{ key: laterAward.key, revisionId: lr.id }];
    f.packet.baselineDigest = hash(f.baseline);
    f.packet.baselineRevisionCount = f.baseline.revisions.length;
    f.packet.corrections.baseline = createPointsCorrectionBaseline(f.baseline);
    f.packet.sourceAudit.sources.push({
      id: later.sourceId,
      number: 3,
      headSha: mergeSha,
      mergedAt: later.source.occurredAt as string,
    });
    const priorCandidate = f.packet.corrections.candidates[0];
    f.packet.corrections.candidates.push({
      ...structuredClone(priorCandidate),
      id: "later",
      sourceId: later.sourceId,
      sourceUrl: later.source.sourceUrl,
      occurredAt: laterAward.occurredAt,
      workUnitId: later.workUnitId,
      sourceIds: [later.sourceId],
      expectedPredecessors: later.expectedPredecessors,
      proof: { status: "held" },
    });
    let expected = f.baseline;
    for (const r of [first, later]) {
      const award = r === first ? originalAward : laterAward;
      expected = appendPointAwards(
        expected,
        [{ ...award, amount: 0 }],
        hash(r),
        "slop-score-v2",
        time,
        new Map([
          [
            award.key,
            {
              sourceId: `owner_duplicate_${r.evidenceSha256}`,
              effectiveAt: time,
              reason:
                "Owner-reviewed duplicate accepted work already rewarded by earlier sources.",
            },
          ],
        ]),
      );
    }
    f.packet.candidateDigest = hash(expected);
    if (fault === "cycle") {
      originalProof.commits[0].sourceId = later.sourceId;
      bind(first);
    }
    f.packet.duplicateRetirements =
      fault === "missing-earlier"
        ? [later]
        : fault === "reversed"
          ? [later, first]
          : [first, later];
    if (fault === "none")
      expect(
        reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
      ).toEqual(expected);
    else
      expect(() =>
        reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
      ).toThrow();
  });
}

test("historical publication refusal reports a fixed phase without exposing private input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "historical-points-phase-"));
  const script = fileURLToPath(
    new URL("./run-reviewed-historical-points.ts", import.meta.url),
  );
  const privateInput = "private-fixture-content";
  try {
    await writeFile(
      join(directory, "git"),
      `#!/bin/sh
if [ "$1" = "ls-remote" ] && [ -n "$REJECT_SOURCE" ]; then
  printf '%s\\n' "$REJECT_SOURCE" >&2
  exit 1
fi
printf '%s\\n' "$GITHUB_SHA"
`,
      { mode: 0o700 },
    );
    for (const [phase, overrides] of [
      ["trusted invocation", { GITHUB_REF: "refs/heads/development" }],
      ["main source verification", { REJECT_SOURCE: privateInput }],
      [
        "private packet read",
        {
          HISTORICAL_POINTS_OBJECT_MANIFEST: privateInput,
          PRIVATE_PACKET_TRANSPORT: "invalid-fixture-transport",
        },
      ],
      ["reviewed packet validation", {}],
    ] as const) {
      const result = Bun.spawnSync(
        [process.execPath, "--no-env-file", script],
        {
          env: {
            PATH: directory,
            GITHUB_ACTIONS: "true",
            GITHUB_EVENT_NAME: "workflow_dispatch",
            GITHUB_REF: "refs/heads/main",
            GITHUB_SHA: "a".repeat(40),
            HISTORICAL_POINTS_APPLY: "true",
            HISTORICAL_POINTS_PACKET_1: privateInput,
            REVIEWED_PACKET_SHA256: "b".repeat(64),
            ...overrides,
          },
        },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString().trim()).toBe(
        `Reviewed historical Points publication refused during ${phase}; private inputs retained in runner`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("historical publication installs the canonical merge runtime before verification", async () => {
  const workflow = await Bun.file(
    new URL(
      "../.github/workflows/reviewed-historical-points.yml",
      import.meta.url,
    ),
  ).text();
  expect(workflow).toContain("timeout-minutes: 90");
  const install = workflow.indexOf(
    'scripts/install-value-merge-git.ts "$RUNNER_TEMP/value-merge-git"',
  );
  const verify = workflow.indexOf("scripts/run-reviewed-historical-points.ts");
  expect(install).toBeGreaterThan(0);
  expect(verify).toBeGreaterThan(install);
  expect(workflow).toContain(
    '"$RUNNER_TEMP/value-merge-git/bin" >> "$GITHUB_PATH"',
  );
  const source = await Bun.file(
    new URL("./value-merge-ingestion.ts", import.meta.url),
  ).text();
  expect(source).toContain('["fetch", "fsck"].includes(args[0])');
  expect(source).toContain(": command.options.timeout");
});

test("an independently verified identical accepted change retires only its later ordinary award", () => {
  const f = duplicateRetirementFixture();
  const { retirement } = f;
  const earlier = retirement.earlierSources[0];
  earlier.headSha = "e".repeat(40);
  earlier.commits[0].sha = earlier.headSha;
  f.packet.sourceAudit.sources[1].headSha = earlier.headSha;
  retirement.coverage = [];
  retirement.identicalAcceptedChange = {
    earlierSourceId: earlier.sourceId,
    earlierMergeSha: "1".repeat(40),
    mergeSha: "2".repeat(40),
    diffSha256: "3".repeat(64),
  };
  retirement.evidence = JSON.stringify({
    sourceId: retirement.sourceId,
    workUnitId: retirement.workUnitId,
    sourceSha256: hash(retirement.source),
    earlierSourcesSha256: hash(retirement.earlierSources),
    coverageSha256: hash(retirement.coverage),
    identicalAcceptedChangeSha256: hash(retirement.identicalAcceptedChange),
  });
  retirement.evidenceSha256 = sha256Hex(retirement.evidence);
  const target = f.baseline.revisions[0].award;
  const expected = appendPointAwards(
    f.baseline,
    [{ ...target, amount: 0 }],
    hash(retirement),
    "slop-score-v2",
    time,
    new Map([
      [
        target.key,
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
  const verified = new Set([hash(retirement)]);
  expect(() =>
    reconstructHistoricalPoints(f.packet, f.baseline, time, new Map()),
  ).toThrow("Identical accepted change lacks a verified earlier ordinary pool");
  const result = reconstructHistoricalPoints(
    f.packet,
    f.baseline,
    time,
    new Map(),
    verified,
  );
  expect(result).toEqual(expected);
  expect(result.revisions.slice(0, 2)).toEqual(f.baseline.revisions);
  expect(latestPoints(result).get(target.key)?.award.amount).toBe(0);
  expect(latestPoints(result).get(f.baseline.revisions[1].award.key)).toEqual(
    f.baseline.revisions[1],
  );

  retirement.identicalAcceptedChange.diffSha256 = "4".repeat(64);
  expect(() =>
    reconstructHistoricalPoints(
      f.packet,
      f.baseline,
      time,
      new Map(),
      verified,
    ),
  ).toThrow("Identical accepted change lacks a verified earlier ordinary pool");
});
