import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ workers: { worker: "src/worker.vibe", identity: "src/workers/identity.vibe" } }));
