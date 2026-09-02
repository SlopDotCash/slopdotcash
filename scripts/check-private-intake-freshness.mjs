/** Validates the deployed private-intake attestation before its API gate expires. */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_AGE_MS = 49 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
// One six-hour scheduled refresh plus three hours of approval slack, so at
// least one reviewed run lands inside the window before expiry.
const RENEWAL_WINDOW_MS = 9 * 60 * 60 * 1000;

export function checkPrivateIntakeFreshness(value, now = Date.now()) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["enabled", "revision", "source", "verifiedAt"]) ||
    value.enabled !== true ||
    value.source !== "github-public-status" ||
    typeof value.verifiedAt !== "string" ||
    typeof value.revision !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.revision)
  ) {
    return { status: "invalid" };
  }

  const verifiedAt = Date.parse(value.verifiedAt);
  const age = now - verifiedAt;
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(now) ||
    age < -MAX_FUTURE_SKEW_MS ||
    age > MAX_AGE_MS
  ) {
    return { status: "invalid" };
  }

  const expiresAt = verifiedAt + MAX_AGE_MS;
  if (expiresAt - now <= RENEWAL_WINDOW_MS) {
    return { status: "renew", expiresAt: new Date(expiresAt).toISOString() };
  }
  return { status: "safe", expiresAt: new Date(expiresAt).toISOString() };
}

function main([path, approvalUrl, recoveryUrl]) {
  if (!path || !approvalUrl || !recoveryUrl) {
    throw new Error(
      "Usage: check-private-intake-freshness.mjs <attestation> <approval-url> <recovery-url>",
    );
  }
  const result = checkPrivateIntakeFreshness(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (result.status === "invalid") {
    console.error(
      `::error title=Private intake attestation invalid::Approve a fresh trusted deployment: ${approvalUrl}. Recovery procedure: ${recoveryUrl}`,
    );
    process.exitCode = 1;
    return;
  }
  if (result.status === "renew") {
    console.error(
      `::error title=Private intake renewal required::The deployed attestation expires at ${result.expiresAt}. Approve the newest trusted deployment now: ${approvalUrl}. If the designated reviewer is unavailable, follow: ${recoveryUrl}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Private intake attestation is safe until ${result.expiresAt}.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
