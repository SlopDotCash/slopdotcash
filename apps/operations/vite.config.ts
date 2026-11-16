import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({ workers: { notify: "src/workers/notify.vibe", backup: "src/workers/backup.vibe" }, programs: { main: "src/programs/main.vibe" } }),
);
