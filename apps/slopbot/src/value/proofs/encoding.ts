// spec/slopbot/valueEvidence.md, "A blob, tree or binary claim counts only when its git object hash matches the bytes read"
import { sha256Of } from "@repo/platform/git/bytes";

/** @throws {never} */
export function base64Bytes(text: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function base64Text(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** @throws {never} */
export function contentsPath(repository: string, path: string, ref: string): string | undefined {
  try {
    return `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function withoutWhitespace(text: string): string {
  return text.replace(/\s+/gu, "");
}

/** @throws {never} */
export function isGitLfsPointer(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 80)).startsWith("version https://git-lfs.github.com/spec/");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const pullResponse = /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+(?:\?|$)/u;

/** @throws {never} */
export function responseSignature(path: string, result: unknown): string {
  const pull = pullResponse.test(path);
  const head = pull && typeof result === "object" && result !== null ? (result as { readonly head?: unknown }).head : undefined;
  const base = pull && typeof result === "object" && result !== null ? (result as { readonly base?: unknown }).base : undefined;
  const kept = JSON.stringify(result, function (this: unknown, key: string, value: unknown) {
    if (!pull) return value;
    if (this === result && key === "milestone") return undefined;
    if (key === "repo" && (this === head || this === base)) return undefined;
    return value;
  });
  return sha256Of(canonicalJson(kept === undefined ? null : JSON.parse(kept)));
}

/** @throws {never} */
export async function gunzipped(compressed: Uint8Array, size: number): Promise<Uint8Array | undefined> {
  try {
    const reader = new Blob([compressed.slice()]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const bytes = new Uint8Array(size);
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > size) {
        await reader.cancel();
        return undefined;
      }
      bytes.set(value, length);
      length += value.length;
    }
    return length === size ? bytes : undefined;
  } catch {
    return undefined;
  }
}
