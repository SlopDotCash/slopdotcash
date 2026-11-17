import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({ workers: { sandbox: "src/workers/sandbox.vibe" }, programs: { main: "src/programs/main.vibe" }, nodeCompat: ["sandbox"] }),
);
