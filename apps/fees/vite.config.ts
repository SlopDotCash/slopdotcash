import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

export default defineConfig(workerBuild({ programs: { main: "src/programs/main.vibe" } }));
