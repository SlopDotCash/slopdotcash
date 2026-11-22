import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({
    workers: {
      slopbot: "src/workers/slopbot.vibe",
      repositoryAccess: "src/workers/repositoryAccess.vibe",
    },
    programs: { main: "src/programs/main.vibe" },
  }),
);
