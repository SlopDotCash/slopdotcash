#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const solanaDirectory = fileURLToPath(
  new URL("../contracts/solana/", import.meta.url),
);
const lockfile = JSON.parse(
  readFileSync(
    new URL("../contracts/solana/package-lock.json", import.meta.url),
    "utf8",
  ),
);

// Anchor parses only the repository-owned Anchor.toml in this CI job. It does
// not accept TOML from users, RPC responses, artifacts, or workflow inputs.
// SPL Token reaches bigint-buffer only through repository-owned test values;
// this job exposes no service or caller-controlled buffer conversion.
const advisoryExceptions = new Map(
  [
    ["GHSA-82x6-q7mm-w9cf", "toml", "<4.2.0", "3.0.0"],
    ["GHSA-v5mp-jgw5-2x6j", "toml", "<4.1.2", "3.0.0"],
    ["GHSA-4qx8-w7c3-pj3p", "toml", "<=5.0.0", "3.0.0"],
    ["GHSA-9j65-hcg3-gc64", "toml", "<=5.0.0", "3.0.0"],
    ["GHSA-9qmh-m7c6-f92p", "toml", "<=5.0.0", "3.0.0"],
    ["GHSA-3gc7-fjrx-p6mg", "bigint-buffer", "<=1.1.5", "1.1.5"],
  ].map(([id, packageName, affectedRange, lockedVersion]) => [
    id,
    {
      packageName,
      affectedRange,
      lockedVersion,
      expiresAt: "2026-12-01T00:00:00Z",
    },
  ]),
);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCountRecord(value, keys) {
  return (
    isRecord(value) &&
    keys.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
  );
}

function fail(message) {
  throw new Error(`Invalid npm audit result: ${message}`);
}

const severityRanks = new Map([
  ["info", 0],
  ["low", 1],
  ["moderate", 2],
  ["high", 3],
  ["critical", 4],
]);

function validateReport(report) {
  if (!isRecord(report)) fail("report schema is not an object");
  if (Object.hasOwn(report, "error")) fail("npm returned an error report");
  if (report.auditReportVersion !== 2)
    fail("unsupported or missing schema version");
  if (!isRecord(report.metadata)) fail("missing metadata schema");
  if (
    !isCountRecord(report.metadata.vulnerabilities, [
      "info",
      "low",
      "moderate",
      "high",
      "critical",
      "total",
    ]) ||
    !isCountRecord(report.metadata.dependencies, [
      "prod",
      "dev",
      "optional",
      "peer",
      "peerOptional",
      "total",
    ])
  ) {
    fail("missing or malformed metadata counts");
  }
  if (!isRecord(report.vulnerabilities)) fail("missing vulnerabilities result");

  const derivedCounts = Object.fromEntries(
    [...severityRanks.keys()].map((severity) => [severity, 0]),
  );

  for (const [packageName, vulnerability] of Object.entries(
    report.vulnerabilities,
  )) {
    if (
      !isRecord(vulnerability) ||
      vulnerability.name !== packageName ||
      !severityRanks.has(vulnerability.severity) ||
      !Array.isArray(vulnerability.via)
    ) {
      fail(`malformed vulnerability result for ${packageName}`);
    }
    if (vulnerability.via.length === 0) {
      fail(`vulnerability result for ${packageName} has no causes`);
    }
  }

  const resolutionState = new Map();
  const resolvedSeverities = new Map();
  function resolveVulnerability(packageName) {
    if (resolutionState.get(packageName) === "visiting") {
      fail(`cyclic vulnerability reference for ${packageName}`);
    }
    if (resolutionState.get(packageName) === "resolved") {
      return resolvedSeverities.get(packageName);
    }

    const vulnerability = report.vulnerabilities[packageName];
    if (!isRecord(vulnerability)) {
      fail(`malformed vulnerability reference for ${packageName}`);
    }

    resolutionState.set(packageName, "visiting");
    let derivedSeverityRank = -1;
    let hasAdvisory = false;
    for (const advisory of vulnerability.via) {
      if (typeof advisory === "string") {
        const cause = report.vulnerabilities[advisory];
        if (!isRecord(cause) || !severityRanks.has(cause.severity)) {
          fail(`malformed vulnerability reference for ${packageName}`);
        }
        const resolution = resolveVulnerability(advisory);
        derivedSeverityRank = Math.max(
          derivedSeverityRank,
          resolution.severityRank,
        );
        hasAdvisory ||= resolution.hasAdvisory;
        continue;
      }
      if (
        !isRecord(advisory) ||
        advisory.name !== packageName ||
        advisory.dependency !== packageName ||
        typeof advisory.title !== "string" ||
        typeof advisory.url !== "string" ||
        !severityRanks.has(advisory.severity) ||
        typeof advisory.range !== "string"
      ) {
        fail(`malformed advisory result for ${packageName}`);
      }
      derivedSeverityRank = Math.max(
        derivedSeverityRank,
        severityRanks.get(advisory.severity),
      );
      hasAdvisory = true;
    }
    if (!hasAdvisory) {
      fail(`vulnerability chain for ${packageName} has no advisory`);
    }
    if (severityRanks.get(vulnerability.severity) !== derivedSeverityRank) {
      fail(`severity does not match causes for ${packageName}`);
    }

    const resolution = { severityRank: derivedSeverityRank, hasAdvisory };
    resolvedSeverities.set(packageName, resolution);
    resolutionState.set(packageName, "resolved");
    return resolution;
  }

  for (const [packageName, vulnerability] of Object.entries(
    report.vulnerabilities,
  )) {
    resolveVulnerability(packageName);
    derivedCounts[vulnerability.severity]++;
  }

  const declaredCounts = report.metadata.vulnerabilities;
  const declaredTotal = [...severityRanks.keys()].reduce(
    (total, severity) => total + declaredCounts[severity],
    0,
  );
  if (declaredCounts.total !== declaredTotal) {
    fail("vulnerability total does not match severity counts");
  }
  const derivedTotal = Object.keys(report.vulnerabilities).length;
  if (
    declaredCounts.total !== derivedTotal ||
    [...severityRanks.keys()].some(
      (severity) => declaredCounts[severity] !== derivedCounts[severity],
    )
  ) {
    fail("vulnerability counts do not match vulnerability results");
  }
}

