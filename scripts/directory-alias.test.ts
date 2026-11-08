import { expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDirectoryAlias } from "./directory-alias";

test("alias teardown preserves a setup error and finishes removing fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-alias-cleanup-"));
  const original = Object.assign(new Error("junction setup failed"), {
    code: "EPERM",
  });
  try {
    expect(() => {
      try {
        throw original;
      } finally {
        removeDirectoryAlias(join(root, "missing"));
        rmSync(root, { recursive: true, force: true });
      }
    }).toThrow(original);
    expect(() => lstatSync(root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("alias teardown removes broken links so the next fixture can start", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-alias-cleanup-"));
  const target = join(root, "target");
  const alias = join(root, "alias");
  const type = process.platform === "win32" ? "junction" : "dir";
  try {
    mkdirSync(target);
    symlinkSync(target, alias, type);
    rmSync(target, { recursive: true });
    removeDirectoryAlias(alias);
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "private fixture");
    symlinkSync(target, alias, type);
    removeDirectoryAlias(alias);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe(
      "private fixture",
    );
    expect(() => lstatSync(alias)).toThrow();
  } finally {
    removeDirectoryAlias(alias);
    rmSync(root, { recursive: true, force: true });
  }
});
