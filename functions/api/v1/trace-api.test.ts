import { describe, expect, it } from "vitest";
import { signApiToken, verifyApiToken } from "../../../backend/trace/auth";
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
} from "../../../backend/trace/contracts";
import {
  handleTraceApi,
  TRACE_API_CONTRACT_VERSION,
  type TraceApiDependencies,
} from "../../../backend/trace/handler";
import { readJsonObject, sha256Hex } from "../../../backend/trace/validation";
import {
  MAX_IDENTITY_RESPONSE_BYTES,
  onRequest as onPagesRequest,
} from "./[[path]]";

const SECRET = "A".repeat(43);
const NOW = new Date("2026-08-15T12:00:00.000Z");

class MemoryPersistence implements TracePersistence {
  readonly runs = new Map<string, TraceRun>();
  readonly createKeys = new Map<
    string,
    { fingerprint: string; runId: string }
  >();
  readonly objects = new Map<string, TraceObject>();
  readonly bytes = new Map<string, Uint8Array>();
  readonly uploads = new Map<string, { runId: string; sha256: string }>();
  readonly intents = new Map<string, TraceUploadIntent>();
  readonly intentKeys = new Map<string, string>();
  readonly events = new Map<string, RunProgressEvent>();
  readonly eventKeys = new Map<string, string>();
  readonly grants = new Map<string, CreateGrantInput & { consumed: boolean }>();
  readonly audits: AuditInput[] = [];
  readonly claims = new Map<string, WalletClaim>();
  failNextPut = false;

  async createRun(input: CreateRunInput): Promise<PersistenceResult<TraceRun>> {
    const key = `${input.githubId}:${input.idempotencyKey}`;
    const fingerprint = JSON.stringify({
      ...input,
      id: undefined,
      createdAt: undefined,
    });
    const prior = this.createKeys.get(key);
    if (prior !== undefined) {
      const run = this.runs.get(prior.runId);
      if (run === undefined || prior.fingerprint !== fingerprint)
        return { status: "conflict" };
      return { status: "existing", value: run };
    }
    const run: TraceRun = {
      id: input.id,
      clientRunId: input.clientRunId,
      githubId: input.githubId,
      githubLogin: input.githubLogin,
      projectId: input.projectId,
      repository: input.repository,
      projectPolicyRevision: input.projectPolicyRevision,
      provider: input.provider,
      model: input.model,
      client: input.client,
      clientVersion: input.clientVersion,
      state: "awaiting_trace",
      traceSha256: null,
      createdAt: input.createdAt,
      finalizedAt: null,
    };
    this.runs.set(run.id, run);
    this.createKeys.set(key, { fingerprint, runId: run.id });
    return { status: "created", value: run };
  }

  async getRun(runId: string): Promise<TraceRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async attachTrace(
    input: AttachTraceInput,
  ): Promise<PersistenceResult<TraceRun>> {
    const key = `${input.githubId}:${input.idempotencyKey}`;
    const prior = this.uploads.get(key);
    if (prior !== undefined) {
      const run = this.runs.get(prior.runId);
      if (
        run === undefined ||
        prior.runId !== input.runId ||
        prior.sha256 !== input.object.sha256 ||
        run.traceSha256 !== input.object.sha256
      ) {
        return { status: "conflict" };
      }
      return { status: "conflict" };
    }
    const run = this.runs.get(input.runId);
    const intent = this.intents.get(input.idempotencyKey);
    if (
      run === undefined ||
      run.githubId !== input.githubId ||
      run.state === "finalized" ||
      (run.traceSha256 !== null && run.traceSha256 !== input.object.sha256) ||
      intent === undefined ||
      intent.consumedAt !== null ||
      intent.expiresAt <= input.intentConsumedAt ||
      intent.runId !== input.runId ||
      intent.githubId !== input.githubId ||
      intent.sha256 !== input.object.sha256 ||
      intent.sizeBytes !== input.object.sizeBytes ||
      intent.contentType !== input.object.contentType
    ) {
      return { status: "conflict" };
    }
    const updated = {
      ...run,
      state: "trace_uploaded",
      traceSha256: input.object.sha256,
    } as const;
    this.runs.set(run.id, updated);
    this.intents.set(input.idempotencyKey, {
      ...intent,
      consumedAt: input.intentConsumedAt,
    });
    this.objects.set(input.object.sha256, input.object);
    this.uploads.set(key, { runId: run.id, sha256: input.object.sha256 });
    return { status: "created", value: updated };
  }

