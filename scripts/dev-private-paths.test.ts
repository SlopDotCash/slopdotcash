// The dev-server private-data guard must block every form Vite can serve:
// direct, encoded, aliased and /@fs absolute paths, including the Windows
// drive form that follows the literal "/@fs" prefix without a separating
// slash. Vite strips exactly "/@fs", so on a Windows checkout the guard must
// strip that form too, or Vite serves private data from outside the root.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { privateDevRequest } from "./dev-private-paths";

const root = resolve(import.meta.dir, "..");
const privateDirectory = mkdtempSync(
  resolve(tmpdir(), "slop-dev-private-paths-test-"),
);
writeFileSync(join(privateDirectory, "slop.sqlite"), "local");
writeFileSync(join(privateDirectory, ".dev.vars"), "SECRET=local");
// The dev server can reach a private directory through a symlink in the
// repository root, so the fixture mirrors the driver's alias.
const aliasTarget = resolve(import.meta.dir, ".private-paths-alias-test");
rmSync(aliasTarget, { force: true });
symlinkSync(privateDirectory, aliasTarget, "dir");

afterAll(() => {
  rmSync(aliasTarget, { force: true });
  rmSync(privateDirectory, { recursive: true, force: true });
});

describe("privateDevRequest allows in-root content", () => {
  test("a repository source path is allowed", () => {
    expect(privateDevRequest("/src/main.tsx", root, privateDirectory)).toBe(
      false,
    );
  });

  test("an @fs path inside the repository root is allowed", () => {
    expect(
      privateDevRequest(
        `/@fs/${resolve(root, "src", "main.tsx").replaceAll("\\", "/")}`,
        root,
        privateDirectory,
      ),
    ).toBe(false);
  });
});

describe("privateDevRequest blocks private locations", () => {
  test("the legacy in-root data directory is blocked", () => {
    expect(
      privateDevRequest("/.slop-dev/slop.sqlite", root, privateDirectory),
    ).toBe(true);
  });

  test("an @fs POSIX private path is blocked", () => {
    const directory = "/srv/slop-dev/private";
    expect(
      privateDevRequest(`/@fs${directory}/slop.sqlite`, root, directory),
    ).toBe(true);
    expect(
      privateDevRequest(`/@fs${directory}/private-marker.txt`, root, directory),
    ).toBe(true);
  });

  // The Windows incident shape: Vite strips the literal "/@fs" prefix, so the
  // drive path follows it directly with no separating slash. The URL parser
  // turns the backslashes into forward slashes before the guard runs, and the
  // raw-backslash form reaches the same resolve when Vite has not seen it yet.
  test("an @fs Windows drive path is blocked in every served form", () => {
    const directory = "C:\\Users\\dev\\slop-dev-private-data-1";
    const slashed = directory.replaceAll("\\", "/");
    for (const candidate of [
      `/@fs${slashed}/slop.sqlite`,
      `/@fs/${slashed}/slop.sqlite`,
      `/@fs${directory}/slop.sqlite`,
      `/@fs/${directory}/slop.sqlite`,
    ])
      expect(privateDevRequest(candidate, root, directory)).toBeTrue();
  });

  test("a private alias and encoded dev-var markers are blocked", () => {
    for (const candidate of [
      "/scripts/.private-paths-alias-test/slop.sqlite",
      "/scripts/.private-paths-alias-test/.dev.vars",
      "/scripts/.private-paths-alias-test/%2edev%2evars",
    ])
      expect(privateDevRequest(candidate, root, privateDirectory)).toBeTrue();
  });
});
