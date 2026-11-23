import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(
  workerBuild({
    workers: { submissionFee: "src/workers/submissionFee.vibe" },
    programs: { main: "src/programs/main.vibe" },
  }),
);
