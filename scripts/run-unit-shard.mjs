/**
 * Runs one shard of the `bun run test` unit suite, so CI can run the shards
 * as parallel matrix jobs. The shards partition exactly the files that
 * `bun run test` discovers under its roots; scripts/unit-shards.test.ts
 * proves the partition.
 *
 *   node scripts/run-unit-shard.mjs <vetting|scripts|workers|backend>
 *   node scripts/run-unit-shard.mjs --list <shard>
 *
 * Extra arguments after the shard name pass through to `bun test`.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The roots of `bun run test` in package.json. */
export const UNIT_ROOTS = [
  "scripts",
  "workers",
  "backend",
  "contracts",
  "formal/tests",
];

// Bun's default test file names.
const TEST_FILE = /(?:\.|_)(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;

/** Every unit test file under the roots, as sorted repository paths. */
export function unitTestFiles(base = root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && TEST_FILE.test(entry.name))
        files.push(relative(base, path).split("\\").join("/"));
    }
  };
  for (const unitRoot of UNIT_ROOTS) walk(join(base, unitRoot));
  return files.sort();
}

/** Shard of a repository path; every unit test file has exactly one. */
export function unitShard(path) {
  if (path.startsWith("scripts/vetting-")) return "vetting";
  if (path.startsWith("scripts/")) return "scripts";
  if (path.startsWith("workers/")) return "workers";
  return "backend";
}

export const UNIT_SHARDS = ["vetting", "scripts", "workers", "backend"];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const list = args[0] === "--list";
  const shard = list ? args[1] : args[0];
  if (!UNIT_SHARDS.includes(shard)) {
    process.stderr.write(
      `Usage: run-unit-shard.mjs [--list] <${UNIT_SHARDS.join("|")}>\n`,
    );
    process.exit(2);
  }
  const files = unitTestFiles().filter((path) => unitShard(path) === shard);
  if (files.length === 0) {
    process.stderr.write(`Shard ${shard} has no test files\n`);
    process.exit(1);
  }
  if (list) {
    process.stdout.write(`${files.join("\n")}\n`);
    process.exit(0);
  }
  // A leading ./ makes bun treat each argument as a path, not a name filter.
  const result = spawnSync(
    "bun",
    [
      "test",
      "--timeout",
      "30000",
      ...files.map((path) => `./${path}`),
      ...args.slice(1),
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
