import { valueBlobReader } from "./value-blob";
import type { EvidenceClient, FileChange } from "./value-evidence";
import {
  hasCompleteValuePatch,
  valueAdditionCount,
  valueDeletionCount,
  valuePatch,
} from "./value-patch";
import { readValueTree } from "./value-tree";

export interface AcceptedValueRange {
  headSha: string;
  mergeSha: string;
  parentSha: string;
  files: {
    path: string;
    blobSha: string | null;
    mode?: string;
    alreadyPresent: boolean;
  }[];
}

/** A stacked squash may omit dependency changes already in its parent. Prove
 * every submitted path survives unchanged, and every omitted change was already
 * present. Preserve both diffs: this proves acceptance, not separate credit.
 */
export async function collectAcceptedValueRange(
  client: EvidenceClient,
  repository: string,
  headSha: string,
  files: FileChange[],
  merge: { sha: string; parents: { sha: string }[]; files: FileChange[] },
): Promise<AcceptedValueRange | null> {
  if (
    merge.parents.length !== 1 ||
    ![headSha, merge.sha, merge.parents[0]?.sha].every((sha) =>
      /^[a-f0-9]{40}$/u.test(sha ?? ""),
    ) ||
    !files.length ||
    files.length > 256 ||
    !merge.files.length ||
    merge.files.length >= files.length ||
    new Set(files.map((file) => file.filename)).size !== files.length ||
    new Set(merge.files.map((file) => file.filename)).size !==
      merge.files.length ||
    files.some(
      (file) =>
        !["added", "modified", "removed"].includes(file.status) ||
        file.previous_filename !== undefined ||
        !hasCompleteValuePatch(file),
    )
  )
    return null;
  const changed = new Map(merge.files.map((file) => [file.filename, file]));
  let overlappingDependency = false;
  for (const accepted of merge.files) {
    const submitted = files.find((file) => file.filename === accepted.filename);
    if (
      !submitted ||
      accepted.previous_filename !== undefined ||
      accepted.status !== submitted.status ||
      !hasCompleteValuePatch(accepted)
    )
      return null;
    overlappingDependency ||=
      valueAdditionCount(accepted) !== valueAdditionCount(submitted) ||
      valueDeletionCount(accepted) !== valueDeletionCount(submitted) ||
      valuePatch(accepted) !== valuePatch(submitted);
  }
  const blob = valueBlobReader(client, repository);
  const proof: AcceptedValueRange = {
    headSha,
    mergeSha: merge.sha,
    parentSha: merge.parents[0].sha,
    files: [],
  };
  for (const { filename: path } of files) {
    if (
      !path ||
      path.length > 1024 ||
      path.includes("\\") ||
      [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      return null;
  }
  // An earlier dependency can also change the same path. In that case patch
  // equality is insufficient: bind the complete resulting file and mode.
  if (
    overlappingDependency ||
    files.length > 16 ||
    files.some((file) => file.status === "removed")
  ) {
    const head = await readValueTree(client, repository, headSha);
    const accepted = await readValueTree(client, repository, merge.sha);
    const parent = await readValueTree(client, repository, proof.parentSha);
    if (!head || !accepted || !parent) return null;
    for (const file of [...files].sort((a, b) =>
      a.filename.localeCompare(b.filename),
    )) {
      const path = file.filename;
      const before = head.get(path);
      const after = accepted.get(path);
      const prior = parent.get(path);
      const alreadyPresent = !changed.has(path);
      if (file.status === "removed") {
        if (before || after || (alreadyPresent && prior)) return null;
        proof.files.push({ path, blobSha: null, alreadyPresent });
      } else {
        if (
          !before ||
          !["100644", "100755"].includes(before.mode) ||
          after?.sha !== before.sha ||
          after.mode !== before.mode ||
          (alreadyPresent &&
            (prior?.sha !== before.sha || prior.mode !== before.mode))
        )
          return null;
        proof.files.push({
          path,
          blobSha: before.sha,
          mode: before.mode,
          alreadyPresent,
        });
      }
    }
    return proof;
  }
  for (const file of [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  )) {
    const path = file.filename;
    const head = await blob(path, headSha);
    if (head === null || (await blob(path, merge.sha)) !== head) return null;
    const alreadyPresent = !changed.has(path);
    if (alreadyPresent && (await blob(path, proof.parentSha)) !== head)
      return null;
    proof.files.push({ path, blobSha: head, alreadyPresent });
  }
  return proof;
}
