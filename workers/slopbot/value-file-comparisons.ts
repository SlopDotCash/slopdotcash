import { valueBlobReader, valueFileReader } from "./value-blob";
import type { EvidenceClient, FileChange } from "./value-evidence";
import { hasCompleteValuePatch } from "./value-patch";
import { readValueTree } from "./value-tree";

/** GitHub omits patches for pure renames. Counts alone are insufficient: bind
 * both paths and refs to identical verified Git bytes before admitting one. */
export async function recoverUnchangedValueRenames(
  client: EvidenceClient,
  repository: string,
  files: FileChange[],
  baseSha: string,
  headSha: string,
): Promise<void> {
  const blob = valueBlobReader(client, repository);
  for (const file of files) {
    if (
      file.status !== "renamed" ||
      file.patch !== undefined ||
      file.additions !== 0 ||
      file.deletions !== 0 ||
      !file.previous_filename ||
      file.previous_filename === file.filename
    )
      continue;
    const before = await blob(file.previous_filename, baseSha);
    if (before === null || (await blob(file.filename, headSha)) !== before)
      continue;
    file.unchangedRename = { baseSha, headSha, blobSha: before };
    file.patch = "";
  }
}

export function needsFullValueComparison(file: FileChange): boolean {
  if (file.status === "renamed")
    return (
      typeof file.previous_filename === "string" &&
      file.previous_filename !== file.filename &&
      !hasCompleteValuePatch(file)
    );
  return (
    file.status === "modified" &&
    file.previous_filename === undefined &&
    (!hasCompleteValuePatch(file) ||
      /(^|\/)package\.json$/u.test(file.filename))
  );
}

/** Preserve complete texts for missing patches and reordered package manifests.
 * This is explicit comparison evidence, not a manufactured unified diff. */
export async function recoverFullValueComparisons(
  client: EvidenceClient,
  repository: string,
  files: FileChange[],
  baseSha: string,
  headSha: string,
): Promise<void> {
  const read = valueFileReader(client, repository);
  for (const file of files) {
    if (!needsFullValueComparison(file)) continue;
    const before = await read(file.previous_filename ?? file.filename, baseSha);
    if (!before) continue;
    const after = await read(file.filename, headSha);
    if (!after) continue;
    // Leave identical renames to the existing unchanged-rename proof.
    if (file.status === "renamed" && before.sha === after.sha) continue;
    try {
      const decoder = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      });
      const beforeText = decoder.decode(before.bytes);
      const afterText = decoder.decode(after.bytes);
      if (beforeText.includes("\0") || afterText.includes("\0")) continue;
      file.fullComparison = {
        baseSha,
        headSha,
        before: { blobSha: before.sha, text: beforeText },
        after: { blobSha: after.sha, text: afterText },
      };
    } catch {
      // Invalid UTF-8 remains an explicit missing-diff limitation.
    }
  }
}

export function needsRemovedValueComparison(file: FileChange): boolean {
  return (
    file.status === "removed" &&
    file.previous_filename === undefined &&
    file.additions === 0 &&
    !hasCompleteValuePatch(file)
  );
}

/** A verified parent blob plus a complete accepted tree proves a text deletion.
 * Keep this proof separate from potentially omitted GitHub diff/count fields. */
export async function recoverRemovedValueComparisons(
  client: EvidenceClient,
  repository: string,
  files: FileChange[],
  baseSha: string,
  headSha: string,
): Promise<void> {
  const missing = files.filter(needsRemovedValueComparison);
  if (missing.length === 0) return;
  const before = await readValueTree(client, repository, baseSha);
  const after = await readValueTree(client, repository, headSha);
  if (!before || !after) return;
  const read = valueFileReader(client, repository);
  for (const file of missing) {
    const entry = before.get(file.filename);
    if (
      entry?.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode) ||
      after.has(file.filename)
    )
      continue;
    const blob = await read(file.filename, baseSha);
    if (!blob || blob.sha !== entry.sha) continue;
    try {
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(blob.bytes);
      if (text.includes("\0")) continue;
      file.removedComparison = {
        baseSha,
        headSha,
        before: { blobSha: blob.sha, text },
      };
    } catch {
      // Binary or invalid UTF-8 remains an explicit evidence gap.
    }
  }
}
