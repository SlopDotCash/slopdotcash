import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { admission: "test/support/admission/worker.vibe" }, outDir: ".cache/admission" }));
