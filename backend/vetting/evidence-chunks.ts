import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  partitionCount,
  partitionSize,
} from "../../src/lib/verified-partition";
import type { R2Bucket } from "../trace/cloudflare-persistence";

/** Every upload, read and backup request handles at most one part this size. */
export const EVIDENCE_CHUNK_BYTES = 8 * 1024 * 1024;
export const EVIDENCE_RETIREMENT_METADATA_KEY = "evidenceRetirement";
export const EVIDENCE_RETIREMENT_METADATA_VALUE = "v1";
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

/** Only our verified read may bind corruption to the observed R2 ETag. */
export class EvidenceCorruptionError extends Error {
  readonly status = 409;
  readonly code = "evidence_corrupt";
  readonly observedEtag: string | undefined;

  constructor(message: string, etag: unknown) {
    super(message);
    this.observedEtag =
      typeof etag === "string" && etag.length > 0 ? etag : undefined;
  }
}

export function chunkLayout(value: unknown, size: number): EvidenceChunk[] {
  // No total size limit (owner decision, 28 October 2026); only each part is
  // bounded.
  if (
    size <= EVIDENCE_CHUNK_BYTES ||
    !Number.isSafeInteger(size) ||
    !Array.isArray(value) ||
    value.length !==
      Number(partitionCount(BigInt(size), BigInt(EVIDENCE_CHUNK_BYTES)))
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
        Number(
          partitionSize(
            BigInt(size),
            BigInt(EVIDENCE_CHUNK_BYTES),
            BigInt(index),
          ),
        )
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
  allowRetirementMarker = false,
): Promise<Uint8Array> {
  if (size > EVIDENCE_CHUNK_BYTES || size < 0)
    throw new Error("Evidence part exceeds bounded read size");
  const object = await bucket.get(key);
  if (!object)
    throw Object.assign(new Error("Declared evidence bytes are missing"), {
      status: 404,
      code: "evidence_missing",
    });
  const reader = object.body.getReader();
  try {
    if (
      !allowRetirementMarker &&
      object.customMetadata?.[EVIDENCE_RETIREMENT_METADATA_KEY] ===
        EVIDENCE_RETIREMENT_METADATA_VALUE
    )
      throw Object.assign(new Error("Evidence target has retired"), {
        status: 410,
        code: "evidence_retired",
      });
    if (object.size !== size || object.customMetadata?.sha256 !== digest)
      throw new EvidenceCorruptionError(
        "Evidence metadata changed",
        object.etag,
      );
    const result = new Uint8Array(size);
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size)
        throw new EvidenceCorruptionError(
          "Evidence length changed",
          object.etag,
        );
      result.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== size || bytesToHex(sha256(result)) !== digest)
      throw new EvidenceCorruptionError("Evidence bytes changed", object.etag);
    return result;
  } catch (error) {
    // Rejecting metadata or a body must relinquish the acquired R2 stream.
    // Cleanup failure cannot replace the read/integrity error that caused it.
    try {
      await reader.cancel();
    } catch {
      // error-policy:J3 preserve the primary evidence refusal.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Back up the actual bounded R2 body even if its declared evidence digest is
 * wrong. The returned digest describes observed bytes, never scan clearance.
 */
export async function observedPart(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object)
    throw Object.assign(new Error("Evidence backup source is missing"), {
      status: 404,
      code: "evidence_missing",
    });
  const reader = object.body.getReader();
  try {
    if (
      object.customMetadata?.[EVIDENCE_RETIREMENT_METADATA_KEY] ===
      EVIDENCE_RETIREMENT_METADATA_VALUE
    )
      throw Object.assign(new Error("Evidence target has retired"), {
        status: 410,
        code: "evidence_retired",
      });
    if (
      !Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.size > EVIDENCE_CHUNK_BYTES
    )
      throw new Error("Evidence backup source exceeds bounded part size");
    const bytes = new Uint8Array(object.size);
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength)
        throw new Error("Evidence backup source length changed");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== bytes.byteLength)
      throw new Error("Evidence backup source length changed");
    return {
      bytes,
      sha256: bytesToHex(sha256(bytes)),
      sizeBytes: bytes.byteLength,
    };
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* error-policy:J3 preserve the original backup refusal. */
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Whole-file integrity is the SHA of ordered original bytes, never part hashes. */
export async function verifyParts(
  bucket: R2Bucket,
  key: string,
  chunks: EvidenceChunk[],
  digest: string,
) {
  return verifyPartSequence(chunks, digest, (chunk) =>
    verifiedPart(bucket, chunkKey(key, chunk), chunk.sha256, chunk.sizeBytes),
  );
}

/** Resolve each current part independently, while retaining ordered whole hashing. */
export async function verifyPartSequence(
  chunks: EvidenceChunk[],
  digest: string,
  read: (chunk: EvidenceChunk) => Promise<Uint8Array>,
) {
  const hash = sha256.create();
  try {
    for (const chunk of chunks) hash.update(await read(chunk));
    if (bytesToHex(hash.digest()) !== digest)
      throw Object.assign(new Error("Complete evidence digest changed"), {
        status: 409,
        code: "evidence_corrupt",
      });
  } finally {
    hash.destroy();
  }
}
