import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { disputes: "test/support/u12/worker.vibe" }, outDir: ".cache/u12" }));
