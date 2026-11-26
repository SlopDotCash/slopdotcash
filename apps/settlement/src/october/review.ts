// spec/settlement/octoberImport.md, "An apply run writes only under the reviewed digest, current main and the production lock"
import { createHash } from "node:crypto";
import { githubUserIdFromNodeId } from "@repo/backend/nodeId";

export const octoberPeriod = "2026-10";
export const octoberThrough = "2026-11-01T00:00:00.000Z";
export const octoberApprovedTermsDigest = "9f7fe96337fcede7ba6436ff2c526babc05709efc777989180d1fc12ef054136";

const octoberStart = "2026-10-01T00:00:00.000Z";
const octoberProjects = new Set(["eliza", "slopdotcash", "asi", "feed", "thenetwork"]);
const digestPattern = /^[a-f0-9]{64}$/u;
const numericActor = /^[1-9][0-9]{0,19}$/u;
const loginPattern = /^[A-Za-z0-9-]{1,39}$/u;
const evidenceKeys = ["census", "assessmentJournal", "pointsBatch", "attribution", "duplicateCredit", "protectedHistory", "eligibility"] as const;

export interface OctoberReviewedIdentity {
  readonly githubUserId: string;
  readonly githubNodeId: string;
  readonly login: string;
}

export interface OctoberReviewedWeight {
  readonly githubUserId: string;
  readonly acceptedWorkPoints: number;
  readonly eligible: boolean;
}

export interface OctoberProjectReview {
  readonly id: string;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly from: string;
  readonly reconciliation: "complete";
  readonly identities: readonly OctoberReviewedIdentity[];
  readonly weights: readonly OctoberReviewedWeight[];
}

export interface OctoberReviewedPacket {
  readonly reviewerGithubId: string;
  readonly producerGithubId: string;
  readonly reviewedAt: string;
  readonly enforcementGeneration: number;
  readonly evidence: Readonly<Record<(typeof evidenceKeys)[number], string>>;
  readonly projects: readonly OctoberProjectReview[];
}

function requireReview(holds: boolean, message: string): asserts holds {
  if (!holds) throw new Error(message);
}

function exactRow<T extends string>(value: unknown, keys: readonly T[], message: string): Record<T, unknown> {
  requireReview(typeof value === "object" && value !== null && !Array.isArray(value), message);
  const row = value as Record<T, unknown>;
  requireReview(Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)), message);
  return row;
}