  async finalizeRun(
    runId: string,
    githubId: string,
    finalizedAt: string,
  ): Promise<TraceRun | null> {
    const run = this.runs.get(runId);
    if (
      run === undefined ||
      run.githubId !== githubId ||
      run.traceSha256 === null
    )
      return null;
    const updated: TraceRun = {
      ...run,
      state: "finalized",
      finalizedAt: run.finalizedAt ?? finalizedAt,
    };
    this.runs.set(runId, updated);
    return updated;
  }

  async appendEvent(
    event: RunProgressEvent & { idempotencyKey: string },
  ): Promise<PersistenceResult<RunProgressEvent>> {
    const key = `${event.githubId}:${event.idempotencyKey}`;
    const priorId = this.eventKeys.get(key);
    if (priorId !== undefined) {
      const prior = this.events.get(priorId);
      if (
        prior === undefined ||
        prior.runId !== event.runId ||
        prior.kind !== event.kind ||
        prior.occurredAt !== event.occurredAt ||
        prior.source !== event.source ||
        prior.githubObjectId !== event.githubObjectId ||
        prior.githubUrl !== event.githubUrl ||
        prior.headSha !== event.headSha
      ) {
        return { status: "conflict" };
      }
      return { status: "existing", value: prior };
    }
    this.events.set(event.id, event);
    this.eventKeys.set(key, event.id);
    return { status: "created", value: event };
  }

  async getTraceObject(sha256: string): Promise<TraceObject | null> {
    return this.objects.get(sha256) ?? null;
  }

  async createUploadIntent(
    intent: TraceUploadIntent,
  ): Promise<PersistenceResult<TraceUploadIntent>> {
    const key = `${intent.githubId}:${intent.idempotencyKey}`;
    const priorHash = this.intentKeys.get(key);
    if (priorHash !== undefined) {
      const prior = this.intents.get(priorHash);
      if (
        prior === undefined ||
        prior.runId !== intent.runId ||
        prior.sha256 !== intent.sha256 ||
        prior.sizeBytes !== intent.sizeBytes ||
        prior.contentType !== intent.contentType
      ) {
        return { status: "conflict" };
      }
      return { status: "existing", value: prior };
    }
    this.intents.set(intent.tokenHash, { ...intent });
    this.intentKeys.set(key, intent.tokenHash);
    return { status: "created", value: intent };
  }

  async getUploadIntent(
    tokenHash: string,
    now: string,
  ): Promise<TraceUploadIntent | null> {
    const intent = this.intents.get(tokenHash);
    if (
      intent === undefined ||
      intent.consumedAt !== null ||
      intent.expiresAt <= now
    )
      return null;
    return { ...intent };
  }

  async putTraceBytes(object: TraceObject, bytes: Uint8Array): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("transient R2 failure");
    }
    const existing = this.bytes.get(object.sha256);
    if (existing !== undefined) {
      expect(existing).toEqual(bytes);
      return;
    }
    this.bytes.set(object.sha256, bytes.slice());
  }

  async createReadGrant(input: CreateGrantInput): Promise<void> {
    this.grants.set(input.tokenHash, { ...input, consumed: false });
  }

  async consumeReadGrant(
    tokenHash: string,
    traceSha256: string,
    operatorGithubId: string,
    now: string,
  ): Promise<boolean> {
    const grant = this.grants.get(tokenHash);
    if (
      grant === undefined ||
      grant.consumed ||
      grant.traceSha256 !== traceSha256 ||
      grant.operatorGithubId !== operatorGithubId ||
      grant.expiresAt <= now
    ) {
      return false;
    }
    grant.consumed = true;
    return true;
  }

  async readTraceBytes(object: TraceObject): Promise<Uint8Array | null> {
    return this.bytes.get(object.sha256) ?? null;
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createWalletClaim(
    claim: WalletClaim,
  ): Promise<PersistenceResult<WalletClaim>> {
    const existing = [...this.claims.values()].find(
      (item) => item.recordSha256 === claim.recordSha256,
    );
    if (existing !== undefined) return { status: "existing", value: existing };
    const actorClaims = [...this.claims.values()].filter(
      (item) => item.githubId === claim.githubId,
    );
    if (
      (claim.supersedesClaimId === null &&
        actorClaims.some((item) => item.supersedesClaimId === null)) ||
      (claim.supersedesClaimId !== null &&
        actorClaims.some(
          (item) => item.supersedesClaimId === claim.supersedesClaimId,
        ))
    ) {
      return { status: "conflict" };
    }
    this.claims.set(claim.id, claim);
    return { status: "created", value: claim };
  }

  async getWalletClaim(claimId: string): Promise<WalletClaim | null> {
    return this.claims.get(claimId) ?? null;
  }

  async getCurrentWalletClaim(githubId: string): Promise<WalletClaim | null> {
    const claims = [...this.claims.values()].filter(
      (claim) => claim.githubId === githubId,
    );
    return (
      claims.find(
        (claim) =>
          !claims.some((candidate) => candidate.supersedesClaimId === claim.id),
      ) ?? null
    );
  }
}

