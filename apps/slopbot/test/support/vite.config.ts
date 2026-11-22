import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({
    workers: {
      ingress: "test/support/ingressWorker.vibe",
      routing: "test/support/routingWorker.vibe",
      spend: "test/support/spendWorker.vibe",
      access: "test/support/accessWorker.vibe",
      review: "test/support/reviewWorker.vibe",
      closure: "test/support/closureWorker.vibe",
      close: "test/support/closeWorker.vibe",
      appeals: "test/support/appealsWorker.vibe",
      disputes: "test/support/disputesWorker.vibe",
      history: "test/support/historyWorker.vibe",
      ready: "test/support/ready.vibe",
    },
    outDir: ".cache/journeys",
  }),
);
