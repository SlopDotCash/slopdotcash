// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
import { sha256Of } from "./bytes.ts";

const oid = /^[a-f0-9]{40}$/u;
const mergeGitVersion = "git version 2.56.0";

export interface ResolvedCommit {
  readonly sha: string;
  readonly parents: ReadonlyArray<{ readonly sha: string }>;
}

export interface Relocation {
  readonly sourceParent: string;
  readonly sourcePath: string;
  readonly path: string;
  readonly blobSha: string;
  readonly headSha: string;
  readonly sourceCommitShas: ReadonlyArray<string>;
}

export interface Automatic {
  readonly kind?: "automatic";
  readonly commitSha: string;
  readonly parents: ReadonlyArray<string>;
  readonly gitVersion: string;
  readonly automaticTree: string;
  readonly resolvedTree: string;
  readonly hadConflicts: boolean;
  readonly patch: string;
  readonly patchSha256: string;
  readonly paths: ReadonlyArray<string>;
  readonly automaticRelocations?: ReadonlyArray<Relocation>;
}

export interface Snapshot {
  readonly mode: string;
  readonly blobSha: string;
}

export interface CombinedParent {
  readonly kind: "combined-parent-delta";
  readonly commitSha: string;
  readonly parents: ReadonlyArray<string>;
  readonly parentTrees: ReadonlyArray<string>;
  readonly gitVersion: string;
  readonly resolvedTree: string;
  readonly patch: string;
  readonly patchSha256: string;
  readonly paths: ReadonlyArray<string>;
  readonly files: ReadonlyArray<{ readonly path: string; readonly parents: ReadonlyArray<Snapshot>; readonly result: Snapshot }>;
}

export type Resolution = Automatic | CombinedParent;

