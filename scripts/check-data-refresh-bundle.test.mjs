import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDataOnlyRefresh } from "./check-data-refresh-bundle.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "slop-refresh-test-"));
  roots.push(root);
  for (const dir of ["approved", "candidate"]) {
    await mkdir(join(root, dir, "data"), { recursive: true });
    for (const file of [
      "index.html",
      "deployment-manifest.json",
      "_headers",
      "data/leaderboard.json",
    ]) {
      await writeFile(join(root, dir, file), "original");
    }
  }
  return [join(root, "approved"), join(root, "candidate")];
}
describe("scheduled data-only bundle boundary", () => {
  it("accepts identical bundles and explicit data changes", async () => {
    const [approved, candidate] = await fixture();
    expect(await assertDataOnlyRefresh(approved, candidate)).toEqual([]);
    await writeFile(join(candidate, "data/leaderboard.json"), "fresh");
    expect(await assertDataOnlyRefresh(approved, candidate)).toEqual([
      "data/leaderboard.json",
    ]);
  });
  for (const file of ["index.html", "_headers"]) {
    it(`rejects changed ${file}`, async () => {
      const [approved, candidate] = await fixture();
      await writeFile(join(candidate, file), "changed code or policy");
      await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
        "non-data file",
      );
    });
  }
  it("rejects added files even under data", async () => {
    const [approved, candidate] = await fixture();
    await writeFile(join(candidate, "data/code.js"), "code");
    await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
      "add or remove",
    );
  });
  it("rejects removed files", async () => {
    const [approved, candidate] = await fixture();
    await rm(join(candidate, "_headers"));
    await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
      "add or remove",
    );
  });
  it("rejects symlinks", async () => {
    const [approved, candidate] = await fixture();
    await symlink(join(approved, "index.html"), join(candidate, "linked"));
    await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
      "symlinks",
    );
  });
});
