import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cachedPublicResponse,
  type EdgeCache,
} from "../backend/projects/edge-cache";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { fixtureCheckout } from "../tests/fixture-checkout";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { childEnvironment } from "./child-environment.mjs";
import {
  renderProjectRegistry,
  renderProjectRevisions,
} from "./sync-project-registry.mjs";

for (const outcome of [
  "updated",
  "inconsistent",
  "invalid-digest",
  "unavailable",
] as const) {
  test(`registry sync handles independently cached reads: ${outcome}`, async () => {
    const root = fixtureCheckout("registry-read-race-");
    const oldProjects = assertProjectRegistry([
      { ...fixtureProject("eliza"), status: "paused" },
    ]);
    const newProjects = assertProjectRegistry([
      {
        ...oldProjects[0],
        description: "Updated reproducible research tools.",
      },
    ]);
    const revisions = [oldProjects[0], newProjects[0]].map(
      (manifest, index) => ({
        projectId: manifest.id,
        revision: index + 1,
        manifest,
        manifestSha256: createHash("sha256")
          .update(JSON.stringify(manifest))
          .digest("hex"),
        reason: "Update project description",
        createdAt: `2026-10-30T06:00:0${index}.000Z`,
      }),
    );
    const registryPath = join(root, "src/lib/project-registry.generated.mjs");
    const historyPath = join(root, "src/lib/project-revisions.generated.json");
    const previousRegistry = await renderProjectRegistry(oldProjects);
    const previousHistory = renderProjectRevisions(
      revisions.slice(0, 1),
      oldProjects,
    );
    writeFileSync(registryPath, previousRegistry);
    writeFileSync(historyPath, previousHistory);
    const seen: URL[] = [];
    const entries = new Map<string, Response>();
    const cache: EdgeCache = {
      match: async (request) => entries.get(request.url)?.clone(),
      put: async (request, response) => {
        entries.set(request.url, response.clone());
      },
      delete: async (request) => entries.delete(request.url),
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        seen.push(url);
        if (outcome === "unavailable" && url.search)
          return new Response("Not Found", { status: 404 });
        return cachedPublicResponse(cache, request, async () => {
          if (url.pathname === "/api/v1/projects")
            return Response.json({ schemaVersion: "1", projects: newProjects });
          return Response.json({
            schemaVersion: "1",
            revisions:
              outcome === "invalid-digest"
                ? revisions.map((row) => ({
                    ...row,
                    manifestSha256: "0".repeat(64),
                  }))
                : revisions,
          });
        });
      },
    });
    // Another colo can retain the old project list after a revision is
    // published. History has a different key and already serves revision 2.
    entries.set(
      `${server.url.origin}/__slop-cache/projects-v1/api/v1/projects`,
      Response.json({ schemaVersion: "1", projects: oldProjects }),
    );
    if (outcome === "inconsistent") {
      cache.match = async (request) =>
        new URL(request.url).pathname.endsWith("/projects")
          ? Response.json({ schemaVersion: "1", projects: oldProjects })
          : undefined;
    }
    try {
      const child = Bun.spawn(
        [process.execPath, "scripts/sync-project-registry.mjs"],
        {
          cwd: root,
          env: childEnvironment(process.env, {
            SLOP_API_ORIGIN: server.url.origin,
          }),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (outcome === "updated") {
        expect(code, stderr).toBe(0);
        expect(stdout).toContain("synchronized project registry from D1");
        expect(readFileSync(historyPath, "utf8")).toBe(
          renderProjectRevisions(revisions, newProjects),
        );
        expect(readFileSync(registryPath, "utf8")).toContain(
          newProjects[0].description,
        );
        expect(seen).toHaveLength(4);
        const retry = seen.slice(2);
        expect(retry[0].searchParams.get("snapshot")).toBeTruthy();
        expect(retry[0].search).toBe(retry[1].search);
      } else {
        expect(code).toBe(1);
        expect(stderr).toContain(
          outcome === "inconsistent"
            ? "newest revision"
            : outcome === "unavailable"
              ? "disappeared"
              : "digest",
        );
        expect(readFileSync(registryPath, "utf8")).toBe(previousRegistry);
        expect(readFileSync(historyPath, "utf8")).toBe(previousHistory);
        expect(seen).toHaveLength(
          outcome === "inconsistent" ? 6 : outcome === "unavailable" ? 4 : 2,
        );
      }
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
}
