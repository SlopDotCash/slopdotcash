/** Verifies the immutable namespace and snapshot boundary for Slop writers. */

import { describe, expect, it } from "vitest";
import { validateIdentityRecord } from "./protocol-identity.mjs";

function fixture() {
  return {
    schemaVersion: "1",
    identityVersion: "slop-identity-v1",
    activatedAt: "2026-08-14T05:00:00.000Z",
    activationCode: { commit: "a".repeat(40), tree: "b".repeat(40) },
    legacySnapshot: {
      url: "https://slop.cash/data/leaderboard.json",
      sha256: "c".repeat(64),
      deploymentCommit: "d".repeat(40),
      ruleVersion: "gitarmy-v1",
      generatedAt: "2026-08-13T23:05:05.385Z",
      sourceUpdatedAt: "2026-08-13T23:04:28.000Z",
      sourceCutoff: "2026-08-13T23:02:26.000Z",
    },
    finalAcceptedLegacyReleaseLabelEvent: null,
    identifiers: {
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
      walletMarker: {
        legacy: "gitarmy-wallet:v1",
        slop: "slop-wallet:v1",
      },
    },
    paymentMode: "disabled",
  };
}

describe("protocol identity", () => {
  it("accepts only the exact no-payment Slop namespace boundary", () => {
    expect(validateIdentityRecord(fixture())).toEqual(fixture());
    const wrong = fixture();
    wrong.identifiers.walletMarker.slop = "gitarmy-wallet:v1";
    expect(() => validateIdentityRecord(wrong)).toThrow(/identifiers/u);
    const enabled = fixture();
    enabled.paymentMode = "enabled";
    expect(() => validateIdentityRecord(enabled)).toThrow(/disabled payments/u);
  });
});
