/** Local Git reconstruction, bound to the collected immutable merge parents.
 * This is scope evidence, never a finding that a resolution deserves credit.
 */
import { sha256Hex } from "../../src/lib/sha256";
import type {
  ValueEvidence,
  ValueMergeResolution,
} from "./value-evidence-types";
import { MERGE_GIT_VERSION } from "./value-merge-profile";

export function mergeResolutionMatches(
  resolution: ValueMergeResolution,
  commit: Pick<ValueEvidence["commits"][number], "sha" | "parents">,
): boolean {
  const sha = /^[a-f0-9]{40}$/u;
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
