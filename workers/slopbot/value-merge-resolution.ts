/** Local Git reconstruction, bound to the collected immutable merge parents.
 * This is scope evidence, never a finding that a resolution deserves credit.
 */
import { sha256Hex } from "../../src/lib/sha256";
import type {
  CombinedParentValueMergeResolution,
  ValueEvidence,
  ValueMergeResolution,
} from "./value-evidence-types";
import { MERGE_GIT_VERSION } from "./value-merge-profile";

export function mergeResolutionMatches(
  resolution: ValueMergeResolution,
  commit: Pick<ValueEvidence["commits"][number], "sha" | "parents">,
): boolean {
  const sha = /^[a-f0-9]{40}$/u;
  if (resolution.kind === "combined-parent-delta")
    return combinedParentLineCounts(resolution, commit) !== null;
  return (
    commit.parents.length === 2 &&
    resolution.commitSha === commit.sha &&
    resolution.parents.length === 2 &&
    resolution.parents.every(
      (parent, index) => parent === commit.parents[index].sha,
    ) &&
    sha.test(resolution.automaticTree) &&
    sha.test(resolution.resolvedTree) &&
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
        sha.test(move.blobSha) &&
        sha.test(move.headSha) &&
        move.sourceCommitShas.length > 0 &&
        new Set(move.sourceCommitShas).size === move.sourceCommitShas.length &&
        move.sourceCommitShas.every((value) => sha.test(value)),
    ) &&
    (resolution.paths.length === 0) === (resolution.patch.length === 0) &&
    (resolution.paths.length === 0) ===
      (resolution.automaticTree === resolution.resolvedTree)
  );
}

