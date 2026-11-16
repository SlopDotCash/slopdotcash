/** Execute the recorder's own boundary with real manifests, files and streams. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { onRequest } from "../functions/index.ts";
import { createDistManifest, expectedPublishedRoot } from "./dist-manifest.mjs";
import {
  PRODUCTION_ORIGIN,
  verifyRemoteArtifacts,
} from "./evidence-contract.mjs";
import { sha256Hex as hash } from "./sha256.mjs";

const recorder = await readFile(
  new URL("./record-evidence.mjs", import.meta.url),
  "utf8",
);
const production = recorder.indexOf('if (mode === "production") {');
const start = recorder.indexOf("  const publishedIndex =", production);
const end = recorder.indexOf("  const network =", start);
if (production < 0 || start < production || end < start)
  throw new Error("Recorder production artifact boundary is missing");
const boundary = recorder.slice(start, end);
const directories = [];
const html =
  "<!doctype html><html><body><main>é Evidence</main></body></html>\n";

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "slop-recorder-analytics-"));
  directories.push(root);
  const artifacts = [
    { path: "index.html", contents: Buffer.from(html) },
    { path: "skill-manifest.json", contents: Buffer.from("{}\n") },
    { path: "SKILL.md", contents: Buffer.from("# Original skill\n") },
  ];
  for (const artifact of artifacts)
    await writeFile(join(root, artifact.path), artifact.contents);
  await createDistManifest(root);
  return { root, artifacts, indexArtifact: artifacts[0] };
}

async function verifyCapture(fixture, fetchImpl) {
  // This is the checked-in caller segment, not a second implementation of
  // its artifact selection. Both imported validators run unchanged; only
  // their network boundary is supplied by the fixture.
  return runInNewContext(
    `(async () => { ${boundary}\nreturn remoteArtifacts; })()`,
    {
      Buffer,
      artifacts: fixture.artifacts,
      indexArtifact: fixture.indexArtifact,
      distRoot: fixture.root,
      cacheKey: "recorder-analytics-regression",
      expectedPublishedRoot,
      PRODUCTION_ORIGIN,
      hash,
      verifyRemoteArtifacts: (options) =>
        verifyRemoteArtifacts({ ...options, fetchImpl }),
    },
  );
}

function remote(
  fixture,
  changeRoot = (contents) => contents,
  changeArtifact = (contents) => contents,
) {
  return async (url, options) => {
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    const path = new URL(url).pathname;
    if (path === "/") {
      const response = await onRequest({
        request: new Request(PRODUCTION_ORIGIN),
        next: async () =>
          new Response(html, { headers: { "content-type": "text/html" } }),
      });
      return new Response(changeRoot(await response.text()), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const artifact = fixture.artifacts.find(
      (entry) => `/${entry.path}` === path,
    );
    if (!artifact) throw new Error("Unexpected fixture artifact request");
    return new Response(changeArtifact(artifact.contents, artifact.path), {
      headers: {
        "content-type": artifact.path.endsWith(".json")
          ? "application/json"
          : "text/markdown",
      },
    });
  };
}

test("the production recorder accepts the exact Function-rendered root and retains its raw capture", async () => {
  const captured = await fixture();
  const original = captured.artifacts.map((artifact) => ({
    ...artifact,
    contents: Buffer.from(artifact.contents),
  }));
  const fingerprint = hash(captured.artifacts[1].contents);
  const manifest = await readFile(
    join(captured.root, "deployment-manifest.json"),
  );
  const result = await verifyCapture(captured, remote(captured));
  expect(result[0].sha256).toBe(
    hash(await expectedPublishedRoot(captured.root, PRODUCTION_ORIGIN)),
  );
  expect(result[0].bytes).toBeGreaterThan(
    captured.indexArtifact.contents.length,
  );
  expect(result.slice(1).map((entry) => entry.sha256)).toEqual(
    original.slice(1).map((entry) => hash(entry.contents)),
  );
  expect(captured.artifacts).toEqual(original);
  expect(hash(captured.artifacts[1].contents)).toBe(fingerprint);
  expect(await readFile(join(captured.root, "index.html"), "utf8")).toBe(html);
  expect(
    await readFile(join(captured.root, "deployment-manifest.json")),
  ).toEqual(manifest);
});

test.each([
  ["missing beacon", () => html],
  [
    "wrong beacon",
    (contents) =>
      contents.replace(
        "230b277fc6fe4a279c8b06cf7e569719",
        "00000000000000000000000000000000",
      ),
  ],
  ["unapproved HTML", (contents) => contents.replace("Evidence", "Changed!")],
])(
  "the production recorder refuses %s without normalizing observed HTML",
  async (_, changeRoot) => {
    const captured = await fixture();
    await expect(
      verifyCapture(captured, remote(captured, changeRoot)),
    ).rejects.toThrow(/production index\.html.*(?:length|match|size)/u);
  },
);

test.each(["SKILL.md", "skill-manifest.json"])(
  "the production recorder still refuses changed %s bytes",
  async (path) => {
    const captured = await fixture();
    await expect(
      verifyCapture(
        captured,
        remote(captured, undefined, (contents, requested) => {
          if (requested !== path) return contents;
          const changed = Buffer.from(contents);
          changed[0] ^= 1;
          return changed;
        }),
      ),
    ).rejects.toThrow(
      `production ${path} does not match the verified dist artifact`,
    );
  },
);

test.each([false, true])(
  "an index changed after capture refuses even when its manifest is regenerated: %j",
  async (regenerate) => {
    const captured = await fixture();
    await writeFile(
      join(captured.root, "index.html"),
      html.replace("Evidence", "Changed!"),
    );
    if (regenerate) await createDistManifest(captured.root);
    let reads = 0;
    await expect(
      verifyCapture(captured, async () => {
        reads++;
        throw new Error("Changed raw capture must refuse before fetching");
      }),
    ).rejects.toThrow(
      regenerate
        ? "changed after evidence artifact capture"
        : "does not match the local Pages bundle",
    );
    expect(reads).toBe(0);
    expect(captured.indexArtifact.contents.toString()).toBe(html);
  },
);

test("a changed raw manifest refuses before remote verification", async () => {
  const captured = await fixture();
  const path = join(captured.root, "deployment-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.files.find((file) => file.path === "index.html").sha256 = "0".repeat(
    64,
  );
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  let reads = 0;
  await expect(
    verifyCapture(captured, async () => {
      reads++;
      throw new Error("Changed raw manifest must refuse before fetching");
    }),
  ).rejects.toThrow("does not match the local Pages bundle");
  expect(reads).toBe(0);
});

test.each([null, 1, "", "a".repeat(63), "A".repeat(64), `0x${"a".repeat(64)}`])(
  "an invalid captured-index digest refuses: %j",
  async (digest) => {
    const captured = await fixture();
    await expect(
      expectedPublishedRoot(captured.root, PRODUCTION_ORIGIN, digest),
    ).rejects.toThrow("Expected raw index digest must be lowercase SHA-256");
  },
);
