/** Advisory, source-bound outcome calculations. Never establishes approval. */
import { exactRecord, type FundingPreparation } from "./funding-review-data";

export const QUALITY_TIERS = {
  micro: 1,
  small: 3,
  medium: 9,
  large: 24,
  xl: 45,
  exceptional: 75,
} as const;
export type QualityTier = keyof typeof QUALITY_TIERS;
export interface QualityEvent {
  id: string;
  actorId: string;
  url: string;
  title: string;
  kind: "implementation" | "review" | "evaluation";
  scoreThirds: number;
  weight: string;
  flags: string[];
}
export interface QualityEvidence {
  schemaVersion: "1";
  projectId: string;
  cycleId: string;
  sourceSnapshotSha256: string;
  closureCensus: {
    method: "repository-created-order-v1";
    sourceSha256: string;
    observedAt: string;
    discussionSourceSha256: string | null;
  };
  events: QualityEvent[];
  closures: {
    id: string;
    actorId: string | null;
    url: string;
    title: string;
    createdInCycle: boolean;
    actorLogin: string | null;
    flags: string[];
  }[];
}
export interface QualityDecision {
  /** One logical accepted outcome. All constituent event IDs must be listed. */
  eventIds: string[];
  tier: QualityTier;
  reason: string;
  evidenceUrls: string[];
}
const integer = /^(0|[1-9][0-9]{0,19})$/u;
const github =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pull|issues)\/[1-9][0-9]*(?:#[A-Za-z0-9_-]+)?$/u;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}
function text(value: unknown): asserts value is string {
  requireValue(
    typeof value === "string" && value.length > 0 && value.length <= 2000,
    "Invalid quality text",
  );
}
/** Validate the complete actor/event census against the frozen preparation. */
export function assertQualityEvidence(
  value: unknown,
  preparation: FundingPreparation,
): QualityEvidence {
  const data = exactRecord(
    value,
    "schemaVersion,projectId,cycleId,sourceSnapshotSha256,closureCensus,events,closures",
  );
  requireValue(
    data.schemaVersion === "1" &&
      data.projectId === preparation.projectId &&
      data.cycleId === preparation.cycleId &&
      data.sourceSnapshotSha256 === preparation.sourceSnapshotSha256,
    "Quality evidence does not match this exact cycle source",
  );
  requireValue(
    Array.isArray(data.events) && Array.isArray(data.closures),
    "Invalid quality census",
  );
  const census = exactRecord(
    data.closureCensus,
    "method,sourceSha256,observedAt,discussionSourceSha256",
  );
  requireValue(
    (census.discussionSourceSha256 === null ||
      (typeof census.discussionSourceSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(census.discussionSourceSha256))) &&
      census.method === "repository-created-order-v1" &&
      typeof census.sourceSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(census.sourceSha256) &&
      typeof census.observedAt === "string" &&
      Number.isFinite(Date.parse(census.observedAt)),
    "A complete repository census with source digest is required",
  );
  const actors = new Map(
    preparation.contributors.map((row) => [row.actor.id, row]),
  );
  const ids = new Set<string>();
  const totals = new Map<
    string,
    { thirds: bigint; weight: bigint; count: number }
  >();
  for (const value of data.events) {
    const event = exactRecord(
      value,
      "id,actorId,url,title,kind,scoreThirds,weight,flags",
    );
    text(event.id);
    text(event.actorId);
    text(event.url);
    text(event.title);
    requireValue(
      !ids.has(event.id) && actors.has(event.actorId),
      "Duplicate event or unknown contributor",
    );
    requireValue(
      github.test(event.url) &&
        ["implementation", "review", "evaluation"].includes(String(event.kind)),
      "Invalid quality source",
    );
    requireValue(
      Number.isSafeInteger(event.scoreThirds) &&
        (event.scoreThirds as number) > 0 &&
        typeof event.weight === "string" &&
        integer.test(event.weight) &&
        BigInt(event.weight) > 0n,
      "Invalid quality weight",
    );
    requireValue(
      Array.isArray(event.flags) &&
        event.flags.every(
          (flag) => typeof flag === "string" && flag.length < 100,
        ),
      "Invalid quality flags",
    );
    ids.add(event.id);
    const total = totals.get(event.actorId) ?? {
      thirds: 0n,
      weight: 0n,
      count: 0,
    };
    total.thirds += BigInt(event.scoreThirds as number);
    total.weight += BigInt(event.weight);
    total.count++;
    totals.set(event.actorId, total);
  }
  for (const row of preparation.contributors) {
    const total = totals.get(row.actor.id);
    requireValue(
      total &&
        total.thirds === BigInt(row.scoreThirds) &&
        total.weight === BigInt(row.weight) &&
        total.count === row.eventCount,
      "Quality census does not reconcile with the frozen contributor ledger",
    );
  }
  const mergedUrls = new Set(
    (data.events as QualityEvent[])
      .filter((event) => event.kind === "implementation")
      .map((event) => event.url.split("#")[0].toLowerCase()),
  );
  const closureUrls = new Set<string>();
  for (const value of data.closures) {
    const row = exactRecord(
      value,
      "id,actorId,actorLogin,url,title,createdInCycle,flags",
    );
    text(row.id);
    text(row.url);
    text(row.title);
    const canonicalUrl = row.url.split("#")[0].toLowerCase();
    requireValue(
      row.url === row.url.split("#")[0] &&
        row.url.includes("/pull/") &&
        !closureUrls.has(canonicalUrl) &&
        !mergedUrls.has(canonicalUrl),
      "Closure must identify a distinct unmerged PR, not an accepted implementation",
    );
    closureUrls.add(canonicalUrl);
    requireValue(
      !ids.has(row.id) &&
        github.test(row.url) &&
        (row.actorId === null || typeof row.actorId === "string") &&
        typeof row.createdInCycle === "boolean" &&
        (row.actorLogin === null ||
          (typeof row.actorLogin === "string" &&
            /^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(row.actorLogin))) &&
        Array.isArray(row.flags) &&
        row.flags.every(
          (flag) => typeof flag === "string" && flag.length < 100,
        ),
      "Invalid closed PR evidence",
    );
    ids.add(row.id);
  }
  return value as QualityEvidence;
}
/** Stable largest remainder, including zero-weight contributors. */
export function allocateQualityWeights(
  weights: Map<string, bigint>,
  capMinor: string,
  actorLogins: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  requireValue(integer.test(capMinor), "Invalid allocation cap");
  requireValue(
    [...weights.values()].every((weight) => weight >= 0n),
    "Negative quality weight",
  );
  const cap = BigInt(capMinor);
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0n);
  const rows = [...weights].map(([id, weight]) => ({
    id,
    amount: total ? (cap * weight) / total : 0n,
    remainder: total ? (cap * weight) % total : 0n,
  }));
  rows.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    const left = actorLogins.get(a.id) ?? a.id,
      right = actorLogins.get(b.id) ?? b.id;
    return (
      left.toLowerCase().localeCompare(right.toLowerCase()) ||
      left.localeCompare(right) ||
      a.id.localeCompare(b.id)
    );
  });
  let remaining = total
    ? cap - rows.reduce((sum, row) => sum + row.amount, 0n)
    : 0n;
  for (const row of rows)
    if (remaining > 0n) {
      row.amount++;
      remaining--;
    }
  return new Map(rows.map((row) => [row.id, row.amount.toString()]));
}
export function calculateQualityReview(
  evidence: QualityEvidence,
  untrusted: unknown,
  capMinor: string,
  burdens: QualityBurdenDecision[] = [],
  actorLogins: ReadonlyMap<string, string> = new Map(),
) {
  requireValue(Array.isArray(untrusted), "Quality decisions must be a list");
  const events = new Map(evidence.events.map((event) => [event.id, event]));
  const weights = new Map<string, bigint>();
  for (const event of evidence.events)
    weights.set(
      event.actorId,
      (weights.get(event.actorId) ?? 0n) + BigInt(event.weight),
    );
  const before = allocateQualityWeights(weights, capMinor, actorLogins);
  const consumed = new Set<string>();
  for (const value of untrusted) {
    const decision = exactRecord(value, "eventIds,tier,reason,evidenceUrls");
    requireValue(
      Array.isArray(decision.eventIds) &&
        decision.eventIds.length > 0 &&
        decision.eventIds.every((id) => typeof id === "string"),
      "Select the outcome's source events",
    );
    requireValue(
      typeof decision.tier === "string" &&
        Object.hasOwn(QUALITY_TIERS, decision.tier),
      "Invalid quality tier",
    );
    requireValue(
      typeof decision.reason === "string" &&
        decision.reason.trim().length >= 12 &&
        decision.reason.length <= 1000,
      "Explain the accepted outcome in 12–1000 characters",
    );
    requireValue(
      Array.isArray(decision.evidenceUrls) &&
        decision.evidenceUrls.length > 0 &&
        decision.evidenceUrls.every(
          (url) => typeof url === "string" && github.test(url),
        ),
      "Link public acceptance or review evidence",
    );
    const group = decision.eventIds.map((id) => {
      const event = events.get(id);
      requireValue(
        event && !consumed.has(id),
        "Unknown event or an outcome counted twice",
      );
      consumed.add(id);
      return event;
    });
    // Cross-author salvage requires an explicit reviewed allocation, not guessed authorship.
    requireValue(
      group.every(
        (event) =>
          event.actorId === group[0].actorId && event.kind === group[0].kind,
      ),
      "Group only one contributor and contribution kind; use reviewed allocations for shared authorship",
    );
    const actorId = group[0].actorId;
    const removed = group.reduce(
      (sum, event) => sum + BigInt(event.weight),
      0n,
    );
    // Artifact size, tokens and PR count cannot amplify a reviewed outcome.
    const replacement =
      BigInt(QUALITY_TIERS[decision.tier as QualityTier]) * 10_000n;
    weights.set(actorId, (weights.get(actorId) ?? 0n) - removed + replacement);
  }
  const after = allocateQualityWeights(weights, capMinor, actorLogins);
  const burdenActors = new Set<string>();
  let retainedMinor = 0n;
  for (const burden of burdens) {
    exactRecord(
      burden,
      "actorId,closedPrIds,deductionBasisPoints,reason,evidenceUrls",
    );
    requireValue(
      weights.has(burden.actorId) && !burdenActors.has(burden.actorId),
      "Unknown or repeated burden contributor",
    );
    requireValue(
      Array.isArray(burden.closedPrIds) &&
        new Set(burden.closedPrIds).size === burden.closedPrIds.length &&
        burden.closedPrIds.length >= 2 &&
        burden.closedPrIds.every((id) =>
          evidence.closures.some(
            (row) =>
              row.id === id &&
              row.actorId === burden.actorId &&
              row.createdInCycle,
          ),
        ),
      "A repeated pattern needs at least two distinct in-cycle submissions by this contributor",
    );
    requireValue(
      Number.isSafeInteger(burden.deductionBasisPoints) &&
        burden.deductionBasisPoints > 0 &&
        burden.deductionBasisPoints <= 10000,
      "Invalid proposed burden deduction",
    );
    requireValue(
      typeof burden.reason === "string" &&
        burden.reason.trim().length >= 12 &&
        burden.reason.length <= 1000 &&
        Array.isArray(burden.evidenceUrls) &&
        burden.evidenceUrls.length >= 2 &&
        new Set(burden.evidenceUrls).size === burden.evidenceUrls.length &&
        burden.evidenceUrls.every(
          (url) => typeof url === "string" && github.test(url),
        ),
      "Document the avoidable pattern and distinct public evidence; closure count is not a reason",
    );
    burdenActors.add(burden.actorId);
    const amount = BigInt(after.get(burden.actorId) ?? "0");
    const deduction = (amount * BigInt(burden.deductionBasisPoints)) / 10000n;
    after.set(burden.actorId, (amount - deduction).toString());
    retainedMinor += deduction;
  }
  return {
    before,
    after,
    retainedMinor: retainedMinor.toString(),
    weights,
    reviewedEvents: consumed.size,
    unresolvedEvents: evidence.events.length - consumed.size,
  };
}

/** Explicit draft only; unmerged submissions already have zero implementation credit. */
export interface QualityBurdenDecision {
  actorId: string;
  closedPrIds: string[];
  deductionBasisPoints: number;
  reason: string;
  evidenceUrls: string[];
}
export async function verifyQualityEventIds(
  evidence: QualityEvidence,
  preparation: FundingPreparation,
) {
  for (const actor of preparation.contributors) {
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        evidence.events
          .filter((event) => event.actorId === actor.actor.id)
          .map((event) => event.id)
          .sort(),
      ),
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    requireValue(
      hash === actor.eventIdsSha256,
      "Quality event identities do not match the frozen actor ledger",
    );
  }
}

/** Bind decisions to the complete reviewed payload, not only its source labels. */
export async function qualityEvidenceBinding(
  evidence: QualityEvidence,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(evidence)),
  );
  return `quality-evidence-v2:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
