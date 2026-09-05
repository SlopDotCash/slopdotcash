import { describe, expect, it } from "vitest";
import {
  CloudflareTracePersistence,
  type D1Database,
  type R2Bucket,
} from "../../../backend/trace/cloudflare-persistence";
import type { TraceObject } from "../../../backend/trace/contracts";

const object: TraceObject = {
  sha256: "eafe895eb8119e6e5d06463590b2ef81b3651c157d5c8e18f1889186c7fd0ac0",
  key: "traces/sha256/ea/eafe895eb8119e6e5d06463590b2ef81b3651c157d5c8e18f1889186c7fd0ac0",
  sizeBytes: 5,
  contentType: "text/plain",
  createdByGithubId: "42",
  createdAt: "2026-08-15T12:00:00.000Z",
};

function persistence(bucket: R2Bucket): CloudflareTracePersistence {
  return new CloudflareTracePersistence({} as D1Database, bucket);
}

function body(text: string): ReadableStream<Uint8Array> {
  const stream = new Response(text).body;
  if (stream === null) throw new Error("Test response body is unavailable");
  return stream;
}

describe("Cloudflare trace object persistence", () => {
  it("renews an expired unconsumed upload intent without changing its capability", async () => {
    const expired = {
      token_hash: "a".repeat(64),
      run_id: "run-1",
      github_user_id: "42",
      trace_sha256: object.sha256,
      size_bytes: object.sizeBytes,
      content_type: object.contentType,
      idempotency_key: "intent-key-0001",
      created_at: "2026-08-15T12:00:00.000Z",
      expires_at: "2026-08-15T12:05:00.000Z",
      consumed_at: null,
    };
    let renewed = false;
    const db: D1Database = {
      batch: async () => [],
      prepare(query) {
        const statement = {
          bind() {
            return statement;
          },
          async first<T>() {
            return {
              ...expired,
              ...(renewed
                ? {
                    expires_at: "2026-08-15T12:11:00.000Z",
                  }
                : {}),
            } as T;
          },
          async run() {
            expect(query).toContain("UPDATE trace_upload_intents");
            renewed = true;
            return { success: true };
          },
        };
        return statement;
      },
    };
    const result = await new CloudflareTracePersistence(
      db,
      {} as R2Bucket,
    ).createUploadIntent({
      tokenHash: expired.token_hash,
      runId: expired.run_id,
      githubId: expired.github_user_id,
      sha256: expired.trace_sha256,
      sizeBytes: expired.size_bytes,
      contentType: expired.content_type,
      idempotencyKey: expired.idempotency_key,
      createdAt: "2026-08-15T12:06:00.000Z",
      expiresAt: "2026-08-15T12:11:00.000Z",
      consumedAt: null,
    });
    expect(result.status).toBe("existing");
    expect(result.status === "existing" && result.value.expiresAt).toBe(
      "2026-08-15T12:11:00.000Z",
    );
  });

  it("does not disguise a missing atomic-attachment migration as replay", async () => {
    const db: D1Database = {
      batch: async () => {
        throw new Error("no such table: trace_attachment_commits");
      },
      prepare(query) {
        let bindings: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) {
            bindings = values;
            return statement;
          },
          async first<T>() {
            if (query.includes("FROM trace_uploads")) return null;
            if (query.includes("FROM trace_runs")) {
              return {
                id: "run-1",
                client_run_id: "client-run-1",
                github_user_id: "42",
                github_login: "octocat",
                project_id: "eliza",
                repository: "elizaOS/eliza",
                project_policy_revision: "c".repeat(40),
                provider: "openai",
                model: "gpt-5",
                client: "codex",
                client_version: "1.0.0",
                state: "awaiting_trace",
                trace_sha256: null,
                created_at: object.createdAt,
                finalized_at: null,
                create_idempotency_key: "create-run-key-0001",
              } as T;
            }
            if (query.includes("FROM trace_upload_intents")) {
              return {
                token_hash: bindings[0],
                run_id: "run-1",
                github_user_id: "42",
                trace_sha256: object.sha256,
                size_bytes: object.sizeBytes,
                content_type: object.contentType,
                idempotency_key: "intent-key-0001",
                created_at: object.createdAt,
                expires_at: "2026-08-15T12:05:00.000Z",
                consumed_at: null,
              } as T;
            }
            return null;
          },
          async run() {
            return { success: true };
          },
        };
        return statement;
      },
    };
    const bucket = {} as R2Bucket;
    await expect(
      new CloudflareTracePersistence(db, bucket).attachTrace({
        runId: "run-1",
        githubId: "42",
        idempotencyKey: "a".repeat(64),
        intentConsumedAt: object.createdAt,
        object,
      }),
    ).rejects.toThrow(/trace_attachment_commits/u);
  });

  it("verifies the R2 postcondition after a reported successful create", async () => {
    const bucket: R2Bucket = {
      head: async () => null,
      put: async () => ({}),
      get: async () => ({
        body: body("trace"),
        size: object.sizeBytes,
        customMetadata: { sha256: object.sha256 },
      }),
    };

    await expect(
      persistence(bucket).putTraceBytes(
        object,
        new TextEncoder().encode("trace"),
      ),
    ).rejects.toThrow("R2 trace write failed integrity verification");
  });

  it("rejects a write whose stored bytes disagree with trusted metadata", async () => {
    const bucket: R2Bucket = {
      head: async () => ({
        size: object.sizeBytes,
        customMetadata: { sha256: object.sha256 },
      }),
      put: async () => ({}),
      get: async () => ({
        body: body("wrong"),
        size: object.sizeBytes,
        customMetadata: { sha256: object.sha256 },
      }),
    };

    await expect(
      persistence(bucket).putTraceBytes(
        object,
        new TextEncoder().encode("trace"),
      ),
    ).rejects.toThrow(/byte verification/u);
  });

  it("accepts a conditional-create race only when immutable metadata matches", async () => {
    let calls = 0;
    const bucket: R2Bucket = {
      head: async () => {
        calls += 1;
        return calls === 1
          ? null
          : {
              size: object.sizeBytes,
              customMetadata: { sha256: object.sha256 },
            };
      },
      put: async () => {
        throw new Error("conditional create lost race");
      },
      get: async () => ({
        body: body("trace"),
        size: object.sizeBytes,
        customMetadata: { sha256: object.sha256 },
      }),
    };

    await expect(
      persistence(bucket).putTraceBytes(
        object,
        new TextEncoder().encode("trace"),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a pre-existing object with conflicting immutable metadata", async () => {
    const bucket: R2Bucket = {
      head: async () => ({
        size: object.sizeBytes,
        customMetadata: { sha256: "b".repeat(64) },
      }),
      put: async () => ({}),
      get: async () => null,
    };

    await expect(
      persistence(bucket).putTraceBytes(
        object,
        new TextEncoder().encode("trace"),
      ),
    ).rejects.toThrow("Immutable R2 trace object has conflicting metadata");
  });

  it("cancels an R2 object whose body exceeds its immutable size", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(3));
      },
      cancel() {
        cancelled = true;
      },
    });
    const bucket: R2Bucket = {
      head: async () => null,
      put: async () => ({}),
      get: async () => ({
        body,
        size: object.sizeBytes,
        customMetadata: { sha256: object.sha256 },
      }),
    };

    await expect(
      persistence(bucket).readTraceBytes(object),
    ).resolves.toBeNull();
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
