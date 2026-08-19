import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
