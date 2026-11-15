/** Owner-reviewed historical award changes, reconstructed with canonical Points APIs. */

import { gunzipSync } from "node:zlib";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  assertPointsJournal,
  assertPointsJournalExtension,
  latestPoints,
  OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import {
  applyPointsImplementationCorrections,
  type PointsImplementationCorrectionManifest,
} from "../src/lib/points-implementation-corrections";
import { sha256Hex } from "../src/lib/sha256";
import { pointProtectionQuery } from "./points-protection-sql";

export interface HistoricalPointsPacket {
  schemaVersion: "1";
  projectId: string;
  producerGithubId: string;
  reviewerGithubId: string;
  reviewedAt: string;
  baselineDigest: string;
  baselineRevisionCount: number;
  candidateDigest: string;
  revision: number;
  manifestSha256: string;
  sourceAudit: {
    repository: string;
    repositoryNodeId: string;
    from: string;
    through: string;
    sources: {
      id: string;
      number: number;
      headSha: string;
      mergedAt: string;
    }[];
  };
  valueSnapshot: LeaderboardSnapshot | null;
  valueKeys: string[];
  corrections: PointsImplementationCorrectionManifest;
  recipientCorrections: {
    sourceId: string;
    workUnitId: string;
    originalActor: { id: string; login: string };
    originalGithubId: string;
    evidenceSha256: string;
    evidence: string;
    expectedAfter: {
      key: string;
      actorId: string;
      amount: number;
      occurredAt: string;
    }[];
    claimIds: string[];
    expectedPredecessors: { key: string; revisionId: string }[];
  }[];
}
const hash = (value: unknown) => sha256Hex(JSON.stringify(value));
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** The digest pins all review inputs, including complete audit and correction bytes. */
export function decodeHistoricalPacket(
  encoded: string,
  digest: string,
): HistoricalPointsPacket {
  check(/^[a-f0-9]{64}$/u.test(digest), "Invalid reviewed packet digest");
  const bytes = gunzipSync(Buffer.from(encoded, "base64"), {
    maxOutputLength: 32 * 1024 * 1024,
  });
  check(sha256Hex(bytes) === digest, "Reviewed packet changed");
  const packet = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as HistoricalPointsPacket;
  check(
    Object.keys(packet).sort().join(",") ===
      "baselineDigest,baselineRevisionCount,candidateDigest,corrections,manifestSha256,producerGithubId,projectId,recipientCorrections,reviewedAt,reviewerGithubId,revision,schemaVersion,sourceAudit,valueKeys,valueSnapshot",
    "Unexpected reviewed packet fields",
  );
  check(
    packet?.schemaVersion === "1" &&
      ["eliza", "slopdotcash", "asi", "feed", "thenetwork"].includes(
        packet.projectId,
      ),
    "Invalid historical project",
  );
  check(
    [packet.producerGithubId, packet.reviewerGithubId].every((id) =>
      /^[1-9][0-9]{0,19}$/u.test(id),
    ),
    "Missing review identity",
  );
  check(
    new Date(packet.reviewedAt).toISOString() === packet.reviewedAt &&
      packet.reviewedAt >= "2026-11-14T00:00:00.000Z",
    "Invalid review date",
  );
  check(
    [
      packet.baselineDigest,
      packet.candidateDigest,
      packet.manifestSha256,
    ].every((id) => /^[a-f0-9]{64}$/u.test(id)),
    "Invalid input binding",
  );
  check(
    Number.isSafeInteger(packet.revision) && packet.revision > 0,
    "Invalid project revision",
  );
  check(
    Number.isSafeInteger(packet.baselineRevisionCount) &&
      packet.baselineRevisionCount >= 0,
    "Invalid baseline count",
  );
  const audit = packet.sourceAudit;
  check(
    typeof audit?.repository === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(audit.repository) &&
      typeof audit.repositoryNodeId === "string" &&
      audit.repositoryNodeId.length > 3,
    "Invalid audit repository",
  );
  check(
    audit.from === "2026-09-27T00:00:00.000Z" &&
      audit.through === "2026-11-01T00:00:00.000Z",
    "Incomplete historical window",
  );
  check(
    Array.isArray(audit.sources) &&
      audit.sources.length > 0 &&
      new Set(audit.sources.map((s) => s.id)).size === audit.sources.length,
    "Invalid source audit",
  );
  for (const source of audit.sources)
    check(
      source.id &&
        Number.isSafeInteger(source.number) &&
        source.number > 0 &&
        /^[a-f0-9]{40}$/u.test(source.headSha) &&
        new Date(source.mergedAt).toISOString() === source.mergedAt &&
        source.mergedAt >= audit.from &&
        source.mergedAt < audit.through,
      "Invalid audited source",
    );
  check(
    Array.isArray(packet.valueKeys) &&
      new Set(packet.valueKeys).size === packet.valueKeys.length,
    "Duplicate value keys",
  );
  check(
    Array.isArray(packet.recipientCorrections),
    "Missing recipient correction disposition",
  );
  return packet;
}

