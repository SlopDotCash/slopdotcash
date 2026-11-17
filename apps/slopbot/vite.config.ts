import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({
    workers: {
      slopbot: "src/workers/slopbot.vibe",
      ingress: "test/support/ingressWorker.vibe",
      routing: "test/support/routingWorker.vibe",
      spend: "test/support/spendWorker.vibe",
      access: "test/support/accessWorker.vibe",
    },
  }),
);
