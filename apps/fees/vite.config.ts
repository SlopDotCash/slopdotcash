import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({ workers: { feeConverter: "src/workers/feeConverter.vibe" }, programs: { main: "src/programs/main.vibe" } }),
);
