import type { PointsJournal } from "../src/lib/points";
import {
  assertHistoricalAssessmentFreshness,
  readHistoricalAssessmentCatalog,
} from "./historical-assessment-catalog";
import { classifyHistoricalAssessmentScope } from "./historical-assessment-reconciliation";
import { verifyHistoricalValueReplay } from "./historical-value-replay";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";

/** Sanitized receipt from an authenticated, successful replay workflow run. */
export interface HistoricalReplayReceipt {
  schemaVersion: "1";
  projectId: string;
  mode: "assessment-replay";
  status: "requires-value-replay" | "no-scoped-active-assessments";
  sourceCommit: string;
  sourceDigest: string;
  sourceCount: number;
  sourceRepositoryNodeId: string;
  sourceFrom: string;
  sourceThrough: string;
  expectedPointsDigest: string;
  baselineRevisionCount: number;
  registryRevision: number;
  registryManifestSha256: string;
  enforcementGeneration: number;
  jointThrough: number;
  legacyThrough: number;
  jointRecords: number;
  legacyRecords: number;
  receiptDigest: string;
  replay: {
    snapshotSha256: string | null;
    valueCoverageCount: number;
    closedUnmergedCoverageCount: number;
    valueEventCount: number;
    qualificationSha256: string | null;
  };
}

type Query = (sql: string) => Promise<Record<string, unknown>[]>;
type ReplayPacket = Pick<
  HistoricalPointsPacket,
  | "projectId"
  | "sourceAudit"
  | "revision"
  | "manifestSha256"
  | "baselineDigest"
  | "baselineRevisionCount"
  | "replayQualification"
  | "valueSnapshot"
  | "valueKeys"
>;

/** Rebuild the owner's value projection against the donor's immutable journal prefix. */
export async function verifyHistoricalReplayQualification(
  packet: ReplayPacket,
  baseline: PointsJournal,
  donor: HistoricalReplayReceipt,
  sourceCommit: string,
  enforcementGeneration: number,
  query: Query,
) {
  const { sourceAudit: audit } = packet;
  const qualification = packet.replayQualification?.qualificationSha256;
  if (
    !qualification ||
    !/^[a-f0-9]{64}$/u.test(qualification) ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    donor.schemaVersion !== "1" ||
    donor.mode !== "assessment-replay" ||
    donor.sourceCommit !== sourceCommit ||
    donor.projectId !== packet.projectId ||
    donor.sourceRepositoryNodeId !== audit.repositoryNodeId ||
    donor.sourceFrom !== audit.from ||
    donor.sourceThrough !== audit.through ||
    donor.sourceCount !== audit.sources.length ||
    donor.expectedPointsDigest !== packet.baselineDigest ||
    donor.baselineRevisionCount !== packet.baselineRevisionCount ||
    donor.registryRevision !== packet.revision ||
    donor.registryManifestSha256 !== packet.manifestSha256 ||
    donor.enforcementGeneration !== enforcementGeneration ||
    donor.replay?.qualificationSha256 !== qualification
  )
    throw new Error("Trusted replay receipt differs from the reviewed packet");

  const scope = {
    projectId: packet.projectId,
    repositoryNodeId: audit.repositoryNodeId,
    revision: packet.revision,
    manifestSha256: packet.manifestSha256,
    expectedPointsDigest: packet.baselineDigest,
  };
  const catalog = await readHistoricalAssessmentCatalog(scope, query, {
    jointThrough: donor.jointThrough,
    legacyThrough: donor.legacyThrough,
  });
  const { heads } = catalog;
  const receipt = await classifyHistoricalAssessmentScope(
    catalog,
    audit,
    scope.projectId,
  );
  if (
    heads.enforcementGeneration !== donor.enforcementGeneration ||
    heads.jointScopedCount !== donor.jointRecords ||
    heads.legacyRepoCount !== donor.legacyRecords ||
    receipt.scope.sourceAuditSha256 !== donor.sourceDigest ||
    receipt.receiptSha256 !== donor.receiptDigest ||
    receipt.status !== donor.status
  )
    throw new Error(
      "Trusted replay differs from the protected assessment catalog",
    );

  const snapshot = packet.valueSnapshot;
  const coverageCount = snapshot?.valueAssessmentCoverage?.length ?? 0;
  const eventCount =
    snapshot?.ledger.filter((row) =>
      row.scoreDecisionSourceId?.startsWith("value:"),
    ).length ?? 0;
  if (
    donor.replay.closedUnmergedCoverageCount !== 0 ||
    donor.replay.valueCoverageCount !== coverageCount ||
    donor.replay.valueEventCount !== eventCount ||
    (snapshot
      ? typeof donor.replay.snapshotSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(donor.replay.snapshotSha256)
      : donor.replay.snapshotSha256 !== null)
  )
    throw new Error("Trusted replay output differs from the reviewed scope");
  // The packet's own projection is accepted only if it matches the
  // independent qualification digest from the authenticated donor run.
  if (
    verifyHistoricalValueReplay(packet, baseline, receipt, snapshot) !==
    qualification
  )
    throw new Error(
      "Reviewed value projection differs from the trusted qualification",
    );
  await assertHistoricalAssessmentFreshness(scope, heads, query);
  return heads;
}
