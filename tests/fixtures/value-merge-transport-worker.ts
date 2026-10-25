/** Test-only transport probe. No importer, model, database or journal is called. */
/// <reference path="../../workers/slopbot/cloudflare-workers.d.ts" />

import { WorkerEntrypoint } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { handleHistoricalValueImport } from "../../backend/slopbot/value-import";
import { OfflineSandbox } from "../../workers/vetting-sandbox";

export { OfflineSandbox };

const MAX_REQUEST = 25 * 1024 * 1024;
type Observation = { bytes: number; sha256: string };
interface Env {
  MODE: "sink" | "sdk";
  RUNNER: Parameters<typeof getSandbox>[0];
  PUBLISHER: {
    observe(
      envelope: string,
      body: ReadableStream<Uint8Array> | null,
    ): Promise<unknown>;
  };
}

function observed(stream: ReadableStream<Uint8Array>, ceiling = MAX_REQUEST) {
  let bytes = 0;
  const hash = sha256.create();
  return {
    stream: stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > ceiling) throw new Error("Transport body limit");
          hash.update(chunk);
          controller.enqueue(chunk);
        },
      }),
    ),
    result: (): Observation => ({ bytes, sha256: bytesToHex(hash.digest()) }),
  };
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      /* Consume bytes without retaining them. */
    }
  } finally {
    reader.releaseLock();
  }
}

export class TransportPublisher extends WorkerEntrypoint<Env> {
  async observe(envelope: string, body: ReadableStream<Uint8Array> | null) {
    const envelopeBytes = new TextEncoder().encode(envelope);
    const common = {
      envelope: {
        bytes: envelopeBytes.length,
        sha256: bytesToHex(sha256(envelopeBytes)),
      },
      mode: this.env.MODE,
      journalWritten: false,
      assessmentValidated: false,
    };
    if (!body) return { ...common, bundle: null };
    const input = observed(body);
    if (this.env.MODE === "sink") {
      await drain(input.stream);
      return { ...common, bundle: input.result(), sdkContainerUsed: false };
    }
    if (this.env.MODE !== "sdk") throw new Error("Unknown probe mode");
    const sandbox = getSandbox(this.env.RUNNER, crypto.randomUUID(), {
      transport: "rpc",
    });
    let result: unknown;
    try {
      const written = await sandbox.writeFile(
        "/analysis/transport.bundle",
        input.stream,
      );
      if (!written.success) throw new Error("SDK write refused");
      const bundle = input.result();
      const file = await sandbox.readFile("/analysis/transport.bundle", {
        encoding: "none",
      });
      const output = observed(file.content);
      await drain(output.stream);
      const reread = output.result();
      if (bundle.bytes !== reread.bytes || bundle.sha256 !== reread.sha256)
        throw new Error("SDK file bytes changed");
      const memory = await sandbox.exec("cat /sys/fs/cgroup/memory.peak", {
        timeout: 1000,
      });
      if (!memory.success || !/^\d+\s*$/.test(memory.stdout))
        throw new Error("Container memory observation unavailable");
      result = {
        ...common,
        bundle,
        reread,
        sdkContainerUsed: true,
        containerMemoryPeakBytes: Number(memory.stdout),
      };
    } finally {
      await sandbox.destroy();
    }
    return {
      ...(result as Record<string, unknown>),
      destroyAcknowledged: true,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return Response.json({ service: "merge-transport-test-only" });
    if (new URL(request.url).pathname !== "/api/v1/slopbot/value-import")
      return new Response("Not found", { status: 404 });
    // Synthetic local role fixture. The existing handler still enforces its
    // method, same-origin and admin checks; this is not real-session evidence.
    const actor = request.headers.get("x-fixture-actor");
    const dependencies = {
      adminGithubIds: new Set(["fixture-admin"]),
      sessionActor: async () => (actor ? { githubId: actor } : null),
    };
    const contentType = request.headers.get("content-type") ?? "";
    let envelope: string;
    let bundle: File | null = null;
    let multipartBytes: number | null = null;
    let phase = "start";
    try {
      if (contentType.startsWith("multipart/form-data;")) {
        // Test adapter for the proposed transport only; application JSON source
        // and generic sandbox limits are not changed by this fixture.
        if (
          request.method !== "POST" ||
          request.headers.get("origin") !== new URL(request.url).origin
        )
          return Response.json({ error: "origin_forbidden" }, { status: 403 });
        if (actor !== "fixture-admin")
          return new Response("Unauthorized", { status: actor ? 403 : 401 });
        if (!request.body) throw new Error("Missing body");
        phase = "parse-native-multipart";
        const input = observed(request.body);
        const form = await new Request(request, {
          body: input.stream,
        }).formData();
        multipartBytes = input.result().bytes;
        phase = "validate-parts";
        if (Array.from(form.keys()).sort().join() !== "assessment,bundle")
          throw new Error("Unexpected parts");
        const assessment = form.get("assessment");
        const file = form.get("bundle");
        if (!(assessment instanceof File) || !(file instanceof File))
          throw new Error("Invalid parts");
        // A file part preserves LF bytes; string form parts normalize CRLF.
        envelope = await assessment.text();
        bundle = file;
      } else {
        envelope = await request.text();
      }
      phase = "existing-handler-and-rpc";
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      headers.delete("content-length");
      const adapted = new Request(request.url, {
        method: request.method,
        headers,
        body: envelope,
      });
      return handleHistoricalValueImport(adapted, {
        ...dependencies,
        publisher: {
          publishSubscription: async () => ({
            // Deliberately transport-only: there is no journal receipt.
            recordDigest: "transport-probe-not-a-publication",
            sequence: 0,
            multipartBytes,
            observation: await env.PUBLISHER.observe(
              envelope,
              bundle?.stream() ?? null,
            ),
          }),
        },
      });
    } catch (error) {
      return Response.json(
        {
          error: "transport_probe_refused",
          phase,
          name: error instanceof Error ? error.name : "UnknownFailure",
        },
        { status: 400 },
      );
    }
  },
};
