#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, realpathSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_TERMS_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 32;
const CACHE_FILE_PATTERN = /^[0-9a-f]{64}\.bin$/u;
const ALLOWED_TERMS_HOSTS = new Set([
  "github.com",
  "proximityprize.org",
  "raw.githubusercontent.com",
]);

function fail(message) {
  throw new TypeError(message);
}

function exact(value, keys, field) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    fail(`${field} has unexpected or missing fields`);
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cacheRoot() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  if (!base || !isAbsolute(base)) return null;
  return join(base, "slop", "policy-documents-v1");
}

function immutableCachePath(source, expected) {
  const parsed = new URL(source);
  if (
    parsed.hostname !== "raw.githubusercontent.com" ||
    !/^\/[^/]+\/[^/]+\/[0-9a-f]{40}\/.+/u.test(parsed.pathname)
  ) {
    return null;
  }
  const root = cacheRoot();
  return root === null
    ? null
    : {
        root,
        path: join(root, `${digest(`${source}\0${expected}`)}.bin`),
      };
}

async function cachedVerifiedBytes(cache, expected) {
  if (cache === null) return null;
  let handle;
  try {
    handle = await open(cache.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_TERMS_BYTES) return null;
    const bytes = await handle.readFile();
    return digest(bytes) === expected ? bytes : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function pruneCache(root) {
  const entries = [];
  for (const name of await readdir(root)) {
    if (!CACHE_FILE_PATTERN.test(name)) continue;
    try {
      const metadata = await stat(join(root, name));
      if (metadata.isFile()) {
        entries.push({ name, mtimeMs: metadata.mtimeMs, size: metadata.size });
      }
    } catch {
      // Concurrent cache cleanup is harmless; keep inspecting other entries.
    }
  }
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
  let retainedBytes = 0;
  for (const [index, entry] of entries.entries()) {
    retainedBytes += entry.size;
    if (index >= MAX_CACHE_ENTRIES || retainedBytes > MAX_CACHE_BYTES) {
      await unlink(join(root, entry.name)).catch(() => {});
    }
  }
}

async function publishCache(cache, bytes) {
  if (cache === null) return;
  try {
    await mkdir(cache.root, { mode: 0o700, recursive: true });
    const temporary = `${cache.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, cache.path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    await pruneCache(cache.root);
  } catch {
    // The cache is an availability optimization, never a policy authority.
  }
}

function rawUrl(value) {
  const parsed = new URL(value);
  const match = parsed.pathname.match(
    /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/(.+)$/u,
  );
  return match
    ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`
    : value;
}

function allowedRemoteSource(value, field) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash ||
    !ALLOWED_TERMS_HOSTS.has(parsed.hostname)
  ) {
    fail(`${field} authority is not allowed`);
  }
  return parsed.href;
}

async function boundedResponseBytes(response, limit, field) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > limit)
  ) {
    fail(`${field} exceeds the byte limit`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        fail(`${field} exceeds the byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function verifiedBytes(url, expected, field, allowFile) {
  const source = rawUrl(url);
  let bytes;
  if (source.startsWith("file://")) {
    if (!allowFile) fail(`${field} authority is not allowed`);
    bytes = await readFile(fileURLToPath(source));
    if (bytes.byteLength > MAX_TERMS_BYTES) {
      fail(`${field} exceeds the byte limit`);
    }
  } else {
    const allowedSource = allowedRemoteSource(source, field);
    const cache = immutableCachePath(allowedSource, expected);
    bytes = await cachedVerifiedBytes(cache, expected);
    if (bytes !== null) return;
    const response = await fetch(allowedSource, {
      headers: { accept: "application/octet-stream" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) fail(`${field} could not be fetched`);
    bytes = await boundedResponseBytes(response, MAX_TERMS_BYTES, field);
    if (digest(bytes) !== expected) fail(`${field} digest drifted`);
    await publishCache(cache, bytes);
    return;
  }
  if (digest(bytes) !== expected) fail(`${field} digest drifted`);
}

export async function preflight(projectId, options = {}) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(projectId)) {
    fail("project id is invalid");
  }
  exact(
    options,
    Object.hasOwn(options, "testAuthority") ? ["testAuthority"] : [],
    "preflight options",
  );
  const origin = options.testAuthority ?? "https://slop.cash";
  const authority = new URL(origin);
  if (options.testAuthority !== undefined && authority.protocol !== "file:") {
    fail("test authority must be a file URL");
  }
  if (
    options.testAuthority === undefined &&
    (authority.protocol !== "https:" ||
      authority.origin !== "https://slop.cash")
  ) {
    fail("project policy authority is not allowed");
  }
  const policyUrl = new URL(
    `projects/${projectId}/terms.json`,
    `${authority.href.replace(/\/?$/u, "/")}`,
  );
  let policy;
  if (policyUrl.protocol === "file:") {
    const bytes = await readFile(fileURLToPath(policyUrl));
    if (bytes.byteLength > MAX_POLICY_BYTES) {
      fail("project terms exceeds the byte limit");
    }
    policy = JSON.parse(bytes.toString("utf8"));
  } else {
    const response = await fetch(policyUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) fail("project terms could not be fetched");
    policy = JSON.parse(
      (
        await boundedResponseBytes(response, MAX_POLICY_BYTES, "project terms")
      ).toString("utf8"),
    );
  }
  exact(
    policy,
    ["authority", "projectId", "schemaVersion", "status", "steward", "terms"],
    "project policy",
  );
  if (policy.schemaVersion !== "1" || policy.projectId !== projectId) {
    fail("project policy identity is invalid");
  }
  if (policy.authority?.state === "verified") {
    if (policy.authority.proof?.policyRevision !== policy.terms?.revision) {
      fail("repository proof does not bind the current terms revision");
    }
    if (
      policy.terms?.receiptPolicy?.state !== "active" ||
      policy.terms.receiptPolicy.activatedAt !==
        policy.authority.proof?.verifiedAt
    ) {
      fail("receipt policy is not bound to authority activation");
    }
  }
  if (policy.terms?.repositoryLicense?.state === "verified") {
    await verifiedBytes(
      policy.terms.repositoryLicense.url,
      policy.terms.repositoryLicense.fileSha256,
      "LICENSE",
      options.testAuthority !== undefined,
    );
  }
  if (policy.terms.inbound.fileSha256) {
    await verifiedBytes(
      policy.terms.inbound.termsUrl,
      policy.terms.inbound.fileSha256,
      "inbound terms",
      options.testAuthority !== undefined,
    );
  }
  if (policy.terms.externalPrize?.rulesSha256) {
    await verifiedBytes(
      policy.terms.externalPrize.rulesUrl,
      policy.terms.externalPrize.rulesSha256,
      "prize rules",
      options.testAuthority !== undefined,
    );
  }
  return {
    policyRevision: policy.terms.revision,
    licenseSha256: policy.terms.repositoryLicense.fileSha256,
    inboundTermsSha256: policy.terms.inbound.fileSha256,
    prizeRulesSha256: policy.terms.externalPrize?.rulesSha256 ?? null,
    acknowledgedAt: new Date().toISOString(),
  };
}

const direct =
  typeof process.argv[1] === "string" &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) ===
    realpathSync(process.argv[1]);
if (direct) {
  try {
    const projectIndex = process.argv.indexOf("--project");
    const projectId = process.argv[projectIndex + 1];
    if (process.argv.includes("--authority")) {
      fail("direct CLI authority overrides are forbidden");
    }
    const acknowledgement = await preflight(projectId);
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(acknowledgement)}\n`);
    } else {
      process.stdout.write(
        `Project policy acknowledged: ${acknowledgement.policyRevision} · license ${acknowledgement.licenseSha256?.slice(0, 12) ?? "not declared"} · contributions open\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `project terms preflight failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
