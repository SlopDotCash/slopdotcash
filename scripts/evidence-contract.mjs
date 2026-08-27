/**
 * Defines the fail-closed artifact, ledger, and network checks shared by local
 * and production evidence capture. Network I/O stays injected so the contract
 * can be tested without substituting fixtures for the production recording.
 */

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { PROJECTS } from "../src/lib/projects.mjs";
import {
  PRIMARY_REPOSITORY,
  TARGET_REPOSITORIES,
} from "../src/lib/repositories.mjs";

export const PRODUCTION_ORIGIN = "https://slop.cash";
export const PRODUCTION_HOSTNAME = "slop.cash";
export const LIVE_LEDGER_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const rootPublishedProjects = PROJECTS.filter(
  (project) => project.skill.publishAtRoot === true,
);
if (rootPublishedProjects.length !== 1) {
  throw new TypeError(
    "evidence contract requires exactly one root-published project skill",
  );
}
const rootPublishedProject = rootPublishedProjects[0];
const rootArchiveName = `${rootPublishedProject.skill.id}.skill`;

export const REMOTE_ARTIFACT_PATHS = [
  "index.html",
  "SKILL.md",
  ".well-known/agent-skills/index.json",
  ".well-known/agent-skills/slop/SKILL.md",
  ".well-known/slop/projects.json",
  "llms.txt",
  `projects/${rootPublishedProject.id}/skill.md`,
  "mission.md",
  "codex.md",
  "claude.md",
  "claude-code.md",
  "skill-manifest.json",
  `downloads/${rootArchiveName}`,
  `downloads/${rootArchiveName}.sha256`,
  "data/leaderboard.json",
];

const REQUIRED_SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ],
  "cross-origin-opener-policy": ["same-origin"],
  "permissions-policy": [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
  ],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "strict-transport-security": ["max-age=31536000", "includesubdomains"],
  "x-content-type-options": ["nosniff"],
};

function artifactContentType(path) {
  if (path === "index.html") return "text/html";
  if (path === "llms.txt") return "text/plain";
  if (path.startsWith("downloads/")) return "application/octet-stream";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  throw new TypeError(`remote artifact has no MIME contract: ${path}`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function asObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function asNonEmptyArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array`);
  }
  return value;
}

function asPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive integer`);
  }
  return value;
}

