import { bytesToHex } from "../../src/lib/byte-encoding";

/** The Git object id (SHA-1 hex) of `content` stored as a `type` object. */
export async function gitObjectSha1(
  type: "blob" | "tree",
  content: Uint8Array,
): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const object = new Uint8Array(header.length + content.length);
  object.set(header);
  object.set(content, header.length);
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-1", object)),
  );
}
