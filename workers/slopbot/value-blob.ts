import type { EvidenceClient } from "./value-evidence-types";

/** Bounded immutable Git blob verification shared by acceptance proofs. */
export function valueFileReader(client: EvidenceClient, repository: string) {
  let reads = 0;
  let totalBytes = 0;
  return async (
    path: string,
    ref: string,
  ): Promise<{ sha: string; bytes: Uint8Array } | null> => {
    if (
      !/^[a-f0-9]{40}$/u.test(ref) ||
      !path ||
      path.length > 1024 ||
      path.includes("\\") ||
      [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      path.split("/").some((p) => !p || p === "." || p === "..")
    )
      return null;
    if (++reads > 48) return null;
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const file = await client.get<{
      type: string;
      encoding: string;
      content?: string;
      size: number;
      sha: string;
    }>(`/repos/${repository}/contents/${encoded}?ref=${ref}`);
    if (
      file?.type !== "file" ||
      file.encoding !== "base64" ||
      typeof file.content !== "string" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 512 * 1024 ||
      !/^[a-f0-9]{40}$/u.test(file.sha)
    )
      return null;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(file.content.replace(/\s+/gu, "")), (c) =>
        c.charCodeAt(0),
      );
    } catch {
      return null;
    }
    totalBytes += bytes.length;
    if (bytes.length !== file.size || totalBytes > 2 * 1024 * 1024) return null;
    const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const object = new Uint8Array(prefix.length + bytes.length);
    object.set(prefix);
    object.set(bytes, prefix.length);
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-1", object)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return digest === file.sha ? { sha: digest, bytes } : null;
  };
}

export function valueBlobReader(client: EvidenceClient, repository: string) {
  const read = valueFileReader(client, repository);
  return async (path: string, ref: string): Promise<string | null> =>
    (await read(path, ref))?.sha ?? null;
}
