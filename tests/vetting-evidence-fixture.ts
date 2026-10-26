/**
 * Real local workerd R2 for the connected vetting workflows. The evidence
 * terms are the fixed source policy; the recorded owner and reader IDs are
 * exported for synthetic sessions.
 */
import { fileURLToPath } from "node:url";
import type { ProjectD1Database } from "../backend/projects/cloudflare-persistence";
import type { R2Bucket } from "../backend/trace/cloudflare-persistence";
import {
  EVIDENCE_OPERATOR_GITHUB_IDS,
  EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
  VettingEvidence,
} from "../backend/vetting/evidence";
import { signedVettingRequest } from "../backend/vetting/handler";
import {
  signedVettingHeaders,
  VETTING_EVIDENCE_OBJECTS,
  VETTING_TRACE_SHA,
  vettingKeyPair,
} from "./vetting-fixtures";

/** The recorded evidence policy owner, who is also an evidence reader. */
export const EVIDENCE_OWNER_GITHUB_ID = EVIDENCE_POLICY_AUTHORITY_GITHUB_ID;
/** The recorded evidence reader who does not own the policy. */
export const EVIDENCE_READER_GITHUB_ID = (() => {
  const others = EVIDENCE_OPERATOR_GITHUB_IDS.filter(
    (id) => id !== EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
  );
  if (others.length !== 1) throw new Error("Expected one non-owner reader");
  return others[0];
})();

export async function localVettingEvidence(
  db: ProjectD1Database,
  now: () => Date,
) {
  const child = Bun.spawn(
    [
      "node",
      fileURLToPath(new URL("./vetting-evidence-r2.mjs", import.meta.url)),
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
  );
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let origin: string;
  try {
    const reader = child.stdout.getReader();
    origin = await Promise.race([
      (async () => {
        let line = "";
        while (!line.includes("\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Local R2 startup failed");
          line += new TextDecoder().decode(chunk.value);
          if (line.length > 256)
            throw new Error("Invalid local R2 startup line");
        }
        return line.trim();
      })(),
      new Promise<never>((_, reject) => {
        startupTimer = setTimeout(
          () => reject(new Error("Local R2 startup timed out")),
          15000,
        );
      }),
    ]);
    reader.releaseLock();
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1")
      throw new Error("Invalid local R2 origin");
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
  async function dispose() {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 4000);
    try {
      if ((await child.exited) !== 0)
        throw new Error("Local R2 shutdown failed");
    } finally {
      clearTimeout(timer);
    }
  }
  // Use asynchronous HTTP to real workerd R2. Miniflare's synchronous RPC
  // property getters can fail under Bun before object metadata is returned.
  const url = (key: string) => `${origin}${encodeURIComponent(key)}`;
  async function read(key: string, method: "GET" | "HEAD") {
    const response = await fetch(url(key), { method });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Local R2 read failed: ${response.status}`);
    return {
      size: Number(response.headers.get("x-r2-size")),
      customMetadata: JSON.parse(response.headers.get("x-r2-metadata")!),
      body: response.body,
      arrayBuffer: () => response.arrayBuffer(),
    };
  }
  const bucket = {
    head: (key: string) => read(key, "HEAD"),
    get: (key: string) => read(key, "GET"),
    put: async (...[key, bytes, options]: Parameters<R2Bucket["put"]>) => {
      const response = await fetch(url(key), {
        method: "PUT",
        headers: { "x-r2-options": JSON.stringify(options) },
        body: new Uint8Array(bytes),
      });
      if (!response.ok)
        throw new Error(`Local R2 write failed: ${response.status}`);
      const result = (await response.json()) as { stored: boolean };
      return result.stored ? {} : null;
    },
    delete: async (key: string) => {
      const response = await fetch(url(key), {
        method: "DELETE",
      });
      if (response.status !== 204)
        throw new Error(`Local R2 delete failed: ${response.status}`);
    },
  };
  const keys = await vettingKeyPair();
  const evidence = new VettingEvidence({
    db,
    bucket: {
      head: (key) => bucket.head(key),
      put: (key, bytes, options) => bucket.put(key, bytes, options),
      // Forward the asynchronous workerd HTTP response stream directly.
      get: async (key) => {
        const value = await bucket.get(key);
        return value
          ? {
              size: value.size,
              customMetadata: value.customMetadata,
              body: value.body!,
            }
          : null;
      },
    } as R2Bucket,
    now,
    randomId: () => crypto.randomUUID(),
    session: async (request) => {
      const id = request.headers.get("x-test-operator");
      return id ? { githubId: id, githubLogin: "fixture", admin: false } : null;
    },
    signed: (request, maximum) =>
      signedVettingRequest(
        request,
        { resultPublicKeys: keys.publicKey, now },
        maximum,
      ),
  });
  async function request(
    method: string,
    path: string,
    body: string | Uint8Array,
  ) {
    return new Request(`https://slop.cash${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(await signedVettingHeaders(
          keys.privateKey,
          keys.raw,
          method,
          path,
          body,
          now(),
        )),
      },
      body: typeof body === "string" ? body : new Uint8Array(body),
    });
  }
  async function retain(
    assessmentId: string,
    runId: string,
    input: {
      traceSha256: string;
      objects: typeof VETTING_EVIDENCE_OBJECTS;
    } = { traceSha256: VETTING_TRACE_SHA, objects: VETTING_EVIDENCE_OBJECTS },
  ) {
    const path = `/api/v1/vetting/evidence/${assessmentId}/${runId}`;
    const manifest = {
      traceSha256: input.traceSha256,
      objects: input.objects.map(({ body: _body, ...object }) => object),
    };
    const requests = [await request("POST", path, JSON.stringify(manifest))];
    for (const object of input.objects)
      requests.push(
        await request("PUT", `${path}/${object.sha256}`, object.body),
      );
    for (const req of requests) {
      const response = await evidence.handle(req);
      if (!response?.ok)
        throw new Error(
          `Evidence fixture failed ${response?.status}: ${await response?.text()}`,
        );
    }
  }
  return {
    evidence,
    bucket,
    request,
    retain,
    dispose,
  };
}
