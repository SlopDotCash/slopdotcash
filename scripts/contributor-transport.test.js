import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
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
  for (const name of [
    "run-receipt.mjs",
    "session-export.mjs",
    "wallet-claim.mjs",
  ])
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
    else if (path === "/api/v1/runs/server_test/trace-intents") {
      // The real server reads termsVersion but does not echo it.
      const { termsVersion: _terms, ...intent } = JSON.parse(body);
      value = {
        ...intent,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverRunId: "server_test",
        uploadUrl: "https://api.slop.cash/trace-upload",
      };
    } else if (path === "/trace-upload")
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

// ---- Session command: an installed skill copy, a Git repository whose origin
// is the project, and a loopback server standing in for Slop and GitHub.
const SKILL_FILES = [
  "SKILL.md",
  "project.json",
  "scripts/run-receipt.mjs",
  "scripts/session-export.mjs",
  "scripts/wallet-claim.mjs",
];
const REVISION = "a".repeat(40);
const sessionArgs = (runId, extra = []) => [
  "session",
  "--run",
  runId,
  "--repo-root",
  installed.repo,
  "--pull-request",
  "https://github.com/test/repo/pull/7",
  "--pull-request-node-id",
  "PR_kwDOtest0000007",
  "--client-version",
  "1.0.0",
  "--provider",
  "anthropic",
  "--model",
  "claude-opus-5-5",
  "--client",
  "claude-code",
  ...extra,
];
let installed;
const savedConfigHome = process.env.XDG_CONFIG_HOME;

