import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

// The payment attester (release service PaymentAttesters, `dist/attester.js`) and the payments Worker have no entry
// yet, so the release refuses the attesters' publication for the missing bundle rather than build one.
export default defineConfig(
  workerBuild({
    workers: {
      referralAccrual: "src/workers/referralAccrual.vibe",
      keeper: "src/workers/keeper.vibe",
    },
    programs: { main: "src/programs/main.vibe" },
  }),
);
