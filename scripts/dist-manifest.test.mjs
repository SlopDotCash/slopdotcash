/**
 * Exercises deterministic bundle inventory and bounded byte verification with
 * local files and an in-memory HTTP boundary; production networking is covered
 * by the deployment workflow after Cloudflare reports the exact release SHA.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDistManifest,
  MANIFEST_FILENAME,
  verifyLocalBundle,
  verifyPublishedBundle,
} from "./dist-manifest.mjs";

const temporaryDirectories = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gitarmy-dist-manifest-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"));
  await mkdir(join(root, ".well-known", "agent-skills"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><title>slop.cash</title>\n",
  );
  await writeFile(
    join(root, "404.html"),
    "<!doctype html><title>Not found</title>\n",
  );
  await writeFile(
    join(root, "skill-manifest.json"),
    '{"name":"contribute-to-eliza"}\n',
  );
  await writeFile(
    join(root, "assets", "index-test.js"),
    "export const ready = true;\n",
  );
  await writeFile(
    join(root, ".well-known", "agent-skills", "index.json"),
    '{"skills":["slop"]}\n',
  );
  await writeFile(
    join(root, "_headers"),
    "/*\n  X-Content-Type-Options: nosniff\n",
  );
  await writeFile(join(root, "_redirects"), "/* /index.html 200\n");
  await writeFile(
    join(root, "_routes.json"),
    '{"version":1,"include":["/"],"exclude":[]}\n',
  );
  return root;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Cloudflare Pages deployment manifest", () => {
  it("creates a deterministic inventory while excluding Pages control files", async () => {
    const root = await fixture();
    const manifest = await createDistManifest(root);
    const manifestBytes = await readFile(join(root, MANIFEST_FILENAME));

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files.map((record) => record.path)).toEqual([
      ".well-known/agent-skills/index.json",
      "404.html",
      "assets/index-test.js",
      "index.html",
      "skill-manifest.json",
    ]);
    expect(manifest.files.map((record) => record.path)).not.toContain(
      "_headers",
    );
    expect(manifest.files.map((record) => record.path)).not.toContain(
      "_redirects",
    );
    expect(manifest.files.map((record) => record.path)).not.toContain(
      "_routes.json",
    );
    expect(manifest.files.map((record) => record.path)).not.toContain(
      MANIFEST_FILENAME,
    );
    expect(manifestBytes.toString("utf8")).toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    expect(manifest.files[0].sha256).toBe(
      sha256(await readFile(join(root, manifest.files[0].path))),
    );
  });

  it("rejects symbolic links instead of publishing files outside the bundle", async () => {
    const root = await fixture();
    await symlink(join(root, "index.html"), join(root, "linked.html"));

    await expect(createDistManifest(root)).rejects.toThrow(/symbolic links/u);
  });

  it("verifies the manifest and every inventoried file with cache-busting requests", async () => {
    const root = await fixture();
    const manifest = await createDistManifest(root);
    const requested = [];
    const fetchImpl = async (url, init) => {
      const parsed = new URL(url);
      const publicPath = decodeURIComponent(parsed.pathname);
      const bundlePath =
        publicPath === "/"
          ? "index.html"
          : publicPath === "/404"
            ? "404.html"
            : publicPath.slice(1);
      requested.push({
        init,
        path: publicPath,
        token: parsed.searchParams.get("verify"),
      });
      return new Response(await readFile(join(root, bundlePath)), {
        status: 200,
      });
    };

    await expect(
      verifyPublishedBundle(root, "https://slop.cash", "release-1", {
        concurrency: 2,
        fetchImpl,
        retries: 1,
        retryDelayMs: 0,
      }),
    ).resolves.toBe(manifest.files.length);
    expect(requested[0].path).toBe(`/${MANIFEST_FILENAME}`);
    expect(requested.map((request) => request.path).sort()).toEqual(
      [
        `/${MANIFEST_FILENAME}`,
        ...manifest.files.map((record) =>
          record.path === "index.html"
            ? "/"
            : record.path.endsWith(".html")
              ? `/${record.path.slice(0, -".html".length)}`
              : `/${record.path}`,
        ),
      ].sort(),
    );
    expect(requested.map((request) => request.path)).not.toContain(
      "/index.html",
    );
    expect(requested.map((request) => request.path)).toContain("/404");
    expect(requested.map((request) => request.path)).not.toContain("/404.html");
    expect(requested.every((request) => request.token === "release-1-1")).toBe(
      true,
    );
    expect(
      requested.every(
        (request) =>
          request.init.redirect === "manual" &&
          request.init.cache === "no-store" &&
          request.init.headers["Cache-Control"] === "no-cache",
      ),
    ).toBe(true);
  });

  it("fails closed when any published asset differs from the verified bundle", async () => {
    const root = await fixture();
    await createDistManifest(root);
    const fetchImpl = async (url) => {
      const publicPath = decodeURIComponent(new URL(url).pathname.slice(1));
      const path = publicPath === "404" ? "404.html" : publicPath;
      const contents =
        path === "assets/index-test.js"
          ? Buffer.from("tampered")
          : await readFile(join(root, path));
      return new Response(contents, { status: 200 });
    };

    await expect(
      verifyPublishedBundle(root, "https://slop.cash", "release-2", {
        concurrency: 2,
        fetchImpl,
        retries: 1,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow(/published assets\/index-test\.js did not match/u);
  });

  it("rejects stale manifests when the local bundle changes", async () => {
    const root = await fixture();
    await createDistManifest(root);
    await writeFile(join(root, "index.html"), "changed after verification\n");

    await expect(
      verifyPublishedBundle(root, "https://slop.cash", "release-3", {
        fetchImpl: async () => new Response("unused", { status: 200 }),
        retries: 1,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow(/does not match the local Pages bundle/u);
  });

  it("fails local artifact verification when a hidden endpoint is omitted", async () => {
    const root = await fixture();
    const manifest = await createDistManifest(root);

    await expect(verifyLocalBundle(root)).resolves.toBe(manifest.files.length);
    await rm(join(root, ".well-known", "agent-skills", "index.json"));
    await expect(verifyLocalBundle(root)).rejects.toThrow(
      /does not match the local Pages bundle/u,
    );
  });

  it("rejects verification settings that exceed the production time bound", async () => {
    const root = await fixture();
    await createDistManifest(root);

    await expect(
      verifyPublishedBundle(root, "https://slop.cash", "release-4", {
        totalTimeoutMs: 300_001,
      }),
    ).rejects.toThrow(/options exceed their bounds/u);
  });

  it("rejects non-canonical response lengths", async () => {
    const root = await fixture();
    await createDistManifest(root);
    const body = new Response("unused").body;
    let caught;
    try {
      await verifyPublishedBundle(root, "https://slop.cash", "release-5", {
        fetchImpl: async () => ({
          body,
          headers: {
            get: (name) =>
              name.toLowerCase() === "content-length" ? "1e3" : null,
          },
          status: 200,
        }),
        retries: 1,
        retryDelayMs: 0,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.cause).toHaveProperty(
      "message",
      "published file declared an invalid Content-Length",
    );
    expect(body.locked).toBe(false);
  });

  it("releases the response reader after rejecting oversized bytes", async () => {
    const root = await fixture();
    const manifest = await createDistManifest(root);
    const canonicalManifest = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const response = new Response(
      Buffer.concat([canonicalManifest, Buffer.from("x")]),
    );

    await expect(
      verifyPublishedBundle(root, "https://slop.cash", "release-6", {
        fetchImpl: async () => response,
        retries: 1,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow(/did not match/u);
    expect(response.body.locked).toBe(false);
  });
});
