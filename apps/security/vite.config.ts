import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({ workers: { sandbox: "src/workers/sandbox.vibe", vettingFlags: "src/workers/vettingFlags.vibe", recovery: "src/workers/recovery.vibe" }, programs: { main: "src/programs/main.vibe" }, nodeCompat: ["sandbox"] }),
);