let idCounter = 0;
function dependencies(
  persistence = new MemoryPersistence(),
): TraceApiDependencies {
  return {
    persistence,
    authSecret: SECRET,
    operatorGithubIds: new Set(["99"]),
    now: () => new Date(NOW),
    randomId: () => `identifier_${String(++idCounter).padStart(8, "0")}`,
    verifyIdentityAssertion: async (assertion) =>
      assertion === "valid_slop_identity_assertion_value"
        ? { githubId: "42", githubLogin: "octocat" }
        : null,
  };
}

async function token(
  githubId: string,
  githubLogin: string,
  roles: Array<"contributor" | "project_owner" | "operator">,
): Promise<string> {
  const now = Math.floor(NOW.getTime() / 1000);
  return signApiToken(
    {
      iss: "slop.cash",
      aud: "private-trace-api",
      sub: `github:${githubId}`,
      githubId,
      githubLogin,
      roles,
      iat: now,
      exp: now + (roles.includes("operator") ? 240 : 600),
      jti: `token_identifier_${githubId}`,
    },
    SECRET,
  );
}

function request(
  path: string,
  method: string,
  bearer: string,
  body?: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://api.slop.cash/api/v1/${path}`, {
    method,
    body,
    headers: { authorization: `Bearer ${bearer}`, ...headers },
  });
}

async function createRun(
  deps: TraceApiDependencies,
  bearer: string,
  key = "create_run_key_0001",
  identity = {
    provider: "openai",
    model: "gpt-5",
    client: "codex",
    clientVersion: "1.0.0",
  },
) {
  return handleTraceApi(
    request(
      "runs",
      "POST",
      bearer,
      JSON.stringify({
        clientRunId: "run_01HZXTESTCLIENTRUN",
        projectId: "eliza",
        repository: "elizaOS/eliza",
        projectPolicyRevision: "a".repeat(40),
        ...identity,
      }),
      { "content-type": "application/json", "idempotency-key": key },
    ),
    deps,
  );
}

async function uploadTrace(
  deps: TraceApiDependencies,
  bearer: string,
  serverRunId: string,
  bytes: Uint8Array,
  key: string,
  contentType = "text/plain",
) {
  const digest = await sha256Hex(bytes);
  const intentResponse = await handleTraceApi(
    request(
      `runs/${serverRunId}/trace-intents`,
      "POST",
      bearer,
      JSON.stringify({
        sha256: digest,
        sizeBytes: bytes.byteLength,
        contentType,
      }),
      { "content-type": "application/json", "idempotency-key": key },
    ),
    deps,
  );
  const intent = (await intentResponse.json()) as { uploadUrl: string };
  const uploaded = await handleTraceApi(
    new Request(intent.uploadUrl, {
      method: "PUT",
      body: bytes.slice().buffer,
      headers: { "content-type": contentType, digest: `sha-256=${digest}` },
    }),
    deps,
  );
  return { digest, intentResponse, uploaded };
}

