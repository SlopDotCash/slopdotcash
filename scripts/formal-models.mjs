/** Shared helpers for the Quint models and the generated formal indexes. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const modelRoot = "formal/models";

/** Production files a model abstracts, from its `// @source path` lines. */
export const modelSources = (text) =>
  [...text.matchAll(/^\s*\/\/\s*@source\s+(\S+)\s*$/gmu)].map(
    (match) => match[1],
  );

/** Named `run *Test` reachability scenarios. */
export const modelScenarios = (text) =>
  [...text.matchAll(/^\s*run\s+(\w+Test)\s*=/gmu)].map((match) => match[1]);

/**
 * Writes a generated index formatted by Biome, or refuses when the committed
 * file is missing or differs from the regenerated value.
 */
export function writeOrCompareIndex(root, path, value, write, staleMessage) {
  const file = join(root, path);
  if (write) {
    writeFileSync(
      file,
      execFileSync(
        join(root, "node_modules/.bin/biome"),
        ["format", "--stdin-file-path", path],
        { cwd: root, input: JSON.stringify(value), encoding: "utf8" },
      ),
    );
    return;
  }
  if (
    !existsSync(file) ||
    JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) !==
      JSON.stringify(value)
  )
    throw new Error(staleMessage);
}

/**
 * Returns repository-relative model paths in sorted order. `selected` matches a
 * model's file name without the extension, so names stay unique across folders.
 */
export function listModels(root, selected) {
  const paths = readdirSync(join(root, modelRoot), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".qnt"))
    .map((entry) =>
      relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .sort();
  const names = new Map();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1, -".qnt".length);
    if (names.has(name))
      throw new Error(
        `Duplicate model name ${name}: ${names.get(name)}, ${path}`,
      );
    names.set(name, path);
  }
  return selected
    ? paths.filter((path) => path.endsWith(`/${selected}.qnt`))
    : paths;
}
