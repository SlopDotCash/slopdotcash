/** Public preparation data. These artifacts confer no approval or payment authority. */
import { deriveAllocationFundingBasis } from "./allocation-funding";
import type { CycleWalletProof } from "./cycle-index";
import { findProject } from "./projects.mjs";
import { isSolanaAddress, WALLET_CLAIM_REPOSITORY } from "./wallets";

export interface FundingPreparationContributor {
  actor: { id: string; login: string };
  scoreThirds: string;
  weight: string;
  eventCount: number;
  eventIdsSha256: string;
  wallet: CycleWalletProof | null;
  lookupUnavailable: boolean;
}
export interface FundingPreparation {
  projectId: string;
  cycleId: string;
  sourceSnapshotSha256: string;
  sourceAuditSha256: string | null;
  observedAt: string;
  provenance: {
    ruleVersion: string;
    walletObservationsSha256: string;
    snapshotFrom: string;
    snapshotTo: string;
    periodFrom: string;
    periodTo: string;
    snapshotLedgerCount: number;
    sourceMergedPullRequests: number;
    mergedCensus: number | null;
    derivation?: "snapshot-derived";
    evidenceUrl?: string;
    evidenceArtifact?: string;
    scoredMerges: number;
  };
  counts: {
    contributors: number;
    events: number;
    scoreThirds: string;
    weight: string;
  };
  contributors: FundingPreparationContributor[];
}
export interface FundingReviewContributor
  extends FundingPreparationContributor {
  simulatedMinor: string | null;
  externalSharePartsPerMillion: string | null;
}
export interface FundingReview
  extends Omit<FundingPreparation, "contributors"> {
  status: "preparation";
  paymentAuthorized: false;
  proposalPublished: false;
  rewardKind: "monthly-pool" | "external-prize-share";
  capMinor: string | null;
  contributors: FundingReviewContributor[];
}
export interface FundingReviewIndex {
  schemaVersion: "1";
  generatedAt: string;
  reviews: FundingReview[];
}
const integer = /^(0|[1-9][0-9]{0,19})$/u;
const hash = /^[a-f0-9]{64}$/u;
export function exactRecord(
  value: unknown,
  keys: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")
  )
    throw new TypeError(`Invalid preparation fields: expected ${keys}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new TypeError("Invalid preparation text");
}
function count(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError("Invalid preparation count");
}
function date(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Invalid preparation timestamp");
}
function wallet(value: unknown, actor: { id: string; login: string }): void {
  if (value === null) return;
  if (!value || typeof value !== "object")
    throw new TypeError("Invalid wallet proof");
  const v = value as Record<string, unknown>;
  const common = "address,chain,observedAt,sourceUrl";
  if ("sourceCommit" in v) {
    exactRecord(v, `${common},sourceCommit`);
    text(v.sourceCommit, /^[a-f0-9]{40}$/u);
    if (
      v.sourceUrl !==
      `https://github.com/${actor.login}/${actor.login}/blob/${v.sourceCommit}/README.md`
    )
      throw new TypeError("Wallet README does not bind actor and commit");
  } else if ("sourceClaimId" in v) {
    exactRecord(v, `${common},sourceActorId,sourceClaimId,sourceRecordSha256`);
    text(v.sourceClaimId, /^[A-Za-z0-9_-]{1,128}$/u);
    text(v.sourceRecordSha256, hash);
    if (
      v.sourceActorId !== actor.id ||
      v.sourceUrl !==
        `https://api.slop.cash/api/v1/wallet-claims/${v.sourceClaimId}`
    )
      throw new TypeError("Wallet claim does not bind actor");
  } else {
    exactRecord(
      v,
      `${common},sourceActorId,sourceBodySha256,sourceIssueId,sourceIssueNumber,sourceUpdatedAt`,
    );
    text(v.sourceBodySha256, hash);
    text(v.sourceIssueId, /^[A-Za-z0-9_=-]{1,128}$/u);
    count(v.sourceIssueNumber);
    date(v.sourceUpdatedAt);
    if (
      !v.sourceIssueNumber ||
      v.sourceActorId !== actor.id ||
      v.sourceUrl !==
        `https://github.com/${WALLET_CLAIM_REPOSITORY}/issues/${v.sourceIssueNumber}`
    )
      throw new TypeError("Wallet issue does not bind actor");
  }
  date(v.observedAt);
  if (v.chain !== "solana" || !isSolanaAddress(v.address))
    throw new TypeError("Invalid wallet address");
}
const preparationKeys =
  "projectId,cycleId,sourceSnapshotSha256,sourceAuditSha256,observedAt,provenance,counts,contributors";