function isActor(value: unknown): value is string {
  return typeof value === "string" && numericActor.test(value) && BigInt(value) <= (1n << 64n) - 1n;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function reviewedIdentity(input: unknown): OctoberReviewedIdentity {
  const row = exactRow(input, ["githubUserId", "githubNodeId", "login"], "Invalid reviewed identity.");
  const { githubUserId, githubNodeId, login } = row;
  requireReview(isActor(githubUserId) && typeof githubNodeId === "string" && typeof login === "string" && loginPattern.test(login), "Invalid reviewed identity.");
  requireReview(githubUserIdFromNodeId(githubNodeId).toString() === githubUserId, "Reviewed actor ID and node ID differ.");
  return { githubUserId, githubNodeId, login };
}

function reviewedWeight(input: unknown): OctoberReviewedWeight {
  const row = exactRow(input, ["githubUserId", "acceptedWorkPoints", "eligible"], "Invalid reviewed weight.");
  const { githubUserId, acceptedWorkPoints, eligible } = row;
  requireReview(isActor(githubUserId) && isCount(acceptedWorkPoints) && typeof eligible === "boolean", "Invalid reviewed weight.");
  return { githubUserId, acceptedWorkPoints, eligible };
}

function reviewedProject(input: unknown): OctoberProjectReview {
  const row = exactRow(input, ["id", "revision", "manifestSha256", "from", "reconciliation", "identities", "weights"], "Invalid reviewed project.");
  const { id, revision, manifestSha256, from, reconciliation } = row;
  requireReview(typeof id === "string" && octoberProjects.has(id) && isCount(revision) && revision > 0 && isDigest(manifestSha256), "Invalid reviewed project binding.");
  requireReview(isDate(from) && from >= octoberStart && from < octoberThrough && reconciliation === "complete", "October review is incomplete.");
  requireReview(Array.isArray(row.identities) && Array.isArray(row.weights), "Reviewed identities or weights are invalid.");
  const identities = row.identities.map(reviewedIdentity);
  const weights = row.weights.map(reviewedWeight);
  const known = new Set(identities.map(({ githubUserId }) => githubUserId));
  const weighted = new Set(weights.map(({ githubUserId }) => githubUserId));
  requireReview(known.size === identities.length && weighted.size === weights.length && known.size === weighted.size &&
    weights.every(({ githubUserId }) => known.has(githubUserId)), "October weights need one disposition per reviewed identity.");
  requireReview(weights.some(({ acceptedWorkPoints, eligible }) => eligible && acceptedWorkPoints > 0), "October has no reviewed positive eligible weight.");
  return { id, revision, manifestSha256, from, reconciliation, identities, weights };
}

export function decodeOctoberReviewedPacket(bytes: Uint8Array, reviewedDigest: string): OctoberReviewedPacket {
  requireReview(isDigest(reviewedDigest) && createHash("sha256").update(bytes).digest("hex") === reviewedDigest, "October reviewed packet digest differs.");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("October reviewed packet is not UTF-8 JSON.");
  }
  const fields = ["schemaVersion", "kind", "period", "through", "approvedTermsSha256", "producerGithubId",
    "reviewerGithubId", "reviewedAt", "enforcementGeneration", "evidence", "projects"] as const;
  const row = exactRow(raw, fields, "Unexpected October reviewed packet fields.");
  requireReview(row.schemaVersion === "1" && row.kind === "reconciled-october-accepted-work" && row.period === octoberPeriod &&
    row.through === octoberThrough && row.approvedTermsSha256 === octoberApprovedTermsDigest, "October packet does not bind approved terms and the complete month.");
  const { producerGithubId, reviewerGithubId, reviewedAt, enforcementGeneration } = row;
  requireReview(isActor(producerGithubId) && isActor(reviewerGithubId) && isDate(reviewedAt) && reviewedAt >= "2026-11-14" &&
    isCount(enforcementGeneration), "October packet review identity or checkpoint is invalid.");
  const evidence = exactRow(row.evidence, evidenceKeys, "October packet lacks the reviewed evidence bindings.");
  requireReview(Object.values(evidence).every(isDigest), "October packet has an invalid evidence digest.");
  requireReview(Array.isArray(row.projects) && row.projects.length > 0, "October packet chooses no approved project.");
  const projects = row.projects.map(reviewedProject);
  requireReview(new Set(projects.map(({ id }) => id)).size === projects.length, "October packet repeats a project.");
  return { producerGithubId, reviewerGithubId, reviewedAt, enforcementGeneration,
    evidence: evidence as OctoberReviewedPacket["evidence"], projects };
}

export interface OctoberObservedWeight {
  readonly githubNodeId: string;
  readonly acceptedWorkPoints: number;
}

export function assertOctoberReviewedWeights(
  project: OctoberProjectReview,
  expected: ReadonlyMap<string, OctoberObservedWeight>,
  known: ReadonlyMap<string, string>,
  eligible: ReadonlySet<string>,
): void {
  const identities = new Map(project.identities.map(({ githubUserId, githubNodeId }) => [githubUserId, githubNodeId]));
  const visited = new Set<string>();
  for (const row of project.weights) {
    const archived = expected.get(row.githubUserId);
    const identity = identities.get(row.githubUserId);
    requireReview((archived !== undefined && archived.githubNodeId === identity && archived.acceptedWorkPoints === row.acceptedWorkPoints) ||
      (archived === undefined && row.acceptedWorkPoints === 0 && identity !== undefined && known.get(row.githubUserId) === identity),
    "October weights differ from canonical Points.");
    requireReview(row.eligible === eligible.has(row.githubUserId), "October eligibility changed after review.");
    visited.add(row.githubUserId);
  }
  requireReview([...expected.keys()].every((id) => visited.has(id)), "October weight review omits a contributor.");
}
