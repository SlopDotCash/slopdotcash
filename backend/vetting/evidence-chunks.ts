import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { R2Bucket } from "../trace/cloudflare-persistence";

/** Every upload, read and backup request handles at most one part this size. */
export const EVIDENCE_CHUNK_BYTES = 8 * 1024 * 1024;
/**
 * Where an evidence row's bytes live in R2: its content-addressed key for
 * `storage = 'content'`, otherwise its historical run-scoped `object_key`.
 */
export function evidenceLocation(row: {
  object_key: string;
  sha256: string;
  storage?: string | null;
}) {
  return row.storage === "content"
    ? evidenceObjectKey(row.sha256)
    : row.object_key;
}

/**
 * The content-addressed key of an evidence object registered since
 * 28 October 2026. Its bytes are verified against the digest before any
 * write is recorded, so one stored copy can serve every run that declares
 * the same digest. Earlier runs keep their run-scoped
 * `vetting/<assessment>/<run>/<sha256>` keys.
 */
export function evidenceObjectKey(sha256: string) {
  if (!/^[a-f0-9]{64}$/u.test(sha256))
    throw new Error("Invalid evidence object digest");
  return `vetting/objects/${sha256}`;
}
export type EvidenceChunk = {
  index: number;
  sha256: string;
  sizeBytes: number;
};

export function chunkLayout(value: unknown, size: number): EvidenceChunk[] {
  // No total size limit (owner decision, 28 October 2026); only each part is
  // bounded.
  if (
    size <= EVIDENCE_CHUNK_BYTES ||
    !Number.isSafeInteger(size) ||
    !Array.isArray(value) ||
    value.length !== Math.ceil(size / EVIDENCE_CHUNK_BYTES)
  )
    throw new Error("Invalid bounded evidence chunk layout");
  return value.map((part, index) => {
    if (
      !part ||
      typeof part !== "object" ||
      Object.keys(part).sort().join() !== "index,sha256,sizeBytes" ||
      part.index !== index ||
      typeof part.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(part.sha256) ||
      part.sizeBytes !==
        Math.min(EVIDENCE_CHUNK_BYTES, size - index * EVIDENCE_CHUNK_BYTES)
    )
      throw new Error("Invalid ordered evidence chunk");
    return { index, sha256: part.sha256, sizeBytes: part.sizeBytes };
  });
}

export function chunkKey(key: string, chunk: EvidenceChunk) {
  return `${key}/chunks/${chunk.index}/${chunk.sha256}`;
}

/** At most one bounded part is buffered; metadata is not byte-integrity proof. */
export async function verifiedPart(
  bucket: R2Bucket,
  key: string,
  digest: string,
  size: number,
): Promise<Uint8Array> {
  if (size > EVIDENCE_CHUNK_BYTES || size < 0)
    throw new Error("Evidence part exceeds bounded read size");
  const object = await bucket.get(key);
  if (!object)
    throw Object.assign(new Error("Declared evidence bytes are missing"), {
      status: 404,
      code: "evidence_missing",
    });
  if (object.size !== size || object.customMetadata?.sha256 !== digest)
    throw Object.assign(new Error("Evidence metadata changed"), {
      status: 409,
      code: "evidence_corrupt",
    });
  const result = new Uint8Array(size);
  const reader = object.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size) {
        await reader.cancel();
        throw Object.assign(new Error("Evidence length changed"), {
          status: 409,
          code: "evidence_corrupt",
        });
      }
      result.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== size || bytesToHex(sha256(result)) !== digest)
    throw Object.assign(new Error("Evidence bytes changed"), {
      status: 409,
      code: "evidence_corrupt",
    });
  return result;
}

/** Whole-file integrity is the SHA of ordered original bytes, never part hashes. */
export async function verifyParts(
  bucket: R2Bucket,
  key: string,
  chunks: EvidenceChunk[],
  digest: string,
) {
  const hash = sha256.create();
  try {
    for (const chunk of chunks)
      hash.update(
        await verifiedPart(
          bucket,
          chunkKey(key, chunk),
          chunk.sha256,
          chunk.sizeBytes,
        ),
      );
    if (bytesToHex(hash.digest()) !== digest)
      throw Object.assign(new Error("Complete evidence digest changed"), {
        status: 409,
        code: "evidence_corrupt",
      });
  } finally {
    hash.destroy();
  }
}
