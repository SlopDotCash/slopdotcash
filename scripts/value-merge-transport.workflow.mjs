/** Native Workerd transport feasibility; never imports or publishes an assessment. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { childEnvironment } from "./child-environment.mjs";

const [bundlePath, envelopePath, resultPath, sdkUrl, sdkProcessId] =
  process.argv.slice(2);
if (sdkProcessId) assert.match(sdkProcessId, /^[1-9][0-9]*$/);
if (sdkUrl) assert.match(sdkUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
const sdk = Boolean(sdkUrl);
assert(
  bundlePath && envelopePath && resultPath,
  "Expected bundle, private envelope and safe result paths",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directory = await mkdtemp(join(tmpdir(), "slop-merge-transport-"));
const result = {
  mode: sdk ? "linux-sdk-transport-control" : "native-workerd-checksum-sink",
  status: "failed",
  sdkContainerUsed: sdk,
  envelopeKind:
    envelopePath === "--transport-control"
      ? "harmless-size-control"
      : "private-unpublished-assessment",
  journalWritten: false,
  assessmentValidated: false,
};
let runtime;
let outbound = 0;
let timer;
let failure;
let idleRssKiB = [];
const peaks = new Map();
function sample() {
  const ps = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,comm="], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (ps.status !== 0) return;
  const rows = ps.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return (
        match && {
          pid: Number(match[1]),
          parent: Number(match[2]),
          rssKiB: Number(match[3]),
          command: match[4],
        }
      );
    })
    .filter(Boolean);
  const owned = new Set([process.pid]);
  if (sdkProcessId) owned.add(Number(sdkProcessId));
  for (let pass = 0; pass < 5; pass++)
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  for (const row of rows)
    if (owned.has(row.pid) && /(?:^|\/)workerd$/.test(row.command))
      peaks.set(row.pid, Math.max(peaks.get(row.pid) ?? 0, row.rssKiB));
}
try {
  result.phase = "read-private-inputs";
  const bundle = await readFile(bundlePath);
  const control = JSON.stringify({
    schema: "transport-control-not-an-assessment",
    padding: "",
  });
  const envelope =
    envelopePath === "--transport-control"
      ? control.replace(
          '"padding":""',
          `"padding":"${"x".repeat(15546 - Buffer.byteLength(control))}"`,
        )
      : await readFile(envelopePath, "utf8");
  if (sdk)
    assert.equal(
      envelopePath,
      "--transport-control",
      "CI must never upload a real assessment",
    );
  JSON.parse(envelope);
  result.inputs = {
    bundle: { bytes: bundle.length, sha256: sha(bundle) },
    envelope: { bytes: Buffer.byteLength(envelope), sha256: sha(envelope) },
  };
  assert(
    bundle.length > 24_000_000 &&
      bundle.length + Buffer.byteLength(envelope) < 25 * 1024 * 1024,
  );
  let pages;
  if (!sdk) {
    result.phase = "build-test-only-worker";
    const built = join(directory, "probe.mjs");
    const build = spawnSync(
      "bun",
      [
        "--no-env-file",
        "build",
        "tests/fixtures/value-merge-transport-worker.ts",
        "--target=browser",
        "--external=cloudflare:*",
        `--outfile=${built}`,
      ],
      {
        encoding: "utf8",
        env: childEnvironment(process.env),
        timeout: 30000,
      },
    );
    assert.equal(build.status, 0, "Test-only Worker bundle failed");
    const script = await readFile(built, "utf8");
    result.phase = "native-rpc-start";
    const shared = {
      modules: true,
      compatibilityDate: "2026-09-14",
      compatibilityFlags: ["nodejs_compat"],
      outboundService: () => {
        outbound++;
        return new Response("No outbound", { status: 502 });
      },
    };
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "transport-pages",
            ...shared,
            script,
            serviceBindings: {
              PUBLISHER: {
                name: "transport-publisher",
                entrypoint: "TransportPublisher",
              },
            },
          },
          {
            name: "transport-publisher",
            ...shared,
            script,
            bindings: { MODE: "sink" },
          },
        ],
      }),
    );
    await runtime.ready;
    sample();
    idleRssKiB = [...peaks.values()];
    timer = setInterval(sample, 100);
    // Dispatch through the native HTTP entrypoint. getWorker().fetch uses the
    // /cdn-cgi RPC proxy, whose Origin guard applies before this fixture.
    pages = {
      fetch(url, init) {
        // Serialize Node's native FormData before crossing Miniflare's separately
        // bundled Undici version. Pass the actual HTTP stream and headers.
        const request = new Request(url, init);
        return runtime.dispatchFetch(url, {
          method: request.method,
          headers: [...request.headers],
          body: request.body,
          duplex: "half",
        });
      },
    };
  } else {
    sample();
    idleRssKiB = [...peaks.values()];
    timer = setInterval(sample, 100);
    pages = {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(180_000) }),
    };
  }
  const origin = sdkUrl ?? "https://transport.internal";
  const url = `${origin}/api/v1/slopbot/value-import`;
  const headers = {
    origin,
    "x-fixture-actor": "fixture-admin",
  };
  const form = () => {
    const data = new FormData();
    data.set(
      "assessment",
      new Blob([envelope], { type: "application/json" }),
      "assessment.json",
    );
    data.set(
      "bundle",
      new Blob([bundle], { type: "application/octet-stream" }),
      "source.bundle",
    );
    return data;
  };
  result.phase = "multipart-and-named-rpc";
  const started = performance.now();
  const response = await pages.fetch(url, {
    method: "POST",
    headers,
    body: form(),
  });
  result.responseStatus = response.status;
  if (response.status !== 200) {
    // Retain only fixture-owned error labels, never provider response bodies.
    const refusal = await response.json().catch(() => null);
    result.refusal = refusal && {
      error: refusal.error,
      phase: refusal.phase,
      name: refusal.name,
    };
  }
  assert.equal(response.status, 200, "Actual native multipart path refused");
  const body = await response.json();
  result.observed = body.observation;
  result.multipartBytes = body.multipartBytes;
  assert.equal(body.sequence, 0);
  assert.equal(body.observation.journalWritten, false);
  assert.equal(body.observation.assessmentValidated, false);
  assert.equal(body.observation.sdkContainerUsed, sdk);
  if (sdk) {
    assert.deepEqual(body.observation.reread, result.inputs.bundle);
    assert.equal(body.observation.destroyAcknowledged, true);
  }
  assert.deepEqual(body.observation.bundle, result.inputs.bundle);
  assert.deepEqual(body.observation.envelope, result.inputs.envelope);
  assert(body.multipartBytes < 25 * 1024 * 1024);
  result.multipart = {
    totalBytes: body.multipartBytes,
    elapsedMs: performance.now() - started,
    exactByteEquality: true,
    namedRpcStream: true,
  };
  result.phase = "existing-json";
  const json = await pages.fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: envelope,
  });
  assert.equal(json.status, 200);
  const jsonBody = await json.json();
  assert.deepEqual(jsonBody.observation.envelope, result.inputs.envelope);
  assert.equal(jsonBody.observation.bundle, null);
  result.jsonUnchanged = true;
  result.phase = "request-boundaries";
  const missingRole = await pages.fetch(url, {
    method: "POST",
    headers: { origin: headers.origin },
    body: form(),
  });
  assert.equal(missingRole.status, 401);
  await missingRole.text();
  const wrongOrigin = await pages.fetch(url, {
    method: "POST",
    headers: { ...headers, origin: "https://other.invalid" },
    body: form(),
  });
  assert.equal(wrongOrigin.status, 403);
  await wrongOrigin.text();
  const oversize = new FormData();
  oversize.set(
    "assessment",
    new Blob([envelope], { type: "application/json" }),
    "assessment.json",
  );
  oversize.set(
    "bundle",
    new Blob([new Uint8Array(25 * 1024 * 1024)]),
    "oversize.bundle",
  );
  const refused = await pages.fetch(url, {
    method: "POST",
    headers,
    body: oversize,
  });
  assert.equal(refused.status, 400);
  await refused.text();
  result.refusals = {
    absentSyntheticRole: true,
    wrongOrigin: true,
    total25MiBCeiling: true,
  };
  if (!sdk) {
    assert.equal(outbound, 0);
    result.outboundCalls = outbound;
  }
  result.status = "passed";
  result.phase = "complete";
} catch (error) {
  failure = error;
  result.error = error instanceof Error ? error.name : "UnknownFailure";
} finally {
  clearInterval(timer);
  sample();
  result.idleWorkerdRssKiB = idleRssKiB;
  result.sampledWorkerdRssKiB = [...peaks.values()];
  result.memoryMeasurement =
    "100ms host RSS samples of owned Workerd processes; not isolate heap, cgroup peak, or SDK-container measurement";
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
  result.cleanup = {
    nativeRuntimeDisposed: !sdk,
    sdkDestroyAcknowledged:
      sdk && result.observed?.destroyAcknowledged === true,
    temporaryDirectoryRemoved: true,
  };
  await writeFile(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
}
console.log(JSON.stringify(result));
if (failure) process.exitCode = 1;
