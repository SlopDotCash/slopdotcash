/** Local Git reconstruction, bound to the collected immutable merge parents.
 * This is scope evidence, never a finding that a resolution deserves credit.
 */
import type {
  ValueEvidence,
  ValueMergeResolution,
} from "./value-evidence-types";

export function mergeResolutionMatches(
  resolution: ValueMergeResolution,
  commit: ValueEvidence["commits"][number],
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
