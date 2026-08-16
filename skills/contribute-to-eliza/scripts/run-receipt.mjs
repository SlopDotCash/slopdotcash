#!/usr/bin/env node
/**
 * Captures a bounded ccusage session delta, permanently uploads a bounded raw
 * trace to private Slop storage, and emits a device-signed GitHub footer. Only
 * totals, hashes, provenance, and immutable upload evidence are public.
 */

import { spawnSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = resolve(scriptDirectory, "..");
const PROJECT = JSON.parse(
  readFileSync(join(skillDirectory, "project.json"), "utf8"),
);
const CCUSAGE_VERSION = "20.0.20";
const CCUSAGE_VERSION_OUTPUT = `ccusage ${CCUSAGE_VERSION}`;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_TRAJECTORY_BYTES = 8 * 1024 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/u;
const SHA_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN =
  /^[@~]?[A-Za-z0-9](?:[A-Za-z0-9._:@/+~-]{0,126}[A-Za-z0-9])?$/u;
const COMMON_PLACEHOLDERS = new Set([
  "na",
  "none",
  "null",
  "other",
  "placeholder",
  "tbd",
  "todo",
  "unknown",
  "unspecified",
]);
const FIELD_PLACEHOLDERS = {
  client: new Set(["agent", "app", "cli", "client"]),
  model: new Set([
    "ai",
    "claude",
    "gemini",
    "gpt",
    "grok",
    "llama",
    "llm",
    "model",
  ]),
  provider: new Set(["ai", "model", "provider"]),
  version: new Set(["current", "latest", "version"]),
};
const MAX_STATE_BYTES = MAX_REPORT_BYTES + 1024 * 1024;
const AUTHORIZATION_RECEIPT = ".slop-authorization.json";
const TRACE_AUTHORITY = "https://api.slop.cash";
const IDENTITY_AUTHORITY = "https://identity.slop.cash";
const TRACE_PRIVACY_CONTRACT = "https://slop.cash/protocol/private-trace-v1.md";
const PRIVATE_REQUEST_INTAKE_STATUS =
  "https://api.github.com/repos/elizaOS/slopdotcash/private-vulnerability-reporting";

const HELP = `Usage: node scripts/run-receipt.mjs <command> [options]

Commands:
  preview  Show local reads, writes, network access, and public receipt fields
  doctor   Verify repository, skill provenance, declarations, and local runners
  status   List this project's local active and completed measured runs
  start    Capture a local ccusage baseline after explicit usage consent
  trace    Permanently upload this run's private trace and finalize it
  finish   Close a measured run and print its device-signed GitHub footer

Common options:
  --repo-root <path>  Target Git repository root (default: current directory)
  --client <name>     Declared agent/client identifier
  --provider <name>   Declared model provider identifier
  --model <id>        Declared exact model identifier
  --client-version <version>  Exact declared agent/client version
  --json              Emit machine-readable JSON

Start and finish also require --lane <public-lane>. Start requires
--allow-local-usage after preview. Finish requires --run <run-id> and accepts
a required --trajectory <path>, --trace-server-run <id>, and
--trace-object-id sha256:<digest> returned by the finalized private Slop trace
upload. Publish only this upload evidence and digest. Supported usage adapters
also require --allow-package-execution after preview because package-manager
resolution may fetch code and write caches.
`;

function fail(message) {
  throw new TypeError(message);
}

function hasExactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validatePolicyAcknowledgement(value) {
  if (
    !hasExactKeys(value, [
      "acknowledgedAt",
      "inboundTermsSha256",
      "licenseSha256",
      "policyRevision",
      "prizeRulesSha256",
    ]) ||
    typeof value.policyRevision !== "string" ||
    value.policyRevision.length === 0 ||
    !SHA_PATTERN.test(value.licenseSha256 ?? "") ||
    (value.inboundTermsSha256 !== null &&
      !SHA_PATTERN.test(value.inboundTermsSha256 ?? "")) ||
    (value.prizeRulesSha256 !== null &&
      !SHA_PATTERN.test(value.prizeRulesSha256 ?? "")) ||
    canonicalIso(value.acknowledgedAt) !== value.acknowledgedAt
  ) {
    fail("project policy acknowledgement is invalid");
  }
  return value;
}

function projectPolicyPreflight(testOptions) {
  const testAuthority = testOptions?.testPolicyAuthority;
  if (
    testOptions !== undefined &&
    (!hasExactKeys(testOptions, ["testPolicyAuthority"]) ||
      typeof testAuthority !== "string" ||
      new URL(testAuthority).protocol !== "file:")
  ) {
    fail("test policy authority option is invalid");
  }
  const preflightScript = join(scriptDirectory, "terms-preflight.mjs");
  const command = testAuthority
    ? [
        "--input-type=module",
        "--eval",
        `import { preflight } from ${JSON.stringify(pathToFileURL(preflightScript).href)}; const value = await preflight(${JSON.stringify(PROJECT.projectId)}, { testAuthority: ${JSON.stringify(testAuthority)} }); process.stdout.write(JSON.stringify(value));`,
      ]
    : [preflightScript, "--project", PROJECT.projectId, "--json"];
  const result = spawnSync(process.execPath, command, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0 || result.signal || result.error) {
    fail(
      result.stderr.trim() ||
        "project terms preflight failed without a diagnostic",
    );
  }
  try {
    return validatePolicyAcknowledgement(JSON.parse(result.stdout));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail("project terms preflight returned invalid JSON");
    }
    throw error;
  }
}

function policyBinding(value) {
  const { acknowledgedAt: _acknowledgedAt, ...binding } =
    validatePolicyAcknowledgement(value);
  return JSON.stringify(binding);
}

function canonicalIso(value = new Date()) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) fail("timestamp is invalid");
  return new Date(time).toISOString();
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`ccusage returned an unsafe ${field}`);
  }
  return value;
}

function numericField(record, names, field, requireInteger = false) {
  for (const name of names) {
    if (!Object.hasOwn(record, name)) continue;
    const value = record[name];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      (requireInteger && !Number.isSafeInteger(value))
    ) {
      fail(`ccusage returned an invalid ${field}`);
    }
    return value;
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

function declaredIdentifier(value, field, maxLength = 128) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    /^n\/a$/iu.test(value) ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    fail(`${field} must be a concrete identifier`);
  }
  return value;
}

export function declaredIdentity(value, field, kind, maxLength = 128) {
  declaredIdentifier(value, field, maxLength);
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  if (
    COMMON_PLACEHOLDERS.has(normalized) ||
    FIELD_PLACEHOLDERS[kind].has(normalized)
  ) {
    fail(`${field} must be an exact non-placeholder identifier`);
  }
  return value;
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
      "directory",
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

    const inputTokens = numericField(
      value,
      ["inputTokens", "input_tokens"],
      "input token count",
      true,
    );
    const outputTokens = numericField(
      value,
      ["outputTokens", "output_tokens"],
      "output token count",
      true,
    );
    const cacheCreationTokens = numericField(
      value,
      ["cacheCreationTokens", "cache_creation_tokens", "cacheWriteTokens"],
      "cache creation token count",
      true,
    );
    const cacheReadTokens = numericField(
      value,
      ["cacheReadTokens", "cache_read_tokens"],
      "cache read token count",
      true,
    );
    const visibleTotal = safeInteger(
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
      "visible token total",
    );
    const totalTokens = safeInteger(
      Math.max(
        visibleTotal,
        numericField(
          value,
          ["totalTokens", "total_tokens"],
          "total token count",
          true,
        ),
      ),
      "total token count",
    );
    const costUsd = numericField(
      value,
      ["totalCost", "costUSD", "costUsd", "cost"],
      "USD cost",
    );
    const idHash = sha256(id);
    sessions[idHash] = {
      cacheCreationTokens,
      cacheReadTokens,
      costMicroUsd: safeInteger(
        Math.round(costUsd * 1_000_000),
        "micro-USD cost",
      ),
      inputTokens,
      outputTokens,
      pathMatched,
      totalTokens,
    };
  }
  return { sessions };
}

