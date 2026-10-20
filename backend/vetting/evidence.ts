/** Separate private vetting evidence. Policy and external controls have no defaults. */

import type { ProjectD1Database } from "../projects/cloudflare-persistence";
import type { WebSession } from "../projects/contracts";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import { isRecord, readJsonObject, sha256Hex } from "../trace/validation";
import {
  chunkKey,
  chunkLayout,
  EVIDENCE_CHUNK_BYTES,
  EVIDENCE_RUN_BYTES,
  type EvidenceChunk,
  verifiedPart,
  verifyParts,
} from "./evidence-chunks";
import type { VettingResult } from "./result";

// Whole objects stay within the run ceiling; each read/upload part stays bounded.
export const MAX_EVIDENCE_OBJECT_BYTES = EVIDENCE_RUN_BYTES;
const HEX = /^[a-f0-9]{64}$/u;
const ID = /^[a-zA-Z0-9_-]{1,100}$/u;
const KINDS = new Set([
  "trace",
  "stdout",
  "stderr",
  "network",
  "artifact",
  "lineage",
  "manifest",
  "disk-diff",
]);
export type EvidencePolicy = {
  version: string;
  policyAuthorityGithubId: string;
  operatorGithubIds: string[];
  accessDurationSeconds: number;
  maxObjectBytes: number;
  maxRunBytes: number;
  maxObjects: number;
  accessPolicyReference: string;
  retentionPolicyReference: string;
  recoveryPolicyReference: string;
  externalControls: {
    evidenceReference: string;
    attestedByGithubId: string;
    attestedAt: string;
    validUntil: string;
  };
};
function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join() !== keys.sort().join())
    fail(400, "invalid_request", "Unexpected evidence fields");
}
function text(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, "invalid_request", "Invalid evidence text");
  return value;
}
export function evidencePolicy(
  raw: string | undefined,
  now: Date,
): EvidencePolicy | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!isRecord(p)) return null;
    exact(p, [
      "version",
      "policyAuthorityGithubId",
      "operatorGithubIds",
      "accessDurationSeconds",
      "maxObjectBytes",
      "maxRunBytes",
      "maxObjects",
      "accessPolicyReference",
      "retentionPolicyReference",
      "recoveryPolicyReference",
      "externalControls",
    ]);
    text(p.version, 100);
    if (
      typeof p.policyAuthorityGithubId !== "string" ||
      !/^[1-9][0-9]{0,19}$/u.test(p.policyAuthorityGithubId)
    )
      return null;
    for (const key of [
      "accessPolicyReference",
      "retentionPolicyReference",
      "recoveryPolicyReference",
    ])
      text(p[key]);
    if (
      !Array.isArray(p.operatorGithubIds) ||
      !p.operatorGithubIds.length ||
      p.operatorGithubIds.some(
        (v) => typeof v !== "string" || !/^[1-9][0-9]{0,19}$/u.test(v),
      )
    )
      return null;
    for (const key of [
      "accessDurationSeconds",
      "maxObjectBytes",
      "maxRunBytes",
      "maxObjects",
    ])
      if (!Number.isSafeInteger(p[key]) || Number(p[key]) < 1) return null;
    if (
      Number(p.maxObjectBytes) > MAX_EVIDENCE_OBJECT_BYTES ||
      Number(p.maxRunBytes) > 64 * 1024 * 1024 ||
      Number(p.maxObjects) > 1024 ||
      Number(p.maxRunBytes) < Number(p.maxObjectBytes)
    )
      return null;
    const controls = p.externalControls;
    if (!isRecord(controls)) return null;
    exact(controls, [
      "evidenceReference",
      "attestedByGithubId",
      "attestedAt",
      "validUntil",
    ]);
    text(controls.evidenceReference);
    if (controls.attestedByGithubId !== p.policyAuthorityGithubId) return null;
    const from = Date.parse(String(controls.attestedAt)),
      until = Date.parse(String(controls.validUntil));
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(until) ||
      from > now.getTime() ||
      until <= now.getTime() ||
      until <= from
    )
      return null;
    if (
      !Number.isFinite(
        new Date(
          now.getTime() + Number(p.accessDurationSeconds) * 1000,
        ).getTime(),
      )
    )
      return null;
    return p as EvidencePolicy;
  } catch {
    return null;
  }
}
export type EvidenceDependencies = {
  db: ProjectD1Database;
  bucket: R2Bucket | undefined;
  policy: string | undefined;
  session?: (request: Request) => Promise<WebSession | null>;
  now: () => Date;
  randomId: () => string;
  signed?: (
    request: Request,
    maximum: number,
  ) => Promise<{ body: Uint8Array; keySha256: string }>;
};
type Run = {
  assessment_id: string;
  run_id: string;
  trace_sha256: string;
  manifest_sha256: string;
  manifest: string;
  policy: string;
  created_at: string;
  expires_at: string;
};
type ObjectRow = {
  assessment_id: string;
  run_id: string;
  sha256: string;
  size_bytes: number;
  kind: string;
  label: string;
  content_type: string;
  object_key: string;
  chunks: string | null;
};
const headers = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
export class VettingEvidence {
  constructor(readonly deps: EvidenceDependencies) {}
  private signed(request: Request, maximum: number) {
    if (!this.deps.signed)
      fail(
        503,
        "service_unavailable",
        "Vetting evidence upload is unavailable",
      );
    return this.deps.signed(request, maximum);
  }
  ready() {
    return Boolean(
      this.deps.bucket && evidencePolicy(this.deps.policy, this.deps.now()),
    );
  }
  configuration() {
    const policy = evidencePolicy(this.deps.policy, this.deps.now());
    if (!this.deps.bucket || !policy)
      fail(
        503,
        "evidence_unavailable",
        "Vetting evidence requires a private bucket, explicit policy and current operator attestation of external retention and recovery controls",
      );
    return { policy, bucket: this.deps.bucket };
  }
  async audit(
    actor: string,
    action: string,
    assessment: string,
    run: string | null = null,
    sha: string | null = null,
    reason: string | null = null,
  ) {
    await this.deps.db
      .prepare(
        "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        this.deps.randomId(),
        actor,
        action,
        assessment,
        run,
        sha,
        reason,
        this.deps.now().toISOString(),
      )
      .run();
  }
  async operator(request: Request) {
    const actor = await this.deps.session?.(request);
    if (!actor) fail(401, "unauthorized", "Sign in with GitHub");
    const { policy } = this.configuration();
    if (!policy.operatorGithubIds.includes(actor.githubId))
      fail(403, "forbidden", "Designated vetting operator access is required");
    return actor;
  }
  async run(assessment: string, run: string): Promise<Run> {
    const row = await this.deps.db
      .prepare(
        "SELECT * FROM vetting_evidence_runs WHERE assessment_id=? AND run_id=?",
      )
      .bind(assessment, run)
      .first<Run>();
    if (!row) fail(404, "evidence_missing", "Evidence run is missing");
    return row;
  }
  async object(
    assessment: string,
    run: string,
    sha: string,
  ): Promise<ObjectRow> {
    const row = await this.deps.db
      .prepare(
        "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=? AND sha256=?",
      )
      .bind(assessment, run, sha)
      .first<ObjectRow>();
    if (!row) fail(404, "evidence_missing", "Evidence object is missing");
    return row;
  }
  private readable(row: ObjectRow, run: Run) {
    const { policy, bucket } = this.configuration();
    if (Date.parse(run.expires_at) <= this.deps.now().getTime())
      fail(
        410,
        "evidence_expired",
        "Evidence access expired; physical retention is governed separately",
      );
    if (row.size_bytes > policy.maxObjectBytes)
      fail(
        413,
        "evidence_oversize",
        "Complete evidence exceeds the current inspection limit",
      );
    return bucket;
  }
  private layout(row: ObjectRow): EvidenceChunk[] | null {
    return row.chunks === null
      ? null
      : chunkLayout(JSON.parse(row.chunks), row.size_bytes);
  }
  async bytes(row: ObjectRow, run: Run): Promise<Uint8Array> {
    const bucket = this.readable(row, run);
    if (row.size_bytes > EVIDENCE_CHUNK_BYTES)
      fail(
        413,
        "evidence_oversize",
        "Large evidence requires a streamed download",
      );
    return verifiedPart(bucket, row.object_key, row.sha256, row.size_bytes);
  }
  async verify(row: ObjectRow, run: Run, requireComplete = true) {
    const bucket = this.readable(row, run),
      chunks = this.layout(row);
    if (!chunks) {
      await this.bytes(row, run);
      return;
    }
    if (
      requireComplete &&
      !(await this.deps.db
        .prepare(
          "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
        )
        .bind(row.assessment_id, row.run_id, row.sha256)
        .first())
    )
      fail(
        409,
        "evidence_pending",
        "Chunked evidence has not completed whole-file verification",
      );
    await verifyParts(bucket, row.object_key, chunks, row.sha256);
  }
  async complete(result: VettingResult) {
    const assessment = result.assessmentId,
      runId = result.environment.runId,
      traceSha = result.traceSha256;
    try {
      const run = await this.run(assessment, runId);
      if (run.trace_sha256 !== traceSha) return false;
      const objects =
        (
          await this.deps.db
            .prepare(
              "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=?",
            )
            .bind(assessment, runId)
            .all<ObjectRow>()
        ).results ?? [];
      const inventory = new Set(objects.map((object) => object.sha256));
      const required = [
        traceSha,
        result.assessed.inputManifestSha256,
        ...result.modelReviews.map((review) => review.inputManifestSha256),
        ...result.assessed.dependencyLocks.map((lock) => lock.sha256),
        ...result.artifacts.flatMap((artifact) => [
          artifact.sha256,
          ...(artifact.parentSha256 ? [artifact.parentSha256] : []),
        ]),
      ];
      if (required.some((digest) => !inventory.has(digest))) return false;
      for (const row of objects) await this.verify(row, run);
      return true;
    } catch {
      return false;
    }
  }
  async register(request: Request, assessment: string, runId: string) {
    const { policy } = this.configuration();
    const { body, keySha256 } = await this.signed(request, 1024 * 1024);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
    } catch {
      fail(
        400,
        "invalid_request",
        "Evidence manifest must be valid UTF-8 JSON",
      );
    }
    if (!isRecord(input))
      fail(400, "invalid_request", "Evidence manifest must be an object");
    exact(input, ["traceSha256", "objects"]);
    if (
      typeof input.traceSha256 !== "string" ||
      !HEX.test(input.traceSha256) ||
      !Array.isArray(input.objects) ||
      !input.objects.length ||
      input.objects.length > policy.maxObjects
    )
      fail(400, "invalid_request", "Invalid evidence manifest");
    const exists = await this.deps.db
      .prepare("SELECT id FROM vetting_assessments WHERE id=?")
      .bind(assessment)
      .first();
    if (!exists) fail(404, "not_found", "Assessment not found");
    let total = 0;
    const seen = new Set<string>();
    const objects = input.objects
      .map((value) => {
        if (!isRecord(value))
          fail(400, "invalid_request", "Invalid evidence object");
        exact(value, [
          "sha256",
          "sizeBytes",
          "kind",
          "label",
          "contentType",
          ...(Object.hasOwn(value, "chunks") ? ["chunks"] : []),
        ]);
        const sha = text(value.sha256, 64),
          kind = text(value.kind, 20),
          label = text(value.label, 200),
          contentType = text(value.contentType, 80);
        if (
          !HEX.test(sha) ||
          seen.has(sha) ||
          !KINDS.has(kind) ||
          ![
            "text/plain",
            "application/x-ndjson",
            "application/json",
            "application/octet-stream",
          ].includes(contentType) ||
          !Number.isSafeInteger(value.sizeBytes) ||
          Number(value.sizeBytes) < 0
        )
          fail(400, "invalid_request", "Invalid or duplicate evidence object");
        if (Number(value.sizeBytes) > policy.maxObjectBytes)
          fail(
            413,
            "evidence_oversize",
            "Complete object exceeds the configured limit; the run is not inspectable",
          );
        let chunks: EvidenceChunk[] | undefined;
        if (
          Number(value.sizeBytes) > EVIDENCE_CHUNK_BYTES ||
          Object.hasOwn(value, "chunks")
        ) {
          try {
            chunks = chunkLayout(value.chunks, Number(value.sizeBytes));
          } catch {
            fail(
              400,
              "invalid_request",
              "Large evidence requires an exact ordered bounded chunk layout",
            );
          }
        }
        total += Number(value.sizeBytes);
        seen.add(sha);
        return {
          sha256: sha,
          sizeBytes: Number(value.sizeBytes),
          kind,
          label,
          contentType,
          ...(chunks ? { chunks } : {}),
        };
      })
      .sort((a, b) => a.sha256.localeCompare(b.sha256));
    if (total > policy.maxRunBytes)
      fail(
        413,
        "evidence_oversize",
        "Complete run exceeds the configured limit",
      );
    if (
      !objects.some((o) => o.kind === "trace" && o.sha256 === input.traceSha256)
    )
      fail(400, "invalid_request", "The exact trace object must be declared");
    const manifest = JSON.stringify({
        traceSha256: input.traceSha256,
        objects,
      }),
      digest = await sha256Hex(new TextEncoder().encode(manifest));
    const previous = await this.deps.db
      .prepare(
        "SELECT manifest_sha256 FROM vetting_evidence_runs WHERE assessment_id=? AND run_id=?",
      )
      .bind(assessment, runId)
      .first<{ manifest_sha256: string }>();
    if (previous) {
      if (previous.manifest_sha256 !== digest)
        fail(
          409,
          "evidence_conflict",
          "Evidence run already binds different bytes",
        );
      return json(200, { manifestSha256: digest, replayed: true });
    }
    const at = this.deps.now();
    await this.deps.db.batch([
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          assessment,
          runId,
          input.traceSha256,
          digest,
          manifest,
          JSON.stringify(policy),
          at.toISOString(),
          new Date(
            at.getTime() + policy.accessDurationSeconds * 1000,
          ).toISOString(),
        ),
      ...objects.map((o) =>
        this.deps.db
          .prepare(
            "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            assessment,
            runId,
            o.sha256,
            o.sizeBytes,
            o.kind,
            o.label,
            o.contentType,
            `vetting/${assessment}/${runId}/${o.sha256}`,
            o.chunks ? JSON.stringify(o.chunks) : null,
          ),
      ),
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          this.deps.randomId(),
          `service:${keySha256}`,
          "register",
          assessment,
          runId,
          at.toISOString(),
        ),
    ]);
    return json(201, { manifestSha256: digest });
  }
  async upload(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
  ) {
    const { policy, bucket } = this.configuration();
    const { body, keySha256 } = await this.signed(
      request,
      Math.min(policy.maxObjectBytes, EVIDENCE_CHUNK_BYTES),
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    if (Date.parse(run.expires_at) <= this.deps.now().getTime())
      fail(410, "evidence_expired", "Evidence upload expired");
    if (
      body.byteLength !== object.size_bytes ||
      (await sha256Hex(body)) !== sha
    )
      fail(
        422,
        "digest_mismatch",
        "Upload must match the complete declared bytes",
      );
    await bucket.put(object.object_key, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: object.content_type },
      customMetadata: { sha256: sha },
    });
    await this.bytes(object, run);
    await this.audit(`service:${keySha256}`, "upload", assessment, runId, sha);
    return json(200, { sha256: sha, sizeBytes: body.byteLength });
  }
  async uploadChunk(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
    index: number,
  ) {
    const { bucket } = this.configuration();
    const { body, keySha256 } = await this.signed(
      request,
      EVIDENCE_CHUNK_BYTES,
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    this.readable(object, run);
    const chunk = this.layout(object)?.[index];
    if (!chunk) fail(404, "not_found", "Declared chunk not found");
    if (
      body.byteLength !== chunk.sizeBytes ||
      (await sha256Hex(body)) !== chunk.sha256
    )
      fail(
        422,
        "digest_mismatch",
        "Upload must match the exact declared chunk bytes",
      );
    const key = chunkKey(object.object_key, chunk);
    await bucket.put(key, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { sha256: chunk.sha256 },
    });
    await verifiedPart(bucket, key, chunk.sha256, chunk.sizeBytes);
    await this.audit(
      `service:${keySha256}`,
      "upload-chunk",
      assessment,
      runId,
      sha,
      `Chunk ${index}`,
    );
    return json(200, {
      sha256: chunk.sha256,
      index,
      sizeBytes: body.byteLength,
    });
  }
  async finalize(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
  ) {
    const { body, keySha256 } = await this.signed(request, 2);
    if (new TextDecoder().decode(body) !== "{}")
      fail(
        400,
        "invalid_request",
        "Finalization requires an empty JSON object",
      );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    if (!this.layout(object))
      fail(
        400,
        "invalid_request",
        "Only chunked evidence requires finalization",
      );
    await this.verify(object, run, false);
    // No partial completion state: concurrent/repeated finalization has one immutable receipt.
    const at = this.deps.now().toISOString();
    const [recorded] = await this.deps.db.batch([
      this.deps.db
        .prepare(
          "INSERT OR IGNORE INTO vetting_evidence_completions(assessment_id,run_id,sha256,completed_at) VALUES(?,?,?,?)",
        )
        .bind(assessment, runId, sha, at),
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,created_at) SELECT ?,?,'finalize',?,?,?,? WHERE changes()=1",
        )
        .bind(
          this.deps.randomId(),
          `service:${keySha256}`,
          assessment,
          runId,
          sha,
          at,
        ),
    ]);
    return json(200, {
      sha256: sha,
      sizeBytes: object.size_bytes,
      replayed: recorded.meta?.changes !== 1,
    });
  }
  async overview(request: Request) {
    const actor = await this.operator(request);
    const query = new URL(request.url).searchParams;
    const assessment = query.get("assessmentId"),
      runId = query.get("runId");
    const runs: Run[] = [];
    if (assessment !== null || runId !== null) {
      if (!ID.test(assessment ?? "") || !ID.test(runId ?? ""))
        fail(
          400,
          "invalid_request",
          "Enter the exact assessment and run identity",
        );
      runs.push(await this.run(String(assessment), String(runId)));
    }
    const { bucket, policy } = this.configuration();
    const result = [];
    for (const run of runs) {
      const rows =
        (
          await this.deps.db
            .prepare(
              "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=? ORDER BY kind,sha256",
            )
            .bind(run.assessment_id, run.run_id)
            .all<ObjectRow>()
        ).results ?? [];
      const objects = [];
      for (const row of rows) {
        const chunks = this.layout(row);
        const head = chunks
          ? await this.deps.db
              .prepare(
                "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
              )
              .bind(run.assessment_id, run.run_id, row.sha256)
              .first<{ completed_at: string }>()
          : await bucket.head(row.object_key);
        const state =
          Date.parse(run.expires_at) <= this.deps.now().getTime()
            ? "expired"
            : row.size_bytes > policy.maxObjectBytes
              ? "oversize"
              : !head
                ? chunks
                  ? "pending"
                  : "missing"
                : !chunks &&
                    (("size" in head && head.size !== row.size_bytes) ||
                      ("customMetadata" in head &&
                        (
                          head.customMetadata as
                            | Record<string, string>
                            | undefined
                        )?.sha256 !== row.sha256))
                  ? "corrupt"
                  : "stored-unverified";
        objects.push({
          sha256: row.sha256,
          sizeBytes: row.size_bytes,
          kind: row.kind,
          label: row.label,
          contentType: row.content_type,
          streamed: row.size_bytes > EVIDENCE_CHUNK_BYTES,
          state,
        });
      }
      result.push({
        assessmentId: run.assessment_id,
        runId: run.run_id,
        traceSha256: run.trace_sha256,
        manifestSha256: run.manifest_sha256,
        createdAt: run.created_at,
        expiresAt: run.expires_at,
        policy: JSON.parse(run.policy),
        objects,
      });
    }
    await this.audit(
      actor.githubId,
      "list",
      "*",
      null,
      null,
      "Inspect registered vetting evidence",
    );
    return json(200, {
      runs: result,
      policy,
      retentionBoundary:
        "Access expiry is enforced here. Physical retention, legal holds and backups are external, operator-attested controls; this console does not verify or execute them.",
    });
  }
  async grant(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
    download = false,
  ) {
    const actor = await this.operator(request),
      body = await readJsonObject(request);
    exact(body, ["reason"]);
    const reason = text(body.reason);
    if (reason.trim().length < 8)
      fail(
        400,
        "invalid_request",
        "Explain why access is needed (8 to 500 characters)",
      );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    if (!download && object.size_bytes > EVIDENCE_CHUNK_BYTES)
      fail(
        413,
        "evidence_oversize",
        "Large evidence requires a native streamed download grant",
      );
    // Do not grant access to absent, expired, oversized or changed evidence.
    await this.verify(object, run);
    const token = crypto.randomUUID() + crypto.randomUUID(),
      hash = await sha256Hex(new TextEncoder().encode(token));
    await this.deps.db.batch([
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_grants(token_hash,assessment_id,run_id,sha256,operator_github_id,reason,expires_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          hash,
          assessment,
          runId,
          sha,
          actor.githubId,
          reason,
          new Date(this.deps.now().getTime() + 60_000).toISOString(),
        ),
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          this.deps.randomId(),
          actor.githubId,
          "grant",
          assessment,
          runId,
          sha,
          reason,
          this.deps.now().toISOString(),
        ),
    ]);
    if (download) {
      const response = json(201, { expiresInSeconds: 60 });
      response.headers.set(
        "set-cookie",
        this.downloadCookie(assessment, runId, sha, token),
      );
      return response;
    }
    return json(201, { grant: token, expiresInSeconds: 60 });
  }
  private async consume(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
    token: string,
  ) {
    const actor = await this.operator(request);
    if (token.length > 100) fail(403, "grant_invalid", "Invalid read grant");
    const hash = await sha256Hex(new TextEncoder().encode(token)),
      at = this.deps.now().toISOString();
    const grant = await this.deps.db
      .prepare(
        "UPDATE vetting_evidence_grants SET consumed_at=? WHERE token_hash=? AND assessment_id=? AND run_id=? AND sha256=? AND operator_github_id=? AND consumed_at IS NULL AND expires_at>? RETURNING reason",
      )
      .bind(at, hash, assessment, runId, sha, actor.githubId, at)
      .first<{ reason: string }>();
    if (!grant)
      fail(
        403,
        "grant_invalid",
        "Read grant is expired, used or belongs to another operator or object",
      );
    await this.audit(
      actor.githubId,
      "read-attempt",
      assessment,
      runId,
      sha,
      grant.reason,
    );
    return { actor, reason: grant.reason };
  }
  async read(request: Request, assessment: string, runId: string, sha: string) {
    const { actor, reason } = await this.consume(
      request,
      assessment,
      runId,
      sha,
      request.headers.get("x-vetting-read-grant") ?? "",
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha),
      bytes = await this.bytes(object, run);
    await this.audit(actor.githubId, "read", assessment, runId, sha, reason);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        ...headers,
        "content-type": object.content_type,
        "content-length": String(bytes.byteLength),
        "content-disposition": `attachment; filename="${sha}.bin"`,
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }
  private downloadCookie(
    assessment: string,
    runId: string,
    sha: string,
    token = "",
  ) {
    const path = `/api/v1/operator/vetting-evidence/${assessment}/${runId}/${sha}/download`;
    return `__Secure-vetting-read-grant=${token}; Path=${path}; Max-Age=${token ? 60 : 0}; Secure; HttpOnly; SameSite=Strict`;
  }
  async download(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
  ) {
    if (
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      request.headers.has("range")
    )
      fail(
        403,
        "origin_forbidden",
        "Downloads require a fresh same-origin browser request without ranges",
      );
    const cookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__Secure-vetting-read-grant="));
    if (cookies.length !== 1)
      fail(403, "grant_invalid", "Exactly one download grant is required");
    const token = cookies[0].slice("__Secure-vetting-read-grant=".length);
    const { actor, reason } = await this.consume(
      request,
      assessment,
      runId,
      sha,
      token,
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    this.readable(object, run);
    const chunks = this.layout(object);
    if (
      chunks &&
      !(await this.deps.db
        .prepare(
          "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
        )
        .bind(assessment, runId, sha)
        .first())
    )
      fail(409, "evidence_pending", "Whole-file verification is incomplete");
    let index = 0,
      started = false,
      ended = false;
    const audit = (action: string) =>
      this.audit(actor.githubId, action, assessment, runId, sha, reason);
    await audit("download-authorized");
    const stream = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            const bucket = this.readable(object, run);
            if (index >= (chunks?.length ?? 1)) {
              await audit("download-finished");
              if (ended) return;
              ended = true;
              controller.close();
              return;
            }
            // Current session and operator authorization gate every part.
            if ((await this.operator(request)).githubId !== actor.githubId)
              fail(403, "forbidden", "Download actor changed");
            const part = chunks?.[index];
            const bytes = part
              ? await verifiedPart(
                  bucket,
                  chunkKey(object.object_key, part),
                  part.sha256,
                  part.sizeBytes,
                )
              : await this.bytes(object, run);
            if (ended) return;
            if (!started) {
              await audit("download-started");
              started = true;
            }
            if (ended) return;
            index++;
            controller.enqueue(bytes);
          } catch (error) {
            if (ended) return;
            ended = true;
            try {
              await audit("download-failed");
            } finally {
              controller.error(error);
            }
          }
        },
        cancel: async () => {
          if (!ended) {
            ended = true;
            await audit("download-cancelled");
          }
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, {
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "content-length": String(object.size_bytes),
        "content-disposition": `attachment; filename="${sha}.bin"`,
        "content-security-policy": "default-src 'none'; sandbox",
        "accept-ranges": "none",
      },
    });
  }
  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname
      .split("/")
      .filter(Boolean)
      .slice(2);
    const service = path[0] === "vetting" && path[1] === "evidence",
      operator = path[0] === "operator" && path[1] === "vetting-evidence";
    if (!service && !operator) return null;
    try {
      if (
        operator &&
        request.method !== "GET" &&
        (request.headers.get("origin") !== new URL(request.url).origin ||
          request.headers.get("content-type")?.split(";")[0] !==
            "application/json")
      )
        fail(403, "origin_forbidden", "Requests must come from this site");
      if (operator && path.length === 2 && request.method === "GET")
        return await this.overview(request);
      const [, , assessment, run, sha, action] = path;
      if (!ID.test(assessment ?? "") || !ID.test(run ?? ""))
        fail(404, "not_found", "Evidence route not found");
      if (service && path.length === 4 && request.method === "POST")
        return await this.register(request, assessment, run);
      if (!HEX.test(sha ?? ""))
        fail(404, "not_found", "Evidence route not found");
      if (service && path.length === 5 && request.method === "PUT")
        return await this.upload(request, assessment, run, sha);
      if (
        service &&
        path.length === 7 &&
        action === "chunks" &&
        /^[0-7]$/u.test(path[6]) &&
        request.method === "PUT"
      )
        return await this.uploadChunk(
          request,
          assessment,
          run,
          sha,
          Number(path[6]),
        );
      if (
        service &&
        path.length === 6 &&
        action === "finalize" &&
        request.method === "POST"
      )
        return await this.finalize(request, assessment, run, sha);
      if (
        operator &&
        path.length === 6 &&
        action === "download-grant" &&
        request.method === "POST"
      )
        return await this.grant(request, assessment, run, sha, true);
      if (operator && path.length === 6 && action === "download") {
        let response: Response;
        try {
          if (request.method !== "GET")
            fail(405, "method_not_allowed", "Native downloads require GET");
          response = await this.download(request, assessment, run, sha);
        } catch (error) {
          const e = error as { status?: number; code?: string };
          response = json(e.status ?? 500, {
            error: e.status ? e.code : "evidence_failure",
          });
        }
        response.headers.set(
          "set-cookie",
          this.downloadCookie(assessment, run, sha),
        );
        return response;
      }
      if (
        operator &&
        path.length === 6 &&
        action === "grant" &&
        request.method === "POST"
      )
        return await this.grant(request, assessment, run, sha);
      if (
        operator &&
        path.length === 6 &&
        action === "body" &&
        request.method === "GET"
      )
        return await this.read(request, assessment, run, sha);
      return json(404, { error: "not_found" });
    } catch (error) {
      const e = error as { status?: number; code?: string; message?: string };
      const status = e.status ?? 500;
      return json(status, {
        error:
          status === 500 ? "evidence_failure" : (e.code ?? "evidence_failure"),
        message: status === 500 ? "Evidence operation failed" : e.message,
      });
    }
  }
}
