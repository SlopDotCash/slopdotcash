import { defineConfig } from "vite";
import { workerBuild } from "./src/vite.ts";

export default defineConfig(workerBuild({
  workers: {
    main: "test/worker/main.vibe",
    storage: "test/worker/storage.vibe",
    github: "test/worker/github.vibe",
    http: "test/worker/http.vibe",
  },
}));