/** Calculates only monotonic session deltas; counter regressions fail closed. */
export function usageDelta(before, after, _client) {
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
    confidence: everyChangedSessionMatched ? "exact" : "bounded",
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    totalTokens: totals.totalTokens,
    costMicroUsd: String(totals.costMicroUsd),
    sessionCount,
  };
}

function unavailableUsage(source = "ccusage-session-v20") {
  return {
    source,
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

function commandExists(command, executionRoot) {
  return (
    spawnSync(command, ["--version"], {
      cwd: executionRoot,
      encoding: "utf8",
      env: executionEnvironment(),
      stdio: "ignore",
      timeout: 5_000,
    }).status === 0
  );
}

function ccusageRunners(executionRoot) {
  return [
    commandExists("bun", executionRoot)
      ? { command: "bun", prefix: ["x", `ccusage@${CCUSAGE_VERSION}`] }
      : null,
    commandExists("npx", executionRoot)
      ? { command: "npx", prefix: ["--yes", `ccusage@${CCUSAGE_VERSION}`] }
      : null,
  ].filter(Boolean);
}

function executionEnvironment() {
  const allowed = [
    "PATH",
    "HOME",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "GROK_HOME",
    "XDG_CONFIG_HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
  ];
  return {
    ...Object.fromEntries(
      allowed.flatMap((name) =>
        typeof process.env[name] === "string"
          ? [[name, process.env[name]]]
          : [],
      ),
    ),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NO_UPDATE_NOTIFIER: "1",
  };
}

function ccusageEnvironment(executionRoot) {
  return {
    ...executionEnvironment(),
    BUN_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_USERCONFIG: join(executionRoot, ".npmrc"),
  };
}

function withPackageExecution(callback) {
  const executionRoot = mkdtempSync(join(tmpdir(), "slop-ccusage-"));
  writeFileSync(join(executionRoot, ".npmrc"), "", {
    flag: "wx",
    mode: 0o600,
  });
  try {
    return callback(executionRoot);
  } finally {
    rmSync(executionRoot, { force: true, recursive: true });
  }
}

function inspectCcusageRunner() {
  return withPackageExecution((executionRoot) => {
    const runners = ccusageRunners(executionRoot);
    if (runners.length === 0) {
      return { runner: null, status: "unavailable", version: null };
    }
    for (const runner of runners) {
      const result = spawnSync(
        runner.command,
        [...runner.prefix, "--version"],
        {
          cwd: executionRoot,
          encoding: "utf8",
          env: ccusageEnvironment(executionRoot),
          maxBuffer: 1024 * 1024,
          timeout: 120_000,
        },
      );
      if (
        result.status === 0 &&
        !result.signal &&
        !result.error &&
        result.stdout.trim() === CCUSAGE_VERSION_OUTPUT
      ) {
        return {
          runner: runner.command,
          status: "available",
          version: CCUSAGE_VERSION,
        };
      }
    }
    return {
      runner: runners.map(({ command }) => command).join(","),
      status: "unavailable",
      version: null,
    };
  });
}

function collectUsage(client, repositoryRoot) {
  const ccusageSource = PROJECT.usageAdapters[client];
  if (!ccusageSource) return null;
  return withPackageExecution((executionRoot) => {
    for (const runner of ccusageRunners(executionRoot)) {
      const args = [
        ...runner.prefix,
        ccusageSource,
        "session",
        "--json",
        "--mode",
        "calculate",
      ];
      const result = spawnSync(runner.command, args, {
        cwd: executionRoot,
        encoding: "utf8",
        env: ccusageEnvironment(executionRoot),
        maxBuffer: MAX_REPORT_BYTES,
        timeout: 120_000,
      });
      if (result.status !== 0 || result.signal || result.error) continue;
      try {
        return normalizeSessionReport(
          JSON.parse(result.stdout),
          repositoryRoot,
        );
      } catch {
        // error-policy:J3 malformed local tool output tries the next exact runner.
      }
    }
    return null;
  });
}

function configurationRoot(namespace = "slop") {
  const configured = process.env.XDG_CONFIG_HOME;
  return configured && resolve(configured) === configured
    ? join(configured, namespace)
    : join(homedir(), ".config", namespace);
}

function usageInputPaths(client) {
  const home = homedir();
  if (client === "codex") {
    const root = process.env.CODEX_HOME
      ? resolve(process.env.CODEX_HOME)
      : join(home, ".codex");
    return [join(root, "sessions"), join(root, "archived_sessions")];
  }
  if (client === "grok-build") {
    const root = process.env.GROK_HOME
      ? resolve(process.env.GROK_HOME)
      : join(home, ".grok");
    return [join(root, "sessions")];
  }
  if (client !== "claude-code") return [];
  const roots = new Set([
    join(home, ".config", "claude", "projects"),
    join(home, ".claude", "projects"),
  ]);
  if (process.env.CLAUDE_CONFIG_DIR) {
    roots.add(join(resolve(process.env.CLAUDE_CONFIG_DIR), "projects"));
  }
  return [...roots];
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
  const pending = join(root, "pending");
  ensureDirectory(active);
  ensureDirectory(completed);
  ensureDirectory(pending);
  return { active, completed, pending };
}

function readStateRecords(directory, kind) {
  if (!existsSync(directory)) return [];
  const directoryStats = lstatSync(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    fail(`refusing non-directory or symlinked state path: ${directory}`);
  }
  const records = [];
  for (const name of readdirSync(directory).sort()) {
    if (!/^run_[0-9A-HJKMNP-TV-Z]{26}\.json$/u.test(name)) {
      fail(`run state contains an unexpected entry: ${name}`);
    }
    const path = join(directory, name);
    const value = readStateFile(path, name);
    const record = kind === "active" ? value : value?.receipt;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail(`run state has an invalid ${kind} schema: ${name}`);
    }
    if (record.projectId !== PROJECT.projectId) continue;
    if (!RUN_ID_PATTERN.test(record.runId ?? "")) {
      fail(`run state has an invalid run id: ${name}`);
    }
    if (name !== `${record.runId}.json`) {
      fail(`run state filename does not match its run id: ${name}`);
    }
    const completed = kind === "active" ? null : validateCompletedRecord(value);
    if (kind === "active") validateActiveRecord(value);
    records.push({
      runId: record.runId,
      state: kind,
      client: record.client,
      model: record.model,
      lane: kind === "active" ? record.lane : completed.lane,
      startedAt: record.startedAt,
      completedAt: kind === "completed" ? record.completedAt : null,
    });
  }
  return records;
}

function validateSessionBaseline(value) {
  if (value === null) return;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== "sessions" ||
    !value.sessions ||
    typeof value.sessions !== "object" ||
    Array.isArray(value.sessions)
  ) {
    fail("active run state has an invalid usage baseline");
  }
  const numericFields = [
    "cacheCreationTokens",
    "cacheReadTokens",
    "costMicroUsd",
    "inputTokens",
    "outputTokens",
    "totalTokens",
  ];
  const expectedFields = [...numericFields, "pathMatched"].sort().join("\0");
  for (const [idHash, session] of Object.entries(value.sessions)) {
    if (
      !SHA_PATTERN.test(idHash) ||
      !session ||
      typeof session !== "object" ||
      Array.isArray(session) ||
      Object.keys(session).sort().join("\0") !== expectedFields ||
      (session.pathMatched !== true && session.pathMatched !== false) ||
      numericFields.some(
        (field) => !Number.isSafeInteger(session[field]) || session[field] < 0,
      )
    ) {
      fail("active run state has an invalid usage baseline");
    }
  }
}

