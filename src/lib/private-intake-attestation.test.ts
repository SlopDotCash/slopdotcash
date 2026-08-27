import { describe, expect, it } from "vitest";
import {
  isDisabledPrivateIntakeAttestation,
  PRIVATE_INTAKE_ATTESTATION_MAX_AGE_MS,
  parsePrivateIntakeAttestation,
} from "./private-intake-attestation";

const NOW = new Date("2026-08-27T08:00:00.000Z");
const REVISION = "a".repeat(40);

describe("private intake build attestation", () => {
  it("accepts only a fresh exact GitHub public-status attestation", () => {
    expect(
      parsePrivateIntakeAttestation(
        {
          enabled: true,
          source: "github-public-status",
          verifiedAt: NOW.toISOString(),
          revision: REVISION,
        },
        NOW,
      ),
    ).toEqual({
      enabled: true,
      source: "github-public-status",
      verifiedAt: NOW.toISOString(),
      revision: REVISION,
    });
    expect(
      parsePrivateIntakeAttestation(
        {
          enabled: true,
          source: "github-public-status",
          verifiedAt: new Date(
            NOW.getTime() - PRIVATE_INTAKE_ATTESTATION_MAX_AGE_MS - 1,
          ).toISOString(),
          revision: REVISION,
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("recognizes only the explicit fail-closed local placeholder", () => {
    expect(
      isDisabledPrivateIntakeAttestation({
        enabled: false,
        source: "build-unverified",
        verifiedAt: null,
        revision: null,
      }),
    ).toBe(true);
    expect(
      isDisabledPrivateIntakeAttestation({
        enabled: false,
        source: "github-public-status",
        verifiedAt: null,
        revision: null,
      }),
    ).toBe(false);
  });
});
