// spec/slopbot/readyLabel.md, "A changed file is protected when it is deleted, on a default or owner path, or has no text diff"; spec/slopbot/readyLabel.md, "The decision takes the first failing condition, and only a running review or unsettled mergeability is pending"
import type { ReadyLabelConfig } from "../../gen/backend__readyLabelSettings.ts";
import { type ChangedFile, type FileChange, type ReadyReason, largeDeletionLines, readyLabelName, readyLineMarker } from "../../gen/slopbot__readyLabel.ts";

const ci = "CI or GitHub settings";
const dependencies = "a dependency manifest or lockfile";
const payments = "contracts or payment code";
const policy = "a skill, agent or policy file";
const manifest = "the Slop project manifest";
const security = "SECURITY.md";
const binary = "a binary file or a file without a text diff";
const deleted = "a deleted file";
const owner = "a path this project protects";

const rootDirectories: ReadonlyMap<string, string> = new Map(
  [".github", ".circleci", ".buildkite", ".woodpecker", ".gitlab", ".azure-pipelines"].map((name) => [name, ci] as const),
);

const anyDirectories: ReadonlyMap<string, string> = new Map([
  ...["contracts", "contract", "payments", "payment", "escrow", "billing", "wallet", "wallets"].map((name) => [name, payments] as const),
  ...["skills", ".claude", ".cursor", ".windsurf"].map((name) => [name, policy] as const),
]);

const fileNames: ReadonlyMap<string, string> = new Map([
  ...[
    ".gitlab-ci.yml", ".travis.yml", "azure-pipelines.yml", "jenkinsfile", "appveyor.yml", "bitbucket-pipelines.yml",
    ".drone.yml", ".woodpecker.yml", "cloudbuild.yaml", "cloudbuild.yml", ".pre-commit-config.yaml", ".gitmodules",
  ].map((name) => [name, ci] as const),
  ...[
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", ".yarnrc", ".yarnrc.yml", ".npmrc",
    "pnpm-lock.yaml", "pnpm-workspace.yaml", "bun.lock", "bun.lockb", "bunfig.toml", "deno.json", "deno.jsonc",
    "deno.lock", "cargo.toml", "cargo.lock", "go.mod", "go.sum", "go.work", "go.work.sum", "pipfile", "pipfile.lock",
    "pyproject.toml", "poetry.lock", "uv.lock", "setup.py", "setup.cfg", "gemfile", "gemfile.lock", "composer.json",
    "composer.lock", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
    "gradle.lockfile", "libs.versions.toml", "packages.lock.json", "directory.packages.props", "mix.exs", "mix.lock",
    "package.swift", "package.resolved", "podfile", "podfile.lock", "pubspec.yaml", "pubspec.lock", "flake.nix",
    "flake.lock", "vcpkg.json", "conanfile.txt", "conanfile.py",
  ].map((name) => [name, dependencies] as const),
  ...["foundry.toml", "anchor.toml", "remappings.txt"].map((name) => [name, payments] as const),
  ...[
    "skill.md", "agents.md", "claude.md", "gemini.md", "contributing.md", "codeowners", "code_of_conduct.md",
    ".cursorrules", ".windsurfrules",
  ].map((name) => [name, policy] as const),
  ["slop-project.json", manifest],
  ["slopbot.json", manifest],
  ["security.md", security],
]);

const filePatterns: ReadonlyArray<readonly [RegExp, string]> = [
  [/^requirements[^/]*\.(?:txt|in)$/u, dependencies],
  [/\.(?:gemspec|csproj|fsproj|vbproj|nuspec)$/u, dependencies],
  [/\.(?:sol|vy|move|cairo)$/u, payments],
  [/^hardhat\.config\.[a-z]+$/u, payments],
  [/^(?:license|licence|copying)(?:\.[^/]*)?$/u, policy],
];

const binaryExtensions: ReadonlySet<string> = new Set([
  "exe", "dll", "so", "dylib", "a", "o", "obj", "lib", "bin", "class", "jar", "war", "ear", "wasm", "pyc", "pyo",
  "whl", "egg", "node", "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "iso", "dmg", "pkg", "deb",
  "rpm", "apk", "ipa", "msi", "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff", "pdf", "woff",
  "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "wav", "ogg", "webm", "sqlite", "db",
]);

export interface GitHubFile {
  readonly filename: string;
  readonly previous_filename?: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
}

export interface ReadyCounts {
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly approvals: number;
  readonly mergeableState: string | null;
  readonly protectedDetail: string | null;
}

const changes: Readonly<Record<string, FileChange>> = { added: "FileAdded", modified: "FileModified", removed: "FileRemoved", renamed: "FileRenamed" };

function escaped(text: string): string {
  return text.replace(/[.+^${}()|[\]\\@-]/gu, (c) => `\\${c}`);
}

/** @throws {never} */
export function ownerPatternMatches(pattern: string, path: string): boolean {
  const trimmed = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  const body = trimmed
    .split(/(\*\*\/|\*\*|\*)/u)
    .map((part) => (part === "**/" ? "(?:[^/]*/)*" : part === "**" ? ".*" : part === "*" ? "[^/]*" : escaped(part)))
    .join("");
  return new RegExp(`${trimmed.includes("/") ? "^" : "(?:^|/)"}${body}(?:/.*)?$`, "u").test(path);
}