function validateActiveRecord(value) {
  const hasPolicyAcknowledgement = Object.hasOwn(
    value ?? {},
    "policyAcknowledgement",
  );
  const expectedKeys = [
    "baseline",
    "client",
    "lane",
    "model",
    ...(hasPolicyAcknowledgement ? ["policyAcknowledgement"] : []),
    "projectId",
    "provider",
    "repositoryId",
    "repositoryRootHash",
    "revision",
    "runId",
    "schemaVersion",
    "skillRevision",
    "skillSha256",
    "startedAt",
  ]
    .sort()
    .join("\0");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== expectedKeys ||
    !["1", "2"].includes(value.schemaVersion) ||
    (value.schemaVersion === "2") !== hasPolicyAcknowledgement ||
    value.projectId !== PROJECT.projectId ||
    value.repositoryId !== PROJECT.repositoryId ||
    !RUN_ID_PATTERN.test(value.runId ?? "") ||
    !SHA_PATTERN.test(value.repositoryRootHash ?? "") ||
    (() => {
      try {
        declaredIdentity(value.client, "client", "client", 64);
        declaredIdentity(value.provider, "provider", "provider", 64);
        declaredIdentity(value.model, "model", "model");
        return false;
      } catch {
        return true;
      }
    })() ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{1,48}$/u.test(value.lane ?? "") ||
    canonicalIso(value.startedAt) !== value.startedAt ||
    !/^[0-9a-f]{40}$/u.test(value.revision ?? "") ||
    value.skillRevision !==
      `elizaOS/slopdotcash@${value.revision}:${PROJECT.skillSourcePath}` ||
    !SHA_PATTERN.test(value.skillSha256 ?? "")
  ) {
    fail("active run state has an invalid identity");
  }
  if (hasPolicyAcknowledgement) {
    validatePolicyAcknowledgement(value.policyAcknowledgement);
  }
  validateSessionBaseline(value.baseline);
  return value;
}

function readStateFile(path, name = basename(path)) {
  const stats = lstatSync(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size > MAX_STATE_BYTES
  ) {
    fail(`run state is not a bounded regular file: ${name}`);
  }
  const contents = readFileSync(path, "utf8");
  try {
    return JSON.parse(contents);
  } catch {
    // error-policy:J3 malformed local state is an explicit invalid result.
    fail(`run state is not valid JSON: ${name}`);
  }
}

function writeJsonExclusive(path, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_STATE_BYTES) {
    fail("run state exceeds the bounded local report size");
  }
  writeFileSync(path, contents, {
    flag: "wx",
    mode: 0o600,
  });
}

function atomicJson(path, value, pendingDirectory) {
  const temporary = join(
    pendingDirectory,
    `${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_STATE_BYTES) {
    fail("run state exceeds the bounded local report size");
  }
  writeFileSync(temporary, contents, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
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
  const root = realpathSync(resolve(repositoryRoot));
  if (git(root, ["rev-parse", "--show-toplevel"]) !== root) {
    fail("--repo-root must be the Git repository root");
  }
  const remote = git(root, ["remote", "get-url", "origin"]);
  const normalizedRemote = remote
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//u, "https://github.com/")
    .replace(/\.git$/u, "")
    .toLowerCase();
  if (
    normalizedRemote !==
    `https://github.com/${PROJECT.repositoryId}`.toLowerCase()
  ) {
    fail(`origin must be ${PROJECT.repositoryId}`);
  }
  return root;
}

function resolveSkillProvenance() {
  const skillBytes = readFileSync(join(skillDirectory, "SKILL.md"));
  const digest = sha256(skillBytes);
  const provenancePath = join(skillDirectory, "PROVENANCE.json");
  if (existsSync(provenancePath)) {
    let provenance;
    try {
      provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    } catch {
      // error-policy:J3 malformed installed provenance is explicitly invalid.
      fail("installed skill provenance is not valid JSON");
    }
    if (
      provenance?.schemaVersion !== "1" ||
      provenance?.name !== PROJECT.skillName ||
      provenance?.repository !== "elizaOS/slopdotcash" ||
      provenance?.revisionStatus !== "committed" ||
      !/^[0-9a-f]{40}$/u.test(provenance?.revision) ||
      provenance?.source?.path !== `${PROJECT.skillSourcePath}/SKILL.md` ||
      provenance?.source?.sha256 !== digest
    ) {
      fail("installed skill provenance is missing, dirty, or mismatched");
    }
    validateAuthorizationReceipt(provenance.revision);
    if (
      !Array.isArray(provenance.files) ||
      provenance.files.length === 0 ||
      provenance.files.length > 32
    ) {
      fail("installed skill provenance has an invalid file manifest");
    }
    const expectedFiles = new Map();
    for (const file of provenance.files) {
      if (
        !file ||
        typeof file !== "object" ||
        typeof file.path !== "string" ||
        !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u.test(
          file.path,
        ) ||
        !SHA_PATTERN.test(file.sha256) ||
        expectedFiles.has(file.path) ||
        file.path === "PROVENANCE.json"
      ) {
        fail("installed skill provenance has an invalid file entry");
      }
      expectedFiles.set(file.path, file.sha256);
    }
    const actualFiles = listRegularFiles(skillDirectory)
      .filter(
        (path) => path !== "PROVENANCE.json" && path !== AUTHORIZATION_RECEIPT,
      )
      .sort();
    if (
      actualFiles.length !== expectedFiles.size ||
      actualFiles.some((path) => !expectedFiles.has(path))
    ) {
      fail("installed skill file tree does not match provenance");
    }
    for (const path of actualFiles) {
      if (
        sha256(readFileSync(join(skillDirectory, path))) !==
        expectedFiles.get(path)
      ) {
        fail(`installed skill file does not match provenance: ${path}`);
      }
    }
    return {
      revision: provenance.revision,
      skillRevision: `elizaOS/slopdotcash@${provenance.revision}:${PROJECT.skillSourcePath}`,
      skillSha256: digest,
    };
  }
  const repositoryRoot = git(skillDirectory, ["rev-parse", "--show-toplevel"]);
  const sourceRemote = git(repositoryRoot, ["remote", "get-url", "origin"])
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//u, "https://github.com/")
    .replace(/\.git$/u, "")
    .toLowerCase();
  if (
    ![
      "https://github.com/elizaos/army",
      "https://github.com/elizaos/slopdotcash",
    ].includes(sourceRemote)
  ) {
    fail("bundled skill source must come from the canonical Slop repository");
  }
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
    skillRevision: `elizaOS/slopdotcash@${revision}:${relativeSkill}`,
    skillSha256: digest,
  };
}

function validateAuthorizationReceipt(revision) {
  const path = join(skillDirectory, AUTHORIZATION_RECEIPT);
  const stats = lstatSync(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1 ||
    stats.size > 4096
  ) {
    fail("installed skill authorization receipt is not a bounded regular file");
  }
  let receipt;
  const contents = readFileSync(path, "utf8");
  try {
    receipt = JSON.parse(contents);
  } catch {
    // error-policy:J3 malformed authorization state is explicitly invalid.
    fail("installed skill authorization receipt is not valid JSON");
  }
  if (
    receipt?.schemaVersion !== "1" ||
    receipt?.repository !== "elizaOS/slopdotcash" ||
    receipt?.revision !== revision ||
    !receipt.authorization ||
    typeof receipt.authorization !== "object" ||
    Array.isArray(receipt.authorization) ||
    !/^[0-9a-f]{40}$/u.test(receipt.authorization.develop)
  ) {
    fail("installed skill authorization receipt has an invalid identity");
  }
  const authorization = receipt.authorization;
  const expectedAuthorization =
    authorization.kind === "develop" &&
    Object.keys(authorization).sort().join("\0") === "develop\0kind"
      ? { kind: "develop", develop: authorization.develop }
      : authorization.kind === "candidate" &&
          Object.keys(authorization).sort().join("\0") ===
            "develop\0kind\0pull" &&
          Number.isSafeInteger(authorization.pull) &&
          authorization.pull > 0
        ? {
            kind: "candidate",
            develop: authorization.develop,
            pull: authorization.pull,
          }
        : null;
  const expectedReceipt = expectedAuthorization
    ? {
        schemaVersion: "1",
        repository: "elizaOS/slopdotcash",
        revision,
        authorization: expectedAuthorization,
      }
    : null;
  if (
    expectedReceipt === null ||
    Object.keys(receipt).sort().join("\0") !==
      "authorization\0repository\0revision\0schemaVersion" ||
    contents !== `${JSON.stringify(expectedReceipt, null, 2)}\n`
  ) {
    fail("installed skill authorization receipt has an invalid schema");
  }
}

function listRegularFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name).replaceAll("\\", "/");
    const path = join(root, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      fail(`installed skill contains a symlink: ${relativePath}`);
    }
    if (stats.isDirectory())
      files.push(...listRegularFiles(path, relativePath));
    else if (stats.isFile() && stats.nlink === 1) files.push(relativePath);
    else fail(`installed skill contains a non-regular entry: ${relativePath}`);
  }
  return files;
}

function readTrajectoryFile(path) {
  const absolute = resolve(path);
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch {
    fail("trajectory must be an accessible non-symlinked regular file");
  }
  let contents;
  try {
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size === 0 ||
      metadata.size > MAX_TRAJECTORY_BYTES
    ) {
      fail("trajectory must be a non-empty regular file no larger than 8 MiB");
    }
    contents = readFileSync(descriptor);
    if (contents.length === 0 || contents.length > MAX_TRAJECTORY_BYTES) {
      fail("trajectory must be a non-empty regular file no larger than 8 MiB");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      fail("trajectory must contain valid UTF-8 text or NDJSON");
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    absolutePath: absolute,
    contents,
    sha256: sha256(contents),
  };
}

function trajectoryDigest(path) {
  if (path === null) return null;
  return readTrajectoryFile(path).sha256;
}

function traceUploadEvidence(serverRunId, objectId, trajectorySha256) {
  if (
    typeof serverRunId !== "string" ||
    serverRunId.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(serverRunId)
  ) {
    fail("--trace-server-run must be the finalized Slop server run id");
  }
  if (objectId !== `sha256:${trajectorySha256}`) {
    fail("--trace-object-id must match the uploaded trajectory SHA-256");
  }
  return {
    authority: TRACE_AUTHORITY,
    serverRunId,
    objectId,
    sha256: trajectorySha256,
  };
}

function exactObject(value, keys, field) {
  if (!hasExactKeys(value, keys)) fail(`${field} returned an invalid schema`);
  return value;
}

async function jsonRequest(fetchImpl, url, options, keys, field) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail(`${field} request failed`);
  }
  if (!response?.ok) fail(`${field} request returned HTTP ${response?.status}`);
  const source = await response.text();
  if (Buffer.byteLength(source) > 64 * 1024) {
    fail(`${field} response exceeded its bound`);
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail(`${field} response was not JSON`);
  }
  return exactObject(value, keys, field);
}

export async function slopIdentityAssertion(
  fetchImpl = globalThis.fetch,
  delayImpl = (milliseconds) =>
    new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
) {
  if (typeof fetchImpl !== "function")
    fail("Slop identity transport is unavailable");
  const started = await jsonRequest(
    fetchImpl,
    `${IDENTITY_AUTHORITY}/v1/oauth/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience: "private-trace-api" }),
    },
    [
      "authorizationUrl",
      "expiresAt",
      "flowId",
      "pollAfterSeconds",
      "pollCapability",
    ],
    "Slop identity start",
  );
  let authorizationUrl;
  try {
    authorizationUrl = new URL(started.authorizationUrl);
  } catch {
    fail("Slop identity start returned an invalid authorization URL");
  }
  if (
    authorizationUrl.origin !== IDENTITY_AUTHORITY ||
    authorizationUrl.pathname !== "/v1/oauth/authorize" ||
    authorizationUrl.username ||
    authorizationUrl.password ||
    authorizationUrl.hash ||
    typeof started.flowId !== "string" ||
    !/^flow_[A-Za-z0-9_-]{20,160}$/u.test(started.flowId) ||
    typeof started.pollCapability !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/u.test(started.pollCapability) ||
    !Number.isSafeInteger(started.pollAfterSeconds) ||
    started.pollAfterSeconds < 1 ||
    started.pollAfterSeconds > 10 ||
    canonicalIso(started.expiresAt) !== started.expiresAt
  ) {
    fail("Slop identity start returned invalid fields");
  }

  process.stderr.write(
    `Authorize this contribution with GitHub:\n${authorizationUrl.href}\n`,
  );
  const expiresAt = Date.parse(started.expiresAt);
  let retryAfterSeconds = started.pollAfterSeconds;
  while (Date.now() < expiresAt) {
    await delayImpl(retryAfterSeconds * 1000);
    let response;
    try {
      response = await fetchImpl(`${IDENTITY_AUTHORITY}/v1/oauth/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId: started.flowId,
          pollCapability: started.pollCapability,
          audience: "private-trace-api",
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail("Slop identity poll request failed");
    }
    if (!response.ok) {
      fail(`Slop identity poll returned HTTP ${response.status}`);
    }
    const source = await response.text();
    if (Buffer.byteLength(source) > 64 * 1024) {
      fail("Slop identity poll response exceeded its bound");
    }
    let result;
    try {
      result = JSON.parse(source);
    } catch {
      fail("Slop identity poll response was not JSON");
    }
    if (response.status === 202) {
      result = exactObject(
        result,
        ["retryAfterSeconds", "status"],
        "Slop identity pending response",
      );
      if (
        result.status !== "pending" ||
        !Number.isSafeInteger(result.retryAfterSeconds) ||
        result.retryAfterSeconds < started.pollAfterSeconds ||
        result.retryAfterSeconds > 10
      ) {
        fail("Slop identity pending response was invalid");
      }
      retryAfterSeconds = result.retryAfterSeconds;
      continue;
    }
    if (response.status !== 200) {
      fail("Slop identity poll returned an invalid success status");
    }
    result = exactObject(
      result,
      ["assertion", "assertionType", "expiresAt", "status"],
      "Slop identity completion response",
    );
    if (
      result.status !== "complete" ||
      result.assertionType !== "SlopIdentity" ||
      typeof result.assertion !== "string" ||
      !/^slop_assert_v1_[A-Za-z0-9_-]{20,512}$/u.test(result.assertion) ||
      canonicalIso(result.expiresAt) !== result.expiresAt ||
      Date.parse(result.expiresAt) <= Date.now()
    ) {
      fail("Slop identity completion response was invalid");
    }
    return result.assertion;
  }
  fail("Slop identity authorization expired");
}

function privateTraceFile(path) {
  const snapshot = readTrajectoryFile(path);
  return {
    ...snapshot,
    sizeBytes: snapshot.contents.length,
    contentType:
      extname(path).toLowerCase() === ".ndjson"
        ? "application/x-ndjson"
        : "text/plain",
  };
}

export function disclosePrivateTrace(trace) {
  process.stderr.write(
    `${[
      "Private trace pre-upload disclosure (authorization has not started):",
      `Privacy contract: ${TRACE_PRIVACY_CONTRACT}`,
      `Inspect exact final bytes: ${trace.absolutePath}`,
      `Size: ${trace.sizeBytes} bytes`,
      `Content-Type: ${trace.contentType}`,
      `SHA-256: ${trace.sha256}`,
      "Automatic redaction: none; the selected bytes are uploaded unchanged and retained permanently.",
      "Inspect before opening the authorization URL. To change any byte, cancel and rerun trace; this process retains the disclosed snapshot.",
      "Do not authorize unless you accept the disclosed bytes and permanent-retention contract.",
    ].join("\n")}\n`,
  );
}

