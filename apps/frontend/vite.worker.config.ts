import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({ workers: { _worker: "src/worker/pages.vibe" }, emptyOutDir: false }),
);
