/** Immutable physical targets beneath a run's recorded content generation. */
import { fail } from "../http";
import type { ProjectD1Database } from "../projects/cloudflare-persistence";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import {
  chunkKey,
  EVIDENCE_CHUNK_BYTES,
  type EvidenceChunk,
  EvidenceCorruptionError,
  evidenceLocation,
  verifiedPart,
} from "./evidence-chunks";

export {
  EVIDENCE_RETIREMENT_METADATA_KEY,
  EVIDENCE_RETIREMENT_METADATA_VALUE,
} from "./evidence-chunks";

const ID = /^[A-Za-z0-9_-]{1,100}$/u;
const SHA = /^[a-f0-9]{64}$/u;

export type EvidenceStorageRow = {
  object_key: string;
  sha256: string;
  size_bytes: number;
  storage?: string | null;
  storage_generation?: string | null;
};
type Slot = { index: number; sha: string; size: number };
type Target = {
  target_key: string;
  generation_id: string;
  part_index: number;
  sha256: string;
  size_bytes: number;
};

export function generationTargetKey(generation: string, target: string) {
  if (!ID.test(generation) || !ID.test(target))
    fail(409, "evidence_corrupt", "Invalid evidence target identity");
  return `vetting/generations/${generation}/${target}`;
}

export function evidenceRetirementBytes(targetKey: string) {
  if (
    !/^vetting\/generations\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/u.test(
      targetKey,
    )
  )
    fail(409, "evidence_corrupt", "Invalid evidence retirement target");
  return new TextEncoder().encode(
    JSON.stringify({ schemaVersion: "slop-evidence-retirement-v1", targetKey }),
  );
}

function generationOf(row: EvidenceStorageRow) {
  const generation = row.storage_generation;
  if (generation === undefined || generation === null) return null;
  if (row.storage !== "content" || !ID.test(generation))
    fail(409, "evidence_corrupt", "Invalid evidence generation binding");
  return generation;
}

function slotOf(row: EvidenceStorageRow, part?: EvidenceChunk): Slot {
  const slot = {
    index: part?.index ?? -1,
    sha: part?.sha256 ?? row.sha256,
    size: part?.sizeBytes ?? row.size_bytes,
  };
  if (
    !SHA.test(row.sha256) ||
    !SHA.test(slot.sha) ||
    !Number.isSafeInteger(slot.index) ||
    slot.index < -1 ||
    !Number.isSafeInteger(slot.size) ||
    slot.size < 0 ||
    slot.size > EVIDENCE_CHUNK_BYTES
  )
    fail(409, "evidence_corrupt", "Invalid bounded evidence target");
  return slot;
}

/**
 * Each reserved target is permanent history, including failed or uncertain
 * writes. A repair selects fresh storage; it never replaces an old R2 object.
 * Callers verify the incoming body's digest before invoking storePart.
 */
export class EvidenceStorage {
  constructor(
    private readonly db: ProjectD1Database,
    private readonly bucket: R2Bucket,
    private readonly now: () => Date,
    private readonly randomId: () => string,
  ) {}

  registrationStatements(sha: string, at: string) {
    const id = this.randomId();
    if (!SHA.test(sha) || !ID.test(id))
      fail(409, "evidence_corrupt", "Invalid evidence generation identity");
    return [
      this.db
        .prepare(
          "INSERT INTO vetting_evidence_generations(id,sha256,state,created_at) SELECT ?,?,'active',? WHERE NOT EXISTS (SELECT 1 FROM vetting_evidence_generations WHERE sha256=? AND state='active')",
        )
        .bind(id, sha, at, sha),
    ];
  }

  private async active(generation: string, sha: string) {
    const row = await this.db
      .prepare(
        "SELECT state FROM vetting_evidence_generations WHERE id=? AND sha256=?",
      )
      .bind(generation, sha)
      .first<{ state: string }>();
    if (!row || row.state !== "active")
      fail(
        410,
        "evidence_retired",
        "Evidence generation is retiring or retired",
      );
  }

  async partKey(
    row: EvidenceStorageRow,
    part?: EvidenceChunk,
  ): Promise<string | null> {
    const generation = generationOf(row);
    if (generation === null) {
      const root = evidenceLocation(row);
      return part ? chunkKey(root, part) : root;
    }
    const slot = slotOf(row, part);
    const head = await this.db
      .prepare(
        `SELECT h.target_key FROM vetting_evidence_heads h
       JOIN vetting_evidence_targets t ON t.target_key=h.target_key
       JOIN vetting_evidence_generations g ON g.id=h.generation_id
       WHERE h.generation_id=? AND h.part_index=? AND h.sha256=? AND h.size_bytes=?
         AND g.sha256=? AND t.generation_id=h.generation_id
         AND t.part_index=h.part_index AND t.sha256=h.sha256 AND t.size_bytes=h.size_bytes`,
      )
      .bind(generation, slot.index, slot.sha, slot.size, row.sha256)
      .first<{ target_key: string }>();
    if (!head) return null;
    const prefix = `vetting/generations/${generation}/`;
    if (
      !head.target_key.startsWith(prefix) ||
      !ID.test(head.target_key.slice(prefix.length))
    )
      fail(409, "evidence_corrupt", "Invalid selected evidence target");
    return head.target_key;
  }