export async function uploadPrivateTrace(
  state,
  trajectoryPath,
  clientVersion,
  {
    fetchImpl = globalThis.fetch,
    assertionProvider = slopIdentityAssertion,
    disclosure = disclosePrivateTrace,
  } = {},
) {
  declaredIdentifier(clientVersion, "--client-version", 128);
  if (typeof fetchImpl !== "function")
    fail("private trace transport is unavailable");
  const trace = privateTraceFile(trajectoryPath);
  if (typeof disclosure !== "function")
    fail("private trace disclosure is unavailable");
  disclosure({
    absolutePath: trace.absolutePath,
    sha256: trace.sha256,
    sizeBytes: trace.sizeBytes,
    contentType: trace.contentType,
    privacyContract: TRACE_PRIVACY_CONTRACT,
    automaticRedaction: "none",
    retention: "permanent",
  });
  const intake = await jsonRequest(
    fetchImpl,
    PRIVATE_REQUEST_INTAKE_STATUS,
    {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    },
    ["enabled"],
    "private request intake status",
  );
  if (intake.enabled !== true) {
    fail(
      "private request intake is unavailable; private trace upload is blocked",
    );
  }
  const identityAssertion = await assertionProvider(fetchImpl);
  if (
    typeof identityAssertion !== "string" ||
    identityAssertion.length < 20 ||
    identityAssertion.length > 4096 ||
    /\s/u.test(identityAssertion)
  ) {
    fail("Slop identity assertion is invalid");
  }
  const auth = await jsonRequest(
    fetchImpl,
    `${TRACE_AUTHORITY}/api/v1/auth/session`,
    {
      method: "POST",
      headers: { "X-Slop-Identity-Assertion": identityAssertion },
    },
    ["expiresAt", "token", "tokenType"],
    "trace authentication",
  );
  if (
    auth.tokenType !== "Bearer" ||
    typeof auth.token !== "string" ||
    auth.token.length < 20 ||
    auth.token.length > 4096 ||
    canonicalIso(auth.expiresAt) !== auth.expiresAt
  ) {
    fail("trace authentication returned invalid credentials");
  }
  const authorization = `Bearer ${auth.token}`;
  const jsonHeaders = {
    Authorization: authorization,
    "Content-Type": "application/json",
  };
  const createBody = {
    clientRunId: state.runId,
    projectId: state.projectId,
    repository: state.repositoryId,
    projectPolicyRevision: state.revision,
    provider: state.provider,
    model: state.model,
    client: state.client,
    clientVersion,
  };
  const created = await jsonRequest(
    fetchImpl,
    `${TRACE_AUTHORITY}/api/v1/runs`,
    {
      method: "POST",
      headers: {
        ...jsonHeaders,
        "Idempotency-Key": sha256(`create:${JSON.stringify(createBody)}`),
      },
      body: JSON.stringify(createBody),
    },
    ["clientRunId", "serverRunId", "state"],
    "trace run creation",
  );
  if (
    created.clientRunId !== state.runId ||
    created.state !== "awaiting_trace" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(created.serverRunId ?? "")
  ) {
    fail("trace run creation returned mismatched identity");
  }
  const serverPath = encodeURIComponent(created.serverRunId);
  const intentBody = {
    sha256: trace.sha256,
    sizeBytes: trace.sizeBytes,
    contentType: trace.contentType,
  };
  const intent = await jsonRequest(
    fetchImpl,
    `${TRACE_AUTHORITY}/api/v1/runs/${serverPath}/trace-intents`,
    {
      method: "POST",
      headers: {
        ...jsonHeaders,
        "Idempotency-Key": sha256(
          `intent:${created.serverRunId}:${trace.sha256}`,
        ),
      },
      body: JSON.stringify(intentBody),
    },
    [
      "contentType",
      "expiresAt",
      "serverRunId",
      "sha256",
      "sizeBytes",
      "uploadUrl",
    ],
    "trace upload intent",
  );
  let uploadUrl;
  try {
    uploadUrl = new URL(intent.uploadUrl);
  } catch {
    fail("trace upload intent returned an invalid URL");
  }
  if (
    intent.serverRunId !== created.serverRunId ||
    intent.sha256 !== trace.sha256 ||
    intent.sizeBytes !== trace.sizeBytes ||
    intent.contentType !== trace.contentType ||
    uploadUrl.origin !== TRACE_AUTHORITY ||
    uploadUrl.username ||
    uploadUrl.password ||
    uploadUrl.hash
  ) {
    fail("trace upload intent returned mismatched fields");
  }
  const uploaded = await jsonRequest(
    fetchImpl,
    uploadUrl.href,
    {
      method: "PUT",
      headers: {
        "Content-Type": trace.contentType,
        Digest: `sha-256=${trace.sha256}`,
      },
      body: trace.contents,
    },
    [
      "clientRunId",
      "serverRunId",
      "sizeBytes",
      "state",
      "traceObjectId",
      "traceSha256",
    ],
    "trace upload",
  );
  if (
    uploaded.clientRunId !== state.runId ||
    uploaded.serverRunId !== created.serverRunId ||
    uploaded.sizeBytes !== trace.sizeBytes ||
    uploaded.state !== "trace_uploaded" ||
    uploaded.traceSha256 !== trace.sha256 ||
    uploaded.traceObjectId !== `sha256:${trace.sha256}`
  ) {
    fail("trace upload returned mismatched evidence");
  }
  const finalized = await jsonRequest(
    fetchImpl,
    `${TRACE_AUTHORITY}/api/v1/runs/${serverPath}/finalize`,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Idempotency-Key": sha256(
          `finalize:${created.serverRunId}:${trace.sha256}`,
        ),
      },
    },
    ["clientRunId", "serverRunId", "state", "traceObjectId", "traceSha256"],
    "trace finalization",
  );
  if (
    finalized.clientRunId !== state.runId ||
    finalized.serverRunId !== created.serverRunId ||
    finalized.state !== "finalized" ||
    finalized.traceSha256 !== trace.sha256 ||
    finalized.traceObjectId !== `sha256:${trace.sha256}`
  ) {
    fail("trace finalization returned mismatched evidence");
  }
  return traceUploadEvidence(
    finalized.serverRunId,
    finalized.traceObjectId,
    finalized.traceSha256,
  );
}

export function marker(receipt) {
  const run = {
    schema_version: receipt.schemaVersion,
    run_id: receipt.runId,
    project: receipt.projectId,
    repository: receipt.repositoryId,
    started_at: receipt.startedAt,
    completed_at: receipt.completedAt,
    skill_sha256: receipt.skillSha256,
    ...(receipt.policyAcknowledgement
      ? {
          policy_acknowledgement: {
            policy_revision: receipt.policyAcknowledgement.policyRevision,
            license_sha256: receipt.policyAcknowledgement.licenseSha256,
            inbound_terms_sha256:
              receipt.policyAcknowledgement.inboundTermsSha256,
            prize_rules_sha256: receipt.policyAcknowledgement.prizeRulesSha256,
            acknowledged_at: receipt.policyAcknowledgement.acknowledgedAt,
          },
        }
      : {}),
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
    ...(receipt.traceUpload
      ? {
          trace_upload: {
            authority: receipt.traceUpload.authority,
            server_run_id: receipt.traceUpload.serverRunId,
            object_id: receipt.traceUpload.objectId,
            sha256: receipt.traceUpload.sha256,
          },
        }
      : {}),
    signature_algorithm: "ed25519",
    device_public_key: receipt.devicePublicKey,
    device_key_id: receipt.deviceKeyId,
    device_signature: receipt.deviceSignature,
  };
  return {
    provider: receipt.provider,
    model: receipt.model,
    client: receipt.client,
    skill_revision: receipt.skillRevision,
    run,
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
    `Compute receipt: ${receipt.usage.totalTokens} project-attributed tokens (${receipt.usage.confidence}; device-signed, locally reported)`,
    `AI provider/model: ${receipt.provider} / ${receipt.model}`,
    `Client / agent tooling: ${receipt.client}`,
    `Contribution skill revision: ${receipt.skillRevision}`,
    "Attribution status: self-reported",
    `— [${lane}]`,
    `<!-- slop-contribution-attribution:v1 ${JSON.stringify(value)} -->`,
  ].join("\n");
}

function preActivationFooter(receipt, lane) {
  const value = marker(receipt);
  return [
    `Compute receipt: ${receipt.usage.totalTokens} project-attributed tokens (${receipt.usage.confidence}; device-signed, locally reported)`,
    `AI provider/model: ${receipt.provider} / ${receipt.model}`,
    `Client / agent tooling: ${receipt.client}`,
    `Contribution skill revision: ${receipt.skillRevision}`,
    "Attribution status: self-reported",
    `— [${lane}]`,
    `<!-- elizaos-contribution-attribution:v2 ${JSON.stringify(value)} -->`,
  ].join("\n");
}

