/**
 * Builds the static slop.cash contribution surface for Cloudflare Pages.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const publicDirectory = `${fileURLToPath(new URL("./public", import.meta.url))}${sep}`;
// Local UI development reads the registry and the published snapshots from one
// public origin, so the snapshots validate against the registry they cite.
const localReadOrigin = "https://slop.cash";

export default defineConfig(({ command, isPreview }) => {
  // Local development owns its sign-in backend. Built artifacts never enable it.
  const automaticBackend =
    command === "serve" &&
    !isPreview &&
    process.env.SLOP_DEV_BACKEND === undefined;
  const localBackend =
    process.env.SLOP_DEV_BACKEND === "off"
      ? undefined
      : (process.env.SLOP_DEV_BACKEND ??
        (automaticBackend ? "http://127.0.0.1:4477" : undefined));
  if (
    localBackend !== undefined &&
    !["localhost", "127.0.0.1"].includes(new URL(localBackend).hostname)
  )
    throw new Error("SLOP_DEV_BACKEND must be a localhost address");
  const localBackendProxy: Record<string, ProxyOptions> = localBackend
    ? {
        "^/(?:api/|v1/oauth/|__dev/)": {
          target: localBackend,
          changeOrigin: false,
        },
      }
    : {};

  return {
    plugins: [
      react(),
      {
        name: "local-sign-in",
        apply: "serve",
        configureServer(server) {
          if (!automaticBackend || !localBackend) return;
          let child: ChildProcess | undefined;
          const stop = () => child?.kill("SIGTERM");
          server.httpServer?.once("close", stop);
          server.httpServer?.once("listening", () => {
            const address = server.httpServer?.address();
            if (!address || typeof address === "string") return;
            const host =
              server.config.server.host === "127.0.0.1"
                ? "127.0.0.1"
                : "localhost";
            const origin =
              process.env.SLOP_DEV_ORIGIN ?? `http://${host}:${address.port}`;
            void (async () => {
              try {
                const response = await fetch(`${localBackend}/__dev/health`, {
                  headers: { host: new URL(origin).host },
                  signal: AbortSignal.timeout(1000),
                });
                if (response.ok && (await response.json()).origin === origin)
                  return;
                server.config.logger.error(
                  `Local sign-in backend is already in use. Set SLOP_DEV_BACKEND to its address or stop it before restarting.`,
                );
                return;
              } catch {
                child = spawn("bun", ["scripts/dev-backend.ts"], {
                  cwd: server.config.root,
                  env: {
                    ...process.env,
                    SLOP_DEV_ORIGIN: origin,
                    SLOP_DEV_BACKEND_PORT: new URL(localBackend).port,
                  },
                  stdio: "inherit",
                });
                child.once("error", (error) =>
                  server.config.logger.error(
                    `Local sign-in could not start: ${error.message}`,
                  ),
                );
              }
            })();
          });
        },
      },
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
              new URL(
                "./src/lib/project-registry.runtime.mjs",
                import.meta.url,
              ),
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
        "^/(?:api/v1/projects|api/v1/payments/[^?]+/direct-transfers|\\.well-known/slop/projects\\.json|data/project-registry\\.json)(?:\\?.*)?$":
          {
            target: localReadOrigin,
            changeOrigin: true,
            rewrite: (path) =>
              path.replace(
                /^\/data\/project-registry\.json/,
                "/api/v1/projects",
              ),
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
  };
});
