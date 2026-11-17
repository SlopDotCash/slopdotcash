import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({
    workers: { backup: "src/workers/backup.vibe", recovery: "src/workers/recovery.vibe" },
    programs: { main: "src/programs/main.vibe", local: "src/programs/local.vibe" },
  }),
);
