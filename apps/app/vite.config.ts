import { cp } from "node:fs/promises";
import { join } from "node:path";
import { workerBuild } from "@repo/platform/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vibelang from "vibelang-vite";
import { defineConfig } from "vite";

const workers = workerBuild({ workers: { _worker: "src/worker/pages.vibe", notify: "src/worker/notify.vibe" }, emptyOutDir: false });
const environments = workers.environments ?? {};

export default defineConfig({
  plugins: [vibelang(), react(), tailwindcss()],
  environments,
  builder: {
    buildApp: async (builder) => {
      const client = builder.environments.client;
      if (client !== undefined) await builder.build(client);
      await cp(join(import.meta.dirname, ".cache/site"), join(import.meta.dirname, "dist"), { recursive: true });
      for (const name of Object.keys(environments)) {
        const target = builder.environments[name];
        if (target !== undefined) await builder.build(target);
      }
    },
  },
});
