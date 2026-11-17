import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { evidence: "test/support/evidence/worker.vibe" }, outDir: ".cache/evidence" }));
