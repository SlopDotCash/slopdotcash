import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { intake: "test/support/intake/worker.vibe" }, outDir: ".cache/intake" }));
