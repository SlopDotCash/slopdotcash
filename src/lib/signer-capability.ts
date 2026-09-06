/** Public signer reports are evidence, not backing or payment authorization. */
export interface PublicSignerReport {
  projectId: string;
  cycleId: string;
  instrumentId: string;
  role: "funder" | "steward";
  capability: "can-sign" | "lost-access";
  reportedAt: string;
  expiresAt: string | null;
  reason: string;
  sourceRepository: string;
  sourceCommit: string;
}

function time(value: unknown): number {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Signer report time must be canonical UTC");
  return Date.parse(value);
}

export function assertPublicSignerReport(value: unknown): PublicSignerReport {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid public signer report");
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(",") !==
      "capability,cycleId,expiresAt,instrumentId,projectId,reason,reportedAt,role,sourceCommit,sourceRepository" ||
    typeof r.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(r.projectId) ||
    typeof r.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(r.cycleId) ||
    typeof r.instrumentId !== "string" ||
    !/^squads-v4-vault:solana:[1-9A-HJ-NP-Za-km-z]{32,44}:(?:0|[1-9][0-9]*):[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(
      r.instrumentId,
    ) ||
    !["funder", "steward"].includes(String(r.role)) ||
    !["can-sign", "lost-access"].includes(String(r.capability)) ||
    typeof r.reason !== "string" ||
    r.reason.trim() !== r.reason ||
    r.reason.length < 1 ||
    r.reason.length > 500 ||
    [...r.reason].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    typeof r.sourceRepository !== "string" ||
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(
      r.sourceRepository,
    ) ||
    typeof r.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(r.sourceCommit)
  )
    throw new TypeError("Invalid public signer report");
  const reported = time(r.reportedAt);
  if (r.capability === "lost-access") {
    if (r.expiresAt !== null) throw new TypeError("Loss cannot expire");
  } else if (
    time(r.expiresAt) <= reported ||
    time(r.expiresAt) - reported > 86400000
  )
    throw new TypeError("Signer capability lifetime exceeds its bound");
  return { ...r } as unknown as PublicSignerReport;
}

export function publicSignerReport(
  report: PublicSignerReport,
): PublicSignerReport {
  const {
    projectId,
    cycleId,
    instrumentId,
    role,
    capability,
    reportedAt,
    expiresAt,
    reason,
    sourceRepository,
    sourceCommit,
  } = report;
  return assertPublicSignerReport({
    projectId,
    cycleId,
    instrumentId,
    role,
    capability,
    reportedAt,
    expiresAt,
    reason,
    sourceRepository,
    sourceCommit,
  });
}

export function publicSignerStatus(
  reports: readonly PublicSignerReport[],
  now: number,
) {
  if (!Number.isFinite(now))
    throw new TypeError("Invalid signer evaluation time");
  if (
    new Set(reports.map((r) => `${r.projectId}:${r.cycleId}:${r.instrumentId}`))
      .size > 1
  )
    throw new TypeError("Signer status requires one exact monthly instrument");
  if (
    reports.some(
      (r) => r.capability === "lost-access" && Date.parse(r.reportedAt) <= now,
    )
  )
    return "inaccessible" as const;
  if (reports.some((r) => Date.parse(r.reportedAt) > now))
    return "unknown" as const;
  return (["funder", "steward"] as const).every((role) =>
    reports.some(
      (r) =>
        r.role === role &&
        r.capability === "can-sign" &&
        r.expiresAt !== null &&
        Date.parse(r.expiresAt) > now,
    ),
  )
    ? ("both-signers-current" as const)
    : ("unknown" as const);
}
