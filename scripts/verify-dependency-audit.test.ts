import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readAuditReport,
  verifyAuditFindings,
} from "./verify-dependency-audit.mjs";

const advisory = {
  id: 1247710,
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  severity: "high",
  vulnerable_versions: "<=4.0.7",
};
const report = { picomatch: [advisory] };
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-picomatch-audit-"));
  directories.push(root);
  const write = (path: string, contents: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return createHash("sha256").update(contents).digest("hex");
  };

  const patchedDependencies: Record<string, string> = {};
  const locked: Record<string, unknown> = {};
  const packages: Record<string, unknown> = {};
  for (const [name, version, directory] of [
    ["picomatch", "4.0.5", "node_modules/picomatch"],
    [
      "micromatch/picomatch",
      "2.3.2",
      "node_modules/micromatch/node_modules/picomatch",
    ],
  ]) {
    const identity = `picomatch@${version}`;
    const patch = `patches/${identity}.patch`;
    const integrity = `sha512-fixture-${version}`;
    patchedDependencies[identity] = patch;
    locked[name] = [identity, "", {}, integrity];
    packages[name] = {
      version,
      integrity,
      patchSha256: write(patch, `Reviewed patch for ${version}`),
      files: {
        "package.json": write(
          `${directory}/package.json`,
          JSON.stringify({ name: "picomatch", version }),
        ),
        "index.js": write(`${directory}/index.js`, "module.exports = {};"),
        "lib/parse.js": write(
          `${directory}/lib/parse.js`,
          `Reviewed parser for ${version}`,
        ),
      },
    };
  }
  for (const name of ["vite", "tinyglobby", "fdir", "micromatch"]) {
    write(`node_modules/${name}/package.json`, JSON.stringify({ name }));
  }

  const writeLock = () =>
    write(
      "bun.lock",
      JSON.stringify({ patchedDependencies, packages: locked }),
    );
  write("package.json", JSON.stringify({ patchedDependencies }));
  writeLock();
  write(
    "scripts/picomatch-backport-integrity.json",
    JSON.stringify({ packages }),
  );
  return { root, write, locked, writeLock };
}

test("the reported advisory passes only with both reviewed copies installed", () => {
  const { root, write } = fixture();
  expect(verifyAuditFindings(report, root)).toBe(true);
  expect(verifyAuditFindings({}, root)).toBe(false);

  write(
    "node_modules/micromatch/node_modules/picomatch/lib/parse.js",
    "Unreviewed parser bytes",
  );
  expect(() => verifyAuditFindings(report, root)).toThrow("SHA-256 mismatch");
  expect(() => verifyAuditFindings({}, root)).toThrow("SHA-256 mismatch");
});

test("a missing on-disk patch or changed locked inventory blocks the advisory", () => {
  const missing = fixture();
  rmSync(join(missing.root, "patches/picomatch@2.3.2.patch"));
  expect(() => verifyAuditFindings(report, missing.root)).toThrow("ENOENT");

  const extra = fixture();
  extra.locked["other/repackaged"] = [
    "picomatch@4.0.7",
    "",
    {},
    "sha512-other",
  ];
  extra.writeLock();
  expect(() => verifyAuditFindings(report, extra.root)).toThrow(
    "unexpected Picomatch copies",
  );
});

test("both reviewed copies are insufficient if a consumer resolves another copy", () => {
  const { root, write } = fixture();
  write(
    "node_modules/tinyglobby/node_modules/picomatch/index.js",
    "module.exports = {};",
  );
  expect(() => verifyAuditFindings(report, root)).toThrow(
    "tinyglobby does not resolve the reviewed picomatch@4.0.5",
  );
});

test("an additional advisory or changed affected range stays unresolved", () => {
  const { root } = fixture();
  expect(() =>
    verifyAuditFindings({ ...report, anotherDependency: [{ id: 1 }] }, root),
  ).toThrow("unresolved advisory");
  expect(() =>
    verifyAuditFindings(
      {
        picomatch: [{ ...advisory, vulnerable_versions: "<=4.0.8" }],
      },
      root,
    ),
  ).toThrow("unresolved advisory");
});

test("malformed output, registry failures and exit disagreement cannot pass", () => {
  const result = { status: 1, stdout: JSON.stringify(report), stderr: "" };
  expect(readAuditReport(result)).toEqual(report);
  expect(() => readAuditReport({ ...result, stdout: "not JSON" })).toThrow(
    "did not return JSON",
  );
  expect(() =>
    readAuditReport({ ...result, stderr: "error: registry unavailable" }),
  ).toThrow("did not return a verified response");
  expect(() => readAuditReport({ ...result, status: 0 })).toThrow(
    "exit status disagree",
  );
  expect(() =>
    readAuditReport({ ...result, error: new Error("timed out") }),
  ).toThrow("did not return a verified response");
});
