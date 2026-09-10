import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  assertQualityEvidence,
  verifyQualityEventIds,
} from "../src/lib/contribution-quality";
import { assertFundingPreparation } from "../src/lib/funding-review-data";

const root = process.cwd();
const output = join(root, "public/data/contribution-quality");
const validateOnly = process.argv[2] === "--validate";
if (
  process.argv.slice(2).length &&
  !(process.argv.length === 3 && validateOnly)
)
  throw new Error("Usage: sync-contribution-quality.ts [--validate]");
const files = new Map<string, string>();
const entries: {
  projectId: string;
  cycleId: string;
  sourceSnapshotSha256: string;
  path: string;
}[] = [];
for (const name of (await readdir(join(root, "funding/quality"))).sort()) {
  if (!/^[a-z0-9-]+\.json$/.test(name))
    throw new Error("Unexpected quality input");
  const stat = await lstat(join(root, "funding/quality", name));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error("Invalid quality source file");
  const preparation = assertFundingPreparation(
    JSON.parse(
      await readFile(join(root, "funding/preparations", name), "utf8"),
    ),
  );
  const evidence = assertQualityEvidence(
    JSON.parse(await readFile(join(root, "funding/quality", name), "utf8")),
    preparation,
  );
  await verifyQualityEventIds(evidence, preparation);
  files.set(name, `${JSON.stringify(evidence)}\n`);
  entries.push({
    projectId: preparation.projectId,
    cycleId: preparation.cycleId,
    sourceSnapshotSha256: preparation.sourceSnapshotSha256,
    path: `/data/contribution-quality/${name}`,
  });
}
if (!validateOnly) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [name, bytes] of files) await writeFile(join(output, name), bytes);
  await writeFile(join(output, "index.json"), `${JSON.stringify(entries)}\n`);
}
console.log(
  `Validated ${entries.length} source-bound quality review datasets.`,
);
