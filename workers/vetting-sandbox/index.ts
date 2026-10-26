/** Private service binding only. The Pages bridge authenticates the scanner. */
import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { isRecord, readLimitedBody } from "../../backend/trace/validation";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";

export { MergeVerifier } from "./merge";

export class OfflineSandbox extends Sandbox {
  override enableInternet = false;
  override sleepAfter = "1m";
  override envVars = {};
}

interface Env {
  SLOP_RELEASE_SHA?: string;
  RUNNER_IMAGE_SHA256?: string;
  RUNNER: Parameters<typeof getSandbox>[0];
}

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const INTERPRETERS = new Set(["shell", "python", "node", "binary"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return Response.json({
        service: "vetting-sandbox",
        ok: true,
        revision: env.SLOP_RELEASE_SHA ?? null,
        imageSha256: env.RUNNER_IMAGE_SHA256 ?? null,
      });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    let body: unknown;
    let bytes: Uint8Array;
    try {
      body = JSON.parse(
        new TextDecoder().decode(
          await readLimitedBody(request, 3 * 1024 * 1024),
        ),
      );
      if (
        !isRecord(body) ||
        Object.keys(body).sort().join(",") !==
          "artifactBase64,artifactSha256,interpreter" ||
        typeof body.artifactBase64 !== "string" ||
        typeof body.artifactSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.artifactSha256) ||
        typeof body.interpreter !== "string" ||
        !INTERPRETERS.has(body.interpreter)
      )
        throw new Error("Invalid artifact request");
      bytes = Uint8Array.from(atob(body.artifactBase64), (character) =>
        character.charCodeAt(0),
      );
      if (
        bytes.length === 0 ||
        bytes.length > MAX_ARTIFACT_BYTES ||
        (await sha256Hex(bytes)) !== body.artifactSha256
      )
        throw new Error("Artifact digest or size mismatch");
    } catch {
      return new Response("Invalid artifact request", { status: 400 });
    }
    // A fresh ID per execution prevents reuse of any earlier artifact's filesystem.
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const sandbox = getSandbox(env.RUNNER, runId);
    try {
      const write = await sandbox.writeFile(
        "/analysis/artifact",
        body.artifactBase64 as string,
        { encoding: "base64" },
      );
      if (!write.success) throw new Error("Artifact write failed");
      const setup = await sandbox.exec("chmod 0555 /analysis/artifact", {
        timeout: 10000,
      });
      if (!setup.success) throw new Error("Artifact permissions failed");
      const execution = await sandbox.exec(
        `python3 /opt/slop/supervise.py ${body.interpreter}`,
        { timeout: 40000 },
      );
      if (!execution.success) throw new Error("Execution supervisor failed");
      const evidence: unknown = JSON.parse(execution.stdout);
      if (
        !isRecord(evidence) ||
        typeof evidence.status !== "string" ||
        !["exited", "timeout", "output-limit", "not-executable"].includes(
          evidence.status,
        ) ||
        typeof evidence.exitCode !== "number" ||
        typeof evidence.stdoutBase64 !== "string" ||
        typeof evidence.stderrBase64 !== "string" ||
        typeof evidence.outputComplete !== "boolean"
      )
        throw new Error("Invalid execution evidence");
      return Response.json(
        {
          schema: "slop-isolated-artifact-v1",
          runId,
          startedAt,
          completedAt: new Date().toISOString(),
          imageSha256: env.RUNNER_IMAGE_SHA256 ?? null,
          sourceSha: env.SLOP_RELEASE_SHA ?? null,
          artifactSha256: body.artifactSha256,
          interpreter: body.interpreter,
          internetEnabled: false,
          status: evidence.status,
          exitCode: evidence.exitCode,
          stdoutBase64: evidence.stdoutBase64,
          stderrBase64: evidence.stderrBase64,
          outputComplete: evidence.outputComplete,
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return new Response("Isolated execution unavailable", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    } finally {
      await sandbox.destroy();
    }
  },
};
