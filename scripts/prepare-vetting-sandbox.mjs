/** Build the one canonical fixed Git operation into the container context. */
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = await Bun.build({
  entrypoints: [`${root}workers/vetting-sandbox/merge-job.ts`],
  target: "node",
  outdir: `${root}workers/vetting-sandbox/.build`,
  naming: "merge.mjs",
});
if (!result.success) throw new Error("Fixed merge collector build failed");
