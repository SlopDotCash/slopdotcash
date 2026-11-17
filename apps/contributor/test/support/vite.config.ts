import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { contributor: "test/support/worker.vibe" }, outDir: ".cache/contributor" }));
