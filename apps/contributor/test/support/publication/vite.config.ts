import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { publication: "test/support/publication/worker.vibe" }, outDir: ".cache/publication" }));
