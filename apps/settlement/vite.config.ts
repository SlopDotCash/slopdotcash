import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({
    workers: {
      attester: "src/workers/attester.vibe",
      payments: "src/workers/payments.vibe",
      referralAccrual: "src/workers/referralAccrual.vibe",
      keeper: "src/workers/keeper.vibe",
    },
    programs: { main: "src/programs/main.vibe" },
  }),
);
