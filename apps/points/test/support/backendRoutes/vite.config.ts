import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { backendRoutes: "test/support/backendRoutes/worker.vibe" }, outDir: ".cache/backendRoutes" }));