const audit = spawnSync(
  "npm",
  ["audit", "--package-lock-only", "--ignore-scripts", "--json"],
  { cwd: solanaDirectory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (audit.error) throw audit.error;
if (audit.status !== 0 && audit.status !== 1) {
  process.stderr.write(audit.stderr);
  process.exit(audit.status ?? 1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr);
  throw new Error("npm audit did not return valid JSON");
}
validateReport(report);

const blocking = [];
const now = Date.now();
for (const vulnerability of Object.values(report.vulnerabilities)) {
  for (const advisory of vulnerability.via) {
    if (typeof advisory === "string") continue;
    if (advisory.severity !== "high" && advisory.severity !== "critical")
      continue;

    let id;
    try {
      const url = new URL(advisory.url);
      const pathMatch =
        /^\/advisories\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/u.exec(
          url.pathname,
        );
      if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.port !== "" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        pathMatch === null ||
        advisory.url !== `https://github.com/advisories/${pathMatch[1]}`
      ) {
        fail(`unexpected advisory URL ${advisory.url}`);
      }
      id = pathMatch[1];
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Invalid npm audit result:")
      )
        throw error;
      fail(`malformed advisory URL ${advisory.url}`);
    }

    const exception = advisoryExceptions.get(id);
    if (!exception) {
      blocking.push(`${id ?? advisory.url}: ${advisory.title}`);
      continue;
    }
    const expiresAt = Date.parse(exception.expiresAt);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(exception.expiresAt) ||
      !Number.isFinite(expiresAt)
    ) {
      blocking.push(`${id}: advisory exception has an invalid UTC expiry`);
      continue;
    }
    if (expiresAt <= now) {
      blocking.push(
        `${id}: advisory exception expired at ${exception.expiresAt}`,
      );
      continue;
    }
    if (
      advisory.dependency !== exception.packageName ||
      advisory.range !== exception.affectedRange
    ) {
      blocking.push(
        `${id}: advisory package or affected range no longer matches`,
      );
      continue;
    }
    const lockedVersion =
      lockfile.packages?.[`node_modules/${exception.packageName}`]?.version;
    if (lockedVersion !== exception.lockedVersion) {
      blocking.push(
        `${id}: locked version ${lockedVersion ?? "missing"} does not match exception ${exception.lockedVersion}`,
      );
    }
  }
}

if (blocking.length > 0) {
  console.error(
    "Unallowlisted, expired, or changed high/critical Solana npm advisories:",
  );
  for (const finding of blocking) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(
  `Solana npm audit passed; ${advisoryExceptions.size} exact advisory exceptions remain valid.`,
);
