/** Fixed harmless Pages requests inside the queue-only qualification Worker. */

import {
  EVIDENCE_OPERATOR_GITHUB_IDS,
  EVIDENCE_POLICY,
  EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
} from "../../backend/vetting/evidence";
import {
  chunkKey,
  EVIDENCE_CHUNK_BYTES,
  type EvidenceChunk,
  verifiedPart,
} from "../../backend/vetting/evidence-chunks";
import { onRequest } from "../../functions/api/v1/[[path]]";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { BackupEnvironment } from "./core";

const origin = "https://qualification.invalid";
const root = "/api/v1/operator/vetting-evidence";
const owner = EVIDENCE_POLICY_AUTHORITY_GITHUB_ID;
const reader = EVIDENCE_OPERATOR_GITHUB_IDS[1];
const other = "900000099";
const encoder = new TextEncoder();
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function qualifyAccess(env: BackupEnvironment) {
  const db = env.EVIDENCE_DATABASE;
  const source = env.EVIDENCE_SOURCE;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const cookies = new Map<string, string>();
  const hashes: string[] = [];
  let objects = 0;
  let bytes = 0;
  for (const id of [owner, reader, other]) {
    const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    const hash = await sha256Hex(encoder.encode(token));
    await db
      .prepare(
        "INSERT OR IGNORE INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
      )
      .bind(`qualification-${id}`, id, "synthetic-qualification", at)
      .run();
    await db
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .bind(hash, `qualification-${id}`, new Date(now + 3600_000).toISOString())
      .run();
    cookies.set(id, `__Host-slop_points=${token}`);
    hashes.push(hash);
  }
  // This is the real Pages factory with a closed fixture environment. No
  // deployment environment, provider credentials or real identity is passed.
  const pagesEnv = {
    SLOP_DB: db,
    VETTING_EVIDENCE: source,
    ADMIN_GITHUB_IDS: other,
    PROJECT_MODERATOR_GITHUB_IDS: other,
  } as unknown as Parameters<typeof onRequest>[0]["env"];
  const cases = new Set<string>();
  async function request(
    path: string,
    actor: string | null = owner,
    options: {
      method?: "GET" | "POST" | "HEAD";
      body?: unknown;
      headers?: Record<string, string>;
      inactive?: boolean;
    } = {},
  ) {
    check(
      path === root ||
        [...cases].some((id) => path.startsWith(`${root}/${id}/`)),
      "Unexpected fixture route",
    );
    const method =
      options.method ?? (options.body === undefined ? "GET" : "POST");
    const session = actor === null ? undefined : cookies.get(actor);
    check(actor === null || session, "Unknown synthetic actor");
    return onRequest({
      request: new Request(`${origin}${path}`, {
        method,
        headers: {
          ...(session ? { cookie: session } : {}),
          ...(method === "POST"
            ? { origin, "content-type": "application/json" }
            : {}),
          ...options.headers,
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      }),
      env: options.inactive
        ? { ...pagesEnv, VETTING_EVIDENCE: undefined }
        : pagesEnv,
    });
  }
  async function put(key: string, data: Uint8Array) {
    const sha256 = await sha256Hex(data);
    await source.put(key, data, {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { sha256 },
      httpMetadata: { contentType: "application/octet-stream" },
    });
    await verifiedPart(source, key, sha256, data.length);
  }
  async function fixture(
    id: string,
    data: Uint8Array,
    closedDays?: number,
    permanentAdmission = false,
  ) {
    cases.add(id);
    const sha = await sha256Hex(data);
    const key = `vetting/${id}/run/${sha}`;
    const chunks: EvidenceChunk[] | null =
      data.length > EVIDENCE_CHUNK_BYTES ? [] : null;
    if (chunks) {
      for (
        let offset = 0;
        offset < data.length;
        offset += EVIDENCE_CHUNK_BYTES
      ) {
        const part = data.slice(offset, offset + EVIDENCE_CHUNK_BYTES);
        const chunk = {
          index: chunks.length,
          sha256: await sha256Hex(part),
          sizeBytes: part.length,
        };
        chunks.push(chunk);
        await put(chunkKey(key, chunk), part);
        objects++;
      }
    } else {
      await put(key, data);
      objects++;
    }
    bytes += data.length;
    const manifest = JSON.stringify({
      traceSha256: sha,
      objects: [
        {
          sha256: sha,
          sizeBytes: data.length,
          kind: "trace",
          label: "Harmless qualification bytes",
          contentType: "application/octet-stream",
          ...(chunks ? { chunks } : {}),
        },
      ],
    });
    await db
      .prepare(
        "INSERT INTO vetting_assessments(id,state,completed_at) VALUES(?,'incomplete',?)",
      )
      .bind(id, at)
      .run();
    if (permanentAdmission)
      await db
        .prepare(
          "UPDATE vetting_assessments SET state='clean',result=?,completed_at=? WHERE id=?",
        )
        .bind(
          JSON.stringify({
            schemaVersion: "slop-vetting-result-v2",
            disposition: "clean",
          }),
          new Date(now - (closedDays ?? 0) * 86400_000).toISOString(),
          id,
        )
        .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,'run',?,?,?,?,?,?)",
      )
      .bind(
        id,
        sha,
        await sha256Hex(encoder.encode(manifest)),
        manifest,
        JSON.stringify(EVIDENCE_POLICY),
        at,
        new Date(now + 86400_000).toISOString(),
      )
      .run();
    await db
      .prepare(
        "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks) VALUES(?,'run',?,?,'trace','Harmless qualification bytes','application/octet-stream',?,?)",
      )
      .bind(id, sha, data.length, key, chunks ? JSON.stringify(chunks) : null)
      .run();
    if (chunks)
      await db
        .prepare("INSERT INTO vetting_evidence_completions VALUES(?,'run',?,?)")
        .bind(id, sha, at)
        .run();
    if (closedDays !== undefined && !permanentAdmission)
      await db
        .prepare(
          "INSERT INTO vetting_evidence_case_closures VALUES(?,?,?,'Synthetic aged case')",
        )
        .bind(id, new Date(now - closedDays * 86400_000).toISOString(), owner)
        .run();
    return { id, sha, key, data, chunks, path: `${root}/${id}/run/${sha}` };
  }
  async function grant(path: string, actor = owner) {
    const result = await request(`${path}/grant`, actor, {
      body: { reason: "Inspect harmless hosted qualification bytes" },
    });
    check(result.status === 201, "Read grant failed");
    const body = (await result.json()) as {
      grant: string;
      expiresInSeconds: number;
    };
    check(
      body.expiresInSeconds === 900 && typeof body.grant === "string",
      "Grant duration changed",
    );
    return body.grant;
  }
  try {
    const single = await fixture(
      "vet_qualification_access",
      encoder.encode("Harmless hosted access fixture; no private report."),
    );
    const recent = await fixture(
      "vet_qualification_recent",
      encoder.encode("Recent closed case retained."),
      89,
    );
    const expired = await fixture(
      "vet_qualification_expired",
      encoder.encode("Old closed case eligible for fixture deletion."),
      91,
    );
    const permanent = await fixture(
      "vet_qualification_permanent",
      encoder.encode("Permanent admission evidence after 91 days."),
      91,
      true,
    );
    const large = await fixture(
      "vet_qualification_large",
      new Uint8Array(EVIDENCE_CHUNK_BYTES + 17).fill(11),
    );
    check(
      (await request(root, null)).status === 401,
      "Anonymous access accepted",
    );
    check(
      (await request(root, other)).status === 403,
      "Administrator or moderator inherited evidence access",
    );
    check(
      (await request(root, owner)).status === 200 &&
        (await request(root, reader)).status === 200,
      "Designated readers refused",
    );
    check(
      (
        await request(`${single.path}/grant`, owner, {
          body: { reason: "Cross-site refusal" },
          headers: { origin: "https://other.invalid" },
        })
      ).status === 403,
      "Cross-site grant accepted",
    );
    check(
      (
        await request(`${single.path}/grant`, owner, {
          body: { reason: "Wrong media refusal" },
          headers: { "content-type": "text/plain" },
        })
      ).status === 403,
      "Wrong content type accepted",
    );
    check(
      (await request(`${single.path}/grant`, owner, { body: { reason: "" } }))
        .status === 400,
      "Empty reason accepted",
    );
    const one = await grant(single.path);
    const read = (token: string, actor = owner, path = single.path) =>
      request(`${path}/body`, actor, {
        headers: { "x-vetting-read-grant": token },
      });
    check(
      (await read(one, reader)).status === 403,
      "Cross-actor grant accepted",
    );
    check(
      (await read(one, owner, recent.path)).status === 403,
      "Cross-object grant accepted",
    );
    const raced = await Promise.all([read(one), read(one)]);
    check(
      raced
        .map((r) => r.status)
        .sort()
        .join() === "200,403",
      "Single-use grant race changed",
    );
    const accepted = raced.find((r) => r.status === 200);
    check(accepted, "Successful read missing");
    check(
      (await sha256Hex(new Uint8Array(await accepted.arrayBuffer()))) ===
        single.sha,
      "Read bytes changed",
    );
    check(
      accepted.headers.get("cache-control") === "private, no-store" &&
        accepted.headers.get("x-content-type-options") === "nosniff" &&
        accepted.headers
          .get("content-disposition")
          ?.startsWith("attachment;") &&
        accepted.headers.get("content-security-policy") ===
          "default-src 'none'; sandbox",
      "Private read headers changed",
    );
    check((await read(one)).status === 403, "Grant replay accepted");
    const storedGrant = await db
      .prepare(
        "SELECT operator_github_id,reason,consumed_at FROM vetting_evidence_grants WHERE token_hash=?",
      )
      .bind(await sha256Hex(encoder.encode(one)))
      .first<{
        operator_github_id: string;
        reason: string;
        consumed_at: string | null;
      }>();
    const readAudit =
      (
        await db
          .prepare(
            "SELECT actor,action,reason FROM vetting_evidence_audit WHERE assessment_id=?",
          )
          .bind(single.id)
          .all<{ actor: string; action: string; reason: string }>()
      ).results ?? [];
    check(
      storedGrant?.operator_github_id === owner &&
        storedGrant.consumed_at &&
        storedGrant.reason === "Inspect harmless hosted qualification bytes" &&
        readAudit
          .map((row) => row.action)
          .sort()
          .join() === "grant,read,read-attempt" &&
        readAudit.every(
          (row) => row.actor === owner && row.reason === storedGrant.reason,
        ),
      "Grant and read audit identity differs",
    );
    const expiredGrant = await grant(single.path);
    await db
      .prepare(
        "UPDATE vetting_evidence_grants SET expires_at=? WHERE token_hash=?",
      )
      .bind(
        new Date(now - 1000).toISOString(),
        await sha256Hex(encoder.encode(expiredGrant)),
      )
      .run();
    check((await read(expiredGrant)).status === 403, "Expired grant accepted");
    const inactiveGrant = await grant(single.path);
    check(
      (
        await request(`${single.path}/body`, owner, {
          inactive: true,
          headers: { "x-vetting-read-grant": inactiveGrant },
        })
      ).status === 503,
      "Inactive policy accepted grant",
    );
    await db
      .prepare("UPDATE points_sessions SET expires_at=? WHERE token_hash=?")
      .bind(new Date(now - 1000).toISOString(), hashes[1])
      .run();
    check(
      (await request(root, reader)).status === 401,
      "Expired session accepted",
    );
    await db
      .prepare("DELETE FROM points_sessions WHERE token_hash=?")
      .bind(hashes[1])
      .run();
    check(
      (await request(root, reader)).status === 401,
      "Revoked session accepted",
    );
    // Restore only this synthetic reader session for the closure-authority check.
    await db
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .bind(
        hashes[1],
        `qualification-${reader}`,
        new Date(now + 3600_000).toISOString(),
      )
      .run();
    const closePath = `${root}/${single.id}/close`;
    check(
      (
        await request(closePath, reader, {
          body: { reason: "Reader cannot close a case" },
        })
      ).status === 403,
      "Reader closed case",
    );
    check(
      (
        await request(closePath, owner, {
          body: { reason: "Cross-site closure refused" },
          headers: { origin: "https://other.invalid" },
        })
      ).status === 403,
      "Cross-site closure accepted",
    );
    const closed = await request(closePath, owner, {
      body: { reason: "Close harmless qualification exception" },
    });
    check(closed.status === 200, "Owner closure failed");
    const closure = (await closed.json()) as { closedAt: string };
    const replay = await request(closePath, owner, {
      body: { reason: "Repeat the same harmless closure" },
    });
    check(
      replay.status === 200 &&
        ((await replay.json()) as { closedAt: string }).closedAt ===
          closure.closedAt,
      "Closure replay moved retention deadline",
    );
    check(
      (
        await db
          .prepare("SELECT state FROM vetting_assessments WHERE id=?")
          .bind(single.id)
          .first<{ state: string }>()
      )?.state === "incomplete",
      "Closure changed assessment",
    );
    check(
      (
        await request(`${expired.path}/grant`, owner, {
          body: { reason: "Expired case must refuse" },
        })
      ).status === 410,
      "Expired case read accepted",
    );
    await grant(recent.path);
    const permanentGrant = await grant(permanent.path);
    const permanentRead = await request(`${permanent.path}/body`, owner, {
      headers: { "x-vetting-read-grant": permanentGrant },
    });
    check(
      permanentRead.status === 200 &&
        (await permanentRead.text()) ===
          "Permanent admission evidence after 91 days.",
      "Admission evidence expired after closure",
    );
    const downloaded = async () => {
      const response = await request(`${large.path}/download-grant`, owner, {
        body: { reason: "Read harmless chunked qualification" },
      });
      check(response.status === 201, "Download grant failed");
      const value = response.headers.get("set-cookie");
      check(typeof value === "string", "Download cookie missing");
      check(
        value?.includes("Secure; HttpOnly; SameSite=Strict") &&
          value.includes("Max-Age=900;") &&
          value.includes(`Path=${large.path}/download;`) &&
          !value.includes("Domain="),
        "Download cookie scope changed",
      );
      check(
        !Object.hasOwn(await response.json(), "grant"),
        "Download grant returned token body",
      );
      return value.split(";")[0];
    };
    const cookie = await downloaded();
    const download = (
      grantCookie: string,
      headers: Record<string, string> = {},
      method: "GET" | "HEAD" = "GET",
    ) =>
      request(`${large.path}/download`, owner, {
        method,
        headers: {
          cookie: `${cookies.get(owner)}; ${grantCookie}`,
          "sec-fetch-site": "same-origin",
          ...headers,
        },
      });
    check(
      (await download(cookie, { "sec-fetch-site": "same-site" })).status ===
        403,
      "Cross-site download accepted",
    );
    check(
      (await download(cookie, { range: "bytes=0-1" })).status === 403,
      "Range download accepted",
    );
    check(
      (await download(`${cookie}; ${cookie}`)).status === 403,
      "Duplicate download cookie accepted",
    );
    check(
      (
        await download(
          cookie,
          { origin, "content-type": "application/json" },
          "HEAD",
        )
      ).status === 405,
      "HEAD download accepted",
    );
    const body = await download(cookie);
    check(
      body.status === 200 &&
        body.headers.get("set-cookie")?.includes("Max-Age=0"),
      "Download did not consume cookie",
    );
    check(body.body, "Download body missing");
    const stream = body.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const value = await stream.read();
      if (value.done) break;
      check(
        value.value.length <= EVIDENCE_CHUNK_BYTES,
        "Download chunk exceeded bound",
      );
      parts.push(value.value);
      size += value.value.length;
    }
    const assembled = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      assembled.set(part, offset);
      offset += part.length;
    }
    check(
      size === large.data.length && (await sha256Hex(assembled)) === large.sha,
      "Download bytes changed",
    );
    check((await download(cookie)).status === 403, "Download replay accepted");
    const cancel = await download(await downloaded());
    check(cancel.body, "Cancellation body missing");
    const cancelReader = cancel.body.getReader();
    await cancelReader.read();
    await cancelReader.cancel();
    const audit =
      (
        await db
          .prepare(
            "SELECT actor,action,reason FROM vetting_evidence_audit WHERE assessment_id=?",
          )
          .bind(large.id)
          .all<{ actor: string; action: string; reason: string }>()
      ).results ?? [];
    check(
      audit.filter((r) => r.action === "download-finished").length === 1 &&
        audit.filter((r) => r.action === "download-cancelled").length === 1 &&
        audit.every((r) => r.actor === owner && r.reason.length >= 8),
      "Download audit differs",
    );
    await source.delete(single.key);
    check(
      (
        await request(`${single.path}/grant`, owner, {
          body: { reason: "Missing source must refuse" },
        })
      ).status === 404,
      "Missing object granted",
    );
    await source.put(single.key, new Uint8Array(single.data.length), {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { sha256: single.sha },
      httpMetadata: { contentType: "application/octet-stream" },
    });
    check(
      (
        await request(`${single.path}/grant`, owner, {
          body: { reason: "Changed source must refuse" },
        })
      ).status === 409,
      "Changed object granted",
    );
    await source.delete(single.key);
    await put(single.key, single.data);
    return {
      objects,
      bytes,
      actualPagesHandler: true,
      actualSessionLookup: true,
      syntheticIdentities: true,
      authorizedReaders: 2,
      anonymousAndOtherRolesRefused: true,
      sessionExpiryAndRevocationRefused: true,
      originAndReasonEnforced: true,
      grantSeconds: 900,
      actorObjectExpiryAndReplayEnforced: true,
      grantAndReadAuditIdentityVerified: true,
      concurrentReadStatuses: [200, 403],
      exactSingleSha256: single.sha,
      exactChunkedSha256: large.sha,
      chunkedBytes: large.data.length,
      nativeCookieScopeEnforced: true,
      downloadFinishAndCancellationAudited: true,
      ownerOnlyClosure: true,
      closureReplayUnchanged: true,
      assessmentUnchanged: true,
      caseAccessExpiryEnforced: true,
      missingAndCorruptBytesRefused: true,
      liveOAuth: false,
      operationalPolicyAttested: false,
    };
  } finally {
    for (const hash of hashes)
      await db
        .prepare("DELETE FROM points_sessions WHERE token_hash=?")
        .bind(hash)
        .run();
  }
}
