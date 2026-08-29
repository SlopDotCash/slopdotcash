/** Exercises watchdog decisions against the production attestation time contract. */

import { describe, expect, it } from "vitest";
import { checkPrivateIntakeFreshness } from "./check-private-intake-freshness.mjs";

const NOW = Date.parse("2026-08-29T02:00:00.000Z");
const REVISION = "a".repeat(40);

function attestation(verifiedAt) {
  return {
    enabled: true,
    source: "github-public-status",
    verifiedAt: new Date(verifiedAt).toISOString(),
    revision: REVISION,
  };
}

describe("private intake freshness watchdog", () => {
  it("accepts a current attestation outside the renewal window", () => {
    expect(checkPrivateIntakeFreshness(attestation(NOW - 60_000), NOW)).toEqual(
      {
        status: "safe",
        expiresAt: "2026-08-29T08:59:00.000Z",
      },
    );
  });

  it("requires renewal at the 90-minute boundary and after expiry", () => {
    expect(
      checkPrivateIntakeFreshness(
        attestation(NOW - (7 * 60 - 90) * 60_000),
        NOW,
      ).status,
    ).toBe("renew");
    expect(
      checkPrivateIntakeFreshness(attestation(NOW - 7 * 60 * 60_000), NOW)
        .status,
    ).toBe("renew");
  });

  it("rejects timestamps beyond the production five-minute future skew", () => {
    expect(
      checkPrivateIntakeFreshness(attestation(NOW + 5 * 60_000), NOW).status,
    ).toBe("safe");
    expect(
      checkPrivateIntakeFreshness(attestation(NOW + 5 * 60_000 + 1), NOW)
        .status,
    ).toBe("invalid");
  });

  it("rejects malformed, stale, and extra-field attestations", () => {
    expect(checkPrivateIntakeFreshness({}, NOW).status).toBe("invalid");
    expect(
      checkPrivateIntakeFreshness(attestation(NOW - 7 * 60 * 60_000 - 1), NOW)
        .status,
    ).toBe("invalid");
    expect(
      checkPrivateIntakeFreshness(
        { ...attestation(NOW), unexpected: true },
        NOW,
      ).status,
    ).toBe("invalid");
  });
});
