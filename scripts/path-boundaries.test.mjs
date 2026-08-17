import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("destructive script path boundaries", () => {
  it("refuses recursive deletion outside the working tree", () => {
    const outside = mkdtempSync(join(tmpdir(), "slop-rm-boundary-"));
    const victim = join(outside, "victim.txt");
    temporaryRoots.push(outside);
    writeFileSync(victim, "preserve\n");

    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, "scripts", "rm-path-recursive.mjs"), outside],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "outside the working tree",
    );
    expect(readFileSync(victim, "utf8")).toBe("preserve\n");
  });

  it("refuses brand publication outside the repository", () => {
    const outside = mkdtempSync(join(tmpdir(), "slop-brand-boundary-"));
    temporaryRoots.push(outside);

    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, "scripts", "sync-brand-assets.mjs"), outside],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "outside the repository",
    );
  });
});
