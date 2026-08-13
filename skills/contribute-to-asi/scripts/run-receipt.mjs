#!/usr/bin/env node
/**
 * Captures a bounded ccusage session delta and emits a device-signed project
 * receipt for a GitHub contribution footer. Raw sessions, paths, prompts, and
 * responses stay local; only totals, hashes, provenance, and the public key
 * appear in the receipt.
 */

import { spawnSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = resolve(scriptDirectory, "..");
const PROJECT = JSON.parse(
  readFileSync(join(skillDirectory, "project.json"), "utf8"),
);
const CCUSAGE_VERSION = "20.0.19";
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_TRAJECTORY_BYTES = 100 * 1024 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/u;
const SHA_PATTERN = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new TypeError(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalIso(value = new Date()) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) fail("timestamp is invalid");
  return new Date(time).toISOString();
}

function _safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function numericField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

function stringField(record, names) {
  for (const name of names) {
    if (typeof record[name] === "string" && record[name].length > 0) {
      return record[name];
    }
  }
  return null;
}

function normalizePath(value) {
  return resolve(value).replaceAll("\\", "/").replace(/\/$/u, "");
}

function claudeProjectDirectoryName(value) {
  return value.replaceAll(/[^A-Za-z0-9]/gu, "-");
}

/** Reduces ccusage's source-specific session dialects to non-sensitive totals. */
export function normalizeSessionReport(payload, repositoryRoot) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(payload.sessions)
  ) {
    fail("ccusage returned an invalid session report");
  }
  const expectedRoot = normalizePath(repositoryRoot);
  const expectedName = basename(expectedRoot).toLowerCase();
  const expectedDirectoryName = claudeProjectDirectoryName(expectedRoot);
  const sessions = {};
  for (const value of payload.sessions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const id = stringField(value, ["sessionId", "session_id", "id"]);
    if (!id) continue;
    const projectPath = stringField(value, [
      "projectPath",
      "project_path",
      "cwd",
      "workingDirectory",
      "path",
    ]);
    const normalizedProject = projectPath ? normalizePath(projectPath) : null;
    const pathMatched =
      normalizedProject === expectedRoot ||
      projectPath === expectedDirectoryName;
    const nameMatched =
      normalizedProject !== null &&
      basename(normalizedProject).toLowerCase() === expectedName;
    if (normalizedProject !== null && !pathMatched && !nameMatched) continue;

    const inputTokens = Math.floor(
      numericField(value, ["inputTokens", "input_tokens"]),
    );
    const outputTokens = Math.floor(
      numericField(value, ["outputTokens", "output_tokens"]),
    );
    const cacheCreationTokens = Math.floor(
      numericField(value, [
        "cacheCreationTokens",
        "cache_creation_tokens",
        "cacheWriteTokens",
      ]),
    );
    const cacheReadTokens = Math.floor(
      numericField(value, ["cacheReadTokens", "cache_read_tokens"]),
    );
    const visibleTotal =
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
    const totalTokens = Math.floor(
      Math.max(
        visibleTotal,
        numericField(value, ["totalTokens", "total_tokens"]),
      ),
    );
    const costUsd = numericField(value, [
      "totalCost",
      "costUSD",
      "costUsd",
      "cost",
    ]);
    const idHash = sha256(id);
    sessions[idHash] = {
      cacheCreationTokens,
      cacheReadTokens,
      costMicroUsd: Math.max(0, Math.round(costUsd * 1_000_000)),
      inputTokens,
      outputTokens,
      pathMatched,
      totalTokens,
    };
  }
  return { sessions };
}