export interface LineCount {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** @throws {never} */
export function mergeResolutionMatches(resolution: Resolution, commit: ResolvedCommit): boolean {
  if (resolution.kind === "combined-parent-delta") return combinedParentLineCounts(resolution, commit) !== null;
  return (
    commit.parents.length === 2 &&
    resolution.commitSha === commit.sha &&
    resolution.parents.length === 2 &&
    resolution.parents.every((parent, index) => parent === commit.parents[index]?.sha) &&
    oid.test(resolution.automaticTree) &&
    oid.test(resolution.resolvedTree) &&
    resolution.gitVersion.startsWith("git version ") &&
    typeof resolution.hadConflicts === "boolean" &&
    /^[a-f0-9]{64}$/u.test(resolution.patchSha256) &&
    new Set(resolution.paths).size === resolution.paths.length &&
    resolution.paths.every((path) => path.length > 0 && !path.includes("\0")) &&
    (resolution.automaticRelocations ?? []).every(
      (move) =>
        resolution.parents.includes(move.sourceParent) &&
        move.sourcePath.length > 0 &&
        move.path.length > 0 &&
        !move.sourcePath.includes("\0") &&
        !move.path.includes("\0") &&
        move.sourcePath !== move.path &&
        oid.test(move.blobSha) &&
        oid.test(move.headSha) &&
        move.sourceCommitShas.length > 0 &&
        new Set(move.sourceCommitShas).size === move.sourceCommitShas.length &&
        move.sourceCommitShas.every((value) => oid.test(value)),
    ) &&
    (resolution.paths.length === 0) === (resolution.patch.length === 0) &&
    (resolution.paths.length === 0) === (resolution.automaticTree === resolution.resolvedTree)
  );
}

function decodedPath(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (value === "/dev/null") return value;
  let decoded: unknown = value;
  if (value.startsWith('"')) {
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof decoded === "string" && /^[ab]\//u.test(decoded) ? decoded.slice(2) : null;
}

function automaticSection(section: string, resolution: Automatic, counted: ReadonlyArray<LineCount>): LineCount | null {
  const lines = section.split("\n");
  const oldPath = decodedPath(lines.find((line) => line.startsWith("--- "))?.slice(4));
  const newPath = decodedPath(lines.find((line) => line.startsWith("+++ "))?.slice(4));
  const path = newPath === "/dev/null" ? oldPath : newPath;
  if (
    !path ||
    !oldPath ||
    !newPath ||
    (oldPath !== "/dev/null" && newPath !== "/dev/null" && oldPath !== newPath) ||
    !resolution.paths.includes(path) ||
    counted.some((file) => file.path === path)
  )
    return null;
  let additions = 0;
  let deletions = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let hunks = 0;
  for (const line of lines.slice(1)) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/u.exec(line);
    if (hunk) {
      if (oldRemaining || newRemaining) return null;
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      if (
        !Number.isSafeInteger(oldRemaining) ||
        !Number.isSafeInteger(newRemaining) ||
        (oldPath === "/dev/null" && oldRemaining !== 0) ||
        (newPath === "/dev/null" && newRemaining !== 0)
      )
        return null;
      hunks++;
      continue;
    }
    if (!hunks || line === "\\ No newline at end of file") continue;
    if (line === "" && oldRemaining === 0 && newRemaining === 0) continue;
    if (line.startsWith("+")) {
      additions++;
      newRemaining--;
    } else if (line.startsWith("-")) {
      deletions++;
      oldRemaining--;
    } else if (line.startsWith(" ")) {
      oldRemaining--;
      newRemaining--;
    } else return null;
    if (oldRemaining < 0 || newRemaining < 0) return null;
  }
  if (!hunks || oldRemaining || newRemaining) return null;
  return { path, additions, deletions };
}

/** @throws {never} */
export function mergeResolutionLineCounts(resolution: Resolution, commit: ResolvedCommit): ReadonlyArray<LineCount> | null {
  if (resolution.kind === "combined-parent-delta") return combinedParentLineCounts(resolution, commit);
  if (!mergeResolutionMatches(resolution, commit) || resolution.gitVersion !== mergeGitVersion || sha256Of(resolution.patch) !== resolution.patchSha256) return null;
  if (resolution.paths.length === 0) return [];
  const sections = resolution.patch.split(/^diff --git /mu).slice(1);
  if (sections.length !== resolution.paths.length) return null;
  const files: LineCount[] = [];
  for (const section of sections) {
    const file = automaticSection(section, resolution, files);
    if (file === null) return null;
    files.push(file);
  }
  return files;
}

interface Range {
  readonly start: number;
  readonly count: number;
}

function combinedRanges(line: string, parents: number): Range[] | null {
  const marker = "@".repeat(parents + 1);
  if (!line.startsWith(`${marker} `)) return null;
  const close = line.indexOf(` ${marker}`, marker.length);
  if (close < 0) return null;
  const fields = line.slice(marker.length + 1, close).split(" ");
  if (fields.length !== parents + 1) return null;
  const ranges: Range[] = [];
  for (const [index, field] of fields.entries()) {
    const match = (index < parents ? /^-(\d+)(?:,(\d+))?$/u : /^\+(\d+)(?:,(\d+))?$/u).exec(field);
    if (!match) return null;
    ranges.push({ start: Number(match[1]), count: Number(match[2] ?? 1) });
  }
  return ranges;
}

function combinedSection(section: string, file: CombinedParent["files"][number], path: string, parents: number): LineCount | null {
  const lines = section.split("\n");
  if (
    !path ||
    path.includes("\0") ||
    file.path !== path ||
    lines[0] !== path ||
    file.parents.length !== parents ||
    [...file.parents, file.result].some((entry) => !["100644", "100755"].includes(entry.mode) || !oid.test(entry.blobSha))
  )
    return null;
  let cursor = 1;
  if (lines[cursor++] !== `index ${file.parents.map((parent) => parent.blobSha).join(",")}..${file.result.blobSha}`) return null;
  if (lines[cursor]?.startsWith("mode ")) {
    if (lines[cursor++] !== `mode ${file.parents.map((parent) => parent.mode).join(",")}..${file.result.mode}`) return null;
  } else if (file.parents.some((parent) => parent.mode !== file.result.mode)) return null;
  for (let index = 0; index < parents; index++) if (lines[cursor++] !== `--- a/${path}`) return null;
  if (lines[cursor++] !== `+++ b/${path}`) return null;
  let remaining: number[] = [];
  let hunks = 0;
  let additions = 0;
  let deletions = 0;
  let ends = Array.from({ length: parents + 1 }, () => 0);
  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor] ?? "";
    if (line.startsWith(`${"@".repeat(parents + 1)} `)) {
      if (remaining.some((value) => value !== 0)) return null;
      const ranges = combinedRanges(line, parents);
      if (
        ranges === null ||
        ranges.some(
          (range, index) =>
            !Number.isSafeInteger(range.start) ||
            !Number.isSafeInteger(range.count) ||
            range.start < 0 ||
            range.count < 0 ||
            (range.count > 0 && range.start < 1) ||
            range.start < (ends[index] ?? 0) ||
            !Number.isSafeInteger(range.start + range.count),
        )
      )
        return null;
      ends = ranges.map((range) => range.start + range.count);
      remaining = ranges.map((range) => range.count);
      hunks++;
      continue;
    }
    if (line === "" && remaining.every((value) => value === 0)) continue;
    if (line === "\\ No newline at end of file") continue;
    if (!hunks || line.length < parents) return null;
    const prefix = line.slice(0, parents);
    if (!/^[ +-]+$/u.test(prefix) || (prefix.includes("+") && prefix.includes("-"))) return null;
    const removed = prefix.includes("-");
    for (let index = 0; index < parents; index++) if (removed ? prefix[index] === "-" : prefix[index] !== "+") remaining[index]--;
    if (!removed) remaining[parents]--;
    if (remaining.some((value) => value < 0)) return null;
    if (prefix === "+".repeat(parents)) additions++;
    if (prefix === "-".repeat(parents)) deletions++;
  }
  if (!hunks || remaining.some((value) => value !== 0) || additions + deletions === 0) return null;
  return { path, additions, deletions };
}

function combinedParentLineCounts(resolution: CombinedParent, commit: ResolvedCommit): ReadonlyArray<LineCount> | null {
  const parents = commit.parents.length;
  if (
    parents < 3 ||
    resolution.commitSha !== commit.sha ||
    resolution.parents.length !== parents ||
    new Set(resolution.parents).size !== parents ||
    resolution.parents.some((parent, index) => !oid.test(parent) || parent !== commit.parents[index]?.sha) ||
    resolution.parentTrees.length !== parents ||
    resolution.parentTrees.some((tree) => !oid.test(tree)) ||
    !oid.test(resolution.resolvedTree) ||
    resolution.gitVersion !== mergeGitVersion ||
    sha256Of(resolution.patch) !== resolution.patchSha256 ||
    (resolution.patch.length > 0 && !resolution.patch.endsWith("\n")) ||
    new Set(resolution.paths).size !== resolution.paths.length ||
    resolution.files.length !== resolution.paths.length
  )
    return null;
  const sections = resolution.patch.split(/^diff --combined /mu).slice(1);
  if (sections.length !== resolution.paths.length || (resolution.paths.length === 0) !== (resolution.patch.length === 0)) return null;
  const counts: LineCount[] = [];
  for (const [index, section] of sections.entries()) {
    const file = resolution.files[index];
    const path = resolution.paths[index];
    const count = file === undefined || path === undefined ? null : combinedSection(section, file, path, parents);
    if (count === null) return null;
    counts.push(count);
  }
  return counts;
}
