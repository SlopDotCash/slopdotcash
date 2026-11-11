import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

/**
 * Three configuration keys name a local file that the tool runs on every
 * invocation: `preload` in `bunfig.toml` runs before the entrypoint, and
 * `rustc-wrapper` or a target `runner` in `.cargo/config.toml` replaces the
 * compiler or the test runner. The named file is repository source, so the
 * rule points at which file to read; it is not a remote download.
 */
const LOADERS: [string, string][] = [
  ["bunfig.toml", `preload = ["./tools/setup.ts"]\n`],
  ["bunfig.toml", `preload = "./tools/setup.ts"\n`],
  [".cargo/config.toml", `[build]\nrustc-wrapper = "tools/rustc-wrap.sh"\n`],
  [
    ".cargo/config.toml",
    `[target.x86_64-unknown-linux-gnu]\nrunner = "tools/run-tests.sh"\n`,
  ],
  [
    "crates/core/.cargo/config.toml",
    `[target.wasm32-unknown-unknown]\nrunner = "wasmtime --dir ."\n`,
  ],
];

test("a local code loader is flagged as execution", () => {
  for (const [path, text] of LOADERS) {
    const inspection = inspected(path, text);
    expect({
      path,
      text,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ path, text, findings: [`${path}:unsafe-execution:medium`] });
  }
});

test("a loader keeps its context line in the evidence", () => {
  const path = ".cargo/config.toml";
  const inspection = inspected(path, `[build]\nrustc-wrapper = "tools/w.sh"\n`);
  expect(inspection.findings[0]?.evidence).toBe(`${path}:2`);
});

test("ordinary assignment and prose stay unflagged", () => {
  const cases: [string, string][] = [
    ["bunfig.toml", `[install]\nregistry = "https://example.test"\n`],
    [".cargo/config.toml", `[net]\nretry = 3\n`],
    ["docs/build.md", `The runner is documented elsewhere.\n`],
    [".cargo/config.toml", `runner = 3\n`],
  ];
  for (const [path, text] of cases)
    expect({ path, findings: inspected(path, text).findings }).toEqual({
      path,
      findings: [],
    });
});
