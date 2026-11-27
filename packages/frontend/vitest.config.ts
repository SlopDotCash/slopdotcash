import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { project } from "vibestack/testing/vitest";
import type { ViteUserConfig } from "vitest/config";
import type { BrowserCommand, TestProject, Vitest } from "vitest/node";
import type { Op, Result } from "./test/support/ui/protocol.ts";
import type * as SiteModule from "./test/support/ui/site.ts";

const harness = (on: TestProject) => on.import<typeof SiteModule>(join(import.meta.dirname, "test/support/ui/site.ts"));
const site: BrowserCommand<[Op], Result<Op>> = async (context, op) => (await harness(context.project)).command(context, op);
const siteCommands = {
  name: "slop:site-commands",
  config: (): ViteUserConfig => ({
    resolve: { dedupe: ["react", "react-dom"] },
    optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime", "lucide-react"] },
    test: { testTimeout: 120_000, browser: { commands: { site } } },
  }),
  configureVitest: async ({ project: on, vitest }: { readonly project: TestProject; readonly vitest: Vitest }) => {
    if (!on.config.browser.enabled) return;
    const loaded = await harness(on);
    vitest.onClose(loaded.close);
    await loaded.prepare();
  },
};

export default project({ root: import.meta.dirname, plugins: [siteCommands, react(), tailwindcss()] });
