import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { journal: "test/support/u11/worker.vibe" }, outDir: ".cache/u11" }));
