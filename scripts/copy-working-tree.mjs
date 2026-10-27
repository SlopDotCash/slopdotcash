import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Copy current source, including uncommitted changes, without ignored files. */
export function copyWorkingTree(sourceRoot, targetRoot, exclude = []) {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: sourceRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    if (exclude.some((path) => file === path || file.startsWith(`${path}/`)))
      continue;
    const source = join(sourceRoot, file);
    // Skip deleted paths and runtime directory symlinks that directory-only
    // ignore rules do not hide from git ls-files.
    if (!existsSync(source) || statSync(source).isDirectory()) continue;
    const target = join(targetRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}
