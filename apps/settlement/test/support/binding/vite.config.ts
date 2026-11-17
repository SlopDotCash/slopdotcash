import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { binding: "test/support/binding/worker.vibe" }, outDir: ".cache/binding" }));
