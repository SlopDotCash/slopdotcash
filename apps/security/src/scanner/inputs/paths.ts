// spec/security/scanController.md, "A deployed release serves the scanner input list of its own commit"; spec/security/scanController.md, "The controller runs a pass only on the same commit or an unchanged earlier commit of its branch"
import { posix } from "node:path";
import type { RunnerCompare } from "../../../gen/security__scanController.ts";

export const SCANNER_ENTRIES = [
  "apps/security/src/programs/main.vibe",
  "apps/security/src/admission/routes.vibe",
  "apps/security/src/evidence/routes.vibe",
  "apps/security/src/workers/sandbox.vibe",
  "apps/security/src/sandbox/job.vibe",
  "apps/security/vite.config.ts",
  "apps/security/vite.sandbox.config.ts",
] as const;

export const GENERATOR_DIRECTORY = "vibestack/";

export const SCANNER_DIRECTORIES = [
  "apps/security/src/scanner/",
  "apps/security/src/sandbox/",
  "apps/security/src/programs/",
  "apps/security/src/admission/",
  "apps/security/sandbox/",
  "apps/security/wrangler/",
  ".github/actions/setup/",
  "patches/",
  GENERATOR_DIRECTORY,
] as const;

export const SCANNER_FILES = [
  ".github/workflows/vetting-controller.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/security/package.json",
  "apps/security/tsconfig.json",
  "tsconfig.base.json",
] as const;

export const SCANNER_EXCLUDED = ["vibestack/examples/", "vibestack/fixtures/", "vibestack/selftests/", "vibestack/studio/"] as const;

const NOT_RUN = /(?:\.test\.(?:vibe|[cm]?[jt]sx?)|\.md|(?:^|\/)test\/.*)$/u;