/** Calculates only monotonic session deltas; counter regressions fail closed. */
export function usageDelta(before, after, client) {
  if (before === null || after === null) return unavailableUsage();
  const totals = {
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let sessionCount = 0;
  let everyChangedSessionMatched = true;
  for (const [idHash, current] of Object.entries(after.sessions)) {
    const prior = before.sessions[idHash] ?? {
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      pathMatched: current.pathMatched,
      totalTokens: 0,
    };
    const fields = Object.keys(totals);
    if (fields.some((field) => current[field] < prior[field])) {
      return unavailableUsage();
    }
    const delta = Object.fromEntries(
      fields.map((field) => [field, current[field] - prior[field]]),
    );
    if (delta.totalTokens <= 0) continue;
    sessionCount += 1;
    everyChangedSessionMatched &&= current.pathMatched;
    for (const field of fields) totals[field] += delta[field];
  }
  if (totals.totalTokens <= 0 || sessionCount === 0) return unavailableUsage();
  if (Object.values(totals).some((value) => !Number.isSafeInteger(value))) {
    return unavailableUsage();
  }
  return {
    source: "ccusage-session-v20",
    confidence:
      client === "claude-code" && everyChangedSessionMatched
        ? "exact"
        : "bounded",
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    totalTokens: totals.totalTokens,
    costMicroUsd: String(totals.costMicroUsd),
    sessionCount,
  };
}

function unavailableUsage() {
  return {
    source: "ccusage-session-v20",
    confidence: "unavailable",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costMicroUsd: "0",
    sessionCount: 0,
  };
}

function commandExists(command) {
  return (
    spawnSync(command, ["--version"], {
      encoding: "utf8",
      stdio: "ignore",
      timeout: 5_000,
    }).status === 0
  );
}

function collectUsage(client, repositoryRoot) {
  const model = PROJECT.models[client];
  const runner = commandExists("bun")
    ? { command: "bun", prefix: ["x", `ccusage@${CCUSAGE_VERSION}`] }
    : commandExists("npx")
      ? { command: "npx", prefix: ["--yes", `ccusage@${CCUSAGE_VERSION}`] }
      : null;
  if (!runner) return null;
  const args = [
    ...runner.prefix,
    model.ccusageSource,
    "session",
    "--json",
    "--mode",
    "calculate",
  ];
  const result = spawnSync(runner.command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_REPORT_BYTES,
    timeout: 120_000,
  });
  if (result.status !== 0 || result.signal || result.error) return null;
  try {
    return normalizeSessionReport(JSON.parse(result.stdout), repositoryRoot);
  } catch {
    // error-policy:J3 malformed local tool output produces unavailable usage.
    return null;
  }
}

function configurationRoot() {
  const configured = process.env.XDG_CONFIG_HOME;
  return configured && resolve(configured) === configured
    ? join(configured, "gitarmy")
    : join(homedir(), ".config", "gitarmy");
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(`refusing non-directory or symlinked state path: ${path}`);
  }
  chmodSync(path, 0o700);
}

function deviceKey() {
  const root = configurationRoot();
  ensureDirectory(root);
  const keyPath = join(root, "device-ed25519.pem");
  let privateKey;
  if (existsSync(keyPath)) {
    const stats = lstatSync(keyPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail("refusing a non-regular or symlinked device key");
    }
    privateKey = createPrivateKey(readFileSync(keyPath));
  } else {
    const generated = generateKeyPairSync("ed25519");
    const pem = generated.privateKey.export({ format: "pem", type: "pkcs8" });
    try {
      writeFileSync(keyPath, pem, { flag: "wx", mode: 0o600 });
      privateKey = generated.privateKey;
    } catch (error) {
      if (!existsSync(keyPath)) throw error;
      const stats = lstatSync(keyPath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        fail("refusing a non-regular or symlinked device key");
      }
      privateKey = createPrivateKey(readFileSync(keyPath));
    }
  }
  chmodSync(keyPath, 0o600);
  const publicDer = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  return {
    privateKey,
    publicKey: Buffer.from(publicDer).toString("base64url"),
    keyId: sha256(publicDer),
  };
}

function createRunId(now = Date.now(), entropy = randomBytes(10)) {
  let value = (BigInt(now) << 80n) | BigInt(`0x${entropy.toString("hex")}`);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `run_${encoded}`;
}

function runDirectories() {
  const root = join(configurationRoot(), "runs");
  const active = join(root, "active");
  const completed = join(root, "completed");
  ensureDirectory(active);
  ensureDirectory(completed);
  return { active, completed };
}

function writeJsonExclusive(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function git(repositoryRoot, args) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0 || result.signal || result.error) {
    fail(`git ${args[0]} failed for the contribution repository`);
  }
  return result.stdout.trim();
}

function requireRepository(repositoryRoot) {
  const root = resolve(repositoryRoot);
  if (git(root, ["rev-parse", "--show-toplevel"]) !== root) {
    fail("--repo-root must be the Git repository root");
  }
  const remote = git(root, ["remote", "get-url", "origin"])
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/\.git$/u, "")
    .toLowerCase();
  if (remote !== `https://github.com/${PROJECT.repositoryId}`.toLowerCase()) {
    fail(`origin must be ${PROJECT.repositoryId}`);
  }
  return root;
}

