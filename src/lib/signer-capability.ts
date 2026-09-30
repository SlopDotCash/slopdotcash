/** Public signer reports are evidence, not backing or payment authorization. */
import {
  PROJECT_VAULT_INSTRUMENT_PREFIX,
  planCarriesPlatformFee,
} from "./settlement-plan";

/**
 * Who attests on each instrument kind. On the 2-of-2 both members must be
 * current because either loss strands the vault. On a 2-of-3 project vault
 * (RFC #500) the creator must be current because only the creator can write
 * a proposal, and the independent signer must be current so that a release
 * never depends on Slop's vote. Slop's vote-only key is outside this protocol:
 * it is never necessary for a release and adds no capability to any other
 * member, so it neither attests nor blocks. Its loss is reported publicly and
 * followed by a reviewed signer swap (protocol/project-vault-signing.md).
 */
export type SignerRole = "funder" | "steward" | "creator" | "independent";
export const TWO_OF_TWO_SIGNER_ROLES = Object.freeze([
  "funder",
  "steward",
] as const);
export const PROJECT_VAULT_SIGNER_ROLES = Object.freeze([
  "creator",
  "independent",
] as const);
export type SignerCapabilityStatus =
  | "inaccessible"
  | "unknown"
  | "both-signers-current"
  | "creator-and-independent-current";

export interface PublicSignerReport {
  projectId: string;
  cycleId: string;
  instrumentId: string;
  role: SignerRole;
  /** The key the report is about. For the creator seat of a project vault a
   * capability report names the attesting creator-multisig key, because the
   * seat itself is a program address that cannot sign; a loss report names
   * the seat. */
  member: string;
  capability: "can-sign" | "lost-access";
  reportedAt: string;
  expiresAt: string | null;
  reason: string;
  sourceRepository: string;
  sourceCommit: string;
}

const INSTRUMENT_ID =
  /^squads-(?:v4|project)-vault:solana:[1-9A-HJ-NP-Za-km-z]{32,44}:(?:0|[1-9][0-9]*):[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

export function isProjectVaultSignerInstrument(instrumentId: string): boolean {
  return instrumentId.startsWith(PROJECT_VAULT_INSTRUMENT_PREFIX);
}

/** The roles that must all be current before a plan may be released. */
export function requiredSignerRoles(
  instrumentId: string,
): readonly SignerRole[] {
  return planCarriesPlatformFee(instrumentId)
    ? TWO_OF_TWO_SIGNER_ROLES
    : PROJECT_VAULT_SIGNER_ROLES;
}

export function currentSignerStatus(
  instrumentId: string,
): "both-signers-current" | "creator-and-independent-current" {
  return isProjectVaultSignerInstrument(instrumentId)
    ? "creator-and-independent-current"
    : "both-signers-current";
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
      "capability,cycleId,expiresAt,instrumentId,member,projectId,reason,reportedAt,role,sourceCommit,sourceRepository" ||
    typeof r.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(r.projectId) ||
    typeof r.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(r.cycleId) ||
    typeof r.instrumentId !== "string" ||
    !INSTRUMENT_ID.test(r.instrumentId) ||
    typeof r.role !== "string" ||
    !(requiredSignerRoles(r.instrumentId) as readonly string[]).includes(
      r.role,
    ) ||
    typeof r.member !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(r.member) ||
    (r.capability !== "can-sign" && r.capability !== "lost-access") ||
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
    member,
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
    member,
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
): SignerCapabilityStatus {
  if (!Number.isFinite(now))
    throw new TypeError("Invalid signer evaluation time");
  const identities = new Set(
    reports.map((r) => `${r.projectId}:${r.cycleId}:${r.instrumentId}`),
  );
  if (identities.size > 1)
    throw new TypeError("Signer status requires one exact monthly instrument");
  if (
    reports.some(
      (r) => r.capability === "lost-access" && Date.parse(r.reportedAt) <= now,
    )
  )
    return "inaccessible";
  if (reports.some((r) => Date.parse(r.reportedAt) > now)) return "unknown";
  if (reports.length === 0) return "unknown";
  const instrumentId = reports[0].instrumentId;
  return requiredSignerRoles(instrumentId).every((role) =>
    reports.some(
      (r) =>
        r.role === role &&
        r.capability === "can-sign" &&
        r.expiresAt !== null &&
        Date.parse(r.expiresAt) > now,
    ),
  )
    ? currentSignerStatus(instrumentId)
    : "unknown";
}
