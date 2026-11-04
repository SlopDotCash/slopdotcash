import type { EvidenceClient, FileChange } from "./value-evidence";
import { readValueTree } from "./value-tree";

export interface AcceptedDirectMerge {
  headSha: string;
  mergeSha: string;
  parentSha: string;
  files: {
    path: string;
    blobSha: string | null;
    mode?: string;
  }[];
}

/** A direct (2-parent) merge used to pass with no proof at all: the merge
 * commit was trusted to contain the whole PR head. A maintainer resolving a
 * conflict in favour of the base side can drop or rewrite a submitted file,
 * and the merge tree then no longer contains that file's head blob. Prove
 * every submitted path against the merge tree itself, recording the
 * non-head parent as the base: an added or modified path must carry the head blob
 * and mode in the merge tree, and a removed path must be absent from both
 * the head tree and the merge tree. The hash-verified tree read proves
 * absence as well as presence, so a dropped file cannot pass silently.
 * Anything unproven returns null, and the caller records the same
 * limitation a partial squash receives. Binary paths pass on blob identity
 * here; their separate added-binary proof still applies. An empty
 * submitted file list proves vacuously: a no-change promotion claims no
 * file, and its own promotion proof governs it.
 */
export async function collectAcceptedDirectMerge(
  client: EvidenceClient,
  repository: string,
  headSha: string,
  files: FileChange[],
  merge: { sha: string; parents: { sha: string }[] },
): Promise<AcceptedDirectMerge | null> {
  const oid = /^[a-f0-9]{40}$/u;
  if (
    merge.parents.length !== 2 ||
    !oid.test(headSha) ||
    !oid.test(merge.sha) ||
    files.length > 256 ||
    new Set(files.map((file) => file.filename)).size !== files.length
  )
    return null;
  const other = merge.parents.filter((parent) => parent.sha !== headSha);
  if (
    other.length !== 1 ||
    !merge.parents.some((parent) => parent.sha === headSha) ||
    !oid.test(other[0].sha)
  )
    return null;
  const parentSha = other[0].sha;
  for (const file of files) {
    if (
      !["added", "modified", "removed"].includes(file.status) ||
      file.previous_filename !== undefined ||
      !file.filename ||
      file.filename.length > 1024 ||
      file.filename.includes("\\") ||
      [...file.filename].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ) ||
      file.filename
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      return null;
  }
  const head = await readValueTree(client, repository, headSha);
  const accepted = await readValueTree(client, repository, merge.sha);
  if (!head || !accepted) return null;
  const proof: AcceptedDirectMerge = {
    headSha,
    mergeSha: merge.sha,
    parentSha,
    files: [],
  };
  for (const file of [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  )) {
    const path = file.filename;
    const before = head.get(path);
    const after = accepted.get(path);
    if (file.status === "removed") {
      if (before || after) return null;
      proof.files.push({ path, blobSha: null });
    } else {
      if (
        !before ||
        !["100644", "100755"].includes(before.mode) ||
        !after ||
        after.sha !== before.sha ||
        after.mode !== before.mode
      )
        return null;
      proof.files.push({
        path,
        blobSha: before.sha,
        mode: before.mode,
      });
    }
  }
  return proof;
}
