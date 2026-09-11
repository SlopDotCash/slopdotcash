import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertFundingPreparation } from "../src/lib/funding-review-data";
import { prepareSourceCorrection } from "./source-correction";

const [
  preparationPath,
  snapshotPath,
  auditPath,
  archivePath,
  historyPath,
  qualityPath,
  requestPath,
  outputPath,
  ...proposalPaths
] = process.argv.slice(2);
if (!outputPath)
  throw new Error(
    "Usage: prepare-source-correction.ts PREPARATION SNAPSHOT AUDIT ARCHIVE HISTORY QUALITY REQUEST OUTPUT [QUALITY_PROPOSAL ...]",
  );
const preparationBytes = await readFile(preparationPath, "utf8");
const { projectId, cycleId } = assertFundingPreparation(
  JSON.parse(preparationBytes),
);
try {
  await access(join(process.cwd(), "cycles", projectId, cycleId));
  throw new Error(
    "A published cycle requires a separately reviewed revision contract",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const [
  snapshotBytes,
  auditBytes,
  archiveBytes,
  historyBytes,
  qualityBytes,
  requestBytes,
  ...proposals
] = await Promise.all(
  [
    snapshotPath,
    auditPath,
    archivePath,
    historyPath,
    qualityPath,
    requestPath,
    ...proposalPaths,
  ].map((path) => readFile(path, "utf8")),
);
const result = await prepareSourceCorrection({
  preparationBytes,
  snapshotBytes,
  auditBytes,
  archiveBytes,
  historyBytes,
  qualityBytes,
  request: JSON.parse(requestBytes),
  proposals: proposals.map((value) => JSON.parse(value)),
});
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    events: result.proposedEvents,
    contributors: result.rows.length,
    qualityPreviews: result.qualityPreviews.length,
    paymentAuthorized: false,
    activePreparationChanged: false,
  }),
);