function asTimestamp(value, path) {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be an ISO-8601 timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${path} must be an ISO-8601 timestamp`);
  }
  return timestamp;
}

function parseJson(contents, path) {
  try {
    return JSON.parse(
      Buffer.isBuffer(contents) ? contents.toString("utf8") : contents,
    );
  } catch (error) {
    // error-policy:J2 evidence capture must preserve the rejected artifact path.
    throw new TypeError(`${path} must contain valid JSON`, { cause: error });
  }
}

export function parseEvidenceMode(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--local")) {
    return "local";
  }
  if (args.length === 1 && args[0] === "--production") {
    return "production";
  }
  throw new TypeError(
    "record-evidence accepts exactly one mode: --local or --production",
  );
}

export function shouldBuildForEvidence(mode) {
  if (!["local", "production"].includes(mode)) {
    throw new TypeError(`unknown evidence mode: ${mode}`);
  }
  return mode === "local";
}

export function assertLiveLedgerReady(
  contents,
  { now = Date.now(), maxAgeMs = LIVE_LEDGER_MAX_AGE_MS } = {},
) {
  const snapshot = asObject(
    typeof contents === "string" || Buffer.isBuffer(contents)
      ? parseJson(contents, "leaderboard")
      : contents,
    "leaderboard",
  );
  if (snapshot.schemaVersion !== "6") {
    throw new TypeError("leaderboard.schemaVersion must be 6");
  }
  if (snapshot.repository !== PRIMARY_REPOSITORY.id) {
    throw new TypeError(
      `leaderboard.repository must be ${PRIMARY_REPOSITORY.id}`,
    );
  }
  if (
    !Array.isArray(snapshot.repositories) ||
    snapshot.repositories.length !== TARGET_REPOSITORIES.length ||
    TARGET_REPOSITORIES.some(
      (repository, index) =>
        asObject(
          snapshot.repositories[index],
          `leaderboard.repositories[${index}]`,
        ).id !== repository.id,
    )
  ) {
    throw new TypeError(
      "leaderboard.repositories must match the target repository registry",
    );
  }
  if (snapshot.stale !== false) {
    throw new TypeError("leaderboard.stale must be false");
  }
  const generatedAt = asTimestamp(
    snapshot.generatedAt,
    "leaderboard.generatedAt",
  );
  const ageMs = now - generatedAt;
  if (ageMs < -FUTURE_CLOCK_SKEW_MS) {
    throw new TypeError("leaderboard.generatedAt is in the future");
  }
  if (ageMs > maxAgeMs) {
    throw new TypeError(
      `leaderboard.generatedAt is older than ${Math.floor(maxAgeMs / 3_600_000)} hours`,
    );
  }

  const source = asObject(snapshot.source, "leaderboard.source");
  if (source.provider !== "github-graphql") {
    throw new TypeError("leaderboard.source.provider must be github-graphql");
  }
  asTimestamp(source.fetchedAt, "leaderboard.source.fetchedAt");
  const requestCount = asPositiveInteger(
    source.requestCount,
    "leaderboard.source.requestCount",
  );
  const counts = asObject(source.counts, "leaderboard.source.counts");
  const mergedPullRequests = asPositiveInteger(
    counts.mergedPullRequests,
    "leaderboard.source.counts.mergedPullRequests",
  );
  const openIssues = asPositiveInteger(
    counts.openIssues,
    "leaderboard.source.counts.openIssues",
  );
  const openPullRequests = asPositiveInteger(
    counts.openPullRequests,
    "leaderboard.source.counts.openPullRequests",
  );

  const leaders = asNonEmptyArray(snapshot.leaders, "leaderboard.leaders");
  const ledger = asNonEmptyArray(snapshot.ledger, "leaderboard.ledger");
  const workQueue = asObject(snapshot.workQueue, "leaderboard.workQueue");
  const issues = asNonEmptyArray(
    workQueue.issues,
    "leaderboard.workQueue.issues",
  );
  const pullRequests = asNonEmptyArray(
    workQueue.pullRequests,
    "leaderboard.workQueue.pullRequests",
  );

  return {
    ageMs: Math.max(0, ageMs),
    generatedAt: snapshot.generatedAt,
    issueQueueCount: issues.length,
    ledgerCount: ledger.length,
    leaderCount: leaders.length,
    mergedPullRequests,
    openIssues,
    openPullRequests,
    pullRequestQueueCount: pullRequests.length,
    requestCount,
    sourceFetchedAt: source.fetchedAt,
  };
}

export function assertCommittedBuildManifest(contents, expectedRevision) {
  const manifest = asObject(
    typeof contents === "string" || Buffer.isBuffer(contents)
      ? parseJson(contents, "skill manifest")
      : contents,
    "skill manifest",
  );
  if (manifest.schemaVersion !== "1") {
    throw new TypeError("skill manifest.schemaVersion must be 1");
  }
  if (manifest.repository !== "SlopDotCash/slopdotcash") {
    throw new TypeError(
      "skill manifest.repository must be SlopDotCash/slopdotcash",
    );
  }
  if (manifest.revisionStatus !== "committed") {
    throw new TypeError("skill manifest.revisionStatus must be committed");
  }
  if (
    typeof manifest.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(manifest.revision)
  ) {
    throw new TypeError("skill manifest.revision must be a full commit SHA");
  }
  if (manifest.revision !== expectedRevision) {
    throw new TypeError(
      `skill manifest revision ${manifest.revision} does not match checked-out revision ${expectedRevision}`,
    );
  }
  return {
    generatedAt: manifest.generatedAt,
    revision: manifest.revision,
    revisionStatus: manifest.revisionStatus,
  };
}

export function assertSecurityHeaders(headers) {
  const verified = {};
  for (const [name, requiredValues] of Object.entries(
    REQUIRED_SECURITY_HEADERS,
  )) {
    const value = headers.get(name);
    if (!value) {
      throw new TypeError(`production response omitted ${name}`);
    }
    const normalized = value.toLowerCase();
    for (const requiredValue of requiredValues) {
      if (!normalized.includes(requiredValue.toLowerCase())) {
        throw new TypeError(
          `production ${name} omitted required policy ${requiredValue}`,
        );
      }
    }
    verified[name] = value;
  }
  return verified;
}

export function assertImmutableAssetCache(headers) {
  const value = headers.get("cache-control");
  if (!value) {
    throw new TypeError("production asset omitted cache-control");
  }
  const directives = value.toLowerCase();
  for (const required of ["public", "max-age=31536000", "immutable"]) {
    if (!directives.includes(required)) {
      throw new TypeError(`production asset cache-control omitted ${required}`);
    }
  }
  return value;
}

export function assertHttpsRedirect(status, location) {
  if (![301, 302, 307, 308].includes(status)) {
    throw new TypeError(`HTTP apex returned ${status} instead of a redirect`);
  }
  if (typeof location !== "string") {
    throw new TypeError("HTTP apex redirect omitted Location");
  }
  let target;
  try {
    target = new URL(location, `http://${PRODUCTION_HOSTNAME}`);
  } catch (error) {
    // error-policy:J2 evidence capture must identify a malformed redirect.
    throw new TypeError("HTTP apex returned an invalid Location", {
      cause: error,
    });
  }
  if (
    target.protocol !== "https:" ||
    target.hostname !== PRODUCTION_HOSTNAME ||
    target.port !== ""
  ) {
    throw new TypeError(
      `HTTP apex redirected outside ${PRODUCTION_ORIGIN}: ${target.href}`,
    );
  }
  return { location: target.href, status };
}

