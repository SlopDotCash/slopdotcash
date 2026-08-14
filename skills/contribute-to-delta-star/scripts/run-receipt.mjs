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
  verify,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = resolve(scriptDirectory, "..");
const PROJECT = JSON.parse(
  readFileSync(join(skillDirectory, "project.json"), "utf8"),
);
const CCUSAGE_VERSION = "20.0.19";
const CCUSAGE_VERSION_OUTPUT = `ccusage ${CCUSAGE_VERSION}`;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_TRAJECTORY_BYTES = 100 * 1024 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/u;
const SHA_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_STATE_BYTES = MAX_REPORT_BYTES + 1024 * 1024;
const AUTHORIZATION_RECEIPT = ".slop-authorization.json";

const HELP = `Usage: node scripts/run-receipt.mjs <command> [options]

Commands:
  preview  Show local reads, writes, network access, and public receipt fields
  doctor   Verify repository, skill provenance, model policy, and local runners
  status   List this project's local active and completed measured runs
  start    Capture a local ccusage baseline after explicit usage consent
  finish   Close a measured run and print its device-signed GitHub footer

Common options:
  --repo-root <path>  Target Git repository root (default: current directory)
  --client <name>     codex or claude-code
  --model <id>        Exact model required by the project policy
  --json              Emit machine-readable JSON

Start and finish also require --lane <public-lane>. Start requires
--allow-local-usage after preview. Finish requires --run <run-id> and accepts
an optional --trajectory <path> whose contents stay local.
Doctor, start, and finish require --allow-package-execution after preview
because package-manager resolution may fetch code and write caches.
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
  const model = PROJECT.models[client];
  return withPackageExecution((executionRoot) => {
    for (const runner of ccusageRunners(executionRoot)) {
      const args = [
        ...runner.prefix,
        model.ccusageSource,
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
  const approvedModel = PROJECT.models[value?.client];
  const expectedKeys = [
    "baseline",
    "client",
    "lane",
    "model",
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
    value.schemaVersion !== "1" ||
    value.projectId !== PROJECT.projectId ||
    value.repositoryId !== PROJECT.repositoryId ||
    !RUN_ID_PATTERN.test(value.runId ?? "") ||
    !SHA_PATTERN.test(value.repositoryRootHash ?? "") ||
    !approvedModel ||
    value.provider !== approvedModel.provider ||
    value.model !== approvedModel.model ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{1,48}$/u.test(value.lane ?? "") ||
    canonicalIso(value.startedAt) !== value.startedAt ||
    !/^[0-9a-f]{40}$/u.test(value.revision ?? "") ||
    value.skillRevision !==
      `elizaOS/slopdotcash@${value.revision}:${PROJECT.skillSourcePath}` ||
    !SHA_PATTERN.test(value.skillSha256 ?? "")
  ) {
    fail("active run state has an invalid identity");
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
  const approvedModel = PROJECT.models[receipt?.client];
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
    receipt.schemaVersion !== "1" ||
    receipt.projectId !== PROJECT.projectId ||
    receipt.repositoryId !== PROJECT.repositoryId ||
    !RUN_ID_PATTERN.test(receipt.runId ?? "") ||
    !approvedModel ||
    receipt.provider !== approvedModel.provider ||
    receipt.model !== approvedModel.model ||
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
    usage.source !== "ccusage-session-v20" ||
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
    !/^[A-Za-z0-9_-]+$/u.test(receipt.deviceSignature)
  ) {
    fail("completed run state has an invalid identity");
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
    receipt.model !== options.model
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
    json: false,
    lane: null,
    model: null,
    repoRoot: process.cwd(),
    runId: null,
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
  if (
    !["doctor", "finish", "help", "preview", "start", "status"].includes(
      options.action,
    )
  ) {
    fail("command must be preview, doctor, status, start, or finish");
  }
  const allowedArguments = {
    doctor: new Set([
      "--allow-package-execution",
      "--client",
      "--json",
      "--model",
      "--repo-root",
    ]),
    finish: new Set([
      "--allow-package-execution",
      "--client",
      "--json",
      "--lane",
      "--model",
      "--repo-root",
      "--run",
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
      "--repo-root",
    ]),
    status: new Set(["--json"]),
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
  if (needsClient && !PROJECT.models[options.client]) {
    fail("--client must be codex or claude-code");
  }
  if (["doctor", "finish", "start"].includes(options.action)) {
    const approved = PROJECT.models[options.client];
    if (options.model !== approved.model) {
      fail(`--model must be the approved frontier model ${approved.model}`);
    }
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
    !options.allowPackageExecution
  ) {
    fail(
      `${options.action} requires --allow-package-execution after reviewing the preview output`,
    );
  }
  if (
    !["doctor", "finish", "start"].includes(options.action) &&
    options.allowPackageExecution
  ) {
    fail(
      "--allow-package-execution is valid only with doctor, start, or finish",
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
  const model = PROJECT.models[options.client];
  const result = {
    projectId: PROJECT.projectId,
    repositoryId: PROJECT.repositoryId,
    repositoryRoot,
    client: options.client,
    approvedModel: model.model,
    modelEvidence: "declared-local-not-provider-attested",
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
    ],
    automaticUploads: [],
    publicReceiptFields: [
      "project and repository",
      "run id and timestamps",
      "client and declared provider/model",
      "skill revision and SHA-256",
      "aggregate input/output/cache/total tokens and API-equivalent estimated cost",
      "session count and confidence",
      "optional local trajectory SHA-256",
      "public Ed25519 device key and signature",
    ],
    excluded: [
      "prompts and responses",
      "source files and diffs",
      "transcript and session identifiers",
      "credentials, environment values, private keys, and wallet secrets",
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
        `Local usage reads: ${result.localReads.join(", ")}`,
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
  const probe = inspectCcusageRunner();
  const result = {
    ok: probe.status === "available",
    projectId: PROJECT.projectId,
    repositoryId: PROJECT.repositoryId,
    repositoryRoot,
    client: options.client,
    approvedModel: PROJECT.models[options.client].model,
    modelEvidence: "declared-local-not-provider-attested",
    skillRevision: provenance.skillRevision,
    skillSha256: provenance.skillSha256,
    ccusage: {
      expectedVersion: CCUSAGE_VERSION,
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
        ? `Slop receipt doctor passed for ${result.repositoryId}; no usage logs were read.`
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

function startRun(options) {
  const provenance = resolveSkillProvenance();
  const repositoryRoot = requireRepository(options.repoRoot);
  const model = PROJECT.models[options.client];
  const runId = createRunId();
  const state = validateActiveRecord({
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
  });
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

export function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.action === "help") process.stdout.write(HELP);
  else if (options.action === "preview") previewRun(options);
  else if (options.action === "doctor") doctorRun(options);
  else if (options.action === "status") statusRun(options);
  else if (options.action === "start") startRun(options);
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