before(async () => {
  const base = realpathSync(await mkdtemp(join(tmpdir(), "slop-session-")));
  const skill = join(base, "skill");
  await mkdir(join(skill, "scripts"), { recursive: true });
  for (const name of [
    "run-receipt.mjs",
    "session-export.mjs",
    "wallet-claim.mjs",
  ])
    await copyFile(
      new URL(
        `../skills/project-contributor-template/scripts/${name}`,
        import.meta.url,
      ),
      join(skill, "scripts", name),
    );
  await writeFile(join(skill, "SKILL.md"), "# Test skill\n");
  await writeFile(
    join(skill, "project.json"),
    JSON.stringify({
      projectId: "test",
      repositoryId: "test/repo",
      skillName: "contribute-to-test",
      skillSourcePath: "skills/contribute-to-test",
      usageAdapters: {},
    }),
  );
  const digest = (path) =>
    createHash("sha256")
      .update(readFileSync(join(skill, path)))
      .digest("hex");
  await writeFile(
    join(skill, "PROVENANCE.json"),
    JSON.stringify({
      schemaVersion: "1",
      name: "contribute-to-test",
      repository: "SlopDotCash/slopdotcash",
      revisionStatus: "committed",
      revision: REVISION,
      source: {
        path: "skills/contribute-to-test/SKILL.md",
        sha256: digest("SKILL.md"),
      },
      files: SKILL_FILES.map((path) => ({ path, sha256: digest(path) })),
    }),
  );
  await writeFile(
    join(skill, ".slop-authorization.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1",
        repository: "SlopDotCash/slopdotcash",
        revision: REVISION,
        authorization: { kind: "source", revision: REVISION },
      },
      null,
      2,
    )}\n`,
  );
  const repo = join(base, "repo");
  await mkdir(repo);
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("remote", "add", "origin", "https://github.com/test/repo.git");
  await writeFile(join(repo, "README.md"), "Test repository\n");
  git("add", "README.md");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "init",
  );
  const home = join(base, "home");
  await mkdir(home);
  installed = {
    base,
    skill,
    repo,
    home,
    receipt: await import(
      pathToFileURL(join(skill, "scripts/run-receipt.mjs")).href
    ),
    exporter: await import(
      pathToFileURL(join(skill, "scripts/session-export.mjs")).href
    ),
  };
});
after(async () => {
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedConfigHome;
  if (installed) await rm(installed.base, { recursive: true, force: true });
});

// Each test gets its own machine settings and run state.
async function freshConfig() {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(installed.base, "config-"));
}

async function capture(fn) {
  const out = [];
  const err = [];
  const writeOut = process.stdout.write;
  const writeErr = process.stderr.write;
  process.stdout.write = (chunk) => {
    out.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
  return { stdout: out.join(""), stderr: err.join("") };
}

async function startRun() {
  const { stdout } = await capture(() =>
    installed.receipt.main([
      "start",
      "--repo-root",
      installed.repo,
      "--client",
      "claude-code",
      "--provider",
      "anthropic",
      "--model",
      "claude-opus-5-5",
      "--lane",
      "contributor",
    ]),
  );
  const runId = /Keep this id: (run_[0-9A-Z]{26})/.exec(stdout)?.[1];
  assert.ok(runId, stdout);
  return { runId, stdout };
}

// A Claude Code session file in which the agent ran start and saw its output.
async function writeClaudeSession(runId, startOutput) {
  const dir = join(installed.home, ".claude", "projects", "-test-repo");
  await mkdir(dir, { recursive: true });
  const receiptPath = join(installed.skill, "scripts", "run-receipt.mjs");
  const t = (n) => `2026-11-23T10:00:0${n}Z`;
  const row = (type, n, content) => ({
    type,
    timestamp: t(n),
    cwd: installed.repo,
    sessionId: "test-session",
    message: { role: type, content },
  });
  const rows = [
    row("user", 0, "Fix the README typo."),
    row("assistant", 1, [
      {
        type: "tool_use",
        id: "toolu_start",
        name: "Bash",
        input: { command: `node ${receiptPath} start --repo-root .` },
      },
    ]),
    row("user", 2, [
      { type: "tool_result", tool_use_id: "toolu_start", content: startOutput },
    ]),
    row("assistant", 3, [{ type: "text", text: "Run started; fixing it." }]),
    row("assistant", 4, [
      {
        type: "tool_use",
        id: "toolu_end",
        name: "Bash",
        input: { command: `node ${receiptPath} session --run ${runId}` },
      },
    ]),
  ];
  const path = join(dir, `${runId}.jsonl`);
  await writeFile(path, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return path;
}

// Loopback Slop and GitHub. Records every request in order.
// Keeps the server run state like the real API: an attached object moves the
// run to trace_uploaded, an intent for a different digest is refused, and
// finalize attaches nothing new.
async function sessionServer({ failIntent = false, failEvents = 0 } = {}) {
  const log = [];
  let trace = null;
  let clientRunId = null;
  let runState = "awaiting_trace";
  let eventFailures = failEvents;
  const app = await server((request, response, body) => {
    const path = request.url;
    log.push({ path, body, headers: request.headers });
    const sha = trace ? createHash("sha256").update(trace).digest("hex") : "";
    let value;
    if (path === "/repos/test/repo/license")
      value = { license: { spdx_id: "MIT" } };
    else if (path === "/api/v1/auth/session")
      value = {
        token,
        tokenType: "Bearer",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    else if (path === "/api/v1/runs") {
      clientRunId = JSON.parse(body).clientRunId;
      value = { clientRunId, serverRunId: "server_s", state: runState };
    } else if (path === "/api/v1/runs/server_s/trace-intents") {
      if (failIntent) {
        response.writeHead(500).end("{}");
        return;
      }
      const intent = JSON.parse(body);
      if (
        runState === "finalized" ||
        (trace !== null && intent.sha256 !== sha)
      ) {
        response.writeHead(409).end("{}");
        return;
      }
      value = {
        contentType: intent.contentType,
        sha256: intent.sha256,
        sizeBytes: intent.sizeBytes,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverRunId: "server_s",
        uploadUrl: "https://api.slop.cash/trace-upload-s",
      };
    } else if (path === "/trace-upload-s") {
      trace = body;
      runState = "trace_uploaded";
      const digest = createHash("sha256").update(body).digest("hex");
      value = {
        clientRunId,
        serverRunId: "server_s",
        sizeBytes: Buffer.byteLength(body),
        state: "trace_uploaded",
        traceObjectId: `sha256:${digest}`,
        traceSha256: digest,
      };
    } else if (path === "/api/v1/runs/server_s/events") {
      if (eventFailures > 0) {
        eventFailures -= 1;
        response.writeHead(500).end("{}");
        return;
      }
      value = {
        eventId: "event_1",
        kind: "pull_request_opened",
        runId: "server_s",
      };
    } else if (path === "/api/v1/runs/server_s/finalize") {
      runState = "finalized";
      value = {
        clientRunId,
        serverRunId: "server_s",
        state: "finalized",
        traceObjectId: `sha256:${sha}`,
        traceSha256: sha,
      };
    } else
      value = {
        enabled: true,
        source: "github-public-status",
        verifiedAt: new Date().toISOString(),
      };
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(value));
  });
  const fetchImpl = (url, options) =>
    fetch(`${app.origin}${new URL(url).pathname}`, options);
  return {
    log,
    fetchImpl,
    close: async () => {
      app.app.closeAllConnections();
      await new Promise((resolve) => app.app.close(resolve));
    },
  };
}

function sessionDeps(fetchImpl, order = [], extra = {}) {
  return {
    fetchImpl,
    homeDir: installed.home,
    env: { USER: "tester" },
    assertionProvider: async () => {
      order.push("assertion");
      return assertion;
    },
    disclosure: (shown) => {
      order.push("disclosure");
      order.disclosed = shown;
    },
    ...extra,
  };
}

test("start prints the run marker the exporter finds", async () => {
  await freshConfig();
  const { runId, stdout } = await startRun();
  assert.ok(stdout.split("\n").includes(`slop-run:${runId}`), stdout);
  await writeClaudeSession(runId, stdout);
  const marker = `slop-run:${runId}`;
  const found = installed.exporter.findSessionFile(marker, {
    homeDir: installed.home,
  });
  assert.equal(found?.client, "claude-code");
  const lines = readFileSync(found.path, "utf8").trim().split("\n");
  const events = installed.exporter.readClaudeCode(lines, marker);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["tool_result", "assistant"],
  );
  const json = await capture(() =>
    installed.receipt.main([
      "start",
      "--repo-root",
      installed.repo,
      "--client",
      "claude-code",
      "--provider",
      "anthropic",
      "--model",
      "claude-opus-5-5",
      "--lane",
      "contributor",
      "--json",
    ]),
  );
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.marker, `slop-run:${parsed.runId}`);
});

test("session with --skip makes no request", async () => {
  await freshConfig();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("no request expected");
  };
  const { stdout } = await capture(() =>
    installed.receipt.main(
      sessionArgs("run_00000000000000000000000000", ["--skip"]),
      sessionDeps(fetchImpl),
    ),
  );
  assert.equal(stdout, "Session upload skipped.\n");
  assert.equal(calls, 0);
});

test("trace-off stops session uploads and trace-on restores them", async () => {
  await freshConfig();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("no request expected");
  };
  await capture(() => installed.receipt.main(["trace-off"]));
  const settings = join(
    process.env.XDG_CONFIG_HOME,
    "slop/session-upload.json",
  );
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).upload, false);
  const { stdout } = await capture(() =>
    installed.receipt.main(
      sessionArgs("run_00000000000000000000000000"),
      sessionDeps(fetchImpl),
    ),
  );
  assert.equal(stdout, "Session upload skipped.\n");
  assert.equal(calls, 0);
  await capture(() => installed.receipt.main(["trace-on"]));
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).upload, true);
});

test("session uploads v3 and records the pull request before finalize", async () => {
  await freshConfig();
  const { runId, stdout: startOutput } = await startRun();
  await writeClaudeSession(runId, startOutput);
  const slop = await sessionServer();
  const order = [];
  try {
    const { stdout } = await capture(() =>
      installed.receipt.main(
        sessionArgs(runId),
        sessionDeps(slop.fetchImpl, order),
      ),
    );
    assert.match(stdout, /Session uploaded under private-trace-v3/);
    const paths = slop.log.map((row) => row.path);
    const intent = slop.log.find((row) => row.path.endsWith("/trace-intents"));
    assert.equal(JSON.parse(intent.body).termsVersion, "private-trace-v3");
    const event = slop.log.find((row) => row.path.endsWith("/events"));
    assert.deepEqual(
      {
        kind: JSON.parse(event.body).kind,
        auth: event.headers.authorization,
      },
      { kind: "pull_request_opened", auth: `Bearer ${token}` },
    );
    const at = (suffix) => paths.findIndex((p) => p.endsWith(suffix));
    assert.ok(at("/trace-upload-s") < at("/events"), paths.join(" "));
    assert.ok(at("/events") < at("/finalize"), paths.join(" "));
    assert.equal(
      paths.filter((p) => p === "/api/v1/runs").length,
      1,
      "one server run",
    );
    assert.equal(order.filter((x) => x === "assertion").length, 1);
    const uploaded = slop.log.find((row) => row.path === "/trace-upload-s");
    const header = JSON.parse(uploaded.body.split("\n")[0]);
    assert.equal(header.source, "client-file");
    assert.equal(header.format, "slop-session-v1");
  } finally {
    await slop.close();
  }
});

test("disclosure precedes sign-in and names v3 and the cleaner", async () => {
  await freshConfig();
  const { runId, stdout: startOutput } = await startRun();
  await writeClaudeSession(runId, startOutput);
  const slop = await sessionServer();
  const order = [];
  try {
    await capture(() =>
      installed.receipt.main(
        sessionArgs(runId),
        sessionDeps(slop.fetchImpl, order),
      ),
    );
    assert.deepEqual(order.slice(0, 2), ["disclosure", "assertion"]);
    assert.equal(order.disclosed.termsVersion, "private-trace-v3");
    assert.equal(order.disclosed.cleaner, installed.exporter.CLEANER_VERSION);
  } finally {
    await slop.close();
  }
});

test("v3 disclosure copy", async () => {
  const { stderr } = await capture(() =>
    installed.receipt.disclosePrivateTrace({
      absolutePath: "/tmp/s.ndjson",
      sha256: "b".repeat(64),
      sizeBytes: 10,
      contentType: "application/x-ndjson",
      termsVersion: "private-trace-v3",
      cleaner: "slop-session-cleaner-1",
      counts: { CREDENTIAL: 2, SOURCE: 1 },
    }),
  );
  const lines = stderr.split("\n");
  assert.ok(
    lines.includes(
      "This session will be uploaded under private-trace-v3: https://slop.cash/protocol/private-trace-v3.md",
    ),
    stderr,
  );
  assert.ok(
    lines.includes(
      "Cleaned on this machine by slop-session-cleaner-1: 2 credential, 1 source. Cleaning is pattern-based and may miss a secret; read the file.",
    ),
    stderr,
  );
  assert.ok(
    lines.includes(
      `To skip this run: rerun with --skip. To stop on this machine: node ${installed.skill}/scripts/run-receipt.mjs trace-off`,
    ),
    stderr,
  );
  for (const line of [
    "Inspect exact final bytes: /tmp/s.ndjson",
    "Size: 10 bytes",
    "Content-Type: application/x-ndjson",
    `SHA-256: ${"b".repeat(64)}`,
  ])
    assert.ok(lines.includes(line), line);
  assert.ok(!stderr.includes("Automatic redaction: none"));
});

test("licensing line shows once per machine", async () => {
  await freshConfig();
  const line =
    "Sessions you upload can be licensed for pay, half of each sale to you. It is off until you turn it on: https://slop.cash/account#trace-licensing";
  const outputs = [];
  for (let n = 0; n < 2; n += 1) {
    const { runId, stdout: startOutput } = await startRun();
    await writeClaudeSession(runId, startOutput);
    const slop = await sessionServer();
    try {
      outputs.push(
        (
          await capture(() =>
            installed.receipt.main(
              sessionArgs(runId),
              sessionDeps(slop.fetchImpl),
            ),
          )
        ).stdout,
      );
    } finally {
      await slop.close();
    }
  }
  assert.ok(outputs[0].includes(line), outputs[0]);
  assert.ok(!outputs[1].includes(line), outputs[1]);
});

test("upload failure is one line and the pull request stands", async () => {
  await freshConfig();
  const { runId, stdout: startOutput } = await startRun();
  await writeClaudeSession(runId, startOutput);
  const slop = await sessionServer({ failIntent: true });
  try {
    const { stdout } = await capture(() =>
      installed.receipt.main(sessionArgs(runId), sessionDeps(slop.fetchImpl)),
    );
    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1, stdout);
    assert.match(lines[0], /the pull request stands/);
    assert.doesNotMatch(stdout, /\n\s+at /);
  } finally {
    await slop.close();
  }
});

test("no session record and no log leaves the pull request alone", async () => {
  await freshConfig();
  const { runId } = await startRun();
  const slop = await sessionServer();
  try {
    const { stdout } = await capture(() =>
      installed.receipt.main(sessionArgs(runId), sessionDeps(slop.fetchImpl)),
    );
    assert.equal(stdout, "No session record; the pull request stands.\n");
    assert.ok(!slop.log.some((row) => row.path.startsWith("/api/")));
  } finally {
    await slop.close();
  }
});

test("fallback log is cleaned and headed", async () => {
  await freshConfig();
  const { runId } = await startRun();
  const secret = "zq8Vt3Lw9Kp2Rr7";
  const logPath = join(installed.base, `agent-log-${runId}.ndjson`);
  await writeFile(
    logPath,
    `${[
      { t: "2026-11-23T10:00:00Z", kind: "user", text: "Fix the typo." },
      {
        t: "2026-11-23T10:00:01Z",
        kind: "tool_call",
        tool: "Bash",
        args: { command: `echo ${secret}` },
      },
      {
        t: "2026-11-23T10:00:02Z",
        kind: "assistant",
        text: `The token ${secret} was printed.`,
      },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n")}\n`,
  );
  const slop = await sessionServer();
  try {
    await capture(() =>
      installed.receipt.main(
        sessionArgs(runId, ["--log", logPath]),
        sessionDeps(slop.fetchImpl, [], {
          env: { USER: "tester", SLOP_TEST_SECRET: secret },
        }),
      ),
    );
    const uploaded = slop.log.find((row) => row.path === "/trace-upload-s");
    assert.ok(uploaded, slop.log.map((row) => row.path).join(" "));
    assert.ok(uploaded.body.includes("[REDACTED:CREDENTIAL]"));
    assert.ok(!uploaded.body.includes(secret));
    const header = JSON.parse(uploaded.body.split("\n")[0]);
    assert.equal(header.source, "agent-written");
    assert.equal(header.format, "slop-session-v1");
  } finally {
    await slop.close();
  }
});

