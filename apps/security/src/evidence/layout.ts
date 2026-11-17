// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"
import { chunked, partCount, partSize, slotAccepted } from "./chunks.ts";

export const partBytes = 8 * 1024 * 1024;

export interface EvidenceChunk {
  readonly index: number;
  readonly sha256: string;
  readonly sizeBytes: number;
}

const hex = /^[a-f0-9]{64}$/u;
const width = BigInt(partBytes);

/** @throws {never} */
export function isDigest(value: unknown): value is string {
  return typeof value === "string" && hex.test(value);
}

/** @throws {never} */
function isChunked(size: number): boolean {
  return Number.isSafeInteger(size) && chunked(BigInt(size), width);
}

/** @throws {never} */
export function chunkLayout(value: unknown, size: number): ReadonlyArray<EvidenceChunk> | undefined {
  if (!isChunked(size) || !Array.isArray(value) || BigInt(value.length) !== partCount(BigInt(size), width)) return undefined;
  const parts: EvidenceChunk[] = [];
  for (const [index, part] of value.entries()) {
    if (part === null || typeof part !== "object" || Object.keys(part).sort().join() !== "index,sha256,sizeBytes") return undefined;
    const fields = part as Record<string, unknown>;
    if (fields.index !== index || !isDigest(fields.sha256) || fields.sizeBytes !== Number(partSize(BigInt(size), width, BigInt(index)))) return undefined;
    parts.push({ index, sha256: fields.sha256, sizeBytes: fields.sizeBytes });
  }
  return parts;
}

/** @throws {never} */
export function storedLayout(text: string | null, size: number): ReadonlyArray<EvidenceChunk> | null | undefined {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return chunkLayout(parsed, size);
}

/** @throws {never} */
export function boundedSlot(index: number, size: number): boolean {
  return Number.isSafeInteger(index) && Number.isSafeInteger(size) && slotAccepted(BigInt(index), BigInt(size), width);
}
