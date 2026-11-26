/**
 * Whether the deployed isolated runner may scan for a newer checkout.
 *
 * A scan pass needs the deployed scanner (the isolated runner and the vetting
 * API it talks to) and the checked-out controller to be the same scanner. They
 * are when the deployed revision is the checkout itself, or an earlier commit
 * of the same branch with no scanner input changed since (operator decision,
 * 23 November 2026, PRD section 8). Scanner inputs are the import closure of
 * the controller, the vetting API and the isolated runner, every file of the
 * scanner directories, the workflow and the dependency lock. A merge that
 * touches none of them changes nothing the scan runs, so it need not wait for
 * its own release.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

/** Entry points whose relative imports are scanner code. */
export const SCANNER_ENTRIES = [
  "scripts/run-vetting-controller.ts",
  "backend/vetting/handler.ts",
  "workers/vetting-sandbox/index.ts",
] as const;

/** Directories whose every file is a scanner input, imported or not. */
export const SCANNER_DIRECTORIES = [
  "workers/vetting/",
  "workers/vetting-sandbox/",
  "backend/vetting/",
] as const;

/** Single files that change what a scan runs or how it is deployed. */
export const SCANNER_FILES = [
  ".github/workflows/vetting-controller.yml",
  "package.json",
  "bun.lock",
] as const;

const IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](\.{1,2}\/[^"'\n]+)["']/gu;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"];

function resolveImport(root: string, from: string, spec: string) {
  const base = normalize(join(dirname(from), spec));
  for (const candidate of [
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.slice(1).map((extension) => join(base, `index${extension}`)),
  ]) {
    const path = join(root, candidate);
    if (existsSync(path) && statSync(path).isFile()) return candidate;
  }
  return null;
}

/** The relative-import closure of the scanner entry points, as repo paths. */
export function scannerImportClosure(root: string): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [...SCANNER_ENTRIES];
  while (queue.length > 0) {
    const path = queue.pop() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const text = readFileSync(join(root, path), "utf8");
    for (const match of text.matchAll(IMPORT)) {
      const target = resolveImport(root, path, match[1]);
      // An import the closure cannot resolve could be anything: fail closed.
      if (target === null)
        throw new Error(`Unresolved scanner import in ${path}`);
      if (!target.startsWith("..")) queue.push(target);
    }
  }
  return seen;
}

/** Tests and prose in the scanner directories never run in a scan. */
const NOT_RUN = /(?:\.test\.[cm]?[jt]sx?|\.md)$/u;

/** Every file under the scanner directories, as repo paths. */
function directoryFiles(root: string): Set<string> {
  const files = new Set<string>();
  const walk = (directory: string) => {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!NOT_RUN.test(entry.name))
        files.add(relative(root, join(root, path)));
    }
  };
  for (const directory of SCANNER_DIRECTORIES) walk(directory);
  return files;
}

/** The scanner input set of the checkout at `root`. */
export function scannerInputs(root: string): Set<string> {
  return new Set([
    ...scannerImportClosure(root),
    ...directoryFiles(root),
    ...SCANNER_FILES,
  ]);
}

/** A file GitHub's compare lists between two commits. */
export type ComparedFile = { filename: string; previous_filename?: string };

/**
 * The scanner inputs a list of changed files touches. A path inside a
 * scanner directory counts even when the checkout no longer has it (deleted
 * or renamed away).
 */
export function changedScannerInputs(
  changed: readonly ComparedFile[],
  inputs: ReadonlySet<string>,
): string[] {
  const touched = new Set<string>();
  for (const file of changed)
    for (const path of [file.filename, file.previous_filename])
      if (
        path &&
        (inputs.has(path) ||
          (!NOT_RUN.test(path) &&
            SCANNER_DIRECTORIES.some((directory) =>
              path.startsWith(directory),
            )))
      )
        touched.add(path);
  return [...touched].sort();
}

/** GitHub caps a compare's file list at 300; a full list can be truncated. */
export const COMPARE_FILE_LIMIT = 300;

/**
 * The decision for one deployed revision and checkout: `match` when they are
 * the same commit, `equivalent` when the checkout is ahead of the deployed
 * commit and no scanner input changed, and a refusal reason otherwise.
 */
export function runnerEquivalence(input: {
  deployed: string;
  checkout: string;
  compare?: { status: string; files: readonly ComparedFile[] };
  inputs: ReadonlySet<string>;
}):
  | { result: "match" }
  | { result: "equivalent" }
  | { result: "refused"; reason: string; touched?: string[] } {
  if (input.deployed === input.checkout) return { result: "match" };
  const compare = input.compare;
  if (!compare) return { result: "refused", reason: "no-compare" };
  // `ahead`: the checkout descends from the deployed commit. Anything else
  // (behind, diverged) is not the same scanner moved forward.
  if (compare.status !== "ahead")
    return { result: "refused", reason: `not-ahead-${compare.status}` };
  if (compare.files.length >= COMPARE_FILE_LIMIT)
    return { result: "refused", reason: "compare-truncated" };
  const touched = changedScannerInputs(compare.files, input.inputs);
  return touched.length > 0
    ? { result: "refused", reason: "scanner-changed", touched }
    : { result: "equivalent" };
}