test("opened still records on its own pull request run", async () => {
  const slop = await sessionServer();
  try {
    const result = await installed.receipt.recordPullRequestOpened(
      {
        pullRequest: "https://github.com/test/repo/pull/7",
        pullRequestNodeId: "PR_kwDOtest0000007",
        provider: "anthropic",
        model: "claude-opus-5-5",
        client: "claude-code",
        clientVersion: "1.0.0",
      },
      {
        fetchImpl: slop.fetchImpl,
        assertionProvider: async () => assertion,
        provenance: { revision: REVISION },
      },
    );
    assert.equal(result.eventId, "event_1");
    const created = slop.log.find((row) => row.path === "/api/v1/runs");
    assert.equal(
      JSON.parse(created.body).clientRunId,
      "pr_opened_PR_kwDOtest0000007",
    );
    assert.ok(!slop.log.some((row) => row.path.endsWith("/finalize")));
  } finally {
    await slop.close();
  }
});

// The rerun must not re-export: the session file grows between attempts, so a
// fresh export would differ from the object the server already holds.
async function growSession(runId, startOutput) {
  const path = await writeClaudeSession(runId, startOutput);
  const rows = readFileSync(path, "utf8").trim().split("\n");
  const extra = JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-23T10:00:05Z",
    cwd: installed.repo,
    sessionId: "test-session",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "A later note that changes the export." },
      ],
    },
  });
  rows.splice(rows.length - 1, 0, extra);
  await writeFile(path, `${rows.join("\n")}\n`);
}

