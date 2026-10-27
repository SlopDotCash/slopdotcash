/**
 * Builds the static slop.cash contribution surface for Cloudflare Pages.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const publicDirectory = `${fileURLToPath(new URL("./public", import.meta.url))}${sep}`;
// Local UI development reads the registry and the published snapshots from one
// public origin, so the snapshots validate against the registry they cite.
const localReadOrigin = "https://slop.cash";

// Local sign-in: `bun run dev:local` points the dev server at a backend that
// `bun run dev:backend` runs on this machine (the identity Worker and the API on
// a local database). Sign-in and API calls, with their cookies, go only there.
const localBackend = process.env.SLOP_DEV_BACKEND;
if (
  localBackend !== undefined &&
  !["localhost", "127.0.0.1"].includes(new URL(localBackend).hostname)
)
  throw new Error("SLOP_DEV_BACKEND must be a localhost address");
const localBackendProxy: Record<string, ProxyOptions> = localBackend
  ? {
      "^/(?:api/|v1/oauth/)": { target: localBackend, changeOrigin: false },
    }
  : {};

export default defineConfig({
  plugins: [
    react(),
    {
      // The browser lists projects from the D1 registry at runtime. Only
      // projects.mjs swaps the committed snapshot for the runtime registry;
      // ingestion validation keeps the snapshot the ledger was built from.
      name: "runtime-project-registry",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          source === "./project-registry.generated.mjs" &&
          importer?.replaceAll("\\", "/").endsWith("/src/lib/projects.mjs")
        )
          return fileURLToPath(
            new URL("./src/lib/project-registry.runtime.mjs", import.meta.url),
          );
        return null;
      },
    },
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
  define: localBackend
    ? { "import.meta.env.VITE_SLOP_LOCAL_BACKEND": JSON.stringify("1") }
    : {},
  // Local UI development reads the public registry, independently of build
  // outputs, and the public direct-transfer totals behind "Money received".
  // The legacy file URL is also supported for existing sessions.
  server: {
    proxy: {
      "^/(?:api/v1/projects|api/v1/payments/[^?]+/direct-transfers|data/project-registry\\.json)(?:\\?.*)?$":
        {
          target: localReadOrigin,
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/data\/project-registry\.json/, "/api/v1/projects"),
          bypass: (request) =>
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : false,
          configure: (proxy) => {
            proxy.on("proxyReq", (request) => {
              request.removeHeader("cookie");
              request.removeHeader("authorization");
            });
          },
        },
      // Published snapshots (leaderboard, points, cycles, profiles) are build
      // outputs. A local file from the generators wins; otherwise read the
      // published copy so the leaderboard loads without a live ingestion run.
      "^/data/(?:leaderboard\\.json|points\\.json|points/|cycles/|profiles\\.json)":
        {
          target: localReadOrigin,
          changeOrigin: true,
          bypass: (request) => {
            if (request.method !== "GET" && request.method !== "HEAD")
              return false;
            const path = decodeURIComponent(
              new URL(request.url ?? "/", "http://local").pathname,
            );
            const file = resolve(publicDirectory, `.${path}`);
            return file.startsWith(publicDirectory) && existsSync(file)
              ? request.url
              : undefined;
          },
          configure: (proxy) => {
            proxy.on("proxyReq", (request) => {
              request.removeHeader("cookie");
              request.removeHeader("authorization");
            });
          },
        },
      ...localBackendProxy,
    },
  },
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
  // Preview serves only the built bytes. Vite otherwise inherits the
  // development proxy, which replaces the published last good registry
  // (PRD section 9) with a live staging read.
  preview: {
    cors: true,
    proxy: {},
  },
});
