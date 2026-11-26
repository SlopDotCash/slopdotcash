import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { points: "test/support/u17/worker.vibe" }, outDir: ".cache/u17" }));
