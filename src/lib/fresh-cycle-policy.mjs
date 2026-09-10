/** Optional exact-cycle activation contract. Runtime readiness and canonical reservation remain mandatory. */
export function assertFreshCyclePaymentPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Missing reviewed fresh-cycle policy");
  const keys =
    "cycleId,effectiveAt,feeRecipient,instrumentSha256,kind,planningExpiresAt,projectId,schemaVersion";
  const utc = (v) =>
    typeof v === "string" &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v;
  if (
    Object.keys(value).sort().join() !== keys ||
    value.schemaVersion !== "1" ||
    value.kind !== "fresh-cycle-payment-policy" ||
    typeof value.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(value.projectId) ||
    typeof value.cycleId !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(value.cycleId) ||
    typeof value.instrumentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.instrumentSha256) ||
    typeof value.feeRecipient !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value.feeRecipient) ||
    !utc(value.effectiveAt) ||
    !utc(value.planningExpiresAt) ||
    value.effectiveAt >= value.planningExpiresAt
  )
    throw new TypeError("Invalid fresh-cycle payment policy");
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    projectId: value.projectId,
    cycleId: value.cycleId,
    effectiveAt: value.effectiveAt,
    planningExpiresAt: value.planningExpiresAt,
    instrumentSha256: value.instrumentSha256,
    feeRecipient: value.feeRecipient,
  };
}