const contributorKeys =
  "actor,scoreThirds,weight,eventCount,eventIdsSha256,wallet,lookupUnavailable";
export function assertFundingPreparation(value: unknown): FundingPreparation {
  const v = exactRecord(value, preparationKeys);
  text(v.projectId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  text(v.cycleId, /^\d{4}-(0[1-9]|1[0-2])$/u);
  const project = findProject(v.projectId);
  if (!project) throw new TypeError("Unknown preparation project");
  text(v.sourceSnapshotSha256, hash);
  if (v.sourceAuditSha256 !== null) text(v.sourceAuditSha256, hash);
  date(v.observedAt);
  const p = exactRecord(
    v.provenance,
    "ruleVersion,walletObservationsSha256,snapshotFrom,snapshotTo,periodFrom,periodTo,snapshotLedgerCount,sourceMergedPullRequests,mergedCensus,scoredMerges" +
      (v.sourceAuditSha256 === null
        ? ",derivation,evidenceUrl,evidenceArtifact"
        : ""),
  );
  if (v.sourceAuditSha256 === null) {
    if (p.derivation !== "snapshot-derived" || p.mergedCensus !== null)
      throw new TypeError(
        "Derived preparation cannot claim an independent audit or census",
      );
    text(
      p.evidenceUrl,
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/u,
    );
    text(p.evidenceArtifact, /^funding-preparation-[a-zA-Z0-9-]{1,100}$/u);
  } else count(p.mergedCensus);
  text(p.ruleVersion, /^[a-zA-Z0-9.-]{1,100}$/u);
  text(p.walletObservationsSha256, hash);
  for (const key of ["snapshotFrom", "snapshotTo", "periodFrom", "periodTo"])
    date(p[key]);
  for (const key of [
    "snapshotLedgerCount",
    "sourceMergedPullRequests",
    "scoredMerges",
  ])
    count(p[key]);
  const monthStart = `${v.cycleId}-01T00:00:00.000Z`;
  const end = new Date(monthStart);
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (
    p.periodFrom !==
      new Date(
        Math.max(
          Date.parse(monthStart),
          Date.parse(project.reward.rewardStartAt),
        ),
      ).toISOString() ||
    String(p.periodFrom) >= end.toISOString() ||
    p.periodTo !== end.toISOString() ||
    v.observedAt < end.toISOString() ||
    String(p.snapshotFrom) > String(p.periodFrom) ||
    String(p.snapshotTo) < String(p.periodTo) ||
    Number(p.scoredMerges) > Number(p.sourceMergedPullRequests) ||
    (p.mergedCensus !== null &&
      (Number(p.scoredMerges) > Number(p.mergedCensus) ||
        Number(p.mergedCensus) > Number(p.sourceMergedPullRequests)))
  )
    throw new TypeError("Incomplete preparation period or census");
  const c = exactRecord(v.counts, "contributors,events,scoreThirds,weight");
  count(c.contributors);
  count(c.events);
  text(c.scoreThirds, integer);
  text(c.weight, integer);
  if (!Array.isArray(v.contributors) || v.contributors.length > 100000)
    throw new TypeError("Invalid contributors");
  const ids = new Set<string>();
  let events = 0;
  let scores = 0n;
  let weights = 0n;
  for (const entry of v.contributors) {
    const r = exactRecord(entry, contributorKeys);
    const a = exactRecord(r.actor, "id,login");
    text(a.id, /^[A-Za-z0-9_=-]{1,128}$/u);
    text(a.login, /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/u);
    if (ids.has(a.id)) throw new TypeError("Duplicate preparation actor");
    ids.add(a.id);
    text(r.scoreThirds, integer);
    text(r.weight, integer);
    text(r.eventIdsSha256, hash);
    count(r.eventCount);
    if (
      BigInt(r.scoreThirds) === 0n ||
      BigInt(r.weight) === 0n ||
      r.eventCount === 0
    )
      throw new TypeError("Invalid scored contributor");
    if (
      typeof r.lookupUnavailable !== "boolean" ||
      (r.lookupUnavailable && r.wallet !== null)
    )
      throw new TypeError("Invalid wallet lookup state");
    wallet(r.wallet, { id: a.id, login: a.login });
    if (r.wallet && (r.wallet as CycleWalletProof).observedAt > v.observedAt)
      throw new TypeError("Wallet observation is after preparation");
    events += r.eventCount;
    scores += BigInt(r.scoreThirds);
    weights += BigInt(r.weight);
  }
  if (
    ids.size !== c.contributors ||
    events !== c.events ||
    scores.toString() !== c.scoreThirds ||
    weights.toString() !== c.weight ||
    events > Number(p.snapshotLedgerCount)
  )
    throw new TypeError("Preparation counts do not reconcile");
  return value as FundingPreparation;
}
/** Same canonical actor tie break as project-view, using integer arithmetic only. */
export function allocateFundingReview(
  total: bigint,
  rows: FundingPreparationContributor[],
): Map<string, string> {
  const sum = rows.reduce((s, r) => s + BigInt(r.weight), 0n);
  if (total < 0n) throw new TypeError("Negative allocation");
  const ranked = rows.map((r) => ({
    r,
    amount: sum ? (total * BigInt(r.weight)) / sum : 0n,
    remainder: sum ? (total * BigInt(r.weight)) % sum : 0n,
  }));
  ranked.sort(
    (a, b) =>
      (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1) ||
      a.r.actor.login
        .toLowerCase()
        .localeCompare(b.r.actor.login.toLowerCase()) ||
      a.r.actor.login.localeCompare(b.r.actor.login) ||
      a.r.actor.id.localeCompare(b.r.actor.id),
  );
  let remaining = sum ? total - ranked.reduce((s, r) => s + r.amount, 0n) : 0n;
  for (const r of ranked) {
    if (remaining === 0n) break;
    r.amount++;
    remaining--;
  }
  return new Map(ranked.map((r) => [r.r.actor.id, r.amount.toString()]));
}
export function createFundingReview(input: FundingPreparation): FundingReview {
  const preparation = assertFundingPreparation(input);
  const project = findProject(preparation.projectId);
  if (!project) throw new TypeError("Unknown project");
  const monthly = project.reward.kind === "monthly-pool";
  const capMinor = monthly
    ? deriveAllocationFundingBasis(project, preparation.cycleId).monthlyCapMinor
    : null;
  const amounts = allocateFundingReview(
    monthly
      ? BigInt(capMinor ?? "0")
      : 1000000n - BigInt(project.reward.feeBasisPoints) * 100n,
    preparation.contributors,
  );
  return {
    ...preparation,
    status: "preparation",
    paymentAuthorized: false,
    proposalPublished: false,
    rewardKind: project.reward.kind,
    capMinor,
    contributors: preparation.contributors.map((r) => ({
      ...r,
      simulatedMinor: monthly ? (amounts.get(r.actor.id) ?? "0") : null,
      externalSharePartsPerMillion: monthly
        ? null
        : (amounts.get(r.actor.id) ?? "0"),
    })),
  };
}
export function assertFundingReviewIndex(value: unknown): FundingReviewIndex {
  const v = exactRecord(value, "schemaVersion,generatedAt,reviews");
  if (v.schemaVersion !== "1")
    throw new TypeError("Invalid funding review version");
  date(v.generatedAt);
  if (!Array.isArray(v.reviews) || v.reviews.length > 1000)
    throw new TypeError("Invalid funding reviews");
  const ids = new Set<string>();
  for (const raw of v.reviews) {
    const r = exactRecord(
      raw,
      `${preparationKeys},status,paymentAuthorized,proposalPublished,rewardKind,capMinor`,
    );
    if (!Array.isArray(r.contributors))
      throw new TypeError("Invalid contributors");
    const base = Object.fromEntries(
      preparationKeys.split(",").map((k) => [k, r[k]]),
    );
    base.contributors = r.contributors.map((rawRow) => {
      const row = exactRecord(
        rawRow,
        `${contributorKeys},simulatedMinor,externalSharePartsPerMillion`,
      );
      return Object.fromEntries(
        contributorKeys.split(",").map((k) => [k, row[k]]),
      );
    });
    const expected = createFundingReview(assertFundingPreparation(base));
    for (const key of [
      "status",
      "paymentAuthorized",
      "proposalPublished",
      "rewardKind",
      "capMinor",
    ] as const)
      if (r[key] !== expected[key])
        throw new TypeError("Noncanonical preparation status or cap");
    r.contributors.forEach((row, i) => {
      if (
        row.simulatedMinor !== expected.contributors[i].simulatedMinor ||
        row.externalSharePartsPerMillion !==
          expected.contributors[i].externalSharePartsPerMillion
      )
        throw new TypeError("Incorrect largest remainder allocation");
    });
    const id = `${expected.projectId}/${expected.cycleId}`;
    if (ids.has(id) || expected.observedAt > v.generatedAt)
      throw new TypeError("Duplicate or future preparation");
    ids.add(id);
  }
  return value as FundingReviewIndex;
}
