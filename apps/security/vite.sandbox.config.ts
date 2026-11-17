import { workerBuild } from "@repo/platform/vite";
import { defineConfig, mergeConfig } from "vite";

export default defineConfig(
  mergeConfig(workerBuild({ programs: { merge: "src/sandbox/job.vibe" }, outDir: "sandbox/.build" }), {
    environments: { program_merge: { build: { rolldownOptions: { output: { entryFileNames: "merge.mjs" } } } } },
  }),
);
