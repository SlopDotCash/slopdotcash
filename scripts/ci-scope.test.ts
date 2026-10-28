import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const selector = resolve("scripts/ci-scope.mjs");
for (const path of [
  "skills/slop/SKILL.md",
  "src/lib/project-skill.mjs",
  "src/lib/project-skill-publication.mjs",
  "scripts/skill-source-matches-commit.mjs",
  "scripts/skill-python.mjs",
  "scripts/skill-validation/quick_validate.py",
  "README.md",
]) {
  test(`installer coverage follows ${path}`, () => {
    const root = mkdtempSync(join(tmpdir(), "slop-ci-scope-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      git("init", "-q");
      git("config", "user.name", "CI fixture");
      git("config", "user.email", "fixture@example.invalid");
      git("commit", "--allow-empty", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "fixture\n");
      git("add", ".");
      git("commit", "-qm", "affected source");
      const event = join(root, "event.json");
      const output = join(root, "output");
      writeFileSync(
        event,
        JSON.stringify({
          pull_request: {
            base: { ref: "development", sha: base },
            head: { ref: "fixture", sha: git("rev-parse", "HEAD") },
          },
        }),
      );
      execFileSync("node", [selector], {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: event,
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_OUTPUT: output,
        },
      });
      const lines = readFileSync(output, "utf8").split("\n");
      expect(lines).toContain(`installer=${path !== "README.md"}`);
      if (path === "skills/slop/SKILL.md") {
        const matrix = lines.find((line) => line.startsWith("browser_matrix="));
        if (!matrix) throw new Error("Browser matrix output is missing");
        expect(
          JSON.parse(matrix.slice("browser_matrix=".length)).include,
        ).toContainEqual({
          lane: "pages",
          server: "pages",
          browsers: "chromium",
          shard: "1/1",
          grep: "",
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
