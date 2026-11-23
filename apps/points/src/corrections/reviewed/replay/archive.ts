// spec/points/assessmentAudit.md, "A replay qualifies only an exact merged scope, and its private review is staged only on request after exact readback"
import { brotliCompressSync, inflateRawSync } from "node:zlib";

const endOfDirectory = 0x06054b50;
const directoryEntry = 0x02014b50;
const localEntry = 0x04034b50;
const regularFile = 0o100000;
const fileType = 0o170000;

/** @throws {never} */
export function brotliBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(brotliCompressSync(bytes));
}

/** @throws {never} */
export function onlyZipEntry(archive: Uint8Array, name: string, limit: number): Uint8Array | null {
  try {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const end = archive.length - 22;
    if (end < 0 || view.getUint32(end, true) !== endOfDirectory || view.getUint16(end + 20, true) !== 0) return null;
    if (view.getUint16(end + 8, true) !== 1 || view.getUint16(end + 10, true) !== 1) return null;
    const directory = view.getUint32(end + 16, true);
    if (view.getUint32(directory, true) !== directoryEntry) return null;
    const method = view.getUint16(directory + 10, true);
    const compressed = view.getUint32(directory + 20, true);
    const size = view.getUint32(directory + 24, true);
    const nameLength = view.getUint16(directory + 28, true);
    const mode = view.getUint32(directory + 38, true) >>> 16;
    const local = view.getUint32(directory + 42, true);
    const entryName = new TextDecoder("utf-8", { fatal: true }).decode(archive.subarray(directory + 46, directory + 46 + nameLength));
    if (entryName !== name || ((mode & fileType) !== 0 && (mode & fileType) !== regularFile) || size === 0 || size > limit) return null;
    if (view.getUint32(local, true) !== localEntry) return null;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = archive.subarray(start, start + compressed);
    if (data.length !== compressed) return null;
    const content = method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data, { maxOutputLength: limit + 1 })) : null;
    return content !== null && content.length === size ? new Uint8Array(content) : null;
  } catch {
    return null;
  }
}

/** @throws {never} */
export function base64Text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
