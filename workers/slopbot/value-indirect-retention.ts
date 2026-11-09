import { valueFileReader } from "./value-blob";
import type {
  EvidenceClient,
  FileChange,
  IndirectRetainedFile,
  TextVersion,
} from "./value-evidence-types";
import { readValueTree } from "./value-tree";

/** Compare complete immutable texts at the submitted historical head and the
 * observed integration tip. A verified tree proves absence; HTTP 404 does not.
 * Renames follow GitHub's full comparison, never a guessed filename rewrite.
 */
export async function collectIndirectValueRetention(
  client: EvidenceClient,
  repository: string,
  historicalHeadSha: string,
  acceptedTipSha: string,
  files: FileChange[],
): Promise<IndirectRetainedFile[] | null> {
  if (
    !files.length ||
    files.length > 256 ||
    new Set(files.map((f) => f.filename)).size !== files.length
  )
    return null;
  const comparison = await client.get<{
    status: string;
    merge_base_commit: { sha: string };
    files: { filename: string; previous_filename?: string; status: string }[];
  }>(
    `/repos/${repository}/compare/${historicalHeadSha}...${acceptedTipSha}?per_page=1`,
  );
  // GitHub caps comparison file lists at 300. A saturated result cannot prove
  // that an absent rename is a deletion, even when commit pagination continues.
  if (
    !comparison ||
    !["ahead", "identical"].includes(comparison.status) ||
    comparison.merge_base_commit?.sha !== historicalHeadSha ||
    !Array.isArray(comparison.files) ||
    comparison.files.length >= 300
  )
    return null;
  const renames = new Map<string, string>();
  for (const file of comparison.files) {
    if (file.status !== "renamed") continue;
    if (!file.previous_filename || renames.has(file.previous_filename))
      return null;
    renames.set(file.previous_filename, file.filename);
  }
  const historical = await readValueTree(client, repository, historicalHeadSha);
  const accepted = await readValueTree(client, repository, acceptedTipSha);
  if (!historical || !accepted) return null;
  const read = valueFileReader(client, repository);
  const texts = new Map<string, string>();
  async function version(
    tree: NonNullable<typeof historical>,
    path: string,
    ref: string,
  ): Promise<TextVersion | null | undefined> {
    const entry = tree.get(path);
    if (!entry) return null;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      return undefined;
    let text = texts.get(entry.sha);
    if (text === undefined) {
      const file = await read(path, ref);
      if (!file || file.sha !== entry.sha) return undefined;
      try {
        text = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(file.bytes);
      } catch {
        return undefined;
      }
      if (text.includes("\0")) return undefined;
      texts.set(entry.sha, text);
    }
    return { blobSha: entry.sha, mode: entry.mode, text };
  }
  const result: IndirectRetainedFile[] = [];
  for (const file of [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  )) {
    const sourcePath = file.filename,
      acceptedPath = renames.get(sourcePath) ?? sourcePath;
    const before = await version(historical, sourcePath, historicalHeadSha);
    const after = await version(accepted, acceptedPath, acceptedTipSha);
    if (
      before === undefined ||
      after === undefined ||
      (before === null && file.status !== "removed")
    )
      return null;
    // A rename claim must lead to an existing regular file in the accepted tree.
    if (renames.has(sourcePath) && after === null) return null;
    result.push({
      sourcePath,
      acceptedPath,
      historical: before,
      accepted: after,
    });
  }
  return result;
}
