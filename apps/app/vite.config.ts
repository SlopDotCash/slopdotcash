import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { workerBuild } from "@repo/platform/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vibelang from "vibelang-vite";
import { defineConfig } from "vite";

const workers = workerBuild({ workers: { _worker: "src/worker/pages.vibe", notify: "src/worker/notify.vibe" }, emptyOutDir: false });
const environments = workers.environments ?? {};
const contributorSite = join(import.meta.dirname, ".cache/contributor-site");

export default defineConfig({
  plugins: [vibelang(), react(), tailwindcss()],
  build: { assetsInlineLimit: (file) => (/\.(?:woff2?|ttf|otf)$/u.test(file) ? false : undefined) },
  environments,
  builder: {
    buildApp: async (builder) => {
      if (!existsSync(contributorSite)) throw new Error(`${contributorSite} is missing: pnpm build writes it with the contributor site program before vite build.`);
      const client = builder.environments.client;
      if (client !== undefined) await builder.build(client);
      await cp(contributorSite, join(import.meta.dirname, "dist"), { recursive: true });
      for (const name of Object.keys(environments)) {
        const target = builder.environments[name];
        if (target !== undefined) await builder.build(target);
      }
    },
  },
});
