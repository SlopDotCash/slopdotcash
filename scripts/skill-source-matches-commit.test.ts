import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillSourceMatchesCommit } from "./skill-source-matches-commit.mjs";

test("batched skill provenance keeps exact binary bytes and tree inventory", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-skill-git-"));
  const source = "skills/example";
  const paths = ["SKILL.md", "binary data.bin", "empty.txt"];
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const binary = Buffer.from([0, 10, 255, 13, 0, 10]);
  try {
    mkdirSync(join(root, source), { recursive: true });
    git("init", "--quiet");
    writeFileSync(join(root, ".gitattributes"), "* -text\n");
    writeFileSync(join(root, source, "SKILL.md"), "# Example\r\n");
    writeFileSync(join(root, source, "binary data.bin"), binary);
    writeFileSync(join(root, source, "empty.txt"), "");
    git("add", ".");
    git(
      "-c",
      "user.name=Local Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "skill bytes",
    );
    expect(skillSourceMatchesCommit(root, "HEAD", source, paths)).toBe(true);
    writeFileSync(
      join(root, source, "binary data.bin"),
      Buffer.from([0, 10, 254, 13, 0, 10]),
    );
    expect(skillSourceMatchesCommit(root, "HEAD", source, paths)).toBe(false);
    writeFileSync(join(root, source, "binary data.bin"), binary);
    writeFileSync(join(root, source, "SKILL.md"), "# Example\n");
    expect(skillSourceMatchesCommit(root, "HEAD", source, paths)).toBe(false);
    writeFileSync(join(root, source, "SKILL.md"), "# Example\r\n");
    expect(
      skillSourceMatchesCommit(root, "HEAD", source, paths.slice(0, 2)),
    ).toBe(false);
    expect(
      skillSourceMatchesCommit(root, "HEAD", source, [...paths, "new.txt"]),
    ).toBe(false);
    expect(skillSourceMatchesCommit(root, "HEAD", source, paths)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
