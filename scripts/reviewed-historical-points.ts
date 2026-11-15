/** Owner-reviewed historical award changes, reconstructed with canonical Points APIs. */

import { gunzipSync } from "node:zlib";
import { compareActors, githubUserIdFromNodeId } from "../src/lib/github-actor";
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
  OCTOBER_DUPLICATE_RETIREMENT_DECISION,
  OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import {
  applyPointsImplementationCorrections,
  type CorrectionSource,
  type PointsImplementationCorrectionManifest,
} from "../src/lib/points-implementation-corrections";
import { sha256Hex } from "../src/lib/sha256";
import { VALUE_TIERS } from "../src/lib/value-assessment";
import { allocateWeightedRows } from "../src/lib/weighted-allocation";
import { mergeResolutionLineCounts } from "../workers/slopbot/value-merge-resolution";
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
    recipients: {
      actor: { id: string; login: string };
      githubId: string;
      weight: string;
    }[];
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
  duplicateRetirements?: {
    sourceId: string;
    workUnitId: string;
    source: CorrectionSource;
    earlierSources: CorrectionSource[];
    coverage: {
      commitSha: string;
      path: string;
      sourceId: string;
      rewardedUnit?: {
        recordDigest: string;
        recordJson: string;
        claimId: string;
        workUnitId: string;
        awardSourceId: string;
      };
    }[];
    evidence: string;
    evidenceSha256: string;
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
    Object.keys(packet)
      .filter((key) => key !== "duplicateRetirements")
      .sort()
      .join(",") ===
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
  check(
    packet.duplicateRetirements === undefined ||
      Array.isArray(packet.duplicateRetirements),
    "Invalid duplicate retirement disposition",
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
      correction.recipients.length > 0 &&
        new Set(correction.recipients.map((r) => r.githubId)).size ===
          correction.recipients.length,
      "Duplicate or missing recipients",
    );
    for (const recipient of correction.recipients)
      check(
        githubUserIdFromNodeId(recipient.actor.id) === recipient.githubId &&
          /^[1-9][0-9]{0,19}$/u.test(recipient.githubId) &&
          /^[A-Za-z0-9-]{1,39}$/u.test(recipient.actor.login) &&
          /^[1-9][0-9]*$/u.test(recipient.weight),
        "Invalid reviewed recipient",
      );
    check(
      typeof correction.evidence === "string" &&
        sha256Hex(correction.evidence) === correction.evidenceSha256,
      "Reviewed recipient dossier changed",
    );
    const dossier = JSON.parse(correction.evidence) as {
      sourceId: string;
      workUnitId: string;
      recipients: { githubId: string; weight: string }[];
      sourceSha256: string;
      acceptedClaimIds: string[];
    };
    check(
      dossier.sourceId === correction.sourceId &&
        dossier.workUnitId === correction.workUnitId &&
        Array.isArray(dossier.recipients) &&
        dossier.recipients.length === correction.recipients.length &&
        correction.recipients.every((recipient) =>
          dossier.recipients.some(
            (row) =>
              row.githubId === recipient.githubId &&
              row.weight === recipient.weight,
          ),
        ) &&
        /^[a-f0-9]{64}$/u.test(dossier.sourceSha256) &&
        Array.isArray(dossier.acceptedClaimIds) &&
        dossier.acceptedClaimIds.every((id) => /^[a-f0-9]{64}$/u.test(id)) &&
        dossier.acceptedClaimIds.length === correction.claimIds.length &&
        new Set(dossier.acceptedClaimIds).size ===
          dossier.acceptedClaimIds.length &&
        dossier.acceptedClaimIds.every((id) =>
          correction.claimIds.includes(id),
        ),
      "Recipient dossier scope differs",
    );
    check(
      new Set(correction.expectedPredecessors.map((row) => row.key)).size ===
        correction.expectedPredecessors.length &&
        new Set(correction.expectedAfter.map((row) => row.key)).size ===
          correction.expectedAfter.length,
      "Recipient correction repeats a key",
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
    if (candidate.proof.status === "complete" && "claims" in candidate.proof)
      check(
        correction.claimIds.length === candidate.proof.claims.length &&
          candidate.proof.claims.every((claim) =>
            correction.claimIds.includes(claim.id),
          ),
        "Recipient claims differ from canonical proof",
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
    check(
      rows.every(
        (row) =>
          row.award.occurredAt === rows[0].award.occurredAt &&
          row.award.sourceUrl === rows[0].award.sourceUrl,
      ),
      "Recipient pool has inconsistent source identity",
    );
    for (const recipient of correction.recipients) {
      const ban = bans.get(recipient.actor.id);
      check(
        ban === undefined ||
          Date.parse(rows[0].award.occurredAt) < Date.parse(ban),
        "Recipient is banned for this award",
      );
    }
    const total = rows.reduce((sum, row) => sum + BigInt(row.award.amount), 0n);
    check(
      total > 0n && total <= BigInt(Number.MAX_SAFE_INTEGER),
      "Invalid recipient pool total",
    );
    const template = rows[0].award;
    const replacements = allocateWeightedRows(
      total,
      correction.recipients,
      (row) => BigInt(row.weight),
      (left, right) => compareActors(left.actor, right.actor),
    ).map(({ row, amount }) => ({
      ...template,
      key: pointKey(
        packet.projectId,
        row.actor.id,
        "merged-pull-request",
        correction.sourceId,
        candidate.kind === "work-unit" ? correction.workUnitId : undefined,
      ),
      actor: row.actor,
      amount: Number(amount),
    }));
    const awards = [
      ...replacements,
      ...rows
        .filter(
          (row) =>
            !replacements.some(
              (replacement) => replacement.key === row.award.key,
            ),
        )
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
  const retiringSources = new Set(
    (packet.duplicateRetirements ?? []).map((item) => item.sourceId),
  );
  const rewardedAwards = [...latestPoints(result).values()].map(
    (row) => row.award,
  );
  for (const retirement of packet.duplicateRetirements ?? []) {
    const unitKey = JSON.stringify([
      retirement.sourceId,
      retirement.workUnitId,
    ]);
    check(!correctedUnits.has(unitKey), "Duplicate owner correction");
    correctedUnits.add(unitKey);
    const source = retirement.source;
    check(
      /^[a-f0-9]{64}$/u.test(retirement.evidenceSha256),
      "Invalid duplicate dossier digest",
    );
    const earlier = new Map(
      retirement.earlierSources.map((item) => [item.sourceId, item]),
    );
    check(
      source.sourceId === retirement.sourceId &&
        source.repositoryNodeId === packet.sourceAudit.repositoryNodeId &&
        earlier.size === retirement.earlierSources.length &&
        !earlier.has(source.sourceId),
      "Invalid duplicate source identity",
    );
    for (const item of [source, ...earlier.values()]) {
      const audited = packet.sourceAudit.sources.find(
        (row) => row.id === item.sourceId,
      );
      check(
        item.complete &&
          item.commitCount === item.commits.length &&
          item.commits.length > 0 &&
          new Set(item.commits.map((commit) => commit.sha)).size ===
            item.commits.length &&
          audited?.headSha === item.headSha &&
          audited.mergedAt === item.occurredAt &&
          item.repositoryNodeId === source.repositoryNodeId &&
          item.repository.toLowerCase() === source.repository.toLowerCase() &&
          item.sourceUrl ===
            `https://github.com/${packet.sourceAudit.repository}/pull/${audited.number}`,
        "Duplicate source is incomplete or outside the audit",
      );
      if (item !== source)
        check(
          item.occurredAt !== null &&
            source.occurredAt !== null &&
            item.occurredAt <= source.occurredAt,
          "Duplicate coverage is not an earlier accepted source",
        );
    }
    const expected: string[] = [];
    for (const commit of source.commits) {
      check(
        /^[a-f0-9]{40}$/u.test(commit.sha) &&
          Number.isSafeInteger(commit.parentCount) &&
          commit.parentCount >= 0 &&
          commit.parentShas?.length === commit.parentCount &&
          commit.parentShas.every((parent) => /^[a-f0-9]{40}$/u.test(parent)),
        "Duplicate commit identity is incomplete",
      );
      if (commit.parentCount > 1) {
        const resolutionFiles =
          commit.mergeResolution &&
          mergeResolutionLineCounts(commit.mergeResolution, {
            sha: commit.sha,
            parents: commit.parentShas.map((sha) => ({ sha })),
          });
        check(
          resolutionFiles &&
            JSON.stringify(resolutionFiles) === JSON.stringify(commit.files),
          "Duplicate merge has unreviewed resolution work",
        );
        if (resolutionFiles.length === 0) continue;
      }
      check(
        commit.files &&
          commit.files.length > 0 &&
          new Set(commit.files.map((file) => file.path)).size ===
            commit.files.length,
        "Duplicate commit lacks complete paths",
      );
      for (const file of commit.files) {
        const key = `${commit.sha}\0${file.path}`;
        expected.push(key);
        const matches = retirement.coverage.filter(
          (row) => row.commitSha === commit.sha && row.path === file.path,
        );
        check(
          matches.length === 1,
          "Duplicate claim coverage is missing or repeated",
        );
        const owner = earlier.get(matches[0].sourceId);
        const retained = owner?.commits.find((item) => item.sha === commit.sha);
        const retainedFile = retained?.files?.find(
          (item) => item.path === file.path,
        );
        check(
          owner &&
            !retiringSources.has(owner.sourceId) &&
            retained &&
            retained.parentCount === commit.parentCount &&
            commit.firstAcceptedSourceId === owner.sourceId &&
            retained.firstAcceptedSourceId === owner.sourceId &&
            JSON.stringify(retained.parentShas) ===
              JSON.stringify(commit.parentShas) &&
            retained.author?.id === commit.author?.id &&
            retained.author?.kind === commit.author?.kind &&
            Number.isSafeInteger(file.additions) &&
            file.additions >= 0 &&
            Number.isSafeInteger(file.deletions) &&
            file.deletions >= 0 &&
            retainedFile?.additions === file.additions &&
            retainedFile?.deletions === file.deletions,
          "Earlier source does not cover the exact duplicate claim",
        );
        const unit = matches[0].rewardedUnit;
        if (unit) {
          check(
            !retiringSources.has(unit.awardSourceId),
            "Duplicate coverage relies on another retired pool",
          );
          check(
            hash(JSON.parse(unit.recordJson)) === unit.recordDigest &&
              sha256Hex(unit.recordJson) === unit.recordDigest,
            "Rewarded claim record changed",
          );
          const record = JSON.parse(unit.recordJson);
          const claim = record.claims?.find(
            (item: { id: string }) => item.id === unit.claimId,
          );
          const group = record.units?.find(
            (item: { workUnitId: string }) =>
              item.workUnitId === unit.workUnitId,
          );
          const recordSource = record.sources?.find(
            (item: { pullRequestNodeId: string }) =>
              item.pullRequestNodeId === owner.sourceId,
          );
          const unitClaims =
            record.claims?.filter((item: { id: string }) =>
              group?.claimIds.includes(item.id),
            ) ?? [];
          const acceptanceSources = unitClaims
            .map(
              (item: {
                creditPullRequestId: string;
                retainedCopy?: { acceptancePullRequestId: string };
              }) =>
                record.sources.find(
                  (source: { pullRequestNodeId: string }) =>
                    source.pullRequestNodeId ===
                    (item.retainedCopy?.acceptancePullRequestId ??
                      item.creditPullRequestId),
                ),
            )
            .filter(Boolean)
            .sort(
              (
                a: { occurredAt: string; pullRequestNodeId: string },
                b: { occurredAt: string; pullRequestNodeId: string },
              ) =>
                Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
                a.pullRequestNodeId.localeCompare(b.pullRequestNodeId),
            );
          check(
            record.projectId === packet.projectId &&
              recordSource?.repositoryNodeId === owner.repositoryNodeId &&
              recordSource.headSha === owner.headSha &&
              claim?.repositoryNodeId === source.repositoryNodeId &&
              claim.commitSha === commit.sha &&
              claim.path === file.path &&
              claim.creditPullRequestId === owner.sourceId &&
              group?.claimIds.includes(unit.claimId) &&
              group.assessment?.status === "assessed" &&
              Object.hasOwn(VALUE_TIERS, group.assessment.tier) &&
              VALUE_TIERS[group.assessment.tier as keyof typeof VALUE_TIERS] >
                0 &&
              acceptanceSources.at(-1)?.pullRequestNodeId ===
                unit.awardSourceId,
            "Rewarded unit does not cover the duplicate claim",
          );
        }
        check(
          rewardedAwards.some(
            (award) =>
              award.projectId === packet.projectId &&
              award.category === "merged-pull-request" &&
              award.amount > 0 &&
              (unit
                ? award.sourceId === unit.awardSourceId &&
                  award.workUnitId === unit.workUnitId
                : award.sourceId === owner.sourceId),
          ),
          "Duplicate claim lacks a retained rewarded pool",
        );
      }
    }
    check(
      expected.length > 0 &&
        retirement.coverage.length === expected.length &&
        retirement.coverage.every((row) =>
          expected.includes(`${row.commitSha}\0${row.path}`),
        ),
      "Duplicate retirement has extra or empty coverage",
    );
    const evidence = JSON.parse(retirement.evidence);
    check(
      sha256Hex(retirement.evidence) === retirement.evidenceSha256 &&
        evidence.sourceId === retirement.sourceId &&
        evidence.workUnitId === retirement.workUnitId &&
        evidence.sourceSha256 === hash(source) &&
        evidence.coverageSha256 === hash(retirement.coverage) &&
        evidence.earlierSourcesSha256 === hash(retirement.earlierSources),
      "Duplicate retirement dossier changed",
    );
    const candidate = packet.corrections.candidates.find(
      (item) =>
        item.sourceId === source.sourceId &&
        item.workUnitId === retirement.workUnitId,
    );
    const rows = [...latestPoints(result).values()].filter(
      ({ award }) =>
        award.projectId === packet.projectId &&
        award.sourceId === retirement.sourceId &&
        award.workUnitId === retirement.workUnitId &&
        award.category === "merged-pull-request",
    );
    check(
      candidate &&
        rows.length > 0 &&
        rows.every(
          ({ award }) =>
            award.occurredAt === source.occurredAt &&
            award.occurredAt.startsWith("2026-10-") &&
            award.sourceUrl === source.sourceUrl,
        ) &&
        rows.length === retirement.expectedPredecessors.length &&
        new Set(retirement.expectedPredecessors.map((row) => row.key)).size ===
          rows.length &&
        rows.every((row) =>
          retirement.expectedPredecessors.some(
            (prior) =>
              prior.key === row.award.key && prior.revisionId === row.id,
          ),
        ),
      "Duplicate pool changed after owner review",
    );
    result = appendPointAwards(
      result,
      rows.map(({ award }) => ({ ...award, amount: 0 })),
      hash(retirement),
      "slop-score-v2",
      packet.reviewedAt,
      new Map(
        rows.map(({ award }) => [
          award.key,
          {
            sourceId: `owner_duplicate_${retirement.evidenceSha256}`,
            effectiveAt: packet.reviewedAt,
            reason: OCTOBER_DUPLICATE_RETIREMENT_DECISION,
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
