import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

test("generated merge bundle does not change the source inventory", () => {
  const root = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), "slop-inventory-bundle-"));
  try {
    for (const file of [
      "scripts/lemmascript-inventory.mjs",
      "scripts/lemmascript-source-directories.mjs",
    ]) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      copyFileSync(join(root, file), join(fixture, file));
    }
    mkdirSync(join(fixture, "formal"));
    mkdirSync(join(fixture, "workers/vetting-sandbox"), { recursive: true });
    writeFileSync(
      join(fixture, "workers/vetting-sandbox/merge.ts"),
      "export function retainedSource() { return true; }\n",
    );
    writeFileSync(join(fixture, "LemmaScript-files.txt"), "");
    symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"));
    const inventory = () => {
      execFileSync("node", ["scripts/lemmascript-inventory.mjs", "--write"], {
        cwd: fixture,
        stdio: "pipe",
      });
      return readFileSync(join(fixture, "formal/lemmascript-inventory.json"));
    };
    const before = inventory();
    mkdirSync(join(fixture, "workers/vetting-sandbox/.build"));
    writeFileSync(
      join(fixture, "workers/vetting-sandbox/.build/merge.mjs"),
      "export function bundledCopy() { return false; }\n",
    );
    expect(inventory()).toEqual(before);
    expect(before.toString()).toContain("retainedSource");
    expect(before.toString()).not.toContain("bundledCopy");
    mkdirSync(join(fixture, "workers/other/.build"), { recursive: true });
    writeFileSync(
      join(fixture, "workers/other/.build/source.mjs"),
      "export function unrelatedSource() { return true; }\n",
    );
    expect(inventory().toString()).toContain("unrelatedSource");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
