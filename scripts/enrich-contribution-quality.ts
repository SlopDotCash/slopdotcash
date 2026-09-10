/** Optional local, head-pinned diff inspection. Never emit raw patches. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { QualityEvidence } from "../src/lib/contribution-quality";
import {
  contributionDiffSignals,
  type DiffFile,
} from "./contribution-diff-signals";

const [qualityPath, censusPath, detailsPath, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: enrich-contribution-quality.ts QUALITY CENSUS DETAILS_DIRECTORY OUTPUT",
  );
const evidence: QualityEvidence = JSON.parse(
  await readFile(qualityPath, "utf8"),
);
const census: { nodes: { id: string; headRefOid: string }[] } = JSON.parse(
  await readFile(censusPath, "utf8"),
);
const heads = new Map(census.nodes.map((row) => [row.id, row.headRefOid]));
const patches = new Map<string, string[]>();
let complete = 0;
for (const name of (await readdir(detailsPath))
  .filter((name) => /^pr-\d+\.json$/.test(name))
  .sort()) {
  const detail: {
    pr: {
      node_id: string;
      head: { sha: string };
      changed_files: number;
      additions: number;
      deletions: number;
    };
    files: DiffFile[];
  } = JSON.parse(await readFile(join(detailsPath, name), "utf8"));
  const event = evidence.events.find(
    (event) => event.id === `${detail.pr.node_id}:merged`,
  );
  if (!event) continue;
  if (heads.get(detail.pr.node_id) !== detail.pr.head.sha) {
    event.flags.push("diff head mismatch: inspection unavailable");
    continue;
  }
  const signal = contributionDiffSignals(
    detail.files,
    detail.pr.changed_files,
    detail.pr.additions,
    detail.pr.deletions,
  );
  if (!signal.complete) {
    event.flags.push("incomplete diff: no content classification");
    continue;
  }
  complete++;
  if (signal.testsOnly)
    event.flags.push("test-only change: verify regression value and overlap");
  if (signal.blankLinesOnly)
    event.flags.push("blank-line-only diff: review micro outcome or grouping");
  if (signal.patchSha256)
    patches.set(signal.patchSha256, [
      ...(patches.get(signal.patchSha256) ?? []),
      event.id,
    ]);
}
let duplicateGroups = 0;
for (const [digest, group] of patches)
  if (group.length > 1) {
    duplicateGroups++;
    for (const id of group)
      evidence.events
        .find((event) => event.id === id)
        ?.flags.push(
          `matching patch group ${digest.slice(0, 12)}: inspect shared outcome`,
        );
  }
await writeFile(output, `${JSON.stringify(evidence)}\n`, { flag: "wx" });
console.log(
  JSON.stringify({
    completeDiffs: complete,
    matchingPatchGroups: duplicateGroups,
    paymentChangesApplied: false,
  }),
);