function legacyFooter(receipt, lane) {
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

function completedLane(value, receipt) {
  if (typeof value.lane === "string") return value.lane;
  if (typeof value.footer !== "string") {
    fail("legacy completed run footer is invalid");
  }
  const lanes = value.footer
    .split("\n")
    .map(
      (line) =>
        line.match(/^(?:—|-)\s*\[([A-Za-z0-9][A-Za-z0-9-]{1,48})\]$/u)?.[1],
    )
    .filter(Boolean);
  if (lanes.length !== 1 || value.footer !== legacyFooter(receipt, lanes[0])) {
    fail("legacy completed run footer is invalid");
  }
  return lanes[0];
}

function validateCompletedRecord(value) {
  const receipt = value?.receipt;
  const hasPolicyAcknowledgement = Object.hasOwn(
    receipt ?? {},
    "policyAcknowledgement",
  );
  const wrapperIsCurrent = hasExactKeys(value, [
    "footer",
    "lane",
    "receipt",
    "repositoryRootHash",
  ]);
  const wrapperIsLegacy = hasExactKeys(value, ["footer", "receipt"]);
  const receiptKeys = [
    "client",
    "completedAt",
    "deviceKeyId",
    "devicePublicKey",
    "deviceSignature",
    "model",
    ...(hasPolicyAcknowledgement ? ["policyAcknowledgement"] : []),
    "projectId",
    "provider",
    "repositoryId",
    "runId",
    "schemaVersion",
    "signatureAlgorithm",
    "skillRevision",
    "skillSha256",
    "startedAt",
    "trajectorySha256",
    ...(Object.hasOwn(receipt ?? {}, "traceUpload") ? ["traceUpload"] : []),
    "usage",
  ];
  const usageKeys = [
    "cacheCreationTokens",
    "cacheReadTokens",
    "confidence",
    "costMicroUsd",
    "inputTokens",
    "outputTokens",
    "sessionCount",
    "source",
    "totalTokens",
  ];
  const usage = receipt?.usage;
  const traceUpload = receipt?.traceUpload;
  const numericUsageKeys = [
    "cacheCreationTokens",
    "cacheReadTokens",
    "inputTokens",
    "outputTokens",
    "sessionCount",
    "totalTokens",
  ];
  if (
    (!wrapperIsCurrent && !wrapperIsLegacy) ||
    !receipt ||
    !hasExactKeys(receipt, receiptKeys) ||
    !hasExactKeys(usage, usageKeys) ||
    !["1", "2"].includes(receipt.schemaVersion) ||
    (receipt.schemaVersion === "2") !== hasPolicyAcknowledgement ||
    receipt.projectId !== PROJECT.projectId ||
    receipt.repositoryId !== PROJECT.repositoryId ||
    !RUN_ID_PATTERN.test(receipt.runId ?? "") ||
    (() => {
      try {
        declaredIdentity(receipt.client, "client", "client", 64);
        declaredIdentity(receipt.provider, "provider", "provider", 64);
        declaredIdentity(receipt.model, "model", "model");
        return false;
      } catch {
        return true;
      }
    })() ||
    !new RegExp(
      `^elizaOS/(?:slopdotcash|army)@[0-9a-f]{40}:${PROJECT.skillSourcePath.replaceAll("/", "\\/")}$`,
      "u",
    ).test(receipt.skillRevision ?? "") ||
    canonicalIso(receipt.startedAt) !== receipt.startedAt ||
    canonicalIso(receipt.completedAt) !== receipt.completedAt ||
    Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt) ||
    !SHA_PATTERN.test(receipt.skillSha256 ?? "") ||
    receipt.signatureAlgorithm !== "ed25519" ||
    (receipt.trajectorySha256 !== null &&
      !SHA_PATTERN.test(receipt.trajectorySha256 ?? "")) ||
    !["ccusage-session-v20", "none"].includes(usage.source) ||
    !["bounded", "exact", "unavailable"].includes(usage.confidence) ||
    numericUsageKeys.some(
      (key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0,
    ) ||
    typeof usage.costMicroUsd !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(usage.costMicroUsd) ||
    typeof receipt.devicePublicKey !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(receipt.devicePublicKey) ||
    !SHA_PATTERN.test(receipt.deviceKeyId ?? "") ||
    typeof receipt.deviceSignature !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(receipt.deviceSignature) ||
    (traceUpload !== undefined &&
      (!hasExactKeys(traceUpload, [
        "authority",
        "objectId",
        "serverRunId",
        "sha256",
      ]) ||
        traceUpload.authority !== TRACE_AUTHORITY ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(
          traceUpload.serverRunId ?? "",
        ) ||
        traceUpload.objectId !== `sha256:${receipt.trajectorySha256}` ||
        traceUpload.sha256 !== receipt.trajectorySha256))
  ) {
    fail("completed run state has an invalid identity");
  }
  if (hasPolicyAcknowledgement) {
    validatePolicyAcknowledgement(receipt.policyAcknowledgement);
  }
  const lane = completedLane(value, receipt);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{1,48}$/u.test(lane) ||
    (wrapperIsCurrent && !SHA_PATTERN.test(value.repositoryRootHash ?? ""))
  ) {
    fail("completed run state has an invalid identity");
  }
  let publicKey;
  try {
    const publicDer = Buffer.from(receipt.devicePublicKey, "base64url");
    if (sha256(publicDer) !== receipt.deviceKeyId) {
      fail("completed run device key id does not match its public key");
    }
    publicKey = createPublicKey({
      key: publicDer,
      format: "der",
      type: "spki",
    });
  } catch {
    // error-policy:J3 malformed signed state is explicitly invalid.
    fail("completed run device key is invalid");
  }
  const valid = verify(
    null,
    Buffer.from(signingPayload(receipt), "utf8"),
    publicKey,
    Buffer.from(receipt.deviceSignature, "base64url"),
  );
  const canonicalFooter = footer(receipt, lane);
  if (
    !valid ||
    (wrapperIsCurrent &&
      value.footer !== canonicalFooter &&
      value.footer !== preActivationFooter(receipt, lane))
  ) {
    fail("completed run signature or footer is invalid");
  }
  return {
    receipt,
    footer: canonicalFooter,
    lane,
    repositoryRootHash: wrapperIsCurrent ? value.repositoryRootHash : null,
    legacy: wrapperIsLegacy,
  };
}

function validateCompletedState(value, options, repositoryRoot) {
  const completed = validateCompletedRecord(value);
  const receipt = completed.receipt;
  if (
    completed.lane !== options.lane ||
    (completed.repositoryRootHash !== null &&
      completed.repositoryRootHash !== sha256(repositoryRoot)) ||
    receipt.runId !== options.runId ||
    receipt.client !== options.client ||
    receipt.provider !== options.provider ||
    receipt.model !== options.model ||
    receipt.traceUpload?.serverRunId !== options.traceServerRun ||
    receipt.traceUpload?.objectId !== options.traceObjectId
  ) {
    fail(
      "completed run state does not match this project, repository, model, or lane",
    );
  }
  return completed;
}