const attachedRecord = (runId) =>
  join(
    process.env.XDG_CONFIG_HOME,
    "slop",
    "sessions",
    `${runId}.attached.json`,
  );

test("a rerun after the event failed finalizes the bytes it first showed", async () => {
  await freshConfig();
  const { runId, stdout: startOutput } = await startRun();
  await writeClaudeSession(runId, startOutput);
  const slop = await sessionServer({ failEvents: 1 });
  try {
    const first = [];
    const failed = await capture(() =>
      installed.receipt.main(
        sessionArgs(runId),
        sessionDeps(slop.fetchImpl, first),
      ),
    );
    assert.match(failed.stdout, /the pull request stands/);
    assert.ok(!slop.log.some((row) => row.path.endsWith("/finalize")));
    const firstSha = first.disclosed.sha256;
    await growSession(runId, startOutput);
    const second = [];
    const rerun = await capture(() =>
      installed.receipt.main(
        sessionArgs(runId),
        sessionDeps(slop.fetchImpl, second),
      ),
    );
    assert.deepEqual(second.slice(0, 2), ["disclosure", "assertion"]);
    assert.equal(second.disclosed.sha256, firstSha);
    assert.equal(second.disclosed.absolutePath, first.disclosed.absolutePath);
    assert.equal(second.disclosed.alreadyUploaded, true);
    assert.equal(
      slop.log.filter((row) => row.path === "/trace-upload-s").length,
      1,
      "object not re-sent",
    );
    assert.equal(
      slop.log.filter((row) => row.path.endsWith("/finalize")).length,
      1,
    );
    assert.match(rerun.stdout, /Session uploaded under private-trace-v3/);
    assert.ok(rerun.stdout.includes(`sha256:${firstSha}`), rerun.stdout);
    assert.ok(rerun.stdout.includes(first.disclosed.absolutePath));
  } finally {
    await slop.close();
  }
});