function resolveSkillProvenance() {
  const skillBytes = readFileSync(join(skillDirectory, "SKILL.md"));
  const digest = sha256(skillBytes);
  const provenancePath = join(skillDirectory, "PROVENANCE.json");
  if (existsSync(provenancePath)) {
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    if (
      provenance?.schemaVersion !== "1" ||
      provenance?.name !== PROJECT.skillName ||
      provenance?.repository !== "elizaOS/army" ||
      provenance?.revisionStatus !== "committed" ||
      !/^[0-9a-f]{40}$/u.test(provenance?.revision) ||
      provenance?.source?.path !== `${PROJECT.skillSourcePath}/SKILL.md` ||
      provenance?.source?.sha256 !== digest
    ) {
      fail("installed skill provenance is missing, dirty, or mismatched");
    }
    return {
      revision: provenance.revision,
      skillRevision: `elizaOS/army@${provenance.revision}:${PROJECT.skillSourcePath}`,
      skillSha256: digest,
    };
  }
  const repositoryRoot = git(skillDirectory, ["rev-parse", "--show-toplevel"]);
  const relativeSkill = PROJECT.skillSourcePath;
  if (git(repositoryRoot, ["status", "--porcelain", "--", relativeSkill])) {
    fail("bundled skill source is dirty; install a committed skill revision");
  }
  const revision = git(repositoryRoot, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(revision))
    fail("skill revision is not a full SHA");
  git(repositoryRoot, [
    "cat-file",
    "-e",
    `${revision}:${relativeSkill}/SKILL.md`,
  ]);
  return {
    revision,
    skillRevision: `elizaOS/army@${revision}:${relativeSkill}`,
    skillSha256: digest,
  };
}

function trajectoryDigest(path) {
  if (path === null) return null;
  const absolute = resolve(path);
  const metadata = statSync(absolute);
  if (!metadata.isFile() || metadata.size > MAX_TRAJECTORY_BYTES) {
    fail("trajectory must be a regular file no larger than 100 MiB");
  }
  return sha256(readFileSync(absolute));
}

export function marker(receipt) {
  return {
    provider: receipt.provider,
    model: receipt.model,
    client: receipt.client,
    skill_revision: receipt.skillRevision,
    run: {
      schema_version: "1",
      run_id: receipt.runId,
      project: receipt.projectId,
      repository: receipt.repositoryId,
      started_at: receipt.startedAt,
      completed_at: receipt.completedAt,
      skill_sha256: receipt.skillSha256,
      usage: {
        source: receipt.usage.source,
        confidence: receipt.usage.confidence,
        input_tokens: receipt.usage.inputTokens,
        output_tokens: receipt.usage.outputTokens,
        cache_creation_tokens: receipt.usage.cacheCreationTokens,
        cache_read_tokens: receipt.usage.cacheReadTokens,
        total_tokens: receipt.usage.totalTokens,
        cost_micro_usd: receipt.usage.costMicroUsd,
        session_count: receipt.usage.sessionCount,
      },
      trajectory_sha256: receipt.trajectorySha256,
      signature_algorithm: "ed25519",
      device_public_key: receipt.devicePublicKey,
      device_key_id: receipt.deviceKeyId,
      device_signature: receipt.deviceSignature,
    },
  };
}

export function signingPayload(receipt) {
  const value = marker(receipt);
  const { device_signature: _signature, ...unsignedRun } = value.run;
  return JSON.stringify({ ...value, run: unsignedRun });
}

export function footer(receipt, lane) {
  const value = marker(receipt);
  return [
    `AI provider/model: ${receipt.provider} / ${receipt.model}`,
    `Client / agent tooling: ${receipt.client}`,
    `Contribution skill revision: ${receipt.skillRevision}`,
    `Compute receipt: ${receipt.usage.totalTokens} project-attributed tokens (${receipt.usage.confidence}; device-signed, locally reported)`,
    "Attribution status: self-reported",
    `— [${lane}]`,
    `<!-- elizaos-contribution-attribution:v2 ${JSON.stringify(value)} -->`,
  ].join("\n");
}

function parseArguments(args) {
  const options = {
    action: args[0] ?? null,
    client: null,
    json: false,
    lane: null,
    model: null,
    repoRoot: process.cwd(),
    runId: null,
    trajectory: null,
  };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (
      [
        "--client",
        "--lane",
        "--model",
        "--repo-root",
        "--run",
        "--trajectory",
      ].includes(argument)
    ) {
      const value = args[index + 1];
      if (!value) fail(`${argument} requires a value`);
      index += 1;
      if (argument === "--client") options.client = value;
      if (argument === "--lane") options.lane = value;
      if (argument === "--model") options.model = value;
      if (argument === "--repo-root") options.repoRoot = value;
      if (argument === "--run") options.runId = value;
      if (argument === "--trajectory") options.trajectory = value;
    } else fail(`unknown argument: ${argument}`);
  }
  if (!["start", "finish"].includes(options.action))
    fail("action must be start or finish");
  if (!PROJECT.models[options.client])
    fail("--client must be codex or claude-code");
  const approved = PROJECT.models[options.client];
  if (options.model !== approved.model) {
    fail(`--model must be the approved frontier model ${approved.model}`);
  }
  if (
    !options.lane ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/u.test(options.lane)
  ) {
    fail("--lane must be a concrete public lane identifier");
  }
  if (
    options.action === "finish" &&
    !RUN_ID_PATTERN.test(options.runId ?? "")
  ) {
    fail("finish requires --run with the id returned by start");
  }
  return options;
}