/** Preserve all unrelated periods and projects and the complete append-only prefix. */
export function reconstructHistoricalPoints(
  packet: HistoricalPointsPacket,
  baseline: PointsJournal,
  now: string,
  bans: ReadonlyMap<string, string>,
): PointsJournal {
  assertPointsJournal(baseline);
  check(
    hash(baseline) === packet.baselineDigest &&
      baseline.revisions.length === packet.baselineRevisionCount,
    "Published baseline changed",
  );
  check(
    now >= packet.reviewedAt && now >= baseline.generatedAt,
    "Historical review is stale or in the future",
  );
  let valued = baseline;
  if (packet.valueSnapshot) {
    assertLeaderboardSnapshot(packet.valueSnapshot);
    check(
      packet.valueSnapshot.valuePolicyEffectiveAt ===
        "2026-09-01T00:00:00.000Z" &&
        packet.valueSnapshot.window.from === packet.sourceAudit.from &&
        packet.valueSnapshot.window.to === packet.sourceAudit.through,
      "Historical value snapshot has another window",
    );
    const coverage = packet.valueSnapshot.valueAssessmentCoverage ?? [];
    check(
      coverage.length === packet.sourceAudit.sources.length &&
        coverage.every(
          (row) =>
            packet.sourceAudit.sources.some(
              (source) =>
                source.id === row.pullRequestId &&
                source.number === row.pullRequestNumber,
            ) &&
            row.repository.toLowerCase() ===
              packet.sourceAudit.repository.toLowerCase(),
        ),
      "Snapshot omits audited sources",
    );
    const all = applyPointsSnapshot(
      baseline,
      packet.valueSnapshot,
      hash(packet.valueSnapshot),
      packet.valueSnapshot.generatedAt,
    );
    const latest = latestPoints(all);
    const prior = latestPoints(baseline);
    const eligibleKeys = [...latest.values()]
      .filter(
        (row) =>
          row.id !== prior.get(row.award.key)?.id &&
          row.award.projectId === packet.projectId &&
          row.award.occurredAt >= packet.sourceAudit.from &&
          row.award.occurredAt < packet.sourceAudit.through &&
          row.decision?.sourceId.startsWith("value:"),
      )
      .map((row) => row.award.key);
    check(
      eligibleKeys.length === packet.valueKeys.length &&
        eligibleKeys.every((key) => packet.valueKeys.includes(key)),
      "Reviewed values omit or add an assessed change",
    );
    const selected = packet.valueKeys.map((key) => {
      const row = latest.get(key);
      check(row !== undefined, "Missing reviewed value award");
      check(
        row.decision?.sourceId.startsWith("value:"),
        "Missing reviewed value decision",
      );
      check(
        row.award.projectId === packet.projectId &&
          row.award.occurredAt >= packet.sourceAudit.from &&
          row.award.occurredAt < packet.sourceAudit.through &&
          row.award.category !== "payout-received",
        "Value award exceeds reviewed scope",
      );
      return row;
    });
    valued = appendPointAwards(
      baseline,
      selected.map((r) => r.award),
      hash(packet.valueSnapshot),
      packet.valueSnapshot.ruleVersion,
      packet.valueSnapshot.generatedAt,
      new Map(
        selected.map((r) => {
          if (!r.decision) throw Error("Missing value decision");
          return [r.award.key, r.decision];
        }),
      ),
    );
  } else check(packet.valueKeys.length === 0, "Value keys need a snapshot");
  check(
    packet.corrections.candidates.every(
      (c) => c.projectId === packet.projectId,
    ),
    "Correction exceeds project scope",
  );
  const eligibility = packet.corrections.candidates.map((c) => ({
    candidateId: c.id,
    eligible:
      c.occurredAt >= packet.sourceAudit.from &&
      c.occurredAt < packet.sourceAudit.through,
  }));
  let result = applyPointsImplementationCorrections(
    valued,
    packet.corrections,
    eligibility,
    packet.corrections.generatedAt,
    bans,
  ).journal;
  const correctedUnits = new Set<string>();
  for (const correction of packet.recipientCorrections) {
    const unitKey = JSON.stringify([
      correction.sourceId,
      correction.workUnitId,
    ]);
    check(!correctedUnits.has(unitKey), "Duplicate owner recipient correction");
    correctedUnits.add(unitKey);
    check(
      /^[a-f0-9]{64}$/u.test(correction.evidenceSha256) &&
        correction.claimIds.length > 0 &&
        new Set(correction.claimIds).size === correction.claimIds.length,
      "Recipient correction lacks reviewed evidence",
    );
    check(
      githubUserIdFromNodeId(correction.originalActor.id) ===
        correction.originalGithubId &&
        /^[1-9][0-9]{0,19}$/u.test(correction.originalGithubId),
      "Unverified original recipient identity",
    );
    check(
      typeof correction.evidence === "string" &&
        sha256Hex(correction.evidence) === correction.evidenceSha256,
      "Reviewed recipient dossier changed",
    );
    const candidate = packet.corrections.candidates.find(
      (c) =>
        c.sourceId === correction.sourceId &&
        c.workUnitId === correction.workUnitId,
    );
    check(
      candidate !== undefined,
      "Recipient correction lacks canonical source scope",
    );
    const rows = [...latestPoints(result).values()].filter(
      (row) =>
        row.award.projectId === packet.projectId &&
        row.award.sourceId === correction.sourceId &&
        row.award.workUnitId === correction.workUnitId &&
        row.award.category === "merged-pull-request",
    );
    check(
      rows.length > 0 &&
        rows.every((row) => row.award.occurredAt.startsWith("2026-10-")),
      "Recipient exception requires recorded October implementation pool",
    );
    check(
      rows.length === correction.expectedPredecessors.length &&
        rows.every((row) =>
          correction.expectedPredecessors.some(
            (expected) =>
              expected.key === row.award.key && expected.revisionId === row.id,
          ),
        ),
      "Recipient pool changed after owner review",
    );
    const total = rows.reduce((sum, row) => sum + BigInt(row.award.amount), 0n);
    check(
      total > 0n && total <= BigInt(Number.MAX_SAFE_INTEGER),
      "Invalid recipient pool total",
    );
    const template = rows[0].award;
    const key = pointKey(
      packet.projectId,
      correction.originalActor.id,
      "merged-pull-request",
      correction.sourceId,
      candidate.kind === "work-unit" ? correction.workUnitId : undefined,
    );
    const replacement = {
      ...template,
      key,
      actor: correction.originalActor,
      amount: Number(total),
    };
    const awards = [
      replacement,
      ...rows
        .filter((row) => row.award.key !== key)
        .map((row) => ({ ...row.award, amount: 0 })),
    ];
    check(
      awards.length === correction.expectedAfter.length &&
        awards.every((award) =>
          correction.expectedAfter.some(
            (expected) =>
              expected.key === award.key &&
              expected.actorId === award.actor.id &&
              expected.amount === award.amount &&
              expected.occurredAt === award.occurredAt,
          ),
        ),
      "Reviewed recipient result changed",
    );
    const evidence = `owner_october_${correction.evidenceSha256}`;
    result = appendPointAwards(
      result,
      awards,
      hash(correction),
      "slop-score-v2",
      packet.reviewedAt,
      new Map(
        awards.map((award) => [
          award.key,
          {
            sourceId: evidence,
            effectiveAt: packet.reviewedAt,
            reason: OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
          },
        ]),
      ),
    );
  }
  assertPointsJournalExtension(baseline, result);
  const before = latestPoints(baseline);
  for (const row of result.revisions.slice(baseline.revisions.length)) {
    check(
      row.award.projectId === packet.projectId &&
        row.award.occurredAt >= packet.sourceAudit.from &&
        row.award.occurredAt < packet.sourceAudit.through &&
        row.award.category !== "payout-received",
      "Historical delta exceeds reviewed scope",
    );
    const previous = before.get(row.award.key);
    if (previous)
      check(
        previous.award.occurredAt === row.award.occurredAt,
        "Original occurrence changed",
      );
  }
  check(
    hash(result) === packet.candidateDigest,
    "Canonical candidate differs from owner review",
  );
  return result;
}

export function historicalProtectionQuery(
  packet: HistoricalPointsPacket,
): string {
  return pointProtectionQuery(
    ["2026-09", "2026-10"].map((period) => ({
      projectId: packet.projectId,
      period,
    })),
  );
}
