/** Validate a completed collector artifact for a read-only reconciliation. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertPointsJournalExtension,
  type PointsJournal,
} from "../src/lib/points";
import {
  createPointsCorrectionBaseline,
  type PointsImplementationCorrectionManifest,
} from "../src/lib/points-implementation-corrections";
import { inventoryCorrectionPools } from "./collect-implementation-corrections";
import { loadPublishedPoints } from "./generate-points";
import { verifyCorrectionCollection } from "./prepare-implementation-corrections";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";

interface CompletedCampaign {
  schemaVersion: string;
  projects: string[];
  before: string;
  through: string;
  registryDigest: string;
  octoberOriginalCredit?: boolean;
  baseline: unknown;
}

interface CompleteCollection {
  projects?: unknown;
  before?: unknown;
  through?: unknown;
  registryDigest?: unknown;
  missingMonths?: unknown;
  selectedPools?: unknown;
  manifestDigest: string;
}

export function verifyReusedImplementationPreview({
  campaign,
  frozen,
  current,
  manifest,
  receipt,
  registry,
  project,
  before,
  octoberOriginalCredit,
}: {
  campaign: CompletedCampaign;
  frozen: PointsJournal;
  current: PointsJournal;
  manifest: PointsImplementationCorrectionManifest;
  receipt: CompleteCollection;
  registry: unknown;
  project: string;
  before: string;
  octoberOriginalCredit: boolean;
}): string {
  const encode = JSON.stringify;
  const same = (left: unknown, right: unknown) =>
    encode(left) === encode(right);
  if (
    !project ||
    campaign.schemaVersion !== "1" ||
    !same(campaign.projects, [project]) ||
    !same(receipt.projects, campaign.projects) ||
    (before && before !== campaign.before) ||
    new Date(campaign.before).toISOString() !== campaign.before ||
    new Date(campaign.through).toISOString() !== campaign.through ||
    (campaign.octoberOriginalCredit ?? false) !== octoberOriginalCredit ||
    receipt.before !== campaign.before ||
    receipt.through !== campaign.through ||
    receipt.registryDigest !== campaign.registryDigest ||
    !same(receipt.missingMonths, [])
  )
    throw new Error("Completed evidence does not bind the requested scope");
  // The strict receipt check requires a complete ownership census. Private
  // protection and restrictions are still read by the normal preview job.
  verifyCorrectionCollection(manifest, receipt, registry, true);
  assertPointsJournalExtension(frozen, current);
  const baseline = createPointsCorrectionBaseline(frozen);
  if (!same(campaign.baseline, baseline) || !same(manifest.baseline, baseline))
    throw new Error("Completed evidence has a different frozen baseline");

  const isSelected = ({ occurredAt }: { occurredAt: string }) =>
    occurredAt < campaign.before &&
    (!octoberOriginalCredit || occurredAt.startsWith("2026-10-"));
  const identity = ({
    id,
    projectId,
    kind,
    sourceId,
    sourceUrl,
    occurredAt,
    workUnitId,
    expectedPredecessors,
  }: PointsImplementationCorrectionManifest["candidates"][number]) => ({
    id,
    projectId,
    kind,
    sourceId,
    sourceUrl,
    occurredAt,
    workUnitId,
    expectedPredecessors,
  });
  const pools = inventoryCorrectionPools(frozen, [project]);
  if (
    pools.length !== manifest.candidates.length ||
    receipt.selectedPools !==
      pools.filter(({ candidate }) => isSelected(candidate)).length ||
    pools.some(
      ({ candidate }, index) =>
        !same(identity(candidate), identity(manifest.candidates[index])),
    ) ||
    manifest.candidates.some(
      (candidate) =>
        candidate.proof.status === "complete" && !isSelected(candidate),
    )
  )
    throw new Error(
      "Completed evidence does not cover the requested pool inventory",
    );
  return receipt.manifestDigest;
}

async function main() {
  const [directory, project, before, october] = process.argv.slice(2);
  if (
    !directory ||
    !project ||
    before === undefined ||
    !["true", "false"].includes(october)
  )
    throw new Error("Invalid completed preview scope");
  const json = (name: string) =>
    readFile(join(directory, name), "utf8").then(JSON.parse);
  const [campaign, frozen, manifest, receipt, current, registry] =
    await Promise.all([
      json("campaign.json"),
      json("baseline-journal.json"),
      json("manifest.json"),
      json("collection-receipt.json"),
      loadPublishedPoints(),
      fetchProjectRegistry(),
    ]);
  if (!current) throw new Error("The canonical Points journal is unavailable");
  console.log(
    verifyReusedImplementationPreview({
      campaign,
      frozen,
      current,
      manifest,
      receipt,
      registry,
      project,
      before,
      octoberOriginalCredit: october === "true",
    }),
  );
}
if (import.meta.main) {
  await main().catch(() => {
    console.error(
      "Completed historical evidence could not be reused for this preview.",
    );
    process.exitCode = 1;
  });
}