function renderResult(result, json) {
  process.stdout.write(
    json ? `${JSON.stringify(result, null, 2)}\n` : `${result.message}\n`,
  );
}

function startRun(options) {
  const repositoryRoot = requireRepository(options.repoRoot);
  const provenance = resolveSkillProvenance();
  const model = PROJECT.models[options.client];
  const runId = createRunId();
  const state = {
    schemaVersion: "1",
    runId,
    projectId: PROJECT.projectId,
    repositoryId: PROJECT.repositoryId,
    repositoryRootHash: sha256(repositoryRoot),
    client: options.client,
    provider: model.provider,
    model: model.model,
    lane: options.lane,
    startedAt: canonicalIso(),
    baseline: collectUsage(options.client, repositoryRoot),
    ...provenance,
  };
  const directories = runDirectories();
  writeJsonExclusive(join(directories.active, `${runId}.json`), state);
  renderResult(
    {
      runId,
      message: `Project run started. Keep this id: ${runId}`,
      usageStatus: state.baseline === null ? "unavailable" : "capturing",
    },
    options.json,
  );
}

function finishRun(options) {
  const repositoryRoot = requireRepository(options.repoRoot);
  const directories = runDirectories();
  const activePath = join(directories.active, `${options.runId}.json`);
  const completedPath = join(directories.completed, `${options.runId}.json`);
  if (!existsSync(activePath) && existsSync(completedPath)) {
    const completed = JSON.parse(readFileSync(completedPath, "utf8"));
    renderResult(
      {
        receipt: completed.receipt,
        footer: completed.footer,
        message: completed.footer,
      },
      options.json,
    );
    return;
  }
  if (!existsSync(activePath)) fail("active run state was not found");
  const state = JSON.parse(readFileSync(activePath, "utf8"));
  if (
    state.runId !== options.runId ||
    state.projectId !== PROJECT.projectId ||
    state.repositoryId !== PROJECT.repositoryId ||
    state.client !== options.client ||
    state.model !== options.model ||
    state.lane !== options.lane ||
    state.repositoryRootHash !== sha256(repositoryRoot) ||
    !SHA_PATTERN.test(state.skillSha256)
  ) {
    fail("run state does not match this project, repository, model, or lane");
  }
  const completedAt = canonicalIso();
  if (Date.parse(completedAt) + CLOCK_SKEW_MS < Date.parse(state.startedAt)) {
    fail("system clock moved backward during the run");
  }
  const usage = usageDelta(
    state.baseline,
    collectUsage(options.client, repositoryRoot),
    options.client,
  );
  const key = deviceKey();
  const receipt = {
    schemaVersion: "1",
    runId: state.runId,
    projectId: state.projectId,
    repositoryId: state.repositoryId,
    startedAt: state.startedAt,
    completedAt,
    provider: state.provider,
    model: state.model,
    client: state.client,
    skillRevision: state.skillRevision,
    skillSha256: state.skillSha256,
    usage,
    trajectorySha256: trajectoryDigest(options.trajectory),
    signatureAlgorithm: "ed25519",
    devicePublicKey: key.publicKey,
    deviceKeyId: key.keyId,
    deviceSignature: "pending",
  };
  receipt.deviceSignature = sign(
    null,
    Buffer.from(signingPayload(receipt), "utf8"),
    key.privateKey,
  ).toString("base64url");
  const renderedFooter = footer(receipt, options.lane);
  atomicJson(completedPath, { receipt, footer: renderedFooter });
  rmSync(activePath);
  renderResult(
    { receipt, footer: renderedFooter, message: renderedFooter },
    options.json,
  );
}

export function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.action === "start") startRun(options);
  else finishRun(options);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) ===
    realpathSync(process.argv[1]);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    // error-policy:J1 The CLI boundary returns a non-zero result without a fake receipt.
    process.stderr.write(
      `project run receipt failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