describe("private trace API", () => {
  it("accepts arbitrary exact model identities and rejects placeholders", async () => {
    const deps = dependencies();
    const contributor = await token("42", "octocat", ["contributor"]);
    const openIdentity = await createRun(
      deps,
      contributor,
      "create_run_open_identity_0001",
      {
        provider: "x-ai/hosted+edge",
        model: "accounts/x/models/grok-4.5+reasoning",
        client: "grok-build+acp",
        clientVersion: "v1.2.3+build.7",
      },
    );
    expect(openIdentity.status).toBe(201);

    const placeholder = await createRun(
      deps,
      contributor,
      "create_run_bad_identity_0001",
      {
        provider: "provider",
        model: "model",
        client: "client",
        clientVersion: "latest",
      },
    );
    expect(placeholder.status).toBe(400);
    expect(await placeholder.json()).toMatchObject({
      error: "invalid_request",
    });
  });

  it("fails closed instead of throwing when the operator list is absent", async () => {
    const response = await onPagesRequest({
      request: new Request("https://api.slop.cash/api/v1/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env: {
        SLOP_DB: {} as never,
        PRIVATE_TRACES: {} as never,
        TRACE_AUTH_SECRET: SECRET,
        SLOP_IDENTITY: {
          fetch: async () => new Response(null, { status: 401 }),
        },
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-slop-trace-api-contract")).toBe(
      TRACE_API_CONTRACT_VERSION,
    );
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("cancels an oversized identity response before buffering it", async () => {
    let cancelled = false;
    const identityBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_IDENTITY_RESPONSE_BYTES / 2 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await onPagesRequest({
      request: new Request("https://api.slop.cash/api/v1/auth/session", {
        method: "POST",
        headers: {
          "x-slop-identity-assertion": "valid_slop_identity_assertion_value",
        },
      }),
      env: {
        SLOP_DB: {} as never,
        PRIVATE_TRACES: {} as never,
        TRACE_AUTH_SECRET: SECRET,
        SLOP_IDENTITY: {
          fetch: async () => new Response(identityBody),
        },
      },
    });
    expect(response.status).toBe(500);
    expect(cancelled).toBe(true);
    expect(identityBody.locked).toBe(false);
  });

  it("exchanges a limited identity assertion without granting operator access", async () => {
    const deps = dependencies();
    const response = await handleTraceApi(
      new Request("https://api.slop.cash/api/v1/auth/session", {
        method: "POST",
        headers: {
          "x-slop-identity-assertion": "valid_slop_identity_assertion_value",
        },
      }),
      deps,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    const denied = await handleTraceApi(
      request(
        `operator/traces/${"a".repeat(64)}/grant`,
        "POST",
        body.token,
        JSON.stringify({ reason: "support investigation" }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(denied.status).toBe(403);
  });

  it("never upgrades a contributor assertion to operator authority", async () => {
    const deps = dependencies();
    deps.operatorGithubIds = new Set(["42"]);
    const response = await handleTraceApi(
      new Request("https://api.slop.cash/api/v1/auth/session", {
        method: "POST",
        headers: {
          "x-slop-identity-assertion": "valid_slop_identity_assertion_value",
        },
      }),
      deps,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    const denied = await handleTraceApi(
      request(
        `operator/traces/${"a".repeat(64)}/grant`,
        "POST",
        body.token,
        JSON.stringify({ reason: "support investigation" }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "forbidden" });
  });

  it("rejects alternate HTTPS authorities", async () => {
    for (const authority of ["slop.cash", "api.slop.cash:444"]) {
      const response = await handleTraceApi(
        new Request(
          `https://${authority}/api/v1/wallet-claims/actors/42/current`,
        ),
        dependencies(),
      );
      expect(response.status).toBe(404);
    }
  });

  it("rejects non-canonical body lengths and releases oversized streams", async () => {
    for (const value of ["2e0", "+2"]) {
      await expect(
        readJsonObject(
          new Request("https://api.slop.cash/api/v1/runs", {
            method: "POST",
            headers: { "content-length": value },
            body: "{}",
          }),
        ),
      ).rejects.toThrow(/Content-Length/u);
    }
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(33 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readJsonObject(
        new Request("https://api.slop.cash/api/v1/runs", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      ),
    ).rejects.toThrow(/exceeds/u);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);

    const malformedJson = await handleTraceApi(
      request(
        "runs",
        "POST",
        await token("42", "octocat", ["contributor"]),
        "{",
        {
          "content-type": "application/json",
          "idempotency-key": "malformed_json_key_0001",
        },
      ),
      dependencies(),
    );
    expect(malformedJson.status).toBe(400);
    expect(await malformedJson.json()).toMatchObject({
      error: "invalid_request",
    });

    const tooLarge = await handleTraceApi(
      new Request("https://api.slop.cash/api/v1/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await token("42", "octocat", ["contributor"])}`,
          "content-length": "999999",
          "content-type": "application/json",
          "idempotency-key": "oversized_json_key_0001",
        },
        body: "{}",
      }),
      dependencies(),
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("rejects malformed secrets, extra claims, and duplicate roles", async () => {
    const now = Math.floor(NOW.getTime() / 1000);
    const claims = {
      iss: "slop.cash" as const,
      aud: "private-trace-api" as const,
      sub: "github:42" as const,
      githubId: "42",
      githubLogin: "octocat",
      roles: ["contributor" as const],
      iat: now,
      exp: now + 600,
      jti: "strict_claims_token_0001",
    };
    await expect(signApiToken(claims, "x".repeat(31))).rejects.toThrow(
      /TRACE_AUTH_SECRET/u,
    );
    await expect(signApiToken(claims, `${"x".repeat(31)}\n`)).rejects.toThrow(
      /TRACE_AUTH_SECRET/u,
    );
    await expect(signApiToken(claims, "x".repeat(129))).rejects.toThrow(
      /TRACE_AUTH_SECRET/u,
    );
    const legacySecret = "x".repeat(32);
    const legacyToken = await signApiToken(claims, legacySecret);
    await expect(
      verifyApiToken({
        authorization: `Bearer ${legacyToken}`,
        secret: legacySecret,
        operatorGithubIds: new Set(),
        nowSeconds: now,
      }),
    ).resolves.toMatchObject({ githubId: "42", roles: ["contributor"] });
    await expect(
      signApiToken({ ...claims, extra: "not-authorized" } as never, SECRET),
    ).rejects.toThrow(/claims/u);
    await expect(
      signApiToken(
        { ...claims, roles: ["contributor", "contributor"] },
        SECRET,
      ),
    ).rejects.toThrow(/claims/u);
    await expect(
      verifyApiToken({
        authorization: `Bearer v1.${"A".repeat(4097)}.${"A".repeat(43)}`,
        secret: SECRET,
        operatorGithubIds: new Set(),
        nowSeconds: now,
      }),
    ).resolves.toBeNull();
  });

  it("rejects contributor tokens longer than the documented ten minutes", async () => {
    const now = Math.floor(NOW.getTime() / 1000);
    const oversized = await signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: "github:42",
        githubId: "42",
        githubLogin: "octocat",
        roles: ["contributor"],
        iat: now,
        exp: now + 601,
        jti: "oversized_token_identifier",
      },
      SECRET,
    );
    const response = await createRun(
      dependencies(),
      oversized,
      "oversized_token_run_key",
    );
    expect(response.status).toBe(401);
  });

  it("requires a valid trace before finalization and is write-only for contributors", async () => {
    const store = new MemoryPersistence();
    const deps = dependencies(store);
    const contributor = await token("42", "octocat", ["contributor"]);
    const created = await createRun(deps, contributor);
    expect(created.status).toBe(201);
    const { serverRunId } = (await created.json()) as { serverRunId: string };

    const premature = await handleTraceApi(
      request(`runs/${serverRunId}/finalize`, "POST", contributor, undefined, {
        "idempotency-key": "finalize_run_key_0001",
      }),
      deps,
    );
    expect(premature.status).toBe(409);
    expect(await premature.json()).toMatchObject({ error: "trace_required" });

    const trace = new TextEncoder().encode('{"event":"complete"}\n');
    const { digest, uploaded } = await uploadTrace(
      deps,
      contributor,
      serverRunId,
      trace,
      "upload_trace_key_0001",
      "application/x-ndjson",
    );
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toMatchObject({
      serverRunId,
      traceObjectId: `sha256:${digest}`,
      state: "trace_uploaded",
    });
    const uploadUrl = (
      (await (
        await handleTraceApi(
          request(
            `runs/${serverRunId}/trace-intents`,
            "POST",
            contributor,
            JSON.stringify({
              sha256: digest,
              sizeBytes: trace.byteLength,
              contentType: "application/x-ndjson",
            }),
            {
              "content-type": "application/json",
              "idempotency-key": "upload_trace_key_0001",
            },
          ),
          deps,
        )
      ).json()) as { uploadUrl: string }
    ).uploadUrl;
    const replayUpload = await handleTraceApi(
      new Request(uploadUrl, {
        method: "PUT",
        body: trace.slice().buffer,
        headers: {
          "content-type": "application/x-ndjson",
          digest: `sha-256=${digest}`,
        },
      }),
      deps,
    );
    expect(replayUpload.status).toBe(410);

    const finalized = await handleTraceApi(
      request(`runs/${serverRunId}/finalize`, "POST", contributor, undefined, {
        "idempotency-key": "finalize_run_key_0002",
      }),
      deps,
    );
    expect(finalized.status).toBe(200);
    expect(await finalized.json()).toMatchObject({ state: "finalized" });

    const readAttempt = await handleTraceApi(
      request(`runs/${serverRunId}`, "GET", contributor),
      deps,
    );
    expect(readAttempt.status).toBe(404);
  });

  it("conceals other contributors' runs and rejects idempotency replay mutation", async () => {
    const deps = dependencies();
    const owner = await token("42", "octocat", ["contributor"]);
    const attacker = await token("43", "attacker", ["contributor"]);
    const created = await createRun(deps, owner);
    const { serverRunId } = (await created.json()) as { serverRunId: string };
    const bytes = new TextEncoder().encode("private trace");
    const digest = await sha256Hex(bytes);
    const denied = await handleTraceApi(
      request(
        `runs/${serverRunId}/trace-intents`,
        "POST",
        attacker,
        JSON.stringify({
          sha256: digest,
          sizeBytes: bytes.byteLength,
          contentType: "text/plain",
        }),
        {
          "content-type": "application/json",
          "idempotency-key": "attack_upload_key_01",
        },
      ),
      deps,
    );
    expect(denied.status).toBe(404);

    const replay = await createRun(deps, owner);
    expect(replay.status).toBe(200);
    const changed = await handleTraceApi(
      request(
        "runs",
        "POST",
        owner,
        JSON.stringify({
          clientRunId: "run_DIFFERENT",
          projectId: "eliza",
          repository: "elizaOS/eliza",
          projectPolicyRevision: "a".repeat(40),
          provider: "openai",
          model: "gpt-5",
          client: "codex",
          clientVersion: "1.0.0",
        }),
        {
          "content-type": "application/json",
          "idempotency-key": "create_run_key_0001",
        },
      ),
      deps,
    );
    expect(changed.status).toBe(409);
  });

  it("rejects progress-event mutation under an idempotency key", async () => {
    const deps = dependencies();
    const contributor = await token("42", "octocat", ["contributor"]);
    const created = await createRun(
      deps,
      contributor,
      "create_event_run_key_0001",
    );
    const { serverRunId } = (await created.json()) as { serverRunId: string };
    const post = (occurredAt: string) =>
      handleTraceApi(
        request(
          `runs/${serverRunId}/events`,
          "POST",
          contributor,
          JSON.stringify({ kind: "checkpoint", occurredAt, source: "agent" }),
          {
            "content-type": "application/json",
            "idempotency-key": "progress_event_key_0001",
          },
        ),
        deps,
      );

    expect((await post("2026-08-15T11:59:00.000Z")).status).toBe(201);
    const mutated = await post("2026-08-15T11:59:01.000Z");
    expect(mutated.status).toBe(409);
    expect(await mutated.json()).toMatchObject({
      error: "idempotency_conflict",
    });
  });

  it("rejects digest mismatches before retaining an object", async () => {
    const store = new MemoryPersistence();
    const deps = dependencies(store);
    const contributor = await token("42", "octocat", ["contributor"]);
    const created = await createRun(deps, contributor);
    const { serverRunId } = (await created.json()) as { serverRunId: string };
    const claimed = "0".repeat(64);
    const intentResponse = await handleTraceApi(
      request(
        `runs/${serverRunId}/trace-intents`,
        "POST",
        contributor,
        JSON.stringify({
          sha256: claimed,
          sizeBytes: 21,
          contentType: "text/plain",
        }),
        {
          "content-type": "application/json",
          "idempotency-key": "upload_trace_key_bad1",
        },
      ),
      deps,
    );
    const { uploadUrl } = (await intentResponse.json()) as {
      uploadUrl: string;
    };
    const response = await handleTraceApi(
      new Request(uploadUrl, {
        method: "PUT",
        body: "not the claimed bytes",
        headers: { "content-type": "text/plain", digest: `sha-256=${claimed}` },
      }),
      deps,
    );
    expect(response.status).toBe(422);
    expect(store.bytes.size).toBe(0);
    expect(store.objects.size).toBe(0);
  });

  it("does not burn an upload capability on validation or transient storage failure", async () => {
    const store = new MemoryPersistence();
    const deps = dependencies(store);
    const contributor = await token("42", "octocat", ["contributor"]);
    const created = await createRun(
      deps,
      contributor,
      "create_retry_run_key_0001",
    );
    const { serverRunId } = (await created.json()) as { serverRunId: string };
    const bytes = new TextEncoder().encode("retryable private trace");
    const digest = await sha256Hex(bytes);
    const intent = await handleTraceApi(
      request(
        `runs/${serverRunId}/trace-intents`,
        "POST",
        contributor,
        JSON.stringify({
          sha256: digest,
          sizeBytes: bytes.byteLength,
          contentType: "text/plain",
        }),
        {
          "content-type": "application/json",
          "idempotency-key": "upload_retry_key_0001",
        },
      ),
      deps,
    );
    const { uploadUrl } = (await intent.json()) as { uploadUrl: string };
    const uploadRequest = (contentType = "text/plain") =>
      new Request(uploadUrl, {
        method: "PUT",
        body: bytes.slice().buffer,
        headers: { "content-type": contentType, digest: `sha-256=${digest}` },
      });

    expect(
      (await handleTraceApi(uploadRequest("application/x-ndjson"), deps))
        .status,
    ).toBe(422);
    store.failNextPut = true;
    expect((await handleTraceApi(uploadRequest(), deps)).status).toBe(500);
    expect((await handleTraceApi(uploadRequest(), deps)).status).toBe(201);
  });

  it("atomically permits only one concurrent upload capability consumer", async () => {
    const store = new MemoryPersistence();
    const deps = dependencies(store);
    const contributor = await token("42", "octocat", ["contributor"]);
    const created = await createRun(
      deps,
      contributor,
      "create_concurrent_run_0001",
    );
    const { serverRunId } = (await created.json()) as { serverRunId: string };
    const bytes = new TextEncoder().encode("one consumer only");
    const digest = await sha256Hex(bytes);
    const intent = await handleTraceApi(
      request(
        `runs/${serverRunId}/trace-intents`,
        "POST",
        contributor,
        JSON.stringify({
          sha256: digest,
          sizeBytes: bytes.byteLength,
          contentType: "text/plain",
        }),
        {
          "content-type": "application/json",
          "idempotency-key": "upload_concurrent_0001",
        },
      ),
      deps,
    );
    const { uploadUrl } = (await intent.json()) as { uploadUrl: string };
    const makeUpload = () =>
      new Request(uploadUrl, {
        method: "PUT",
        body: bytes.slice().buffer,
        headers: { "content-type": "text/plain", digest: `sha-256=${digest}` },
      });
    const responses = await Promise.all([
      handleTraceApi(makeUpload(), deps),
      handleTraceApi(makeUpload(), deps),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(store.uploads.size).toBe(1);
    expect(store.objects.size).toBe(1);
    expect((await handleTraceApi(makeUpload(), deps)).status).toBe(410);
  });

  it("allows one audited read only to a designated operator", async () => {
    const store = new MemoryPersistence();
    const deps = dependencies(store);
    const contributor = await token("42", "octocat", ["contributor"]);
    const operator = await token("99", "slop-operator", ["operator"]);
    const created = await createRun(deps, contributor);
    const { serverRunId } = (await created.json()) as { serverRunId: string };
    const bytes = new TextEncoder().encode("permanent private trace");
    const digest = await sha256Hex(bytes);
    await uploadTrace(
      deps,
      contributor,
      serverRunId,
      bytes,
      "upload_trace_key_read",
    );
    const grantResponse = await handleTraceApi(
      request(
        `operator/traces/${digest}/grant`,
        "POST",
        operator,
        JSON.stringify({ reason: "investigate reported receipt mismatch" }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(grantResponse.status).toBe(201);
    const { grant } = (await grantResponse.json()) as { grant: string };
    const first = await handleTraceApi(
      request(`operator/traces/${digest}`, "GET", operator, undefined, {
        "x-trace-read-grant": grant,
      }),
      deps,
    );
    expect(await first.text()).toBe("permanent private trace");
    expect(first.headers.get("content-disposition")).toContain("attachment");
    const replay = await handleTraceApi(
      request(`operator/traces/${digest}`, "GET", operator, undefined, {
        "x-trace-read-grant": grant,
      }),
      deps,
    );
    expect(replay.status).toBe(403);
    expect(store.audits.map((event) => event.action)).toEqual([
      "trace.read_grant.created",
      "trace.read_grant.consumed",
    ]);
  });

  it("publishes only immutable wallet claim metadata", async () => {
    const deps = dependencies();
    const operator = await token("99", "slop-operator", ["operator"]);
    const created = await handleTraceApi(
      request(
        "operator/wallet-claims",
        "POST",
        operator,
        JSON.stringify({
          githubActorId: "42",
          githubLogin: "octocat",
          address: "11111111111111111111111111111111",
          observedAt: NOW.toISOString(),
          sourceBodySha256: "b".repeat(64),
        }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(created.status).toBe(201);
    const claim = (await created.json()) as {
      claimId: string;
      recordDigest: string;
    };
    const publicResponse = await handleTraceApi(
      new Request(
        `https://api.slop.cash/api/v1/wallet-claims/${claim.claimId}`,
      ),
      deps,
    );
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({
      githubActorId: "42",
      address: "11111111111111111111111111111111",
      source: "d1_registry",
      recordDigest: claim.recordDigest,
    });
  });

  it("lets a GitHub-authenticated contributor create and supersede one wallet lineage", async () => {
    const deps = dependencies();
    const contributor = await token("42", "octocat", ["contributor"]);
    const first = await handleTraceApi(
      request(
        "wallet-claims",
        "POST",
        contributor,
        JSON.stringify({ address: "11111111111111111111111111111111" }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(first.status).toBe(201);
    const firstClaim = (await first.json()) as {
      claimId: string;
      githubActorId: string;
      source: string;
    };
    expect(firstClaim).toMatchObject({
      githubActorId: "42",
      source: "d1_registry",
    });

    const unchanged = await handleTraceApi(
      request(
        "wallet-claims",
        "POST",
        contributor,
        JSON.stringify({
          address: "11111111111111111111111111111111",
          supersedesClaimId: firstClaim.claimId,
        }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(unchanged.status).toBe(200);
    expect((await unchanged.json()).claimId).toBe(firstClaim.claimId);

    const changed = await handleTraceApi(
      request(
        "wallet-claims",
        "POST",
        contributor,
        JSON.stringify({
          address: "SysvarRent111111111111111111111111111111111",
          supersedesClaimId: firstClaim.claimId,
        }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(changed.status).toBe(201);
    const secondClaim = (await changed.json()) as {
      claimId: string;
      supersedesClaimId: string;
    };
    expect(secondClaim.supersedesClaimId).toBe(firstClaim.claimId);

    const current = await handleTraceApi(
      new Request(
        "https://api.slop.cash/api/v1/wallet-claims/actors/42/current",
      ),
      deps,
    );
    expect(current.status).toBe(200);
    expect((await current.json()).claimId).toBe(secondClaim.claimId);

    const authenticatedCurrent = await handleTraceApi(
      request("wallet-claims/current", "GET", contributor),
      deps,
    );
    expect(authenticatedCurrent.status).toBe(200);
    expect((await authenticatedCurrent.json()).claimId).toBe(
      secondClaim.claimId,
    );

    const stale = await handleTraceApi(
      request(
        "wallet-claims",
        "POST",
        contributor,
        JSON.stringify({
          address: "Vote111111111111111111111111111111111111111",
          supersedesClaimId: firstClaim.claimId,
        }),
        { "content-type": "application/json" },
      ),
      deps,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale_wallet_claim" });
  });

  it("does not let an unauthenticated caller create a wallet claim", async () => {
    const response = await handleTraceApi(
      new Request("https://api.slop.cash/api/v1/wallet-claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "11111111111111111111111111111111",
        }),
      }),
      dependencies(),
    );
    expect(response.status).toBe(401);
  });
});
