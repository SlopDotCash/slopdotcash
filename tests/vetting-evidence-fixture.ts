/**
 * Real local workerd R2 for the connected vetting workflows. The evidence
 * terms are the fixed source policy; the recorded owner and reader IDs are
 * exported for synthetic sessions.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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

async function processGroupStopped(pid: number) {
  if (process.platform !== "linux") {
    const { stdout } = await promisify(execFile)(
      "ps",
      ["-axo", "pgid=,stat="],
      { timeout: 2000 },
    );
    return !stdout.split("\n").some((line) => {
      const [group, state] = line.trim().split(/\s+/u);
      return Number(group) === pid && !/^[ZX]/u.test(state ?? "");
    });
  }
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    let stat: string;
    try {
      stat = await readFile(`/proc/${entry}/stat`, "utf8");
    } catch (error) {
      if (
        ["ENOENT", "ESRCH"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        continue;
      throw error;
    }
    const [state, , group] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(group) === pid && state !== "Z" && state !== "X") return false;
  }
  return true;
}

/** Stop only this fixture process, independently of inherited pipe closure. */
export async function stopVettingEvidence(
  child: ChildProcess,
  graceMs = 4000,
  ownsProcessGroup = false,
  completionPath?: string,
) {
  let signalError: unknown;
  let forced = false;
  const signal = (name: "SIGTERM" | "SIGKILL") => {
    if (!ownsProcessGroup) return child.kill(name);
    if (!child.pid) return;
    try {
      process.kill(-child.pid, name);
      if (name === "SIGKILL") forced = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        signalError = error;
    }
  };
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const completed = new Promise<number>((resolve, reject) => {
    if (!completionPath || !ownsProcessGroup || !child.pid) return;
    const pid = child.pid;
    const inspect = async () => {
      try {
        const marker = JSON.parse(await readFile(completionPath, "utf8"));
        if (marker.pid !== pid || marker.completed !== true)
          throw new Error("Invalid local R2 shutdown acknowledgement");
        if (!forced && (await processGroupStopped(pid))) {
          resolve(0);
          return;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          reject(error);
          return;
        }
      }
      if (!stopped) completionTimer = setTimeout(inspect, 25);
    };
    void inspect();
  });
  let onExit: (code: number | null) => void = () => {};
  let onError: (error: Error) => void = () => {};
  const exited = new Promise<number | null>((resolve, reject) => {
    onExit = resolve;
    onError = reject;
    // `exit` reports the process termination without waiting for inherited
    // stdout handles. `close` and Bun's exited promise may wait for those.
    child.once("exit", onExit);
    child.once("error", onError);
    if (child.exitCode !== null || child.signalCode !== null)
      resolve(child.exitCode);
  });
  try {
    child.stdin?.end();
  } catch {
    /* A prior shutdown may already have closed stdin. */
  }
  const terminate = setTimeout(() => signal("SIGTERM"), graceMs);
  const force = setTimeout(() => signal("SIGKILL"), graceMs + 1000);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      exited,
      completed,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Local R2 shutdown timed out")),
          graceMs + 2000,
        );
      }),
    ]);
    if (signalError) throw signalError;
    return result;
  } finally {
    stopped = true;
    clearTimeout(completionTimer);
    clearTimeout(terminate);
    clearTimeout(force);
    clearTimeout(deadline);
    // A parent that exits first must not leave its owned descendants running.
    if (ownsProcessGroup) signal("SIGKILL");
    child.removeListener("exit", onExit);
    child.removeListener("error", onError);
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}

export async function localVettingEvidence(
  db: ProjectD1Database,
  now: () => Date,
) {
  const directory = await mkdtemp(join(tmpdir(), "slop-r2-shutdown-"));
  const completionPath = join(directory, "completed.json");
  const child = spawn(
    "node",
    [
      fileURLToPath(new URL("./vetting-evidence-r2.mjs", import.meta.url)),
      completionPath,
    ],
    {
      stdio: ["pipe", "pipe", "inherit"],
      detached: process.platform !== "win32",
    },
  );
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let origin: string;
  let line = "";
  let onData: (chunk: Buffer) => void = () => {};
  let onEnd: () => void = () => {};
  let onError: (error: Error) => void = () => {};
  try {
    origin = await new Promise<string>((resolve, reject) => {
      onData = (chunk) => {
        line += chunk.toString("utf8");
        if (line.length > 256)
          reject(new Error("Invalid local R2 startup line"));
        else if (line.includes("\n")) resolve(line.trim());
      };
      onEnd = () => reject(new Error("Local R2 startup failed"));
      onError = reject;
      child.stdout.on("data", onData);
      child.stdout.once("end", onEnd);
      child.once("error", onError);
      child.once("exit", onEnd);
      startupTimer = setTimeout(
        () => reject(new Error("Local R2 startup timed out")),
        15000,
      );
    });
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1")
      throw new Error("Invalid local R2 origin");
  } catch (error) {
    try {
      if (child.pid)
        await stopVettingEvidence(
          child,
          4000,
          process.platform !== "win32",
          completionPath,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  } finally {
    clearTimeout(startupTimer);
    child.stdout.removeListener("data", onData);
    child.stdout.removeListener("end", onEnd);
    child.removeListener("error", onError);
    child.removeListener("exit", onEnd);
    child.stdout.resume();
  }
  async function dispose() {
    try {
      if (
        (await stopVettingEvidence(
          child,
          4000,
          process.platform !== "win32",
          completionPath,
        )) !== 0
      )
        throw new Error("Local R2 shutdown failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
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
    // Exercise the standard stream contract rather than Bun's optimized
    // HTTP reader, whose releaseLock can fail under concurrent reads.
    const body = response.body?.pipeThrough(new TransformStream()) ?? null;
    const normalized = new Response(body);
    return {
      size: Number(response.headers.get("x-r2-size")),
      etag: response.headers.get("x-r2-etag") ?? undefined,
      customMetadata: JSON.parse(response.headers.get("x-r2-metadata")!),
      body,
      arrayBuffer: () => normalized.arrayBuffer(),
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
              etag: value.etag,
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
