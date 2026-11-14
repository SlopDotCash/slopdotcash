import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { onRequest } from "../functions/index.ts";
import { createDistManifest, verifyPublishedBundle } from "./dist-manifest.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const html =
  "<!doctype html><html><body><main>é Release</main></body></html>\n";
const tag =
  '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token":"230b277fc6fe4a279c8b06cf7e569719","spa":true}\'></script>';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "slop-analytics-bytes-"));
  directories.push(root);
  await writeFile(join(root, "index.html"), html);
  await writeFile(join(root, "skill-manifest.json"), "{}\n");
  await writeFile(join(root, "asset.js"), "export const exact = true;\n");
  const manifest = await createDistManifest(root);
  return { root, manifest };
}

async function servedHtml(hostname, contents = html, method = "GET") {
  return onRequest({
    request: new Request(`https://${hostname}/`, { method }),
    next: async () =>
      new Response(contents, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(Buffer.byteLength(contents)),
        },
      }),
  });
}

function remote(root, hostname, change = (contents) => contents) {
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === "/") {
      return new Response(change(await (await servedHtml(hostname)).text()));
    }
    return new Response(await readFile(join(root, path.slice(1))));
  };
}

function verify(root, origin, fetchImpl) {
  return verifyPublishedBundle(root, origin, "analytics-regression", {
    fetchImpl,
    retries: 1,
    concurrency: 1,
  });
}

test("production verification accepts exactly the Function-rendered root while retaining the raw manifest", async () => {
  const { root, manifest } = await fixture();
  expect(await (await servedHtml("slop.cash")).text()).toBe(
    html.replace("</body>", `${tag}</body>`),
  );
  await expect(
    verify(root, "https://slop.cash", remote(root, "slop.cash")),
  ).resolves.toBe(manifest.files.length);
  expect(await readFile(join(root, "index.html"), "utf8")).toBe(html);
  expect(
    JSON.parse(await readFile(join(root, "deployment-manifest.json"), "utf8")),
  ).toEqual(manifest);
});

test("wrong, missing and additional production scripts are refused byte-for-byte", async () => {
  const { root } = await fixture();
  for (const change of [
    (contents) =>
      contents.replace(
        "230b277fc6fe4a279c8b06cf7e569719",
        "00000000000000000000000000000000",
      ),
    (contents) => contents.replace(tag, ""),
    (contents) =>
      contents.replace(
        "</body>",
        '<script src="https://extra.invalid/run.js"></script></body>',
      ),
  ]) {
    await expect(
      verify(root, "https://slop.cash", remote(root, "slop.cash", change)),
    ).rejects.toThrow("published index.html did not match");
  }
});

test("staging stays byte-identical and cannot acquire an analytics exception", async () => {
  const { root, manifest } = await fixture();
  expect(await (await servedHtml("staging.slop.cash")).text()).toBe(html);
  await expect(
    verify(
      root,
      "https://staging.slop.cash",
      remote(root, "staging.slop.cash"),
    ),
  ).resolves.toBe(manifest.files.length);
  await expect(
    verify(root, "https://staging.slop.cash", remote(root, "slop.cash")),
  ).rejects.toThrow("published index.html did not match");
});

test("other published assets and the local raw index still require their exact manifest bytes", async () => {
  const { root } = await fixture();
  const fetchImpl = remote(root, "slop.cash");
  await expect(
    verify(root, "https://slop.cash", async (url) =>
      new URL(url).pathname === "/asset.js"
        ? new Response("modified")
        : fetchImpl(url),
    ),
  ).rejects.toThrow("published asset.js did not match");
  await writeFile(join(root, "index.html"), html.replace("Release", "Changed"));
  await expect(verify(root, "https://slop.cash", fetchImpl)).rejects.toThrow(
    "does not match the local Pages bundle",
  );
});

test("the Function keeps apex normalization, existing tags and non-GET bodies unchanged", async () => {
  expect(await (await servedHtml("SLOP.CASH.")).text()).toBe(
    html.replace("</body>", `${tag}</body>`),
  );
  const tagged = html.replace("</body>", `${tag}</body>`);
  expect(await (await servedHtml("slop.cash", tagged)).text()).toBe(tagged);
  expect(await (await servedHtml("www.slop.cash")).text()).toBe(html);
  expect(await (await servedHtml("slop.cash", html, "POST")).text()).toBe(html);
  await expect(servedHtml("slop.cash", "<html></html>")).rejects.toThrow(
    "Expected 1 social metadata occurrences",
  );
});

test("the published policy allows the script and report hosts of the Function-added tag and no other analytics host", async () => {
  const policy = (
    await readFile(new URL("../public/_headers", import.meta.url), "utf8")
  )
    .split(/\r?\n\r?\n/u)[0]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Content-Security-Policy:"));
  const sources = Object.fromEntries(
    policy
      .slice(policy.indexOf(":") + 1)
      .split(";")
      .map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/u);
        return [name, values];
      }),
  );
  const scriptOrigin = new URL(tag.match(/ src="([^"]+)"/u)[1]).origin;
  expect(sources["script-src"]).toEqual(["'self'", scriptOrigin]);
  // Cloudflare documents that a manually embedded tag, which is what the
  // Function adds, reports to this host and not to the site's own origin.
  // Without it the browser blocks every report from a Function-served page.
  expect(sources["connect-src"]).toContain("https://cloudflareinsights.com");
  expect(
    Object.entries(sources).flatMap(([name, values]) =>
      values
        .filter((value) => value.includes("cloudflareinsights"))
        .map((value) => `${name} ${value}`),
    ),
  ).toEqual([
    `script-src ${scriptOrigin}`,
    "connect-src https://cloudflareinsights.com",
  ]);
});

test("the workflow CLI emits the same exact rendered bytes and refuses an unbound local index", async () => {
  const { root } = await fixture();
  const render = (origin) =>
    spawnSync("node", [
      fileURLToPath(new URL("./dist-manifest.mjs", import.meta.url)),
      "render-root",
      root,
      origin,
    ]);
  for (const hostname of [
    "slop.cash",
    "staging.slop.cash",
    "1234abcd.slop-staging.pages.dev",
  ]) {
    const rendered = render(`https://${hostname}`);
    expect(rendered.status).toBe(0);
    expect(
      rendered.stdout.equals(
        Buffer.from(await (await servedHtml(hostname)).text()),
      ),
    ).toBe(true);
  }
  await writeFile(join(root, "index.html"), "<body>unbound</body>");
  const refused = render("https://slop.cash");
  expect(refused.status).toBe(1);
  expect(refused.stdout.byteLength).toBe(0);
  expect(refused.stderr.toString()).toContain(
    "does not match the local Pages bundle",
  );
});