/** @throws {never} */
export function defaultPathReason(path: string): string | null {
  const segments = path.split("/");
  const name = (segments.at(-1) ?? "").toLowerCase();
  const directories = segments.slice(0, -1);
  const root = rootDirectories.get(directories[0] ?? "");
  if (root !== undefined) return root;
  const directory = directories.map((segment) => anyDirectories.get(segment.toLowerCase())).find((reason) => reason !== undefined);
  if (directory !== undefined) return directory;
  const named = fileNames.get(name);
  if (named !== undefined) return named;
  const patterned = filePatterns.find(([pattern]) => pattern.test(name));
  if (patterned !== undefined) return patterned[1];
  const extension = name.includes(".") ? name.split(".").at(-1) : undefined;
  return extension !== undefined && binaryExtensions.has(extension) ? binary : null;
}

/** @throws {never} */
export function protectedPathReason(path: string, ownerPatterns: ReadonlyArray<string>): string | null {
  return defaultPathReason(path) ?? (ownerPatterns.some((pattern) => ownerPatternMatches(pattern, path)) ? owner : null);
}

function pathsOf(file: GitHubFile): ReadonlyArray<string> {
  return file.previous_filename === undefined ? [file.filename] : [file.filename, file.previous_filename];
}

function pureRename(file: GitHubFile): boolean {
  return file.status === "renamed" && file.additions + file.deletions === 0;
}

/** @throws {never} */
export function changedFileOf(file: GitHubFile, ownerPatterns: ReadonlyArray<string>): ChangedFile {
  const paths = pathsOf(file);
  return {
    change: changes[file.status] ?? "FileOther",
    defaultProtected: paths.some((path) => defaultPathReason(path) !== null),
    ownerProtected: paths.some((path) => ownerPatterns.some((pattern) => ownerPatternMatches(pattern, path))),
    patched: typeof file.patch === "string",
    lines: file.additions + file.deletions,
  };
}

function fileReason(file: GitHubFile, ownerPatterns: ReadonlyArray<string>): string | null {
  if (file.status === "removed") return `${deleted} (${file.filename})`;
  const found = pathsOf(file).map((path) => [path, protectedPathReason(path, ownerPatterns)] as const).find(([, reason]) => reason !== null);
  if (found !== undefined) return `${found[1]} (${found[0]})`;
  return typeof file.patch !== "string" && !pureRename(file) ? `${binary} (${file.filename})` : null;
}

/** @throws {never} */
export function protectedDetail(files: ReadonlyArray<GitHubFile>, ownerPatterns: ReadonlyArray<string>): string | null {
  return files.map((file) => fileReason(file, ownerPatterns)).find((reason) => reason !== null) ?? null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** @throws {never} */
export function reasonText(reason: ReadyReason, counts: ReadyCounts, settings: ReadyLabelConfig): string {
  const lines = counts.additions + counts.deletions;
  switch (reason) {
    case "NotChecked": return "Slopbot has not checked this pull request";
    case "NotOpen": return "the pull request is not open";
    case "IsDraft": return "the pull request is a draft";
    case "StillReviewing": return "Slopbot is still reviewing this commit";
    case "NotReviewed": return "Slopbot has not reviewed this commit";
    case "LimitedCoverage": return "Slopbot could not review every changed file";
    case "HasFinding": return "Slopbot's review of this commit has a finding";
    case "OverLineCap": return `${lines} changed lines is over the cap of ${settings.maxChangedLines}`;
    case "OverFileCap": return `${counts.changedFiles} changed files is over the cap of ${settings.maxChangedFiles}`;
    case "LargeDeletion": return `${counts.deletions} deleted lines is a large deletion (over ${largeDeletionLines})`;
    case "FileListIncomplete": return "the changed file list could not be read in full";
    case "TouchesProtectedPath": return `it touches ${counts.protectedDetail ?? binary}`;
    case "WriterRequestedChanges": return "an account with write access requested changes";
    case "TooFewApprovals": return `${counts.approvals} of ${settings.approvals} required approvals at this commit from accounts with write access`;
    case "NotMergeable": return `GitHub does not report every check passing and the branch mergeable (${counts.mergeableState ?? "unknown"})`;
    case "CommentUnavailable": return "Slopbot's review comment is unavailable";
    case "FeeUnpaid": return "its submission fee has not been paid";
    case "AllConditionsHold": return "all conditions hold";
    case "LabelOff": return "ready label is off for this project";
    case "HeadMoved": return "a new commit arrived during the check";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function readyLine(ready: boolean, reason: string, headSha: string, counts: ReadyCounts, settings: ReadyLabelConfig): string {
  const at = `\`${headSha.slice(0, 7)}\``;
  if (!ready) return `${readyLineMarker} **Not labelled \`${readyLabelName}\`** at ${at}: ${reason}.`;
  return `${readyLineMarker} **Labelled \`${readyLabelName}\`** at ${at}. Checked: GitHub reports every check passing and the branch mergeable, Slopbot's review has no finding, ${plural(counts.approvals, "approval")} at this commit from accounts with write access (${settings.approvals} required), ${counts.additions + counts.deletions} changed lines in ${plural(counts.changedFiles, "file")} (caps ${settings.maxChangedLines} and ${settings.maxChangedFiles}), no protected path. Not checked: whether the change is correct or wanted, and anything the checks do not test. A maintainer merges; Slopbot never merges.`;
}

/** @throws {never} */
export function withReadyLine(body: string, line: string | null): string {
  const kept = body.split("\n").filter((existing) => !existing.startsWith(readyLineMarker));
  if (line === null) return kept.join("\n");
  const details = kept.indexOf("<details><summary>Review details</summary>");
  const at = details > 0 ? details : kept.length;
  const before = kept.slice(0, at);
  while (before.length > 0 && before.at(-1) === "") before.pop();
  return [...before, "", line, "", ...kept.slice(at)].join("\n");
}
