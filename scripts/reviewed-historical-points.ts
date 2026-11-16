/** Owner-reviewed historical award changes, reconstructed with canonical Points APIs. */

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { shareImplementationPoints } from "../src/lib/implementation-allocation";
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
  type CorrectionCommit,
  type CorrectionSource,
  type PointsImplementationCorrectionManifest,
} from "../src/lib/points-implementation-corrections";
import { sha256Hex } from "../src/lib/sha256";
import { VALUE_TIERS } from "../src/lib/value-assessment";
import type { Pull } from "../workers/slopbot/value-evidence-types";
import { mergeResolutionLineCounts } from "../workers/slopbot/value-merge-resolution";
import { pointProtectionQuery } from "./points-protection-sql";

/** An earlier PR's accepted squash is kept separately from its submitted history. */
export interface HistoricalAcceptedSquash {
  sourceId: string;
  sourceUrl: string;
  repositoryNodeId: string;
  headSha: string;
  occurredAt: string;
  author: CorrectionSource["author"];
  commit: CorrectionCommit;
  headCommit: string;
  acceptedCommit: string;
}

function retainedCommit(raw: string, sha: string) {
  check(
    typeof raw === "string" && Buffer.byteLength(raw) <= 1024 * 1024,
    "Invalid retained squash commit",
  );
  const bytes = Buffer.from(raw);
  check(
    createHash("sha1")
      .update(`commit ${bytes.length}\0`)
      .update(bytes)
      .digest("hex") === sha,
    "Retained squash commit hash changed",
  );
  const headers = raw.slice(0, raw.indexOf("\n\n")).split("\n");
  const tree = /^tree ([a-f0-9]{40})$/u.exec(headers[0])?.[1];
  const parents = headers
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice(7));
  check(
    tree &&
      parents.every((parent) => /^[a-f0-9]{40}$/u.test(parent)) &&
      new Set(parents).size === parents.length,
    "Invalid retained squash parents",
  );
  return { tree, parents };
}

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
    /** Owner-reviewed promotion with no accepted tree change at either stage. */
    unchangedPromotion?: {
      sourceDigest: string;
      pull: Pull;
      merge: {
        sha: string;
        parents: { sha: string }[];
        stats: { additions: number; deletions: number; total: number };
        files: unknown[];
      };
      commits: {
        sha: string;
        tree: { sha: string };
        parents: { sha: string }[];
      }[];
    };
    earlierSources: CorrectionSource[];
    /** Complete native commit membership already accepted before this promotion. */
    earlierAcceptanceProof?: {
      commits: { sha: string; sourceId: string }[];
      sourceBaseSha: string;
      objects: { sha: string; raw: string }[];
      contextSources: {
        id: string;
        number: number;
        headSha: string;
        baseSha: string;
        mergedAt: string;
        mergeSha: string;
        /** Explicit owner review of prior acceptance, never an inferred expiry. */
        historicalAwardRevisionId?: string;
        reviewedBotFollowupShas?: string[];
        automaticMerge?: {
          baseParentSha: string;
          gitVersion: "git version 2.56.0";
          automaticTree: string;
        };
      }[];
    };
    acceptedSquashes?: HistoricalAcceptedSquash[];
    acceptedPromotion?: {
      headCommit: string;
      mergeCommit: string;
      mergeSha: string;
    };
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
  return decodeHistoricalPacketBytes(
    gunzipSync(Buffer.from(encoded, "base64")),
    digest,
  );
}

