import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

const assertion = `slop_assert_v1_${"test_only_".repeat(4)}`;
const token = "test-only-bearer-token-with-no-authority";
const trace = "Synthetic contribution trace, not a private user record.\n";
const address = "11111111111111111111111111111111";
const state = {
  runId: "run_test",
  projectId: "test",
  repositoryId: "test/repo",
  revision: 1,
  provider: "test",
  model: "test",
  client: "test",
};
let root, receipt, wallet;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "slop-transport-"));
  await mkdir(join(root, "scripts"));
  for (const name of ["run-receipt.mjs", "wallet-claim.mjs"])
    await copyFile(
      new URL(
        `../skills/project-contributor-template/scripts/${name}`,
        import.meta.url,
      ),
      join(root, "scripts", name),
    );
  await writeFile(
    join(root, "project.json"),
    JSON.stringify({ repositoryId: state.repositoryId }),
  );
  await writeFile(join(root, "trace.txt"), trace);
  receipt = await import(
    pathToFileURL(join(root, "scripts/run-receipt.mjs")).href
  );
  wallet = await import(
    pathToFileURL(join(root, "scripts/wallet-claim.mjs")).href
  );
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function server(handler) {
  const app = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    handler(request, response, Buffer.concat(chunks).toString());
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  return { app, origin: `http://127.0.0.1:${app.address().port}` };
}

async function withTransport(redirectPath, run, sameOrigin = false) {
  const redirected = [],
    received = [];
  const destination = await server((request, response, body) => {
    redirected.push({ headers: request.headers, body });
    response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  let source;
  const sha256 = createHash("sha256").update(trace).digest("hex");
  const claim = {
    schemaVersion: 1,
    claimId: "claim_test",
    address,
    githubActorId: "1",
    githubLogin: "test",
    observedAt: new Date().toISOString(),
    recordDigest: "a".repeat(64),
    supersedesClaimId: null,
  };
  source = await server((request, response, body) => {
    const path = request.url;
    received.push({ path, headers: request.headers, body });
    if (path === redirectPath) {
      response
        .writeHead(307, {
          Location: `${sameOrigin ? source.origin : destination.origin}/redirected`,
        })
        .end();
      return;
    }
    if (path === "/redirected") {
      redirected.push({ headers: request.headers, body });
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    let value;
    if (path === "/v1/oauth/start")
      value = {
        authorizationUrl: "https://identity.slop.cash/v1/oauth/authorize",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        flowId: `flow_${"x".repeat(20)}`,
        pollAfterSeconds: 1,
        pollCapability: "x".repeat(32),
      };
    else if (path === "/v1/oauth/poll")
      value = {
        assertion,
        assertionType: "SlopIdentity",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "complete",
      };
    else if (path === "/api/v1/auth/session")
      value = {
        token,
        tokenType: "Bearer",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    else if (path === "/api/v1/runs")
      value = {
        clientRunId: state.runId,
        serverRunId: "server_test",
        state: "awaiting_trace",
      };
    else if (path === "/api/v1/runs/server_test/trace-intents")
      value = {
        ...JSON.parse(body),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverRunId: "server_test",
        uploadUrl: "https://api.slop.cash/trace-upload",
      };
    else if (path === "/trace-upload")
      value = {
        clientRunId: state.runId,
        serverRunId: "server_test",
        sizeBytes: Buffer.byteLength(trace),
        state: "trace_uploaded",
        traceObjectId: `sha256:${sha256}`,
        traceSha256: sha256,
      };
    else if (path === "/api/v1/runs/server_test/finalize")
      value = {
        clientRunId: state.runId,
        serverRunId: "server_test",
        state: "finalized",
        traceObjectId: `sha256:${sha256}`,
        traceSha256: sha256,
      };
    else if (path === "/api/v1/wallet-claims/current") {
      response.writeHead(404).end();
      return;
    } else if (path === "/api/v1/wallet-claims") value = claim;
    else
      value = {
        enabled: true,
        source: "github-public-status",
        verifiedAt: new Date().toISOString(),
      };
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(value));
  });
  // Route only the initial canonical authority to loopback; actual fetch must
  // still process the server's redirect with the production request options.
  const fetchImpl = (url, options) =>
    fetch(`${source.origin}${new URL(url).pathname}`, options);
  try {
    await run({ fetchImpl, redirected, received, claim });
  } finally {
    source.app.closeAllConnections();
    destination.app.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => source.app.close(resolve)),
      new Promise((resolve) => destination.app.close(resolve)),
    ]);
  }
}

const upload = (fetchImpl) =>
  receipt.uploadPrivateTrace(state, join(root, "trace.txt"), "1.0.0", {
    fetchImpl,
    assertionProvider: async () => assertion,
    disclosure: () => {},
  });
const register = (fetchImpl) =>
  wallet.registerWalletClaim(address, {
    fetch: fetchImpl,
    assertionProvider: async () => assertion,
  });
const identify = (fetchImpl) =>
  receipt.slopIdentityAssertion(fetchImpl, async () => {});

for (const [name, path, action] of [
  ["trace identity assertion", "/api/v1/auth/session", upload],
  ["private trace bytes", "/trace-upload", upload],
  ["private intake authority", "/api/v1/private-request-intake", upload],
  ["wallet identity assertion", "/api/v1/auth/session", register],
  ["current wallet request", "/api/v1/wallet-claims/current", register],
  ["wallet registration", "/api/v1/wallet-claims", register],
  ["OAuth start", "/v1/oauth/start", identify],
  ["OAuth poll capability", "/v1/oauth/poll", identify],
]) {
  test(`${name} refuses a redirect before contacting another origin`, async () => {
    await withTransport(path, async ({ fetchImpl, redirected, received }) => {
      await assert.rejects(action(fetchImpl));
      assert.ok(received.some((row) => row.path === path));
      assert.deepEqual(redirected, []);
    });
  });
}

test("same-origin redirects cannot replay the identity assertion to another path", async () => {
  await withTransport(
    "/api/v1/auth/session",
    async ({ fetchImpl, redirected }) => {
      await assert.rejects(register(fetchImpl));
      assert.deepEqual(redirected, []);
    },
    true,
  );
});

test("direct trace upload and wallet registration retain their exact payloads", async () => {
  await withTransport(
    null,
    async ({ fetchImpl, received, redirected, claim }) => {
      assert.deepEqual(await upload(fetchImpl), {
        authority: "https://api.slop.cash",
        serverRunId: "server_test",
        objectId: `sha256:${createHash("sha256").update(trace).digest("hex")}`,
        sha256: createHash("sha256").update(trace).digest("hex"),
      });
      assert.deepEqual(await register(fetchImpl), claim);
      assert.equal(
        received.find((row) => row.path === "/trace-upload").body,
        trace,
      );
      assert.ok(
        received
          .filter((row) => row.path === "/api/v1/auth/session")
          .every(
            (row) => row.headers["x-slop-identity-assertion"] === assertion,
          ),
      );
      assert.deepEqual(redirected, []);
    },
  );
});
