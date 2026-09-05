import type {
  AttachTraceInput,
  AuditInput,
  CreateGrantInput,
  CreateRunInput,
  PersistenceResult,
  RunProgressEvent,
  TraceObject,
  TracePersistence,
  TraceRun,
  TraceUploadIntent,
  WalletClaim,
} from "./contracts";
import { sha256Hex } from "./validation";

type D1Result = { success: boolean; meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

export type D1Database = {
  batch(statements: D1Statement[]): Promise<D1Result[]>;
  prepare(query: string): D1Statement;
};

type R2Head = {
  size: number;
  customMetadata?: Record<string, string>;
};
type R2ObjectBody = R2Head & { body: ReadableStream<Uint8Array> };

export type R2Bucket = {
  head(key: string): Promise<R2Head | null>;
  put(
    key: string,
    value: Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      onlyIf: { etagDoesNotMatch: "*" };
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
};

type RunRow = {
  id: string;
  client_run_id: string;
  github_user_id: string;
  github_login: string;
  project_id: string;
  repository: string;
  project_policy_revision: string;
  provider: string;
  model: string;
  client: string;
  client_version: string;
  state: TraceRun["state"];
  trace_sha256: string | null;
  created_at: string;
  finalized_at: string | null;
  create_idempotency_key: string;
};

type ObjectRow = {
  sha256: string;
  r2_key: string;
  size_bytes: number;
  content_type: TraceObject["contentType"];
  created_by_github_id: string;
  created_at: string;
};

type EventRow = {
  id: string;
  run_id: string;
  github_user_id: string;
  kind: RunProgressEvent["kind"];
  occurred_at: string;
  source: RunProgressEvent["source"];
  github_object_id: string | null;
  github_url: string | null;
  head_sha: string | null;
  created_at: string;
  idempotency_key: string;
};

type WalletClaimRow = {
  id: string;
  github_user_id: string;
  github_login: string;
  wallet_address: string;
  source: WalletClaim["source"];
  issue_repository: string | null;
  issue_number: number | null;
  source_body_sha256: string;
  observed_at: string;
  record_sha256: string;
  supersedes_claim_id: string | null;
  created_at: string;
};

type UploadIntentRow = {
  token_hash: string;
  run_id: string;
  github_user_id: string;
  trace_sha256: string;
  size_bytes: number;
  content_type: TraceUploadIntent["contentType"];
  idempotency_key: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

function mapRun(row: RunRow): TraceRun {
  return {
    id: row.id,
    clientRunId: row.client_run_id,
    githubId: row.github_user_id,
    githubLogin: row.github_login,
    projectId: row.project_id,
    repository: row.repository,
    projectPolicyRevision: row.project_policy_revision,
    provider: row.provider,
    model: row.model,
    client: row.client,
    clientVersion: row.client_version,
    state: row.state,
    traceSha256: row.trace_sha256,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  };
}

function mapObject(row: ObjectRow): TraceObject {
  return {
    sha256: row.sha256,
    key: row.r2_key,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    createdByGithubId: row.created_by_github_id,
    createdAt: row.created_at,
  };
}

function mapEvent(row: EventRow): RunProgressEvent {
  return {
    id: row.id,
    runId: row.run_id,
    githubId: row.github_user_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    source: row.source,
    githubObjectId: row.github_object_id,
    githubUrl: row.github_url,
    headSha: row.head_sha,
    createdAt: row.created_at,
  };
}

function mapWalletClaim(row: WalletClaimRow): WalletClaim {
  return {
    id: row.id,
    githubId: row.github_user_id,
    githubLogin: row.github_login,
    walletAddress: row.wallet_address,
    source: row.source,
    issueRepository: row.issue_repository,
    issueNumber: row.issue_number,
    sourceBodySha256: row.source_body_sha256,
    observedAt: row.observed_at,
    recordSha256: row.record_sha256,
    supersedesClaimId: row.supersedes_claim_id,
    createdAt: row.created_at,
  };
}

function mapUploadIntent(row: UploadIntentRow): TraceUploadIntent {
  return {
    tokenHash: row.token_hash,
    runId: row.run_id,
    githubId: row.github_user_id,
    sha256: row.trace_sha256,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function sameEvent(existing: EventRow, event: RunProgressEvent): boolean {
  return (
    existing.run_id === event.runId &&
    existing.github_user_id === event.githubId &&
    existing.kind === event.kind &&
    existing.occurred_at === event.occurredAt &&
    existing.source === event.source &&
    existing.github_object_id === event.githubObjectId &&
    existing.github_url === event.githubUrl &&
    existing.head_sha === event.headSha
  );
}

function sameCreate(existing: RunRow, input: CreateRunInput): boolean {
  return (
    existing.client_run_id === input.clientRunId &&
    existing.project_id === input.projectId &&
    existing.repository === input.repository &&
    existing.project_policy_revision === input.projectPolicyRevision &&
    existing.provider === input.provider &&
    existing.model === input.model &&
    existing.client === input.client &&
    existing.client_version === input.clientVersion
  );
}

export class CloudflareTracePersistence implements TracePersistence {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
  ) {}

  async createRun(input: CreateRunInput): Promise<PersistenceResult<TraceRun>> {
    const existing = await this.db
      .prepare(
        "SELECT * FROM trace_runs WHERE github_user_id = ? AND create_idempotency_key = ?",
      )
      .bind(input.githubId, input.idempotencyKey)
      .first<RunRow>();
    if (existing !== null) {
      return sameCreate(existing, input)
        ? { status: "existing", value: mapRun(existing) }
        : { status: "conflict" };
    }
    try {
      await this.db
        .prepare(
          `INSERT INTO trace_runs (
            id, client_run_id, github_user_id, github_login, project_id,
            repository, project_policy_revision, provider, model, client,
            client_version, state, trace_sha256, created_at, finalized_at,
            create_idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_trace', NULL, ?, NULL, ?)`,
        )
        .bind(
          input.id,
          input.clientRunId,
          input.githubId,
          input.githubLogin,
          input.projectId,
          input.repository,
          input.projectPolicyRevision,
          input.provider,
          input.model,
          input.client,
          input.clientVersion,
          input.createdAt,
          input.idempotencyKey,
        )
        .run();
    } catch {
      const raced = await this.db
        .prepare(
          "SELECT * FROM trace_runs WHERE github_user_id = ? AND create_idempotency_key = ?",
        )
        .bind(input.githubId, input.idempotencyKey)
        .first<RunRow>();
      if (raced === null || !sameCreate(raced, input))
        return { status: "conflict" };
      return { status: "existing", value: mapRun(raced) };
    }
    const created = await this.getRun(input.id);
    if (created === null) throw new Error("Created trace run is unavailable");
    return { status: "created", value: created };
  }

  async getRun(runId: string): Promise<TraceRun | null> {
    const row = await this.db
      .prepare("SELECT * FROM trace_runs WHERE id = ?")
      .bind(runId)
      .first<RunRow>();
    return row === null ? null : mapRun(row);
  }

  async attachTrace(
    input: AttachTraceInput,
  ): Promise<PersistenceResult<TraceRun>> {
    const existing = await this.db
      .prepare(
        "SELECT run_id, trace_sha256 FROM trace_uploads WHERE github_user_id = ? AND idempotency_key = ?",
      )
      .bind(input.githubId, input.idempotencyKey)
      .first<{ run_id: string; trace_sha256: string }>();
    if (existing !== null) {
      return { status: "conflict" };
    }

    const run = await this.getRun(input.runId);
    if (
      run === null ||
      run.githubId !== input.githubId ||
      run.state === "finalized" ||
      (run.traceSha256 !== null && run.traceSha256 !== input.object.sha256)
    ) {
      return { status: "conflict" };
    }
    const intentConsume = this.db
      .prepare(
        `UPDATE trace_upload_intents SET consumed_at = ?
         WHERE token_hash = ? AND run_id = ? AND github_user_id = ?
           AND trace_sha256 = ? AND size_bytes = ? AND content_type = ?
           AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(
        input.intentConsumedAt,
        input.idempotencyKey,
        input.runId,
        input.githubId,
        input.object.sha256,
        input.object.sizeBytes,
        input.object.contentType,
        input.intentConsumedAt,
      );
    const objectInsert = this.db
      .prepare(
        `INSERT INTO trace_objects (
          sha256, r2_key, size_bytes, content_type, created_by_github_id, created_at
        ) SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM trace_upload_intents
            WHERE token_hash = ? AND run_id = ? AND github_user_id = ?
              AND trace_sha256 = ? AND size_bytes = ? AND content_type = ?
              AND consumed_at = ?
          )
          ON CONFLICT(sha256) DO NOTHING`,
      )
      .bind(
        input.object.sha256,
        input.object.key,
        input.object.sizeBytes,
        input.object.contentType,
        input.object.createdByGithubId,
        input.object.createdAt,
        input.idempotencyKey,
        input.runId,
        input.githubId,
        input.object.sha256,
        input.object.sizeBytes,
        input.object.contentType,
        input.intentConsumedAt,
      );
    const uploadInsert = this.db
      .prepare(
        `INSERT INTO trace_uploads (
          github_user_id, idempotency_key, run_id, trace_sha256, created_at
        ) SELECT ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM trace_objects
            WHERE sha256 = ? AND r2_key = ? AND size_bytes = ?
              AND content_type = ?
          ) AND EXISTS (
            SELECT 1 FROM trace_upload_intents
            WHERE token_hash = ? AND run_id = ? AND github_user_id = ?
              AND trace_sha256 = ? AND size_bytes = ? AND content_type = ?
              AND consumed_at = ?
          )`,
      )
      .bind(
        input.githubId,
        input.idempotencyKey,
        input.runId,
        input.object.sha256,
        input.object.createdAt,
        input.object.sha256,
        input.object.key,
        input.object.sizeBytes,
        input.object.contentType,
        input.idempotencyKey,
        input.runId,
        input.githubId,
        input.object.sha256,
        input.object.sizeBytes,
        input.object.contentType,
        input.intentConsumedAt,
      );
    const runUpdate = this.db
      .prepare(
        `UPDATE trace_runs
         SET trace_sha256 = ?, state = 'trace_uploaded'
         WHERE id = ? AND github_user_id = ? AND state != 'finalized'
           AND (trace_sha256 IS NULL OR trace_sha256 = ?)
           AND EXISTS (
             SELECT 1 FROM trace_uploads
             WHERE github_user_id = ? AND idempotency_key = ?
               AND run_id = ? AND trace_sha256 = ?
           ) AND EXISTS (
             SELECT 1 FROM trace_upload_intents
             WHERE token_hash = ? AND run_id = ? AND github_user_id = ?
               AND trace_sha256 = ? AND size_bytes = ? AND content_type = ?
               AND consumed_at = ?
           )`,
      )
      .bind(
        input.object.sha256,
        input.runId,
        input.githubId,
        input.object.sha256,
        input.githubId,
        input.idempotencyKey,
        input.runId,
        input.object.sha256,
        input.idempotencyKey,
        input.runId,
        input.githubId,
        input.object.sha256,
        input.object.sizeBytes,
        input.object.contentType,
        input.intentConsumedAt,
      );
    const commitInsert = this.db
      .prepare(
        `INSERT INTO trace_attachment_commits (
          token_hash, run_id, github_user_id, trace_sha256, consumed_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        input.idempotencyKey,
        input.runId,
        input.githubId,
        input.object.sha256,
        input.intentConsumedAt,
      );
    try {
      const results = await this.db.batch([
        intentConsume,
        objectInsert,
        uploadInsert,
        runUpdate,
        commitInsert,
      ]);
      if (
        results.length !== 5 ||
        results.some((result) => !result.success) ||
        (results[0].meta?.changes ?? 0) !== 1 ||
        (results[2].meta?.changes ?? 0) !== 1 ||
        (results[3].meta?.changes ?? 0) !== 1 ||
        (results[4].meta?.changes ?? 0) !== 1
      ) {
        throw new Error("Atomic trace attachment did not update one run");
      }
    } catch (error) {
      const stillAvailable = await this.getUploadIntent(
        input.idempotencyKey,
        input.intentConsumedAt,
      );
      if (stillAvailable === null) return { status: "conflict" };
      throw error;
    }
    const updated = await this.getRun(input.runId);
    if (updated === null || updated.traceSha256 !== input.object.sha256) {
      return { status: "conflict" };
    }
    return { status: "created", value: updated };
  }

  async finalizeRun(
    runId: string,
    githubId: string,
    finalizedAt: string,
  ): Promise<TraceRun | null> {
    await this.db
      .prepare(
        `UPDATE trace_runs SET state = 'finalized', finalized_at = COALESCE(finalized_at, ?)
         WHERE id = ? AND github_user_id = ? AND trace_sha256 IS NOT NULL`,
      )
      .bind(finalizedAt, runId, githubId)
      .run();
    const run = await this.getRun(runId);
    return run?.githubId === githubId && run.state === "finalized" ? run : null;
  }

  async appendEvent(
    event: RunProgressEvent & { idempotencyKey: string },
  ): Promise<PersistenceResult<RunProgressEvent>> {
    const existing = await this.db
      .prepare(
        "SELECT * FROM run_progress_events WHERE github_user_id = ? AND idempotency_key = ?",
      )
      .bind(event.githubId, event.idempotencyKey)
      .first<EventRow>();
    if (existing !== null) {
      return sameEvent(existing, event)
        ? { status: "existing", value: mapEvent(existing) }
        : { status: "conflict" };
    }
    try {
      await this.db
        .prepare(
          `INSERT INTO run_progress_events (
            id, run_id, github_user_id, kind, occurred_at, source,
            github_object_id, github_url, head_sha, created_at, idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          event.id,
          event.runId,
          event.githubId,
          event.kind,
          event.occurredAt,
          event.source,
          event.githubObjectId,
          event.githubUrl,
          event.headSha,
          event.createdAt,
          event.idempotencyKey,
        )
        .run();
    } catch {
      return { status: "conflict" };
    }
    return { status: "created", value: event };
  }

  async getTraceObject(sha256: string): Promise<TraceObject | null> {
    const row = await this.db
      .prepare("SELECT * FROM trace_objects WHERE sha256 = ?")
      .bind(sha256)
      .first<ObjectRow>();
    return row === null ? null : mapObject(row);
  }

  async createUploadIntent(
    intent: TraceUploadIntent,
  ): Promise<PersistenceResult<TraceUploadIntent>> {
    const existing = await this.db
      .prepare(
        "SELECT * FROM trace_upload_intents WHERE github_user_id = ? AND idempotency_key = ?",
      )
      .bind(intent.githubId, intent.idempotencyKey)
      .first<UploadIntentRow>();
    if (existing !== null) {
      const mapped = mapUploadIntent(existing);
      if (
        mapped.runId !== intent.runId ||
        mapped.sha256 !== intent.sha256 ||
        mapped.sizeBytes !== intent.sizeBytes ||
        mapped.contentType !== intent.contentType
      ) {
        return { status: "conflict" };
      }
      if (mapped.consumedAt === null && mapped.expiresAt <= intent.createdAt) {
        await this.db
          .prepare(
            `UPDATE trace_upload_intents SET expires_at = ?
             WHERE token_hash = ? AND consumed_at IS NULL AND expires_at <= ?`,
          )
          .bind(intent.expiresAt, mapped.tokenHash, intent.createdAt)
          .run();
        const renewed = await this.db
          .prepare("SELECT * FROM trace_upload_intents WHERE token_hash = ?")
          .bind(mapped.tokenHash)
          .first<UploadIntentRow>();
        if (renewed === null) return { status: "conflict" };
        const renewedIntent = mapUploadIntent(renewed);
        return renewedIntent.runId === intent.runId &&
          renewedIntent.sha256 === intent.sha256 &&
          renewedIntent.sizeBytes === intent.sizeBytes &&
          renewedIntent.contentType === intent.contentType &&
          renewedIntent.consumedAt === null &&
          renewedIntent.expiresAt > intent.createdAt
          ? { status: "existing", value: renewedIntent }
          : { status: "conflict" };
      }
      return mapped.runId === intent.runId &&
        mapped.sha256 === intent.sha256 &&
        mapped.sizeBytes === intent.sizeBytes &&
        mapped.contentType === intent.contentType
        ? { status: "existing", value: mapped }
        : { status: "conflict" };
    }
    try {
      await this.db
        .prepare(
          `INSERT INTO trace_upload_intents (
            token_hash, run_id, github_user_id, trace_sha256, size_bytes,
            content_type, idempotency_key, created_at, expires_at, consumed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          intent.tokenHash,
          intent.runId,
          intent.githubId,
          intent.sha256,
          intent.sizeBytes,
          intent.contentType,
          intent.idempotencyKey,
          intent.createdAt,
          intent.expiresAt,
        )
        .run();
    } catch {
      return { status: "conflict" };
    }
    return { status: "created", value: intent };
  }

  async getUploadIntent(
    tokenHash: string,
    now: string,
  ): Promise<TraceUploadIntent | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM trace_upload_intents
         WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(tokenHash, now)
      .first<UploadIntentRow>();
    return row === null ? null : mapUploadIntent(row);
  }

  async putTraceBytes(object: TraceObject, bytes: Uint8Array): Promise<void> {
    const existing = await this.bucket.head(object.key);
    if (existing !== null) {
      if (
        existing.size !== object.sizeBytes ||
        existing.customMetadata?.sha256 !== object.sha256
      ) {
        throw new Error("Immutable R2 trace object has conflicting metadata");
      }
      const verified = await this.readTraceBytes(object);
      if (verified === null) {
        throw new Error("Immutable R2 trace object failed byte verification");
      }
      return;
    }
    try {
      await this.bucket.put(object.key, bytes, {
        httpMetadata: { contentType: object.contentType },
        customMetadata: {
          sha256: object.sha256,
          retention: "permanent",
        },
        onlyIf: { etagDoesNotMatch: "*" },
      });
    } catch {
      // A conditional create can lose a race. The postcondition below decides
      // whether the immutable object is acceptable in both success and race cases.
    }
    const stored = await this.bucket.head(object.key);
    if (
      stored === null ||
      stored.size !== object.sizeBytes ||
      stored.customMetadata?.sha256 !== object.sha256
    ) {
      throw new Error("R2 trace write failed integrity verification");
    }
    const verified = await this.readTraceBytes(object);
    if (verified === null) {
      throw new Error("R2 trace write failed byte verification");
    }
  }

  async createReadGrant(input: CreateGrantInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO trace_read_grants (
          token_hash, trace_sha256, operator_github_id, reason, request_id,
          created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        input.tokenHash,
        input.traceSha256,
        input.operatorGithubId,
        input.reason,
        input.requestId,
        input.createdAt,
        input.expiresAt,
      )
      .run();
  }

  async consumeReadGrant(
    tokenHash: string,
    traceSha256: string,
    operatorGithubId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE trace_read_grants SET consumed_at = ?
         WHERE token_hash = ? AND trace_sha256 = ? AND operator_github_id = ?
           AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(now, tokenHash, traceSha256, operatorGithubId, now)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async readTraceBytes(object: TraceObject): Promise<Uint8Array | null> {
    const value = await this.bucket.get(object.key);
    if (
      value === null ||
      value.size !== object.sizeBytes ||
      value.customMetadata?.sha256 !== object.sha256
    ) {
      return null;
    }
    const response = new Response(value.body);
    if (response.body === null) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > object.sizeBytes) {
          await reader.cancel("R2 object exceeded immutable size");
          return null;
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (
      bytes.byteLength !== object.sizeBytes ||
      (await sha256Hex(bytes)) !== object.sha256
    ) {
      return null;
    }
    return bytes;
  }

  async writeAudit(input: AuditInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO private_audit_events (
          id, actor_github_id, action, target, request_id, created_at, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.actorGithubId,
        input.action,
        input.target,
        input.requestId,
        input.createdAt,
        JSON.stringify(input.details),
      )
      .run();
  }

  async createWalletClaim(
    claim: WalletClaim,
  ): Promise<PersistenceResult<WalletClaim>> {
    const byDigest = await this.db
      .prepare("SELECT * FROM wallet_claims WHERE record_sha256 = ?")
      .bind(claim.recordSha256)
      .first<WalletClaimRow>();
    if (byDigest !== null)
      return { status: "existing", value: mapWalletClaim(byDigest) };
    if (claim.supersedesClaimId !== null) {
      const previous = await this.getWalletClaim(claim.supersedesClaimId);
      if (previous === null || previous.githubId !== claim.githubId) {
        return { status: "conflict" };
      }
    }
    try {
      await this.db
        .prepare(
          `INSERT INTO wallet_claims (
            id, github_user_id, github_login, wallet_address, source,
            issue_repository, issue_number, source_body_sha256, observed_at,
            record_sha256, supersedes_claim_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          claim.id,
          claim.githubId,
          claim.githubLogin,
          claim.walletAddress,
          claim.source,
          claim.issueRepository,
          claim.issueNumber,
          claim.sourceBodySha256,
          claim.observedAt,
          claim.recordSha256,
          claim.supersedesClaimId,
          claim.createdAt,
        )
        .run();
    } catch {
      return { status: "conflict" };
    }
    return { status: "created", value: claim };
  }

  async getWalletClaim(claimId: string): Promise<WalletClaim | null> {
    const row = await this.db
      .prepare("SELECT * FROM wallet_claims WHERE id = ?")
      .bind(claimId)
      .first<WalletClaimRow>();
    return row === null ? null : mapWalletClaim(row);
  }

  async getCurrentWalletClaim(githubId: string): Promise<WalletClaim | null> {
    const row = await this.db
      .prepare(
        `SELECT claim.* FROM wallet_claims AS claim
         WHERE claim.github_user_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM wallet_claims AS successor
             WHERE successor.supersedes_claim_id = claim.id
           )
         ORDER BY claim.observed_at DESC, claim.created_at DESC
         LIMIT 1`,
      )
      .bind(githubId)
      .first<WalletClaimRow>();
    return row === null ? null : mapWalletClaim(row);
  }
}
