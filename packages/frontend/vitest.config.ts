import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { project } from "vibestack/testing/vitest";
import { siteCommands } from "./test/support/ui/site.ts";

export default project({ root: import.meta.dirname, plugins: [siteCommands(), react(), tailwindcss()] });
