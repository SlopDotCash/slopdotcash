#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

function rawUrl(value) {
  const parsed = new URL(value);
  const match = parsed.pathname.match(
    /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/(.+)$/u,
  );
  return match
    ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`
    : value;
}

async function verifiedBytes(url, expected, field) {
  const source = rawUrl(url);
  let bytes;
  if (source.startsWith("file://")) {
    bytes = await readFile(fileURLToPath(source));
  } else {
    const response = await fetch(source, {
      headers: { accept: "application/octet-stream" },
      redirect: "error",
    });
    if (!response.ok) fail(`${field} could not be fetched`);
    bytes = Buffer.from(await response.arrayBuffer());
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
    policy = JSON.parse(await readFile(fileURLToPath(policyUrl), "utf8"));
  } else {
    const response = await fetch(policyUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) fail("project terms could not be fetched");
    policy = await response.json();
  }
  exact(
    policy,
    ["authority", "projectId", "schemaVersion", "status", "steward", "terms"],
    "project policy",
  );
  if (policy.schemaVersion !== "1" || policy.projectId !== projectId) {
    fail("project policy identity is invalid");
  }
  if (policy.status !== "active" || policy.authority?.state !== "verified") {
    fail("new runs are paused until repository authority is verified");
  }
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
  if (policy.terms?.inbound?.mode === "unknown") {
    fail("mandatory inbound terms are unknown");
  }
  if (policy.terms?.repositoryLicense?.state !== "verified") {
    fail("mandatory repository license is unknown");
  }
  if (
    policy.terms?.externalPrize &&
    (policy.terms.externalPrize.version === "unknown" ||
      !policy.terms.externalPrize.rulesSha256)
  ) {
    fail("external prize rules are not immutably verified");
  }
  await verifiedBytes(
    policy.terms.repositoryLicense.url,
    policy.terms.repositoryLicense.fileSha256,
    "LICENSE",
  );
  if (policy.terms.inbound.fileSha256) {
    await verifiedBytes(
      policy.terms.inbound.termsUrl,
      policy.terms.inbound.fileSha256,
      "inbound terms",
    );
  }
  if (policy.terms.externalPrize?.rulesSha256) {
    await verifiedBytes(
      policy.terms.externalPrize.rulesUrl,
      policy.terms.externalPrize.rulesSha256,
      "prize rules",
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
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
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
        `Terms verified: ${acknowledgement.policyRevision} · license ${acknowledgement.licenseSha256.slice(0, 12)} · acknowledgement recorded\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `project terms preflight failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
