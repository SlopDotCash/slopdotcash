import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAXIMUM_BUNDLE_FILES } from "./dist-manifest.mjs";
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
  it("accepts the full deployment inventory and rejects one extra file", async () => {
    const [approved, candidate] = await fixture();
    for (const root of [approved, candidate]) {
      await Promise.all(
        Array.from({ length: MAXIMUM_BUNDLE_FILES - 4 }, (_, index) =>
          writeFile(join(root, `project-artifact-${index}.txt`), "fixture"),
        ),
      );
    }
    await expect(assertDataOnlyRefresh(approved, candidate)).resolves.toEqual(
      [],
    );
    await writeFile(join(candidate, "over-limit.txt"), "fixture");
    await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
      /inventory limits/u,
    );
  });

  for (const path of [
    "skill-manifest.json",
    "projects/example/skill-manifest.json",
    "projects/example/review-skill-manifest.json",
  ]) {
    it(`allows only generatedAt in ${path}`, async () => {
      const [approved, candidate] = await fixture();
      for (const root of [approved, candidate]) {
        await mkdir(join(root, "projects/example"), { recursive: true });
        await writeFile(
          join(root, path),
          JSON.stringify({
            generatedAt: "2026-09-06T00:00:00.000Z",
            source: { sha256: "original" },
          }),
        );
      }
      await writeFile(
        join(candidate, path),
        JSON.stringify({
          generatedAt: "2026-09-06T06:00:00.000Z",
          source: { sha256: "original" },
        }),
      );
      expect(await assertDataOnlyRefresh(approved, candidate)).toEqual([path]);
      await writeFile(
        join(candidate, path),
        JSON.stringify({
          generatedAt: "2026-09-06T06:00:00.000Z",
          source: { sha256: "substituted" },
        }),
      );
      await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
        "non-data file",
      );
      await writeFile(
        join(candidate, path),
        JSON.stringify({
          generatedAt: "invalid",
          source: { sha256: "original" },
        }),
      );
      await expect(assertDataOnlyRefresh(approved, candidate)).rejects.toThrow(
        "timestamp",
      );
    });
  }
  it("accepts identical bundles and explicit data changes", async () => {
    const [approved, candidate] = await fixture();
    expect(await assertDataOnlyRefresh(approved, candidate)).toEqual([]);
    await writeFile(join(candidate, "data/leaderboard.json"), "fresh");
    expect(await assertDataOnlyRefresh(approved, candidate)).toEqual([
      "data/leaderboard.json",
    ]);
  });
  it("accepts regenerated contributor profiles", async () => {
    const [approved, candidate] = await fixture();
    for (const root of [approved, candidate]) {
      await writeFile(join(root, "data/profiles.json"), "original");
    }
    await writeFile(join(candidate, "data/profiles.json"), "fresh");
    expect(await assertDataOnlyRefresh(approved, candidate)).toEqual([
      "data/profiles.json",
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