/** @throws {never} */
export function inScannerDirectory(path: string): boolean {
  return SCANNER_DIRECTORIES.some((directory) => path.startsWith(directory)) && !SCANNER_EXCLUDED.some((directory) => path.startsWith(directory)) && !NOT_RUN.test(path);
}
const CODE = /\.(?:vibe|[cm]?[jt]sx?)$/u;
const IMPORT = /(?<![@\w.$])(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"'\n]+)["']/gu;
const QUINT_BLOCK = /^```quint\n([\s\S]*?)^```/gmu;
const QUINT_IMPORT = /^\s*import\s+[^"\n]*\bfrom\s+"([^"\n]+)"/gmu;
const EXTENSIONS = [".vibe", ".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", ".json"];

export interface WorkspacePackage {
  readonly name: string;
  readonly directory: string;
  readonly exports: Readonly<Record<string, unknown>>;
}

export interface Workspace {
  readonly tracked: ReadonlySet<string>;
  readonly packages: ReadonlyArray<WorkspacePackage>;
}

export type Resolved =
  | { readonly kind: "file"; readonly path: string; readonly manifest?: string }
  | { readonly kind: "generated"; readonly module: string; readonly manifest?: string }
  | { readonly kind: "external" }
  | { readonly kind: "unresolved" };

/** @throws {never} */
export function followsImports(path: string): boolean {
  return !path.startsWith(GENERATOR_DIRECTORY) && (CODE.test(path) || path.endsWith(".md"));
}

/** @throws {never} */
export function codeImports(text: string): string[] {
  return [...text.matchAll(IMPORT)].map((match) => match[1] ?? "");
}

/** @throws {never} */
export function specImports(text: string): string[] {
  return [...text.matchAll(QUINT_BLOCK)].flatMap((block) => [...(block[1] ?? "").matchAll(QUINT_IMPORT)].map((match) => match[1] ?? ""));
}

function located(base: string, workspace: Workspace, manifest?: string): Resolved {
  if (base.startsWith("../") || base === ".." || posix.isAbsolute(base)) return { kind: "unresolved" };
  for (const candidate of [base, ...EXTENSIONS.map((extension) => `${base}${extension}`), ...EXTENSIONS.map((extension) => `${base}/index${extension}`)])
    if (workspace.tracked.has(candidate)) return manifest === undefined ? { kind: "file", path: candidate } : { kind: "file", path: candidate, manifest };
  if (/(?:^|\/)gen\/[^/]+$/u.test(base)) {
    const module = posix.basename(base).split(".")[0] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(module)) return manifest === undefined ? { kind: "generated", module } : { kind: "generated", module, manifest };
  }
  return { kind: "unresolved" };
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of ["default", "import", "types"]) {
      const resolved = exportTarget(record[key]);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

function exported(exports: Readonly<Record<string, unknown>>, subpath: string): string | undefined {
  const exact = exportTarget(exports[subpath]);
  if (exact !== undefined) return exact;
  for (const [key, rawTarget] of Object.entries(exports)) {
    const star = key.indexOf("*");
    const target = exportTarget(rawTarget);
    if (star < 0 || target === undefined) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length > prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const middle = subpath.slice(prefix.length, subpath.length - suffix.length);
      if (!middle.includes("/")) return target.replace("*", middle);
    }
  }
  return undefined;
}

/** @throws {never} */
export function resolveImport(from: string, specifier: string, workspace: Workspace): Resolved {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return located(posix.normalize(posix.join(posix.dirname(from), specifier)), workspace);
  if (specifier.startsWith("node:")) return { kind: "external" };
  const owner = [...workspace.packages]
    .filter((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (owner === undefined) return specifier.startsWith("@repo/") ? { kind: "unresolved" } : { kind: "external" };
  const target = exported(owner.exports, specifier === owner.name ? "." : `./${specifier.slice(owner.name.length + 1)}`);
  if (target === undefined) return { kind: "unresolved" };
  const manifest = owner.directory === "." ? "package.json" : `${owner.directory}/package.json`;
  return located(posix.normalize(posix.join(owner.directory, target)), workspace, manifest);
}

/** @throws {never} */
export function specOfModule(module: string, workspace: Workspace): string | undefined | null {
  if (module.startsWith("_")) return null;
  const path = module.split("__").join("/");
  for (const candidate of [`spec/${path}.md`, `spec/${path}/index.md`]) if (workspace.tracked.has(candidate)) return candidate;
  return undefined;
}

/** @throws {never} */
export function resolveSpecImport(from: string, specifier: string, workspace: Workspace): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  for (const candidate of [`${base}.md`, `${base}/index.md`]) if (workspace.tracked.has(candidate)) return candidate;
  const std = `vibestack/std/${posix.basename(specifier)}.md`;
  return workspace.tracked.has(std) ? std : undefined;
}

/** @throws {never} */
export function directoryInputs(tracked: Iterable<string>): string[] {
  return [...tracked].filter(inScannerDirectory);
}

export interface ComparedFile {
  readonly filename: string;
  readonly previous_filename?: string | undefined;
}

/** @throws {never} */
export function changedScannerInputs(changed: ReadonlyArray<ComparedFile>, inputs: ReadonlySet<string>): string[] {
  const touched = new Set<string>();
  for (const file of changed)
    for (const path of [file.filename, file.previous_filename])
      if (path !== undefined && (inputs.has(path) || inScannerDirectory(path))) touched.add(path);
  return [...touched].sort();
}

export const COMPARE_FILE_LIMIT = 300;

/** @throws {never} */
export function runnerCompare(input: {
  readonly deployed: string;
  readonly checkout: string;
  readonly compare: { readonly status: string; readonly files: ReadonlyArray<ComparedFile> } | undefined;
  readonly inputs: ReadonlySet<string>;
}): RunnerCompare {
  const compare = input.compare;
  return {
    sameCommit: input.deployed === input.checkout,
    readable: compare !== undefined,
    ahead: compare?.status === "ahead",
    complete: compare !== undefined && compare.files.length < COMPARE_FILE_LIMIT,
    scannerTouched: compare === undefined || changedScannerInputs(compare.files, input.inputs).length > 0,
  };
}
