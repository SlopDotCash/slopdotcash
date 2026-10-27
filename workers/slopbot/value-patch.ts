import type { EvidenceClient, FileChange } from "./value-evidence";

function addedLines(file: FileChange): string[] | null {
  if (
    file.status !== "added" ||
    file.previous_filename !== undefined ||
    file.additions !== 0 ||
    file.deletions !== 0 ||
    file.patch !== undefined ||
    !file.addedComparison
  )
    return null;
  const text = file.addedComparison.after.text;
  const lines = text === "" ? [] : text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

export function valueAdditionCount(file: FileChange): number {
  return addedLines(file)?.length ?? file.additions;
}

/** Derived deletion evidence does not overwrite GitHub's reported counts or patch. */
function removedLines(file: FileChange): string[] | null {
  if (
    file.status !== "removed" ||
    file.previous_filename !== undefined ||
    file.additions !== 0 ||
    !file.removedComparison
  )
    return null;
  const text = file.removedComparison.before.text;
  const lines = text === "" ? [] : text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}
export function valueDeletionCount(file: FileChange): number {
  return removedLines(file)?.length ?? file.deletions;
}
export function valuePatch(file: FileChange): string | undefined {
  const additions = addedLines(file);
  if (additions !== null) {
    if (additions.length === 0) return "";
    return (
      `@@ -0,0 +1${additions.length === 1 ? "" : `,${additions.length}`} @@\n` +
      additions.map((line) => `+${line}`).join("\n") +
      (file.addedComparison?.after.text.endsWith("\n")
        ? ""
        : "\n\\ No newline at end of file")
    );
  }
  const lines = removedLines(file);
  if (lines === null) return file.patch;
  if (lines.length === 0) return "";
  return (
    `@@ -1${lines.length === 1 ? "" : `,${lines.length}`} +0,0 @@\n` +
    lines.map((line) => `-${line}`).join("\n") +
    (file.removedComparison?.before.text.endsWith("\n")
      ? ""
      : "\n\\ No newline at end of file")
  );
}

export function hasCompleteValuePatch(file: FileChange): boolean {
  const patch = valuePatch(file);
  const lines = patch?.split("\n") ?? [];
  return (
    patch !== undefined &&
    lines.filter((line) => line.startsWith("+")).length ===
      valueAdditionCount(file) &&
    lines.filter((line) => line.startsWith("-")).length ===
      valueDeletionCount(file)
  );
}

/** An added text file has a complete diff from the empty file. Recover only
 * when immutable Git bytes and GitHub's line counts agree. Other missing
 * patches retain their limitation; a file digest alone is not full evidence.
 */
export function addedValuePatchRecovery(
  client: EvidenceClient,
  repository: string,
) {
  let reads = 0;
  let totalBytes = 0;
  const patches = new Map<
    string,
    { patch: string; additions: number } | null
  >();
  return async (files: FileChange[], ref: string) => {
    if (!/^[a-f0-9]{40}$/u.test(ref)) return;
    for (const file of files) {
      if (
        hasCompleteValuePatch(file) ||
        file.status !== "added" ||
        file.deletions !== 0 ||
        !Number.isSafeInteger(file.additions) ||
        file.additions < 0
      )
        continue;
      const path = file.filename;
      if (
        !path ||
        path.length > 1024 ||
        path.includes("\\") ||
        [...path].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        continue;
      const key = JSON.stringify([ref, path]);
      if (!patches.has(key)) {
        if (reads >= 16 || totalBytes >= 2 * 1024 * 1024) continue;
        reads++;
        const encoded = path.split("/").map(encodeURIComponent).join("/");
        const source = await client.get<{
          type: string;
          encoding: string;
          content?: string;
          size: number;
          sha: string;
        }>(`/repos/${repository}/contents/${encoded}?ref=${ref}`);
        patches.set(key, null);
        if (
          source?.type !== "file" ||
          source.encoding !== "base64" ||
          typeof source.content !== "string" ||
          !Number.isSafeInteger(source.size) ||
          source.size < 0 ||
          source.size > 2 * 1024 * 1024 - totalBytes ||
          !/^[a-f0-9]{40}$/u.test(source.sha)
        )
          continue;
        let bytes: Uint8Array;
        let text: string;
        try {
          bytes = Uint8Array.from(
            atob(source.content.replace(/\s+/gu, "")),
            (c) => c.charCodeAt(0),
          );
          totalBytes += bytes.length;
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
        } catch {
          continue;
        }
        if (
          bytes.length !== source.size ||
          totalBytes > 2 * 1024 * 1024 ||
          text.includes("\0")
        )
          continue;
        const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
        const object = new Uint8Array(prefix.length + bytes.length);
        object.set(prefix);
        object.set(bytes, prefix.length);
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-1", object)),
        ]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        if (digest !== source.sha) continue;
        const lines = text === "" ? [] : text.split("\n");
        if (text.endsWith("\n")) lines.pop();
        const patch =
          lines.length === 0
            ? ""
            : `@@ -0,0 +1${lines.length === 1 ? "" : `,${lines.length}`} @@\n` +
              lines.map((line) => `+${line}`).join("\n") +
              (text.endsWith("\n") ? "" : "\n\\ No newline at end of file");
        patches.set(key, { patch, additions: lines.length });
      }
      const recovered = patches.get(key);
      if (recovered?.additions === file.additions) file.patch = recovered.patch;
    }
  };
}
