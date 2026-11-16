import { defineConfig } from "vite";
import { workerBuild } from "./src/vite.ts";

export default defineConfig(workerBuild("test/worker/main.vibe"));