function parseArguments(args) {
  const requestedAction = args[0] ?? "help";
  const provided = new Set();
  const options = {
    action: ["--help", "-h"].includes(requestedAction)
      ? "help"
      : requestedAction,
    allowLocalUsage: false,
    allowPackageExecution: false,
    client: null,
    clientVersion: null,
    json: false,
    lane: null,
    model: null,
    provider: null,
    repoRoot: process.cwd(),
    runId: null,
    traceObjectId: null,
    traceServerRun: null,
    trajectory: null,
  };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (provided.has(argument)) fail(`duplicate argument: ${argument}`);
    provided.add(argument);
    if (argument === "--json") options.json = true;
    else if (argument === "--allow-package-execution") {
      options.allowPackageExecution = true;
    } else if (argument === "--allow-local-usage") {
      options.allowLocalUsage = true;
    } else if (
      [
        "--client",
        "--client-version",
        "--lane",
        "--model",
        "--provider",
        "--repo-root",
        "--run",
        "--trace-object-id",
        "--trace-server-run",
        "--trajectory",
      ].includes(argument)
    ) {
      const value = args[index + 1];
      if (!value) fail(`${argument} requires a value`);
      index += 1;
      if (argument === "--client") options.client = value;
      if (argument === "--client-version") options.clientVersion = value;
      if (argument === "--lane") options.lane = value;
      if (argument === "--model") options.model = value;
      if (argument === "--provider") options.provider = value;
      if (argument === "--repo-root") options.repoRoot = value;
      if (argument === "--run") options.runId = value;
      if (argument === "--trace-object-id") options.traceObjectId = value;
      if (argument === "--trace-server-run") options.traceServerRun = value;
      if (argument === "--trajectory") options.trajectory = value;
    } else fail(`unknown argument: ${argument}`);
  }
  if (
    ![
      "doctor",
      "finish",
      "help",
      "preview",
      "start",
      "status",
      "trace",
    ].includes(options.action)
  ) {
    fail("command must be preview, doctor, status, start, trace, or finish");
  }
  const allowedArguments = {
    doctor: new Set([
      "--allow-package-execution",
      "--client",
      "--json",
      "--model",
      "--provider",
      "--repo-root",
    ]),
    finish: new Set([
      "--allow-package-execution",
      "--client",
      "--json",
      "--lane",
      "--model",
      "--provider",
      "--repo-root",
      "--run",
      "--trace-object-id",
      "--trace-server-run",
      "--trajectory",
    ]),
    help: new Set(),
    preview: new Set(["--client", "--json", "--repo-root"]),
    start: new Set([
      "--allow-local-usage",
      "--allow-package-execution",
      "--client",
      "--json",
      "--lane",
      "--model",
      "--provider",
      "--repo-root",
    ]),
    status: new Set(["--json"]),
    trace: new Set([
      "--client-version",
      "--json",
      "--repo-root",
      "--run",
      "--trajectory",
    ]),
  }[options.action];
  const inapplicable = [...provided].filter(
    (argument) => !allowedArguments.has(argument),
  );
  if (inapplicable.length > 0) {
    fail(`${inapplicable.join(", ")} is not valid with ${options.action}`);
  }
  const needsClient = ["doctor", "finish", "preview", "start"].includes(
    options.action,
  );
  if (needsClient) {
    declaredIdentity(options.client, "--client", "client", 64);
  }
  if (["doctor", "finish", "start"].includes(options.action)) {
    declaredIdentity(options.provider, "--provider", "provider", 64);
    declaredIdentity(options.model, "--model", "model");
  }
  if (["finish", "start"].includes(options.action)) {
    if (
      !options.lane ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{1,48}$/u.test(options.lane)
    ) {
      fail("--lane must be a concrete public lane identifier");
    }
  }
  if (
    options.action === "finish" &&
    !RUN_ID_PATTERN.test(options.runId ?? "")
  ) {
    fail("finish requires --run with the id returned by start");
  }
  if (options.action === "finish" && options.trajectory === null) {
    fail("finish requires --trajectory; every run must retain a private trace");
  }
  if (
    options.action === "trace" &&
    (!RUN_ID_PATTERN.test(options.runId ?? "") || options.trajectory === null)
  ) {
    fail("trace requires --run and --trajectory");
  }
  if (options.action === "trace") {
    declaredIdentity(options.clientVersion, "--client-version", "version", 128);
  }
  if (
    options.action === "finish" &&
    (options.traceServerRun === null || options.traceObjectId === null)
  ) {
    fail(
      "finish requires finalized --trace-server-run and --trace-object-id evidence",
    );
  }
  if (options.action === "start" && !options.allowLocalUsage) {
    fail(
      "start requires --allow-local-usage after reviewing the preview output",
    );
  }
  if (options.action !== "start" && options.allowLocalUsage) {
    fail("--allow-local-usage is valid only with start");
  }
  if (
    ["doctor", "finish", "start"].includes(options.action) &&
    PROJECT.usageAdapters[options.client] &&
    !options.allowPackageExecution
  ) {
    fail(
      `${options.action} requires --allow-package-execution after reviewing the preview output`,
    );
  }
  if (
    (!["doctor", "finish", "start"].includes(options.action) ||
      !PROJECT.usageAdapters[options.client]) &&
    options.allowPackageExecution
  ) {
    fail(
      "--allow-package-execution is valid only for a supported usage adapter",
    );
  }
  return options;
}

function renderResult(result, json) {
  process.stdout.write(
    json ? `${JSON.stringify(result, null, 2)}\n` : `${result.message}\n`,
  );
}

function previewRun(options) {
  const provenance = resolveSkillProvenance();
  const repositoryRoot = requireRepository(options.repoRoot);
  const stateRoot = configurationRoot();
  const usageAdapter = PROJECT.usageAdapters[options.client] ?? null;
  const result = {
    projectId: PROJECT.projectId,
    repositoryId: PROJECT.repositoryId,
    repositoryRoot,
    client: options.client,
    modelPolicy: "open-declared",
    modelEvidence: "must-be-declared-local-not-provider-attested",
    usageAdapter,
    skillRevision: provenance.skillRevision,
    skillSha256: provenance.skillSha256,
    localReads: usageInputPaths(options.client),
    localWrites: [
      join(stateRoot, "runs", "active", "<run-id>.json"),
      join(stateRoot, "runs", "completed", "<run-id>.json"),
      join(stateRoot, "device-ed25519.pem"),
    ],
    packageManagerCacheWrites: [
      "Bun or npm package cache and diagnostic logs during doctor/start/finish",
    ],
    network: [
      `Resolve exact ccusage@${CCUSAGE_VERSION} during doctor and measured runs; fetch it from the package registry only when it is not already cached`,
      `Verify the public private-request intake gate at ${PRIVATE_REQUEST_INTAKE_STATUS}; trace upload remains blocked unless it reports enabled`,
      `After a local byte/digest disclosure, authenticate with GitHub and permanently upload the inspected trace through ${TRACE_AUTHORITY} under ${TRACE_PRIVACY_CONTRACT}`,
    ],
    automaticUploads: [],
    publicReceiptFields: [
      "project and repository",
      "run id and timestamps",
      "client and declared provider/model",
      "skill revision and SHA-256",
      "aggregate input/output/cache/total tokens and API-equivalent estimated cost",
      "session count and confidence",
      "required private trajectory SHA-256",
      "private trace authority, server run id, and immutable object id",
      "public Ed25519 device key and signature",
    ],
    excluded: [
      "source-file bodies and private diffs",
      "unrelated transcripts and session identifiers",
      "credentials, environment values, private keys, wallet secrets, absolute local paths, and hidden reasoning",
    ],
    consentFlag: "--allow-local-usage",
    packageExecutionConsentFlag: "--allow-package-execution",
    localStateDisclosure:
      "Active baselines retain aggregate counters and SHA-256 session identifiers until finish.",
    linkabilityDisclosure:
      "The shared device public key can link receipts across supported Slop projects and GitHub identities.",
    clientTransportDisclosure:
      "CLI output may enter the active agent/model conversation under the client's privacy policy.",
  };
  renderResult(
    {
      ...result,
      message: [
        `Slop receipt preview for ${result.repositoryId}.`,
        `Local usage reads: ${result.localReads.join(", ") || "none; this client has no usage adapter"}`,
        `Local state: ${stateRoot}`,
        "Automatic uploads: none.",
        `Doctor only after consent with ${result.packageExecutionConsentFlag}.`,
        `Start only after consent with ${result.consentFlag}.`,
      ].join("\n"),
    },
    options.json,
  );
}

function doctorRun(options) {
  const provenance = resolveSkillProvenance();
  const repositoryRoot = requireRepository(options.repoRoot);
  const usageAdapter = PROJECT.usageAdapters[options.client] ?? null;
  const probe = usageAdapter
    ? inspectCcusageRunner()
    : { runner: null, status: "unsupported", version: null };
  const result = {
    ok: probe.status === "available" || probe.status === "unsupported",
    projectId: PROJECT.projectId,
    repositoryId: PROJECT.repositoryId,
    repositoryRoot,
    client: options.client,
    provider: options.provider,
    model: options.model,
    modelPolicy: "open-declared",
    modelEvidence: "declared-local-not-provider-attested",
    skillRevision: provenance.skillRevision,
    skillSha256: provenance.skillSha256,
    ccusage: {
      expectedVersion: usageAdapter ? CCUSAGE_VERSION : null,
      version: probe.version,
      runner: probe.runner,
      status: probe.status,
      logsRead: false,
    },
  };
  renderResult(
    {
      ...result,
      message: result.ok
        ? `Slop receipt doctor passed for ${result.repositoryId}; no usage logs were read${usageAdapter ? "." : "; this client has no usage adapter, so usage will be unavailable."}`
        : `Slop receipt doctor failed: exact ccusage@${CCUSAGE_VERSION} could not be executed.`,
    },
    options.json,
  );
  if (!result.ok) process.exitCode = 1;
}