export function assertDnsAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new TypeError("production DNS returned no addresses");
  }
  return addresses.map((entry, index) => {
    const record = asObject(entry, `DNS address ${index}`);
    if (
      typeof record.address !== "string" ||
      ![4, 6].includes(isIP(record.address)) ||
      record.family !== isIP(record.address)
    ) {
      throw new TypeError(`DNS address ${index} is not a valid A/AAAA result`);
    }
    return { address: record.address, family: record.family };
  });
}

export function assertTlsSession(session, now = Date.now()) {
  const value = asObject(session, "TLS session");
  if (value.authorized !== true) {
    throw new TypeError(
      `TLS certificate was not authorized: ${value.authorizationError ?? "unknown"}`,
    );
  }
  if (!["TLSv1.2", "TLSv1.3"].includes(value.protocol)) {
    throw new TypeError(`TLS protocol is not accepted: ${value.protocol}`);
  }
  const validTo = asTimestamp(value.validTo, "TLS certificate validTo");
  if (validTo <= now) {
    throw new TypeError("TLS certificate is expired");
  }
  if (typeof value.cipher !== "string" || value.cipher.length === 0) {
    throw new TypeError("TLS session omitted its cipher");
  }
  return {
    authorized: true,
    cipher: value.cipher,
    issuer: value.issuer,
    protocol: value.protocol,
    subject: value.subject,
    subjectAltName: value.subjectAltName,
    validFrom: value.validFrom,
    validTo: value.validTo,
  };
}

async function readExactResponseBytes(response, expectedBytes, path) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
      throw new Error(`production ${path} declared an invalid Content-Length`);
    }
    if (parsedLength !== expectedBytes) {
      throw new Error(
        `production ${path} length does not match the verified artifact`,
      );
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`production ${path} omitted its response body`);
  const chunks = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > expectedBytes) {
        await reader.cancel("response exceeded verified artifact size");
        throw new Error(
          `production ${path} exceeded the verified artifact size`,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (receivedBytes !== expectedBytes) {
    throw new Error(
      `production ${path} length does not match the verified artifact`,
    );
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    receivedBytes,
  );
}

export async function verifyRemoteArtifacts({
  artifacts,
  cacheKey,
  fetchImpl = fetch,
}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new TypeError("remote verification requires local artifacts");
  }
  const results = [];
  for (const artifact of artifacts) {
    if (
      !REMOTE_ARTIFACT_PATHS.includes(artifact.path) ||
      !Buffer.isBuffer(artifact.contents)
    ) {
      throw new TypeError("remote verification received an invalid artifact");
    }
    // Cloudflare Pages canonically serves the entry document at the apex and
    // redirects /index.html, so verify its public route without relaxing the
    // no-redirect boundary used for every artifact request.
    const publicPath = artifact.path === "index.html" ? "/" : artifact.path;
    const url = new URL(publicPath, `${PRODUCTION_ORIGIN}/`);
    url.searchParams.set("verify", cacheKey);
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(
        `production ${artifact.path} returned HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get("content-type");
    const expectedContentType = artifactContentType(artifact.path);
    if (
      typeof contentType !== "string" ||
      contentType.toLowerCase().split(";", 1)[0].trim() !== expectedContentType
    ) {
      throw new Error(
        `production ${artifact.path} returned ${contentType ?? "no Content-Type"}; expected ${expectedContentType}`,
      );
    }
    const received = await readExactResponseBytes(
      response,
      artifact.contents.length,
      artifact.path,
    );
    const expectedDigest = sha256(artifact.contents);
    const receivedDigest = sha256(received);
    if (
      artifact.contents.length !== received.length ||
      expectedDigest !== receivedDigest
    ) {
      throw new Error(
        `production ${artifact.path} does not match the verified dist artifact`,
      );
    }
    results.push({
      bytes: received.length,
      cacheControl: response.headers.get("cache-control"),
      contentType,
      path: artifact.path,
      sha256: receivedDigest,
      status: response.status,
      url: url.href,
    });
  }
  return results;
}
