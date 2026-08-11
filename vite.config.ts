/**
 * Builds the static slop.cash contribution surface for Cloudflare Pages.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  // Cloudflare Pages serves /data/* with Access-Control-Allow-Origin: *
  // (public/_headers) so other program surfaces (e.g. the Eliza Hub landing
  // page) can read the published snapshot. Mirror that in local preview.
  preview: {
    cors: true,
  },
});
