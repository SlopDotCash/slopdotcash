import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function found(path: string, text: string) {
  return inspected(path, text).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

/**
 * Three keys name a local file that the tool runs on every invocation:
 * `preload` in `bunfig.toml` runs before the entrypoint, and `rustc-wrapper`
 * or a target `runner` in `.cargo/config.toml` replaces the compiler or the
 * test runner. The named file is repository source, so the rule points at
 * which file to read; it is not a remote download.
 *
 * The section decides the meaning, and TOML keys are case-sensitive, so only
 * the lines the extractor returns reach the rule.
 */
const LOADERS: [string, string, string][] = [
  ["bunfig.toml", 'preload = "./tools/setup.ts"\n', ":1"],
  ["bunfig.toml", 'preload = ["./tools/setup.ts"]\n', ":1"],
  ["bunfig.toml", '"preload" = "./tools/setup.ts"\n', ":1"],
  ["bunfig.toml", 'preload = [\n  # the entry\n  "./a.ts",\n]\n', ":1"],
  [
    ".cargo/config.toml",
    '[build]\nrustc-wrapper = "tools/rustc-wrap.sh"\n',
    ":2",
  ],
  [
    ".cargo/config.toml",
    '[target.x86_64-unknown-linux-gnu]\nrunner = "tools/run-tests.sh"\n',
    ":2",
  ],
  [
    "crates/core/.cargo/config.toml",
    '[target.wasm32-unknown-unknown]\nrunner = "wasmtime --dir ."\n',
    ":2",
  ],
];

test("a local code loader is flagged at its own line", () => {
  for (const [path, text, line] of LOADERS) {
    const inspection = inspected(path, text);
    expect({ path, text, findings: inspection.findings }).toMatchObject({
      path,
      text,
      findings: [{ path, category: "unsafe-execution", severity: "medium" }],
    });
    // The evidence names the source line, not the derived offset.
    expect(inspection.findings[0]?.evidence).toBe(`${path}${line}`);
  }
});

test("the same assignment outside the deciding file or section stays clean", () => {
  const cases: [string, string][] = [
    // A make variable and ordinary assignments.
    ["Makefile", 'runner = "pytest"\n'],
    ["scripts/run.py", 'runner = "pytest"\n'],
    ["tools/setup.js", 'preload = "./polyfill.js"\n'],
    // A section that does not read the key.
    ["pyproject.toml", '[tool.pytest.ini_options]\nrunner = "x"\n'],
    ["Cargo.toml", '[target.x86_64-unknown-linux-gnu]\nrunner = "x"\n'],
    ["bunfig.toml", '[install]\npreload = "./x"\n'],
    [".cargo/config.toml", '[net]\nrunner = "x"\n'],
    // TOML keys are case-sensitive.
    ["bunfig.toml", 'Preload = "./x"\n'],
    // An empty value loads nothing.
    ["bunfig.toml", "preload = []\n"],
    ["bunfig.toml", 'preload = ""\n'],
    [".cargo/config.toml", "[net]\nretry = 3\n"],
  ];
  for (const [path, text] of cases)
    expect({ path, text, findings: found(path, text) }).toEqual({
      path,
      text,
      findings: [],
    });
});

test("a comment line is not a loader", () => {
  expect(
    found(".cargo/config.toml", '# runner = "x"\n[net]\nretry = 3\n'),
  ).toEqual([]);
});
