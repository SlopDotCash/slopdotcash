/**
 * Validates the append-only boundary between historical Army identifiers and
 * Slop writers. The record names immutable code and snapshot bytes so a domain
 * redirect or repository rename can never silently redefine old artifacts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EXPECTED_IDENTIFIERS = {
  contributionMarker: {
    legacy: [
      "eliza-computer-attribution:v1",
      "elizaos-contribution-attribution:v1",
      "elizaos-contribution-attribution:v2",
    ],
    slop: "slop-contribution-attribution:v1",
  },
  installerAuthorization: {
    legacy: ".gitarmy-authorization.json@elizaOS/army",
    slop: ".slop-authorization.json@SlopDotCash/slopdotcash",
  },
  localRunState: { legacy: "gitarmy", slop: "slop" },
  releaseLabel: {
    legacy: "gitarmy-release-candidate",
    slop: "slop-release-candidate",
  },
  reviewFence: { legacy: "gitarmy-review", slop: "slop-review" },
  scoreRule: { legacy: "gitarmy-v1", slop: "slop-score-v1" },
  sourceRepository: {
    legacy: "elizaOS/army",
    slop: "SlopDotCash/slopdotcash",
  },
  walletMarker: { legacy: "gitarmy-wallet:v1", slop: "slop-wallet:v1" },
};

function exactKeys(value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    throw new TypeError(`${field} has unexpected fields`);
  }
}

function iso(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} must be a canonical UTC timestamp`);
  }
}

function equalJson(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${field} does not match slop-identity-v1`);
  }
}

export function validateIdentityRecord(value) {
  exactKeys(
    value,
    [
      "activatedAt",
      "activationCode",
      "finalAcceptedLegacyReleaseLabelEvent",
      "identifiers",
      "identityVersion",
      "legacySnapshot",
      "paymentMode",
      "schemaVersion",
    ],
    "identity record",
  );
  if (value.schemaVersion !== "1") {
    throw new TypeError("identity record schemaVersion is invalid");
  }
  if (value.identityVersion !== "slop-identity-v1") {
    throw new TypeError("identity record identityVersion is invalid");
  }
  iso(value.activatedAt, "identity record activatedAt");
  exactKeys(value.activationCode, ["commit", "tree"], "activationCode");
  if (!SHA1.test(value.activationCode.commit)) {
    throw new TypeError("activationCode.commit is invalid");
  }
  if (!SHA1.test(value.activationCode.tree)) {
    throw new TypeError("activationCode.tree is invalid");
  }
  exactKeys(
    value.legacySnapshot,
    [
      "deploymentCommit",
      "generatedAt",
      "ruleVersion",
      "sha256",
      "sourceCutoff",
      "sourceUpdatedAt",
      "url",
    ],
    "legacySnapshot",
  );
  if (!SHA1.test(value.legacySnapshot.deploymentCommit)) {
    throw new TypeError("legacySnapshot.deploymentCommit is invalid");
  }
  if (!SHA256.test(value.legacySnapshot.sha256)) {
    throw new TypeError("legacySnapshot.sha256 is invalid");
  }
  if (
    value.legacySnapshot.url !== "https://slop.cash/data/leaderboard.json" ||
    value.legacySnapshot.ruleVersion !== "gitarmy-v1"
  ) {
    throw new TypeError("legacySnapshot authority is invalid");
  }
  iso(value.legacySnapshot.generatedAt, "legacySnapshot.generatedAt");
  iso(value.legacySnapshot.sourceUpdatedAt, "legacySnapshot.sourceUpdatedAt");
  iso(value.legacySnapshot.sourceCutoff, "legacySnapshot.sourceCutoff");
  if (value.finalAcceptedLegacyReleaseLabelEvent !== null) {
    throw new TypeError(
      "slop-identity-v1 records no accepted legacy release-label event",
    );
  }
  equalJson(value.identifiers, EXPECTED_IDENTIFIERS, "identifiers");
  if (value.paymentMode !== "disabled") {
    throw new TypeError("identity activation requires disabled payments");
  }
  return value;
}

export function readIdentityRecord(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new TypeError("identity record is not valid JSON", { cause });
  }
  return validateIdentityRecord(value);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  readIdentityRecord(resolve(root, "protocol", "identity-v1.json"));
  process.stdout.write("[Slop] protocol identity record is valid\n");
}