test("a rerun with the uploaded file gone finalizes only the recorded digest", async () => {
  await freshConfig();
  const { runId, stdout: startOutput } = await startRun();
  await writeClaudeSession(runId, startOutput);
  const slop = await sessionServer({ failEvents: 1 });
  try {
    const first = [];
    await capture(() =>
      installed.receipt.main(
        sessionArgs(runId),
        sessionDeps(slop.fetchImpl, first),
      ),
    );
    await rm(first.disclosed.absolutePath);
    const rerun = await capture(() =>
      installed.receipt.main(sessionArgs(runId), sessionDeps(slop.fetchImpl)),
    );
    assert.equal(
      rerun.stderr.split("\n").filter((l) => /missing on this machine/.test(l))
        .length,
      1,
      rerun.stderr,
    );
    assert.ok(rerun.stdout.includes(`sha256:${first.disclosed.sha256}`));
    assert.equal(
      slop.log.filter((row) => row.path === "/trace-upload-s").length,
      1,
    );
  } finally {
    await slop.close();
  }
});

test("a recorded digest the server does not hold stops before finalize", async () => {
  await freshConfig();
  const { runId, stdout: startOutput } = await startRun();
  await writeClaudeSession(runId, startOutput);
  const slop = await sessionServer({ failEvents: 1 });
  try {
    const first = [];
    await capture(() =>
      installed.receipt.main(
        sessionArgs(runId),
        sessionDeps(slop.fetchImpl, first),
      ),
    );
    await rm(first.disclosed.absolutePath);
    const record = JSON.parse(readFileSync(attachedRecord(runId), "utf8"));
    await writeFile(
      attachedRecord(runId),
      JSON.stringify({ ...record, sha256: "c".repeat(64) }),
    );
    const rerun = await capture(() =>
      installed.receipt.main(sessionArgs(runId), sessionDeps(slop.fetchImpl)),
    );
    const lines = rerun.stdout.trim().split("\n");
    assert.equal(lines.length, 1, rerun.stdout);
    assert.match(lines[0], /the pull request stands/);
    assert.ok(!slop.log.some((row) => row.path.endsWith("/finalize")));
  } finally {
    await slop.close();
  }
});