function statusRun(options) {
  const root = join(configurationRoot(), "runs");
  const currentRuns = [
    ...readStateRecords(join(root, "active"), "active"),
    ...readStateRecords(join(root, "completed"), "completed"),
  ];
  const legacyCompleted = readStateRecords(
    join(configurationRoot("gitarmy"), "runs", "completed"),
    "completed",
  );
  const runs = [
    ...new Map(
      [...currentRuns, ...legacyCompleted].map((run) => [run.runId, run]),
    ).values(),
  ].sort((left, right) => left.runId.localeCompare(right.runId));
  renderResult(
    {
      projectId: PROJECT.projectId,
      runs,
      message:
        runs.length === 0
          ? `No local ${PROJECT.projectId} measured runs.`
          : `${runs.length} local ${PROJECT.projectId} measured run${runs.length === 1 ? "" : "s"}.`,
    },
    options.json,
  );
}

function startRun(options, testOptions) {
  const provenance = resolveSkillProvenance();
  const repositoryRoot = requireRepository(options.repoRoot);
  const usageAdapter = PROJECT.usageAdapters[options.client] ?? null;
  const runId = createRunId();
  const state = validateActiveRecord({
    schemaVersion: "2",
    runId,
    projectId: PROJECT.projectId,
    repositoryId: PROJECT.repositoryId,
    repositoryRootHash: sha256(repositoryRoot),
    client: options.client,
    provider: options.provider,
    model: options.model,
    lane: options.lane,
    startedAt: canonicalIso(),
    baseline: collectUsage(options.client, repositoryRoot),
    policyAcknowledgement: projectPolicyPreflight(testOptions),
    ...provenance,
  });
  const directories = runDirectories();
  writeJsonExclusive(join(directories.active, `${runId}.json`), state);
  renderResult(
    {
      runId,
      message: `Project run started. Keep this id: ${runId}`,
      usageStatus:
        usageAdapter === null
          ? "unsupported"
          : state.baseline === null
            ? "unavailable"
            : "capturing",
    },
    options.json,
  );
}

async function traceRun(options) {
  const provenance = resolveSkillProvenance();
  const repositoryRoot = requireRepository(options.repoRoot);
  const activePath = join(runDirectories().active, `${options.runId}.json`);
  if (!existsSync(activePath)) fail("active run state was not found");
  const state = validateActiveRecord(readStateFile(activePath));
  if (
    state.repositoryRootHash !== sha256(repositoryRoot) ||
    state.revision !== provenance.revision ||
    state.skillRevision !== provenance.skillRevision ||
    state.skillSha256 !== provenance.skillSha256
  ) {
    fail("run state does not match this repository or skill revision");
  }
  const evidence = await uploadPrivateTrace(
    state,
    options.trajectory,
    options.clientVersion,
  );
  renderResult(
    {
      ...evidence,
      message: [
        "Private trace uploaded and finalized.",
        `--trace-server-run ${evidence.serverRunId}`,
        `--trace-object-id ${evidence.objectId}`,
      ].join("\n"),
    },
    options.json,
  );
}

function finishRun(options, testOptions) {
  const provenance = resolveSkillProvenance();
  const repositoryRoot = requireRepository(options.repoRoot);
  const directories = runDirectories();
  const activePath = join(directories.active, `${options.runId}.json`);
  const completedPaths = [
    join(directories.completed, `${options.runId}.json`),
    join(
      configurationRoot("gitarmy"),
      "runs",
      "completed",
      `${options.runId}.json`,
    ),
  ];
  const completedPath = completedPaths[0];
  const replayCompleted = () => {
    const replayPath = completedPaths.find((path) => existsSync(path));
    if (!replayPath) return false;
    const completed = validateCompletedState(
      readStateFile(replayPath),
      options,
      repositoryRoot,
    );
    if (
      options.trajectory !== null &&
      completed.receipt.trajectorySha256 !==
        trajectoryDigest(options.trajectory)
    ) {
      fail("completed run trajectory does not match the requested proof");
    }
    if (existsSync(activePath)) rmSync(activePath, { force: true });
    renderResult(
      {
        receipt: completed.receipt,
        footer: completed.footer,
        message: completed.footer,
      },
      options.json,
    );
    return true;
  };
  if (replayCompleted()) return;
  if (!existsSync(activePath)) {
    if (replayCompleted()) return;
    fail("active run state was not found");
  }
  let state;
  try {
    state = validateActiveRecord(readStateFile(activePath));
  } catch (error) {
    if (error?.code === "ENOENT" && replayCompleted()) return;
    throw error;
  }
  if (
    state.runId !== options.runId ||
    state.projectId !== PROJECT.projectId ||
    state.repositoryId !== PROJECT.repositoryId ||
    state.client !== options.client ||
    state.provider !== options.provider ||
    state.model !== options.model ||
    state.lane !== options.lane ||
    state.repositoryRootHash !== sha256(repositoryRoot) ||
    state.revision !== provenance.revision ||
    state.skillRevision !== provenance.skillRevision ||
    state.skillSha256 !== provenance.skillSha256
  ) {
    fail("run state does not match this project, repository, model, or lane");
  }
  const completedAt = canonicalIso();
  if (Date.parse(completedAt) + CLOCK_SKEW_MS < Date.parse(state.startedAt)) {
    fail("system clock moved backward during the run");
  }
  const usage = PROJECT.usageAdapters[options.client]
    ? usageDelta(
        state.baseline,
        collectUsage(options.client, repositoryRoot),
        options.client,
      )
    : unavailableUsage("none");
  const key = deviceKey();
  const trajectorySha256 = trajectoryDigest(options.trajectory);
  const currentPolicy = projectPolicyPreflight(testOptions);
  if (
    policyBinding(currentPolicy) !== policyBinding(state.policyAcknowledgement)
  ) {
    fail("project terms changed during the run; start a new acknowledged run");
  }
  const receipt = {
    schemaVersion: "2",
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
    policyAcknowledgement: state.policyAcknowledgement,
    usage,
    trajectorySha256,
    traceUpload: traceUploadEvidence(
      options.traceServerRun,
      options.traceObjectId,
      trajectorySha256,
    ),
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
  const completed = {
    receipt,
    footer: renderedFooter,
    lane: options.lane,
    repositoryRootHash: state.repositoryRootHash,
  };
  const created = atomicJson(completedPath, completed, directories.pending);
  const winner = created
    ? validateCompletedState(completed, options, repositoryRoot)
    : validateCompletedState(
        readStateFile(completedPath),
        options,
        repositoryRoot,
      );
  if (
    options.trajectory !== null &&
    winner.receipt.trajectorySha256 !== trajectoryDigest(options.trajectory)
  ) {
    fail("completed run trajectory does not match the requested proof");
  }
  rmSync(activePath, { force: true });
  renderResult(
    {
      receipt: winner.receipt,
      footer: winner.footer,
      message: winner.footer,
    },
    options.json,
  );
}

export async function main(args = process.argv.slice(2), testOptions) {
  const options = parseArguments(args);
  if (options.action === "help") process.stdout.write(HELP);
  else if (options.action === "preview") previewRun(options);
  else if (options.action === "doctor") doctorRun(options);
  else if (options.action === "status") statusRun(options);
  else if (options.action === "start") startRun(options, testOptions);
  else if (options.action === "trace") await traceRun(options);
  else finishRun(options, testOptions);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) ===
    realpathSync(process.argv[1]);
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    // error-policy:J1 The CLI boundary returns a non-zero result without a fake receipt.
    process.stderr.write(
      `project run receipt failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
