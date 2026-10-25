/** Harmless isolation probes shared by local and protected hosted qualification. */
import assert from "node:assert/strict";
import { sha256Hex } from "../../backend/trace/validation";
import type { QueueConnection } from "../vetting/queue";
import {
  type ArtifactInterpreter,
  type IsolatedArtifactEvidence,
  runIsolatedArtifact,
} from "../vetting/sandbox";
export async function qualifySandbox(input: {
  connection: QueueConnection;
  send: (body: Uint8Array, signed?: boolean) => Promise<Response>;
  afterUnsigned?: () => void;
  checkIdentity?: (evidence: IsolatedArtifactEvidence) => void;
}) {
  const { connection, send, afterUnsigned, checkIdentity } = input;
  const encoder = new TextEncoder();
  const runIds = new Set<string>();
  async function payload(source: string, interpreter = "python") {
    const bytes = encoder.encode(source);
    return {
      artifactBase64: Buffer.from(bytes).toString("base64"),
      artifactSha256: await sha256Hex(bytes),
      interpreter,
    };
  }
  async function execute(
    source: string,
    interpreter: ArtifactInterpreter = "python",
  ) {
    const result = await runIsolatedArtifact({
      connection,
      bytes: encoder.encode(source),
      interpreter,
    });
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(result.bytes)),
      result.evidence,
    );
    checkIdentity?.(result.evidence);
    assert(!runIds.has(result.evidence.runId), "A sandbox identity was reused");
    runIds.add(result.evidence.runId);
    return result.evidence;
  }

  const body = encoder.encode(
    JSON.stringify(await payload("print('untrusted')")),
  );
  assert.equal((await send(body, false)).status, 401);
  afterUnsigned?.();
  const invalid = await payload("print('wrong digest')");
  invalid.artifactSha256 = "0".repeat(64);
  assert.equal(
    (await send(encoder.encode(JSON.stringify(invalid)))).status,
    400,
  );

  const unsupported = await execute("not an executable format", "binary");
  assert.equal(unsupported.status, "not-executable");
  assert.equal(unsupported.exitCode, 126);
  assert.equal(unsupported.outputComplete, false);

  const identity = await execute(
    "import os,json\nprint(os.getuid(), os.getgid())\nprint(json.dumps(sorted(os.environ)))\nopen('/analysis/work/marker', 'w').write('private')",
  );
  assert.equal(identity.exitCode, 0);
  assert.match(
    Buffer.from(identity.stdoutBase64, "base64").toString(),
    /65534 65534/,
  );
  const environment = JSON.parse(
    Buffer.from(identity.stdoutBase64, "base64").toString().split("\n")[1],
  ) as string[];
  assert.deepEqual(
    environment.filter((key) => key !== "LC_CTYPE"),
    ["HOME", "PATH", "TMPDIR"],
  );
  const fresh = await execute(
    "import os\nprint(os.path.exists('/analysis/work/marker'))\nprint(os.getenv('SURPLUS_API_KEY', 'absent'))",
  );
  assert.equal(
    Buffer.from(fresh.stdoutBase64, "base64").toString(),
    "False\nabsent\n",
  );
  const node = await execute("console.log('node-runtime')", "node");
  assert.equal(node.exitCode, 0);
  assert.equal(
    Buffer.from(node.stdoutBase64, "base64").toString(),
    "node-runtime\n",
  );
  const network = await execute(
    "import socket\ntry:\n s=socket.socket()\n s.settimeout(3)\n s.connect(('1.1.1.1',443))\n print('CONNECTED')\nexcept OSError:\n print('BLOCKED')",
  );
  assert.equal(
    Buffer.from(network.stdoutBase64, "base64").toString(),
    "BLOCKED\n",
  );
  const limited = await execute("import sys\nsys.stdout.write('x' * 1000000)");
  assert.equal(limited.status, "output-limit");
  assert.equal(limited.outputComplete, false);
  assert.equal(Buffer.from(limited.stdoutBase64, "base64").length, 65536);
  const timeout = await execute("import time\ntime.sleep(40)");
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.outputComplete, false);
  const afterTimeout = await execute(
    "import os\nprint(os.path.exists('/analysis/work/marker'))",
  );
  assert.equal(afterTimeout.exitCode, 0);
  assert.equal(
    Buffer.from(afterTimeout.stdoutBase64, "base64").toString(),
    "False\n",
  );
  return {
    authorizationRefused: true,
    digestMismatchRefused: true,
    unsupportedRefused: true,
    unprivilegedIdentity: true,
    minimalEnvironment: true,
    freshFilesystem: true,
    pythonAndNode: true,
    egressRefused: true,
    outputBounded: true,
    timeoutBounded: true,
    freshAfterTimeout: true,
    uniqueExecutions: runIds.size,
    destruction:
      "successful responses awaited destroy; independent provider teardown inventory not proven",
  };
}