export function decodeHistoricalPacketBytes(
  bytes: Uint8Array,
  digest: string,
): HistoricalPointsPacket {
  check(/^[a-f0-9]{64}$/u.test(digest), "Invalid reviewed packet digest");
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
    const shares = shareImplementationPoints(
      Number(total),
      correction.recipients.map((row) => row.actor.id),
      new Map(
        correction.recipients.map((row) => [row.actor.id, BigInt(row.weight)]),
      ),
    );
    const replacements = correction.recipients.map((row, index) => ({
      ...template,
      key: pointKey(
        packet.projectId,
        row.actor.id,
        "merged-pull-request",
        correction.sourceId,
        candidate.kind === "work-unit" ? correction.workUnitId : undefined,
      ),
      actor: row.actor,
      amount: shares[index],
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
  const latestBaseline = latestPoints(baseline);
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
      const audited =
        packet.sourceAudit.sources.find((row) => row.id === item.sourceId) ??
        retirement.earlierAcceptanceProof?.contextSources.find(
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
    const unchanged = retirement.unchangedPromotion;
    const treeCommits = new Map(
      unchanged?.commits.map((commit) => [commit.sha, commit]),
    );
    if (unchanged) {
      const pull = unchanged.pull,
        merge = unchanged.merge;
      const sha = (value: unknown) =>
        typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
      check(
        Object.keys(unchanged).sort().join() ===
          "commits,merge,pull,sourceDigest" &&
          unchanged.sourceDigest ===
            hash({
              pull: unchanged.pull,
              merge: unchanged.merge,
              commits: unchanged.commits,
            }) &&
          pull.node_id === source.sourceId &&
          pull.html_url === source.sourceUrl &&
          pull.state === "closed" &&
          pull.merged_at !== null &&
          new Date(pull.merged_at).toISOString() === source.occurredAt &&
          pull.head.sha === source.headSha &&
          sha(pull.base.sha) &&
          Object.keys(merge).sort().join() === "files,parents,sha,stats" &&
          Object.keys(merge.stats).sort().join() ===
            "additions,deletions,total" &&
          merge.sha === pull.merge_commit_sha &&
          sha(merge.sha) &&
          merge.parents.length === 2 &&
          merge.parents[1].sha === source.headSha &&
          merge.parents.every(
            (parent) => Object.keys(parent).join() === "sha" && sha(parent.sha),
          ) &&
          merge.parents[0].sha !== merge.parents[1].sha &&
          merge.stats.additions === 0 &&
          merge.stats.deletions === 0 &&
          merge.stats.total === 0 &&
          Array.isArray(merge.files) &&
          merge.files.length === 0 &&
          unchanged.commits.length === treeCommits.size &&
          unchanged.commits.every(
            (commit) =>
              Object.keys(commit).sort().join() === "parents,sha,tree" &&
              sha(commit.sha) &&
              Object.keys(commit.tree).join() === "sha" &&
              sha(commit.tree.sha) &&
              commit.parents.every(
                (parent) =>
                  Object.keys(parent).join() === "sha" && sha(parent.sha),
              ) &&
              new Set(commit.parents.map((parent) => parent.sha)).size ===
                commit.parents.length,
          ),
        "Unchanged promotion identity is invalid",
      );
      const head = treeCommits.get(source.headSha),
        base = treeCommits.get(pull.base.sha);
      const accepted = treeCommits.get(merge.sha),
        parent = treeCommits.get(merge.parents[0].sha);
      const required = new Set([
        pull.base.sha,
        source.headSha,
        merge.sha,
        merge.parents[0].sha,
        ...source.commits.flatMap((commit) => [
          commit.sha,
          ...(commit.parentShas ?? []),
        ]),
      ]);
      check(
        required.size === treeCommits.size &&
          [...required].every((sha) => treeCommits.has(sha)),
        "Promotion tree proof has missing or extra commits",
      );
      check(
        head &&
          base &&
          accepted &&
          parent &&
          head.tree.sha === base.tree.sha &&
          accepted.tree.sha === parent.tree.sha &&
          JSON.stringify(accepted.parents) === JSON.stringify(merge.parents),
        "Unchanged promotion trees or accepted parents differ",
      );
      for (const commit of source.commits) {
        const retained = treeCommits.get(commit.sha);
        check(
          retained &&
            JSON.stringify(retained.parents.map((p) => p.sha)) ===
              JSON.stringify(commit.parentShas),
          "Promotion commit parent proof is incomplete",
        );
      }
    }
    const squashes = new Map(
      (retirement.acceptedSquashes ?? []).map((item) => [item.sourceId, item]),
    );
    check(
      squashes.size === (retirement.acceptedSquashes?.length ?? 0),
      "Repeated accepted squash source",
    );
    if (squashes.size || retirement.earlierAcceptanceProof) {
      const promotion = retirement.acceptedPromotion;
      check(
        promotion &&
          source.commits.some((commit) => commit.sha === source.headSha),
        "Accepted promotion proof is missing",
      );
      const head = retainedCommit(promotion.headCommit, source.headSha);
      const merge = retainedCommit(promotion.mergeCommit, promotion.mergeSha);
      check(
        head.tree === merge.tree &&
          merge.parents.length === 2 &&
          merge.parents[1] === source.headSha &&
          merge.parents[0] !== source.headSha,
        "Accepted promotion changes submitted content",
      );
    }
    for (const squash of squashes.values()) {
      const audited = packet.sourceAudit.sources.find(
        (item) => item.id === squash.sourceId,
      );
      check(
        !earlier.has(squash.sourceId) &&
          squash.sourceId !== source.sourceId &&
          squash.repositoryNodeId === source.repositoryNodeId &&
          audited?.headSha === squash.headSha &&
          audited.mergedAt === squash.occurredAt &&
          squash.sourceUrl ===
            `https://github.com/${packet.sourceAudit.repository}/pull/${audited.number}` &&
          source.occurredAt !== null &&
          squash.occurredAt < source.occurredAt &&
          squash.author !== null &&
          typeof squash.author.id === "string" &&
          ["User", "Bot"].includes(squash.author.kind) &&
          (squash.commit.author === null ||
            (typeof squash.commit.author.id === "string" &&
              ["User", "Bot"].includes(squash.commit.author.kind))) &&
          squash.commit.firstAcceptedSourceId === squash.sourceId &&
          squash.commit.parentCount === 1 &&
          squash.commit.parentShas?.length === 1 &&
          squash.commit.files?.length &&
          new Set(squash.commit.files.map((file) => file.path)).size ===
            squash.commit.files.length &&
          squash.commit.files.every(
            (file) =>
              Number.isSafeInteger(file.additions) &&
              file.additions >= 0 &&
              Number.isSafeInteger(file.deletions) &&
              file.deletions >= 0,
          ) &&
          squash.commit.additions ===
            squash.commit.files.reduce(
              (sum, file) => sum + file.additions,
              0,
            ) &&
          squash.commit.deletions ===
            squash.commit.files.reduce((sum, file) => sum + file.deletions, 0),
        "Incomplete accepted squash source",
      );
      retainedCommit(squash.headCommit, squash.headSha);
      const accepted = retainedCommit(squash.acceptedCommit, squash.commit.sha);
      check(
        JSON.stringify(accepted.parents) ===
          JSON.stringify(squash.commit.parentShas),
        "Accepted squash parent changed",
      );
    }
    const acceptedProof = retirement.earlierAcceptanceProof;
    const acceptedCommits = new Map(
      acceptedProof?.commits.map((item) => [item.sha, item.sourceId]),
    );
    if (acceptedProof) {
      check(
        acceptedCommits.size === acceptedProof.commits.length &&
          acceptedProof.commits.length > 0 &&
          new Set(acceptedProof.objects.map((item) => item.sha)).size ===
            acceptedProof.objects.length &&
          new Set(acceptedProof.contextSources.map((item) => item.id)).size ===
            acceptedProof.contextSources.length &&
          acceptedProof.contextSources.length === earlier.size &&
          acceptedProof.contextSources.every((item) => earlier.has(item.id)),
        "Earlier acceptance repeats or omits source identity",
      );
      const objects = new Map(
        acceptedProof.objects.map((item) => [
          item.sha,
          retainedCommit(item.raw, item.sha),
        ]),
      );
      const requiredObjects = new Set<string>();
      const rewardedSourceIds = new Set(
        rewardedAwards
          .filter(
            (award) =>
              award.projectId === packet.projectId &&
              award.category === "merged-pull-request" &&
              award.amount > 0,
          )
          .map((award) => award.sourceId),
      );
      for (const item of [source, ...earlier.values()]) {
        requiredObjects.add(item.headSha);
        for (const commit of item.commits) {
          requiredObjects.add(commit.sha);
          const retained = objects.get(commit.sha);
          check(
            retained &&
              commit.parentCount === retained.parents.length &&
              JSON.stringify(commit.parentShas) ===
                JSON.stringify(retained.parents),
            "Earlier acceptance commit parents differ",
          );
        }
        const head = objects.get(item.headSha);
        check(head, "Earlier acceptance head is unavailable");
        const context =
          item === source
            ? undefined
            : acceptedProof.contextSources.find(
                (row) => row.id === item.sourceId,
              );
        const baseSha =
          item === source ? acceptedProof.sourceBaseSha : context?.baseSha;
        check(
          baseSha && /^[a-f0-9]{40}$/u.test(baseSha),
          "Earlier acceptance base is unavailable",
        );
        const base = objects.get(baseSha);
        check(base, "Earlier acceptance base object is missing");
        requiredObjects.add(baseSha);
        const memberIds = new Set(item.commits.map((commit) => commit.sha));
        const reachable = new Set<string>();
        const pending = [item.headSha];
        while (pending.length) {
          const sha = pending.pop();
          if (!sha || reachable.has(sha) || !memberIds.has(sha)) continue;
          reachable.add(sha);
          pending.push(...(objects.get(sha)?.parents ?? []));
        }
        // Complete head-minus-base membership is independently re-collected
        // through GitHub's immutable range by the normal publication runner.
        check(
          reachable.size === memberIds.size,
          "Earlier acceptance has disconnected source commits",
        );
        if (item === source) continue;
        check(
          context &&
            context.headSha === item.headSha &&
            context.mergedAt === item.occurredAt &&
            Number.isSafeInteger(context.number) &&
            context.number > 0 &&
            item.sourceUrl ===
              `https://github.com/${packet.sourceAudit.repository}/pull/${context.number}` &&
            /^[a-f0-9]{40}$/u.test(context.mergeSha),
          "Earlier acceptance source identity differs",
        );
        const audited = packet.sourceAudit.sources.find(
          (row) => row.id === item.sourceId,
        );
        check(
          !audited ||
            (audited.number === context.number &&
              audited.headSha === context.headSha &&
              audited.mergedAt === context.mergedAt),
          "Earlier acceptance conflicts with current audit",
        );
        requiredObjects.add(context.mergeSha);
        const merge = objects.get(context.mergeSha);
        const automatic = context.automaticMerge;
        if (automatic)
          check(
            merge &&
              merge.parents.length === 1 &&
              automatic.gitVersion === "git version 2.56.0" &&
              /^[a-f0-9]{40}$/u.test(automatic.baseParentSha) &&
              /^[a-f0-9]{40}$/u.test(automatic.automaticTree) &&
              automatic.baseParentSha === merge.parents[0] &&
              automatic.automaticTree === merge.tree &&
              objects.has(automatic.baseParentSha),
            "Earlier automatic merge proof is invalid",
          );
        if (automatic) requiredObjects.add(automatic.baseParentSha);
        check(
          merge &&
            (automatic !== undefined ||
              context.mergeSha === item.headSha ||
              (merge.parents.length === 2 &&
                merge.parents[1] === item.headSha) ||
              merge.tree === head.tree),
          "Earlier acceptance merge does not retain its head",
        );
        const historical =
          context.historicalAwardRevisionId === undefined
            ? undefined
            : baseline.revisions.find(
                (row) => row.id === context.historicalAwardRevisionId,
              );
        check(
          context.historicalAwardRevisionId === undefined ||
            (historical &&
              historical.award.projectId === packet.projectId &&
              historical.award.sourceId === item.sourceId &&
              historical.award.sourceUrl === item.sourceUrl &&
              historical.award.occurredAt === item.occurredAt &&
              historical.award.category === "merged-pull-request" &&
              historical.award.amount > 0 &&
              historical.award.occurredAt < "2026-10-01T00:00:00.000Z" &&
              historical.recordedAt < packet.reviewedAt &&
              latestBaseline.get(historical.award.key)?.award.amount === 0 &&
              !latestBaseline.get(historical.award.key)?.decision &&
              !latestBaseline.get(historical.award.key)?.penalty),
          "Earlier historical award reference is invalid",
        );
        // Unmapped commits use the complete per-path coverage checks below,
        // including any canonical joint-unit reward that absorbed this source.
        const botFollowups = context.reviewedBotFollowupShas;
        const nonBotShas = item.commits
          .filter((commit) => commit.author?.kind !== "Bot")
          .map((commit) => commit.sha)
          .sort();
        if (botFollowups !== undefined)
          check(
            item.author?.kind === "Bot" &&
              item.occurredAt !== null &&
              item.occurredAt < "2026-10-01T00:00:00.000Z" &&
              botFollowups.length > 0 &&
              new Set(botFollowups).size === botFollowups.length &&
              JSON.stringify([...botFollowups].sort()) ===
                JSON.stringify(nonBotShas) &&
              JSON.parse(retirement.evidence)
                .historicalPriorAcceptanceReviewed === true,
            "Earlier bot follow-up review is invalid",
          );
        check(
          !acceptedProof.commits.some(
            (commit) => commit.sourceId === item.sourceId,
          ) ||
            rewardedSourceIds.has(item.sourceId) ||
            botFollowups !== undefined ||
            (historical &&
              historical.award.projectId === packet.projectId &&
              historical.award.sourceId === item.sourceId &&
              historical.award.sourceUrl === item.sourceUrl &&
              historical.award.occurredAt === item.occurredAt &&
              historical.award.category === "merged-pull-request" &&
              historical.award.amount > 0 &&
              historical.award.occurredAt < "2026-10-01T00:00:00.000Z" &&
              historical.recordedAt < packet.reviewedAt &&
              latestBaseline.get(historical.award.key)?.award.amount === 0 &&
              !latestBaseline.get(historical.award.key)?.decision &&
              !latestBaseline.get(historical.award.key)?.penalty) ||
            (item.author?.kind === "Bot" &&
              item.commits.every((commit) => commit.author?.kind === "Bot")),
          "Earlier acceptance has no retained reward or bot exclusion",
        );
      }
      check(
        requiredObjects.size === objects.size &&
          [...requiredObjects].every((sha) => objects.has(sha)),
        "Earlier acceptance has missing or extra Git objects",
      );
      for (const [sha, sourceId] of acceptedCommits) {
        const commit = source.commits.find((item) => item.sha === sha);
        const owner = earlier.get(sourceId);
        const retained = owner?.commits.find((item) => item.sha === sha);
        check(
          commit &&
            owner &&
            retained &&
            !retiringSources.has(sourceId) &&
            commit.firstAcceptedSourceId === sourceId &&
            retained.firstAcceptedSourceId === sourceId &&
            commit.author?.id === retained.author?.id &&
            commit.author?.kind === retained.author?.kind &&
            JSON.stringify(commit.parentShas) ===
              JSON.stringify(retained.parentShas),
          "Earlier acceptance does not cover the exact native commit",
        );
      }
    }
    const usedSquashes = new Set<string>();
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
      if (acceptedCommits.has(commit.sha)) continue;
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
        if (unchanged && resolutionFiles.length > 0) {
          const retained = treeCommits.get(commit.sha);
          const parent = treeCommits.get(commit.parentShas[0]);
          check(
            retained && parent && retained.tree.sha === parent.tree.sha,
            "Promotion merge changes its first-parent tree",
          );
          check(
            commit.mergeResolution?.resolvedTree === retained.tree.sha,
            "Promotion resolution tree is unbound",
          );
          continue;
        }
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
        const squash = squashes.get(matches[0].sourceId);
        const owner = earlier.get(matches[0].sourceId) ?? squash;
        const retained =
          squash?.commit ??
          earlier
            .get(matches[0].sourceId)
            ?.commits.find((item) => item.sha === commit.sha);
        if (squash) usedSquashes.add(squash.sourceId);
        const retainedFile = retained?.files?.find(
          (item) => item.path === file.path,
        );
        check(
          owner &&
            !retiringSources.has(owner.sourceId) &&
            retained &&
            retained.parentCount === commit.parentCount &&
            retained.sha === commit.sha &&
            (!squash ||
              (JSON.stringify(squash.commit.files) ===
                JSON.stringify(commit.files) &&
                squash.commit.additions === commit.additions &&
                squash.commit.deletions === commit.deletions)) &&
            (squash
              ? commit.firstAcceptedSourceId === source.sourceId
              : commit.firstAcceptedSourceId === owner.sourceId) &&
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
              (claim.creditPullRequestId === owner.sourceId ||
                claim.carrierPullRequestIds?.includes(owner.sourceId)) &&
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
          (squash?.author?.kind === "Bot" &&
            squash.commit.author?.kind === "Bot") ||
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
      (expected.length > 0 || acceptedCommits.size > 0) &&
        usedSquashes.size === squashes.size &&
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
        evidence.earlierSourcesSha256 === hash(retirement.earlierSources) &&
        (acceptedProof === undefined ||
          (evidence.earlierAcceptanceProofSha256 === hash(acceptedProof) &&
            (!acceptedProof.contextSources.some(
              (row) => row.historicalAwardRevisionId,
            ) ||
              evidence.historicalPriorAcceptanceReviewed === true))) &&
        (retirement.acceptedSquashes === undefined ||
          evidence.acceptedSquashesSha256 ===
            hash(retirement.acceptedSquashes)) &&
        (retirement.acceptedPromotion === undefined ||
          evidence.acceptedPromotionSha256 ===
            hash(retirement.acceptedPromotion)) &&
        (unchanged === undefined ||
          evidence.unchangedPromotionSha256 === hash(unchanged)),
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
