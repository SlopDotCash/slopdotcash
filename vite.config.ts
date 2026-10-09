/**
 * Builds the static slop.cash contribution surface for Cloudflare Pages.
 */

import { readFileSync, writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "staging-security-headers",
      closeBundle() {
        if (process.env.VITE_SLOP_ENVIRONMENT !== "staging") return;
        const path = "dist/_headers";
        writeFileSync(
          path,
          readFileSync(path, "utf8")
            .replaceAll("https://api.slop.cash", "https://staging.slop.cash")
            .replaceAll(
              "https://identity.slop.cash",
              "https://identity-staging.slop.cash",
            )
            .replace("/*\n", "/*\n  X-Robots-Tag: noindex, nofollow\n"),
        );
      },
    },
  ],
  build: {
    target: "es2022",
    // The production CSP sets font-src 'self', which blocks data: URIs, so
    // self-hosted font subsets must ship as files rather than inlined assets.
    assetsInlineLimit: (filePath) =>
      /\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined,
  },
  // Cloudflare Pages serves /data/* with Access-Control-Allow-Origin: *
  // (public/_headers) so other program surfaces (e.g. the Eliza Hub landing
  // page) can read the published snapshot. Mirror that in local preview.
  preview: {
    cors: true,
  },
});
