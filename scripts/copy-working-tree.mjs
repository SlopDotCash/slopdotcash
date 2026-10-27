import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync } from "node:fs";
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
    // A deleted tracked path still appears in the index.
    if (!existsSync(source) || lstatSync(source).isDirectory()) continue;
    const target = join(targetRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}
