/** Recalculate a saved app proposal; imported amounts and approval claims are ignored. */
import { readFile, writeFile } from "node:fs/promises";
import {
  assertQualityEvidence,
  calculateQualityReview,
  qualityEvidenceBinding,
  verifyQualityEventIds,
} from "../src/lib/contribution-quality";
import {
  assertFundingPreparation,
  createFundingReview,
} from "../src/lib/funding-review-data";

const [preparationPath, evidencePath, proposalPath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw new Error(
    "Usage: simulate-contribution-quality.ts PREPARATION EVIDENCE PROPOSAL OUTPUT",
  );
const preparation = assertFundingPreparation(
  JSON.parse(await readFile(preparationPath, "utf8")),
);
const evidence = assertQualityEvidence(
  JSON.parse(await readFile(evidencePath, "utf8")),
  preparation,
);
await verifyQualityEventIds(evidence, preparation);
const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
const review = createFundingReview(preparation);
if (
  !review.capMinor ||
  proposal.schemaVersion !== "1" ||
  proposal.kind !== "contribution-quality-proposal" ||
  proposal.sourceSnapshotSha256 !== preparation.sourceSnapshotSha256 ||
  proposal.projectId !== preparation.projectId ||
  proposal.cycleId !== preparation.cycleId ||
  proposal.capMinor !== review.capMinor ||
  proposal.sourceQualityBinding !== qualityEvidenceBinding(evidence) ||
  proposal.paymentAuthorized !== false ||
  !Array.isArray(proposal.decisions) ||
  !Array.isArray(proposal.burdens)
)
  throw new Error(
    "Proposal does not match the exact source and manifest budget",
  );
const result = calculateQualityReview(
  evidence,
  proposal.decisions,
  review.capMinor,
  proposal.burdens,
  new Map(
    preparation.contributors.map((row) => [row.actor.id, row.actor.login]),
  ),
);
await writeFile(
  outputPath,
  `${JSON.stringify({ projectId: preparation.projectId, cycleId: preparation.cycleId, sourceSnapshotSha256: preparation.sourceSnapshotSha256, capMinor: review.capMinor, paymentAuthorized: false, reviewedEvents: result.reviewedEvents, unresolvedEvents: result.unresolvedEvents, retainedMinor: result.retainedMinor, contributors: preparation.contributors.map((row) => ({ actor: row.actor, walletPresent: row.wallet !== null, beforeMinor: result.before.get(row.actor.id), proposedMinor: result.after.get(row.actor.id), deltaMinor: (BigInt(result.after.get(row.actor.id) ?? "0") - BigInt(result.before.get(row.actor.id) ?? "0")).toString() })) }, null, 2)}\n`,
  { flag: "wx" },
);
