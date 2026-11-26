// The scan may run on a deployed runner from an earlier commit only when no
// scanner input changed since (operator decision, 23 November 2026).
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COMPARE_FILE_LIMIT,
  runnerEquivalence,
  scannerImportClosure,
  scannerInputs,
} from "./vetting-runner-equivalence";

const root = join(import.meta.dir, "..");
const inputs = scannerInputs(root);
const deployed = "a".repeat(40);
const checkout = "b".repeat(40);
const ahead = (...filenames: string[]) => ({
  status: "ahead",
  files: filenames.map((filename) => ({ filename })),
});

test("the scanner inputs cover the controller, the API, the runner and what they import", () => {
  for (const path of [
    "scripts/run-vetting-controller.ts",
    "scripts/vetting-runner-equivalence.ts",
    "backend/vetting/handler.ts",
    "workers/vetting-sandbox/index.ts",
    "workers/vetting-sandbox/Dockerfile",
    "workers/vetting/run.ts",
    "workers/vetting/local-install-helpers.ts",
    ".github/workflows/vetting-controller.yml",
    "bun.lock",
  ])
    expect(inputs.has(path), path).toBe(true);
  // A shared library the scanner imports is an input even outside the
  // scanner directories.
  expect(inputs.has("src/lib/project-schema.mjs")).toBe(true);
  // Tests and prose in the scanner directories never run in a scan.
  expect(inputs.has("workers/vetting/README.md")).toBe(false);
  expect(inputs.has("workers/vetting/local-install-helpers.test.ts")).toBe(
    false,
  );
});

test("the same commit matches without a compare", () => {
  expect(runnerEquivalence({ deployed, checkout: deployed, inputs })).toEqual({
    result: "match",
  });
});

test("a later commit that changed nothing the scanner runs is equivalent", () => {
  expect(
    runnerEquivalence({
      deployed,
      checkout,
      compare: ahead(
        "src/Home.tsx",
        "scripts/generate-leaderboard.ts",
        "workers/vetting/README.md",
        "workers/vetting/local-install-helpers.test.ts",
      ),
      inputs,
    }),
  ).toEqual({ result: "equivalent" });
});

test("a later commit that changed a scanner input waits for its release", () => {
  for (const changed of [
    "workers/vetting/bounded-scan.ts",
    "workers/vetting-sandbox/Dockerfile",
    "backend/vetting/handler.ts",
    "src/lib/project-schema.mjs",
    "scripts/run-vetting-controller.ts",
    ".github/workflows/vetting-controller.yml",
    "bun.lock",
    "workers/vetting/a-new-module.ts",
  ]) {
    const decision = runnerEquivalence({
      deployed,
      checkout,
      compare: ahead("src/Home.tsx", changed),
      inputs,
    });
    expect(decision, changed).toEqual({
      result: "refused",
      reason: "scanner-changed",
      touched: [changed],
    });
  }
  // A file renamed out of a scanner directory still counts.
  expect(
    runnerEquivalence({
      deployed,
      checkout,
      compare: {
        status: "ahead",
        files: [
          {
            filename: "lib/moved.ts",
            previous_filename: "workers/vetting/x.ts",
          },
        ],
      },
      inputs,
    }).result,
  ).toBe("refused");
});

test("a missing, out-of-order or truncated compare waits for the release", () => {
  expect(runnerEquivalence({ deployed, checkout, inputs })).toEqual({
    result: "refused",
    reason: "no-compare",
  });
  for (const status of ["behind", "diverged", "identical"])
    expect(
      runnerEquivalence({
        deployed,
        checkout,
        compare: { status, files: [] },
        inputs,
      }),
    ).toEqual({ result: "refused", reason: `not-ahead-${status}` });
  expect(
    runnerEquivalence({
      deployed,
      checkout,
      compare: ahead(
        ...Array.from(
          { length: COMPARE_FILE_LIMIT },
          (_, index) => `docs/page-${index}.md`,
        ),
      ),
      inputs,
    }),
  ).toEqual({ result: "refused", reason: "compare-truncated" });
});

test("an import the closure cannot resolve fails closed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "slop-runner-closure-"));
  try {
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    };
    write(
      "scripts/run-vetting-controller.ts",
      'import { x } from "../workers/vetting/missing";\n',
    );
    write("backend/vetting/handler.ts", "export {};\n");
    write("workers/vetting-sandbox/index.ts", "export {};\n");
    expect(() => scannerImportClosure(scratch)).toThrow(
      "Unresolved scanner import",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
