import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { traces: "test/support/traces/worker.vibe" }, outDir: ".cache/traces" }));