  async readPart(row: EvidenceStorageRow, part?: EvidenceChunk) {
    const slot = slotOf(row, part);
    const key = await this.partKey(row, part);
    if (key === null)
      fail(404, "evidence_missing", "Declared evidence bytes are missing");
    return verifiedPart(this.bucket, key, slot.sha, slot.size);
  }

  private async reserve(generation: string, slot: Slot) {
    const key = generationTargetKey(generation, this.randomId());
    let failure: unknown;
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO vetting_evidence_targets(target_key,generation_id,part_index,sha256,size_bytes,created_at)
         SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM vetting_evidence_generations WHERE id=? AND state='active')`,
        )
        .bind(
          key,
          generation,
          slot.index,
          slot.sha,
          slot.size,
          this.now().toISOString(),
          generation,
        )
        .run();
      if (!result.success)
        failure = new Error("Evidence target reservation failed");
    } catch (error) {
      failure = error;
    }
    // A database reply can be lost after committing. Read the exact reservation;
    // a different tuple at the same identifier is never adopted or overwritten.
    const saved = await this.db
      .prepare(
        "SELECT target_key,generation_id,part_index,sha256,size_bytes FROM vetting_evidence_targets WHERE target_key=?",
      )
      .bind(key)
      .first<Target>();
    if (!saved) {
      if (failure !== undefined) throw failure;
      fail(
        410,
        "evidence_retired",
        "Evidence generation no longer accepts writes",
      );
    }
    if (
      saved.generation_id !== generation ||
      saved.part_index !== slot.index ||
      saved.sha256 !== slot.sha ||
      saved.size_bytes !== slot.size
    )
      fail(
        409,
        "evidence_conflict",
        "Evidence target identity already belongs to other bytes",
      );
    return key;
  }

  async storePart(
    row: EvidenceStorageRow,
    body: Uint8Array,
    part: EvidenceChunk | undefined,
    contentType: string,
  ) {
    const generation = generationOf(row);
    if (generation === null)
      fail(
        409,
        "evidence_corrupt",
        "A physical generation is required for this write",
      );
    const slot = slotOf(row, part);
    if (body.byteLength !== slot.size)
      fail(
        422,
        "digest_mismatch",
        "Evidence must match its declared byte length",
      );
    await this.active(generation, row.sha256);
    const previous = await this.partKey(row, part);
    if (previous !== null) {
      try {
        await verifiedPart(this.bucket, previous, slot.sha, slot.size);
        await this.active(generation, row.sha256);
        return;
      } catch (error) {
        if (
          !(error instanceof EvidenceCorruptionError) &&
          !(
            error instanceof Error &&
            (error as Error & { code?: string }).code === "evidence_missing"
          )
        )
          throw error;
      }
    }
    const target = await this.reserve(generation, slot);
    await this.bucket.put(target, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { sha256: slot.sha },
      httpMetadata: { contentType },
    });
    await verifiedPart(this.bucket, target, slot.sha, slot.size);
    let failure: unknown;
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO vetting_evidence_heads(generation_id,part_index,sha256,size_bytes,target_key)
         SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM vetting_evidence_generations WHERE id=? AND state='active')
         ON CONFLICT(generation_id,part_index,sha256,size_bytes) DO UPDATE SET target_key=excluded.target_key
         WHERE vetting_evidence_heads.target_key=?`,
        )
        .bind(
          generation,
          slot.index,
          slot.sha,
          slot.size,
          target,
          generation,
          previous,
        )
        .run();
      if (!result.success)
        failure = new Error("Evidence target publication failed");
    } catch (error) {
      failure = error;
    }
    await this.active(generation, row.sha256);
    const winner = await this.partKey(row, part);
    if (winner === null) {
      if (failure !== undefined) throw failure;
      fail(
        409,
        "evidence_conflict",
        "Evidence target publication did not select bytes",
      );
    }
    // The successful PUT and attempted publication are not a receipt. Only the
    // current selected target's exact bytes can satisfy this caller.
    await verifiedPart(this.bucket, winner, slot.sha, slot.size);
    await this.active(generation, row.sha256);
  }
}
