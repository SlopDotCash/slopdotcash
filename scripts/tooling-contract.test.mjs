import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);

describe("repository tooling contract", () => {
  it("runs Biome through Bun's portable package runner", () => {
    for (const scriptName of ["format", "format:check", "lint", "lint:check"]) {
      const command = packageJson.scripts[scriptName];
      expect(command).toMatch(/^bun x @biomejs\/biome\b/);
      expect(command).not.toMatch(/\bbunx\b/);
    }
  });
});