/** Count only the canonical automatic-to-resolved delta, never parent changes. */
export function mergeResolutionLineCounts(
  resolution: ValueMergeResolution,
  commit: Pick<ValueEvidence["commits"][number], "sha" | "parents">,
): { path: string; additions: number; deletions: number }[] | null {
  if (resolution.kind === "combined-parent-delta")
    return combinedParentLineCounts(resolution, commit);
  if (
    !mergeResolutionMatches(resolution, commit) ||
    resolution.gitVersion !== MERGE_GIT_VERSION ||
    sha256Hex(resolution.patch) !== resolution.patchSha256
  )
    return null;
  if (resolution.paths.length === 0) return [];
  const sections = resolution.patch.split(/^diff --git /mu).slice(1);
  if (sections.length !== resolution.paths.length) return null;
  const files: { path: string; additions: number; deletions: number }[] = [];
  for (const section of sections) {
    const lines = section.split("\n");
    const before = lines.find((line) => line.startsWith("--- "))?.slice(4);
    const after = lines.find((line) => line.startsWith("+++ "))?.slice(4);
    const decode = (value: string | undefined): string | null => {
      if (value === undefined) return null;
      if (value === "/dev/null") return value;
      let decoded = value;
      if (value.startsWith('"')) {
        try {
          decoded = JSON.parse(value);
        } catch {
          return null;
        }
      }
      return /^[ab]\//u.test(decoded) ? decoded.slice(2) : null;
    };
    const oldPath = decode(before),
      newPath = decode(after);
    const path = newPath === "/dev/null" ? oldPath : newPath;
    if (
      !path ||
      !oldPath ||
      !newPath ||
      (oldPath !== "/dev/null" &&
        newPath !== "/dev/null" &&
        oldPath !== newPath) ||
      !resolution.paths.includes(path) ||
      files.some((file) => file.path === path)
    )
      return null;
    let additions = 0,
      deletions = 0,
      oldRemaining = 0,
      newRemaining = 0,
      hunks = 0;
    for (const line of section.split("\n").slice(1)) {
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
    files.push({ path, additions, deletions });
  }
  return files;
}

/** Count only edits absent from every parent of an n-way native merge. */
function combinedParentLineCounts(
  resolution: CombinedParentValueMergeResolution,
  commit: Pick<ValueEvidence["commits"][number], "sha" | "parents">,
): { path: string; additions: number; deletions: number }[] | null {
  const oid = /^[a-f0-9]{40}$/u;
  const n = commit.parents.length;
  if (
    n < 3 ||
    resolution.commitSha !== commit.sha ||
    resolution.parents.length !== n ||
    new Set(resolution.parents).size !== n ||
    resolution.parents.some(
      (parent, i) => !oid.test(parent) || parent !== commit.parents[i].sha,
    ) ||
    resolution.parentTrees.length !== n ||
    resolution.parentTrees.some((tree) => !oid.test(tree)) ||
    !oid.test(resolution.resolvedTree) ||
    resolution.gitVersion !== MERGE_GIT_VERSION ||
    sha256Hex(resolution.patch) !== resolution.patchSha256 ||
    (resolution.patch.length > 0 && !resolution.patch.endsWith("\n")) ||
    new Set(resolution.paths).size !== resolution.paths.length ||
    resolution.files.length !== resolution.paths.length
  )
    return null;
  const sections = resolution.patch.split(/^diff --combined /mu).slice(1);
  if (
    sections.length !== resolution.paths.length ||
    (resolution.paths.length === 0) !== (resolution.patch.length === 0)
  )
    return null;
  const counts: { path: string; additions: number; deletions: number }[] = [];
  for (const [index, section] of sections.entries()) {
    const file = resolution.files[index];
    const lines = section.split("\n");
    const path = resolution.paths[index];
    if (
      !path ||
      path.includes("\0") ||
      file.path !== path ||
      lines[0] !== path ||
      file.parents.length !== n ||
      [...file.parents, file.result].some(
        (entry) =>
          !["100644", "100755"].includes(entry.mode) ||
          !oid.test(entry.blobSha),
      )
    )
      return null;
    let cursor = 1;
    if (
      lines[cursor++] !==
      `index ${file.parents.map((p) => p.blobSha).join(",")}..${file.result.blobSha}`
    )
      return null;
    if (lines[cursor]?.startsWith("mode ")) {
      if (
        lines[cursor++] !==
        `mode ${file.parents.map((p) => p.mode).join(",")}..${file.result.mode}`
      )
        return null;
    } else if (file.parents.some((p) => p.mode !== file.result.mode))
      return null;
    if (
      !file.parents.every(() => lines[cursor++] === `--- a/${path}`) ||
      lines[cursor++] !== `+++ b/${path}`
    )
      return null;
    let remaining: number[] = [],
      hunks = 0,
      additions = 0,
      deletions = 0;
    let ends = Array.from({ length: n + 1 }, () => 0);
    for (; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (line.startsWith(`${"@".repeat(n + 1)} `)) {
        if (remaining.some((value) => value !== 0)) return null;
        const marker = "@".repeat(n + 1);
        const match = new RegExp(
          "^" +
            marker +
            " ((?:-\\d+(?:,\\d+)? ){" +
            n +
            "})\\+(\\d+)(?:,(\\d+))? " +
            marker +
            "(?:.*)$",
        ).exec(line);
        if (!match) return null;
        const ranges = [...match[1].matchAll(/-(\d+)(?:,(\d+))?/gu)].map(
          (m) => ({
            start: Number(m[1]),
            count: Number(m[2] ?? 1),
          }),
        );
        ranges.push({ start: Number(match[2]), count: Number(match[3] ?? 1) });
        if (
          ranges.length !== n + 1 ||
          ranges.some(
            (range, i) =>
              !Number.isSafeInteger(range.start) ||
              !Number.isSafeInteger(range.count) ||
              range.start < 0 ||
              range.count < 0 ||
              (range.count > 0 && range.start < 1) ||
              range.start < ends[i] ||
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
      if (!hunks || line.length < n) return null;
      const prefix = line.slice(0, n);
      if (
        !/^[ +-]+$/u.test(prefix) ||
        (prefix.includes("+") && prefix.includes("-"))
      )
        return null;
      const removed = prefix.includes("-");
      for (let i = 0; i < n; i++)
        if (removed ? prefix[i] === "-" : prefix[i] !== "+") remaining[i]--;
      if (!removed) remaining[n]--;
      if (remaining.some((value) => value < 0)) return null;
      if (prefix === "+".repeat(n)) additions++;
      if (prefix === "-".repeat(n)) deletions++;
    }
    if (
      !hunks ||
      remaining.some((value) => value !== 0) ||
      additions + deletions === 0
    )
      return null;
    counts.push({ path, additions, deletions });
  }
  return counts;
}
