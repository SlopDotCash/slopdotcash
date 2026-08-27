export const PRIVATE_INTAKE_ATTESTATION_PATH =
  "/data/private-intake-attestation.json";
export const PRIVATE_INTAKE_ATTESTATION_MAX_AGE_MS = 7 * 60 * 60 * 1000;

export type PrivateIntakeAttestation = {
  enabled: true;
  source: "github-public-status";
  verifiedAt: string;
  revision: string;
};

export type DisabledPrivateIntakeAttestation = {
  enabled: false;
  source: "build-unverified";
  verifiedAt: null;
  revision: null;
};

export function parsePrivateIntakeAttestation(
  value: unknown,
  now = new Date(),
): PrivateIntakeAttestation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
      JSON.stringify(["enabled", "revision", "source", "verifiedAt"]) ||
    record.enabled !== true ||
    record.source !== "github-public-status" ||
    typeof record.verifiedAt !== "string" ||
    typeof record.revision !== "string" ||
    !/^[0-9a-f]{40}$/u.test(record.revision)
  ) {
    return null;
  }
  const verifiedAt = Date.parse(record.verifiedAt);
  const age = now.getTime() - verifiedAt;
  if (
    !Number.isFinite(verifiedAt) ||
    age < -5 * 60 * 1000 ||
    age > PRIVATE_INTAKE_ATTESTATION_MAX_AGE_MS
  ) {
    return null;
  }
  return record as PrivateIntakeAttestation;
}

export function isDisabledPrivateIntakeAttestation(
  value: unknown,
): value is DisabledPrivateIntakeAttestation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    JSON.stringify(Object.keys(record).sort()) ===
      JSON.stringify(["enabled", "revision", "source", "verifiedAt"]) &&
    record.enabled === false &&
    record.source === "build-unverified" &&
    record.verifiedAt === null &&
    record.revision === null
  );
}
