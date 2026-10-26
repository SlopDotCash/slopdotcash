import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readBoundedBytes } from "../../src/lib/browser-json";
import type { D1TransactionalDatabase as D1Database, D1Result } from "../d1";
import { notifyWalletChanged } from "../notifications/events";
import {
  hasParticipationBan,
  PARTICIPATION_BAN_QUERY,
} from "../projects/account-bans";
import type {
  AttachTraceInput,
  AuditInput,
  CreateGrantInput,
  CreateRunInput,
  PersistenceResult,
  PrivateIntakeStatus,
  RunProgressEvent,
  TraceObject,
  TracePersistence,
  TraceRun,
  TraceUploadIntent,
  WalletClaim,
  WalletPossessionAttestationRecord,
  WalletPossessionChallengeRecord,
} from "./contracts";

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
  chain: WalletClaim["chain"];
  source: WalletClaim["source"];
  issue_repository: string | null;
  issue_number: number | null;
  source_body_sha256: string;
  observed_at: string;
  record_sha256: string;
  supersedes_claim_id: string | null;
  created_at: string;
};

type WalletPossessionChallengeRow = {
  challenge_id: string;
  claim_id: string;
  github_user_id: string;
  wallet_address: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type WalletPossessionAttestationRow = {
  id: string;
  claim_id: string;
  challenge_id: string;
  github_user_id: string;
  wallet_address: string;
  signature: string;
  message_sha256: string;
  attested_at: string;
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
    chain: row.chain,
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

function mapWalletPossessionChallenge(
  row: WalletPossessionChallengeRow,
): WalletPossessionChallengeRecord {
  return {
    challengeId: row.challenge_id,
    claimId: row.claim_id,
    githubId: row.github_user_id,
    walletAddress: row.wallet_address,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

function mapWalletPossessionAttestation(
  row: WalletPossessionAttestationRow,
): WalletPossessionAttestationRecord {
  return {
    id: row.id,
    claimId: row.claim_id,
    challengeId: row.challenge_id,
    githubId: row.github_user_id,
    walletAddress: row.wallet_address,
    signature: row.signature,
    messageSha256: row.message_sha256,
    attestedAt: row.attested_at,
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

/**
 * The one writer of `wallet_claims`: the claim, its audit event and the
 * wallet-change notice commit together. A replay returns the existing claim;
 * a concurrent successor of the same predecessor is a conflict.
 */
export async function insertWalletClaim(
  db: D1Database,
  claim: WalletClaim,
  audit: AuditInput,
): Promise<PersistenceResult<WalletClaim>> {
  const byDigest = await db
    .prepare("SELECT * FROM wallet_claims WHERE record_sha256 = ?")
    .bind(claim.recordSha256)
    .first<WalletClaimRow>();
  if (byDigest !== null)
    return { status: "existing", value: mapWalletClaim(byDigest) };
  if (claim.supersedesClaimId !== null) {
    const previous = await db
      .prepare("SELECT * FROM wallet_claims WHERE id = ?")
      .bind(claim.supersedesClaimId)
      .first<WalletClaimRow>();
    if (
      previous === null ||
      previous.github_user_id !== claim.githubId ||
      previous.chain !== claim.chain
    ) {
      return { status: "conflict" };
    }
  }
  const claimInsert = db
    .prepare(
      `INSERT INTO wallet_claims (
          id, github_user_id, github_login, wallet_address, chain, source,
          issue_repository, issue_number, source_body_sha256, observed_at,
          record_sha256, supersedes_claim_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      claim.id,
      claim.githubId,
      claim.githubLogin,
      claim.walletAddress,
      claim.chain,
      claim.source,
      claim.issueRepository,
      claim.issueNumber,
      claim.sourceBodySha256,
      claim.observedAt,
      claim.recordSha256,
      claim.supersedesClaimId,
      claim.createdAt,
    );
  const auditInsert = db
    .prepare(
      `INSERT INTO private_audit_events (
        id, actor_github_id, action, target, request_id, created_at, details_json
      ) SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM wallet_claims WHERE id = ?)`,
    )
    .bind(
      audit.id,
      audit.actorGithubId,
      audit.action,
      audit.target,
      audit.requestId,
      audit.createdAt,
      JSON.stringify(audit.details),
      claim.id,
    );
  try {
    // The inbox row is a no-op on replay, so only the claim and its audit
    // are checked.
    const results = (
      await db.batch([
        claimInsert,
        auditInsert,
        notifyWalletChanged(db, claim.id, claim.createdAt),
      ])
    ).slice(0, 2);
    if (
      results.length !== 2 ||
      results.some((result) => !result.success) ||
      results.some((result) => (result.meta?.changes ?? 0) !== 1)
    ) {
      throw new Error("Atomic wallet claim and audit did not both commit");
    }
  } catch (error) {
    const raced = await db
      .prepare("SELECT * FROM wallet_claims WHERE record_sha256 = ?")
      .bind(claim.recordSha256)
      .first<WalletClaimRow>();
    if (raced !== null)
      return { status: "existing", value: mapWalletClaim(raced) };
    const competing = await (claim.supersedesClaimId === null
      ? db
          .prepare(
            `SELECT id FROM wallet_claims
             WHERE github_user_id = ? AND chain = ?
               AND supersedes_claim_id IS NULL`,
          )
          .bind(claim.githubId, claim.chain)
      : db
          .prepare("SELECT id FROM wallet_claims WHERE supersedes_claim_id = ?")
          .bind(claim.supersedesClaimId)
    ).first<{ id: string }>();
    if (competing !== null) return { status: "conflict" };
    throw error;
  }
  return { status: "created", value: claim };
}

export class CloudflareTracePersistence implements TracePersistence {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
  ) {}

  hasParticipationBan(githubId: string): Promise<boolean> {
    return hasParticipationBan(this.db, githubId);
  }

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
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_trace', NULL, ?, NULL, ? WHERE NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
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
          input.githubId,
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
    if (created === null) return { status: "conflict" };
    return { status: "created", value: created };
  }

  async getRun(runId: string): Promise<TraceRun | null> {
    const row = await this.db
      .prepare("SELECT * FROM trace_runs WHERE id = ?")
      .bind(runId)
      .first<RunRow>();
    return row === null ? null : mapRun(row);
  }

  async reserveTraceWrite(
    input: Pick<AttachTraceInput, "runId" | "githubId" | "object">,
  ): Promise<boolean> {
    const object = input.object;
    await this.db
      .prepare(`INSERT INTO trace_write_reservations
      (run_id, github_user_id, trace_sha256, r2_key, size_bytes, content_type, created_at)
      SELECT id, github_user_id, ?, ?, ?, ?, ? FROM trace_runs
      WHERE id = ? AND github_user_id = ? AND state != 'finalized'
        AND (trace_sha256 IS NULL OR trace_sha256 = ?)
        AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})
      ON CONFLICT(run_id) DO NOTHING`)
      .bind(
        object.sha256,
        object.key,
        object.sizeBytes,
        object.contentType,
        object.createdAt,
        input.runId,
        input.githubId,
        object.sha256,
        input.githubId,
      )
      .run();
    const reserved = await this.db
      .prepare(`SELECT reservation.run_id
      FROM trace_write_reservations AS reservation JOIN trace_runs AS run ON run.id = reservation.run_id
      WHERE reservation.run_id = ? AND reservation.github_user_id = ?
        AND reservation.trace_sha256 = ? AND reservation.r2_key = ?
        AND reservation.size_bytes = ? AND reservation.content_type = ?
        AND run.state != 'finalized'
        AND (run.trace_sha256 IS NULL OR run.trace_sha256 = ?)
        AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`)
      .bind(
        input.runId,
        input.githubId,
        object.sha256,
        object.key,
        object.sizeBytes,
        object.contentType,
        object.sha256,
        input.githubId,
      )
      .first();
    return reserved !== null;
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
          AND consumed_at IS NULL AND expires_at > ?
          AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
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
        input.githubId,
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
           AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})
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
      if (
        stillAvailable === null ||
        (await this.hasParticipationBan(input.githubId))
      ) {
        return { status: "conflict" };
      }
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
    const updated = await this.db
      .prepare(
        `UPDATE trace_runs SET state = 'finalized', finalized_at = COALESCE(finalized_at, ?)
         WHERE id = ? AND github_user_id = ? AND trace_sha256 IS NOT NULL
           AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
      )
      .bind(finalizedAt, runId, githubId, githubId)
      .run();
    if ((updated.meta?.changes ?? 0) !== 1) return null;
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
      const inserted = await this.db
        .prepare(
          `INSERT INTO run_progress_events (
            id, run_id, github_user_id, kind, occurred_at, source,
            github_object_id, github_url, head_sha, created_at, idempotency_key
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM trace_runs
           WHERE id = ? AND github_user_id = ? AND state != 'finalized' AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
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
          event.runId,
          event.githubId,
          event.githubId,
        )
        .run();
      if ((inserted.meta?.changes ?? 0) !== 1) {
        return { status: "conflict" };
      }
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
      if (await this.hasParticipationBan(intent.githubId)) {
        return { status: "conflict" };
      }
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
             WHERE token_hash = ? AND consumed_at IS NULL AND expires_at <= ?
               AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
          )
          .bind(
            intent.expiresAt,
            mapped.tokenHash,
            intent.createdAt,
            intent.githubId,
          )
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
    let inserted: D1Result;
    try {
      inserted = await this.db
        .prepare(
          `INSERT INTO trace_upload_intents (
            token_hash, run_id, github_user_id, trace_sha256, size_bytes,
            content_type, idempotency_key, created_at, expires_at, consumed_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL WHERE NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
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
          intent.githubId,
        )
        .run();
    } catch {
      return { status: "conflict" };
    }
    if (!inserted.success) {
      throw new Error("Trace upload intent insertion failed");
    }
    if ((inserted.meta?.changes ?? 0) !== 1) {
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

  async createReadGrant(
    input: CreateGrantInput,
    audit: AuditInput,
  ): Promise<void> {
    const grantInsert = this.db
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
      );
    const auditInsert = this.db
      .prepare(
        `INSERT INTO private_audit_events (
          id, actor_github_id, action, target, request_id, created_at, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        audit.id,
        audit.actorGithubId,
        audit.action,
        audit.target,
        audit.requestId,
        audit.createdAt,
        JSON.stringify(audit.details),
      );
    const results = await this.db.batch([grantInsert, auditInsert]);
    if (
      results.length !== 2 ||
      results.some((result) => !result.success) ||
      results.some((result) => (result.meta?.changes ?? 0) !== 1)
    ) {
      throw new Error("Atomic trace read grant creation failed");
    }
  }

  async consumeReadGrant(
    tokenHash: string,
    traceSha256: string,
    operatorGithubId: string,
    now: string,
    audit: AuditInput,
  ): Promise<boolean> {
    const auditInsert = this.db
      .prepare(
        `INSERT INTO private_audit_events (
          id, actor_github_id, action, target, request_id, created_at, details_json
        ) SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM trace_read_grants
            WHERE token_hash = ? AND trace_sha256 = ? AND operator_github_id = ?
              AND consumed_at IS NULL AND expires_at > ?
          )`,
      )
      .bind(
        audit.id,
        audit.actorGithubId,
        audit.action,
        audit.target,
        audit.requestId,
        audit.createdAt,
        JSON.stringify(audit.details),
        tokenHash,
        traceSha256,
        operatorGithubId,
        now,
      );
    const grantConsume = this.db
      .prepare(
        `UPDATE trace_read_grants SET consumed_at = ?
         WHERE token_hash = ? AND trace_sha256 = ? AND operator_github_id = ?
           AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(now, tokenHash, traceSha256, operatorGithubId, now);
    const results = await this.db.batch([auditInsert, grantConsume]);
    if (results.length !== 2 || results.some((result) => !result.success)) {
      throw new Error("Atomic trace read grant consumption failed");
    }
    const auditChanges = results[0].meta?.changes ?? 0;
    const grantChanges = results[1].meta?.changes ?? 0;
    if (auditChanges === 0 && grantChanges === 0) return false;
    if (auditChanges !== 1 || grantChanges !== 1) {
      throw new Error("Trace read grant and audit state diverged");
    }
    return true;
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
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBytes(
        response,
        object.sizeBytes,
        "R2 trace object",
      );
    } catch (error) {
      // An object past its immutable size is not the recorded trace.
      if (error instanceof RangeError) return null;
      throw error;
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

  createWalletClaim(
    claim: WalletClaim,
    audit: AuditInput,
  ): Promise<PersistenceResult<WalletClaim>> {
    return insertWalletClaim(this.db, claim, audit);
  }

  async createWalletPossessionChallenge(
    record: WalletPossessionChallengeRecord,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO wallet_possession_challenges (
            challenge_id, claim_id, github_user_id, wallet_address,
            issued_at, expires_at, consumed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        record.challengeId,
        record.claimId,
        record.githubId,
        record.walletAddress,
        record.issuedAt,
        record.expiresAt,
        record.createdAt,
      )
      .run();
  }

  /**
   * Consumes an unexpired challenge exactly once. The guard is in the
   * statement rather than a read followed by a write, so two concurrent
   * submissions of the same signature cannot both succeed.
   */
  async consumeWalletPossessionChallenge(
    challengeId: string,
    consumedAt: string,
  ): Promise<WalletPossessionChallengeRecord | null> {
    const row = await this.db
      .prepare(
        `UPDATE wallet_possession_challenges
           SET consumed_at = ?
         WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?
         RETURNING *`,
      )
      .bind(consumedAt, challengeId, consumedAt)
      .first<WalletPossessionChallengeRow>();
    return row === null ? null : mapWalletPossessionChallenge(row);
  }

  async createWalletPossessionAttestation(
    record: WalletPossessionAttestationRecord,
    audit: AuditInput,
  ): Promise<PersistenceResult<WalletPossessionAttestationRecord>> {
    const existing = await this.getWalletPossessionAttestation(record.claimId);
    if (existing !== null) return { status: "existing", value: existing };
    const insert = this.db
      .prepare(
        `INSERT INTO wallet_possession_attestations (
            id, claim_id, challenge_id, github_user_id, wallet_address,
            signature, message_sha256, attested_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.claimId,
        record.challengeId,
        record.githubId,
        record.walletAddress,
        record.signature,
        record.messageSha256,
        record.attestedAt,
        record.createdAt,
      );
    const auditInsert = this.db
      .prepare(
        `INSERT INTO private_audit_events (
            id, actor_github_id, action, target, request_id, created_at, details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        audit.id,
        audit.actorGithubId,
        audit.action,
        audit.target,
        audit.requestId,
        audit.createdAt,
        JSON.stringify(audit.details),
      );
    try {
      await this.db.batch([insert, auditInsert]);
    } catch (error) {
      const competing = await this.getWalletPossessionAttestation(
        record.claimId,
      );
      if (competing !== null) return { status: "existing", value: competing };
      throw error;
    }
    return { status: "created", value: record };
  }

  async getWalletPossessionAttestation(
    claimId: string,
  ): Promise<WalletPossessionAttestationRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM wallet_possession_attestations WHERE claim_id = ?",
      )
      .bind(claimId)
      .first<WalletPossessionAttestationRow>();
    return row === null ? null : mapWalletPossessionAttestation(row);
  }

  async getWalletClaim(claimId: string): Promise<WalletClaim | null> {
    const row = await this.db
      .prepare("SELECT * FROM wallet_claims WHERE id = ?")
      .bind(claimId)
      .first<WalletClaimRow>();
    return row === null ? null : mapWalletClaim(row);
  }

  async getCurrentWalletClaim(
    githubId: string,
    chain: WalletClaim["chain"],
  ): Promise<WalletClaim | null> {
    const row = await this.db
      .prepare(
        `SELECT claim.* FROM wallet_claims AS claim
         WHERE claim.github_user_id = ?
           AND claim.chain = ?
           AND NOT EXISTS (
             SELECT 1 FROM wallet_claims AS successor
             WHERE successor.supersedes_claim_id = claim.id
           )
         ORDER BY claim.observed_at DESC, claim.created_at DESC
         LIMIT 1`,
      )
      .bind(githubId, chain)
      .first<WalletClaimRow>();
    return row === null ? null : mapWalletClaim(row);
  }
}

/**
 * The hourly health workflow renews this observation. A row older than 24
 * hours, or a failed read, keeps optional trace collection unavailable.
 */
export async function privateIntakeStatus(
  db: D1Database,
  now = new Date(),
): Promise<PrivateIntakeStatus> {
  let row: { enabled: number; verified_at: string } | null;
  try {
    row = await db
      .prepare(
        "SELECT enabled, verified_at FROM private_intake_status WHERE singleton = 1",
      )
      .first<{ enabled: number; verified_at: string }>();
  } catch {
    console.error("private intake status read failure");
    return { status: "unavailable" };
  }
  if (
    !row ||
    ![0, 1].includes(row.enabled) ||
    typeof row.verified_at !== "string"
  )
    return { status: "unavailable" };
  const age = now.getTime() - Date.parse(row.verified_at);
  if (!Number.isFinite(age) || age < -300000 || age > 24 * 60 * 60 * 1000)
    return { status: "unavailable" };
  return {
    status: "verified",
    enabled: row.enabled === 1,
    verifiedAt: row.verified_at,
  };
}
