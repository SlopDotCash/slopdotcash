import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCANNER_INPUTS_FILE = "scanner-inputs.json";

export const SCANNER_ENTRIES = [
  "apps/security/src/programs/main.vibe",
  "apps/security/sandbox/supervise.py",
];

export const SCANNER_DIRECTORIES = [
  { path: "apps/security", exclude: (file) => isTestFile(file) || isMarkdownFile(file) },
  { path: "spec/security", exclude: (file) => isProofFile(file) },
];

export const SCANNER_FILES = [
  ".github/workflows/vetting-controller.yml",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/scanner-inputs.mjs",
];

const IMPORT_FROM = /from\s+["']([^"']+)["']/g;
const IMPORT_SIDE_EFFECT = /import\s+["']([^"']+)["']/g;
const EXTENSIONS = [".vibe", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "gen"]);

function isTestFile(file) {
  return file.includes(".test.") || file.includes("/test/") || file.startsWith("test/");
}

function isMarkdownFile(file) {
  return file.endsWith(".md");
}

function isProofFile(file) {
  return file.endsWith(".proof.dfy");
}

function toPosix(file) {
  return file.split(sep).join("/");
}

function resolveImport(root, source, specifier) {
  const base = join(dirname(source), specifier);
  const candidates = [base];
  for (const extension of EXTENSIONS) {
    candidates.push(base + extension);
  }
  for (const extension of EXTENSIONS) {
    candidates.push(join(base, `index${extension}`));
  }
  for (const candidate of candidates) {
    const absolute = join(root, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      return toPosix(candidate);
    }
  }
  throw new Error(`Failed to resolve relative import "${specifier}" in "${source}"`);
}

export function scannerImportClosure(root) {
  const closure = new Set();
  const queue = [...SCANNER_ENTRIES];
  while (queue.length > 0) {
    const file = queue.shift();
    if (closure.has(file)) {
      continue;
    }
    const absolute = join(root, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`Failed to resolve scanner entry "${file}"`);
    }
    closure.add(file);
    const source = readFileSync(absolute, "utf8");
    for (const pattern of [IMPORT_FROM, IMPORT_SIDE_EFFECT]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier.startsWith(".")) {
          // gen/ files are generated from the spec; their sources are already inputs.
          const target = toPosix(join(dirname(file), specifier));
          if (target.split("/").includes("gen")) {
            continue;
          }
          const resolved = resolveImport(root, file, specifier);
          if (!closure.has(resolved)) {
            queue.push(resolved);
          }
        }
      }
    }
  }
  return [...closure].sort();
}

function walkDirectory(root, directory, exclude) {
  const files = [];
  const entries = readdirSync(join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        files.push(...walkDirectory(root, file, exclude));
      }
    } else if (entry.isFile() && !exclude(toPosix(file))) {
      files.push(toPosix(file));
    }
  }
  return files;
}

export function scannerInputs(root) {
  const inputs = new Set(scannerImportClosure(root));
  for (const { path, exclude } of SCANNER_DIRECTORIES) {
    for (const file of walkDirectory(root, path, exclude)) {
      inputs.add(file);
    }
  }
  for (const file of SCANNER_FILES) {
    if (!existsSync(join(root, file))) {
      throw new Error(`Failed to resolve scanner file "${file}"`);
    }
    inputs.add(file);
  }
  return [...inputs].sort();
}

function commitFor(root, given) {
  if (given) {
    return given;
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for "${flag}" (usage: node scripts/scanner-inputs.mjs [--root <dir>] [--commit <sha>] [--out <path>])`);
  }
  return value;
}

function parseArguments(argv) {
  const options = { root: process.cwd(), commit: undefined, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      options.root = resolve(takeValue(argv, index, argument));
      index += 1;
    } else if (argument === "--commit") {
      options.commit = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--out") {
      options.out = takeValue(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`Unknown argument "${argument}" (usage: node scripts/scanner-inputs.mjs [--root <dir>] [--commit <sha>] [--out <path>])`);
    }
  }
  return options;
}

function main(argv) {
  const options = parseArguments(argv);
  const list = {
    commit: commitFor(options.root, options.commit),
    files: scannerInputs(options.root),
  };
  const json = `${JSON.stringify(list, null, 2)}\n`;
  if (options.out) {
    const out = resolve(options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

const invokedAsScript = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`scanner-inputs: ${error.message}`);
    process.exitCode = 1;
  }
}
