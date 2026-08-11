/**
 * Plans a hypothetical split of a contributor pool from the published
 * contribution ledger. The distribution model is a required operator-supplied
 * parameter because no payout rule exists yet: defaulting it would answer "how
 * does money split?" on the program's behalf. Every input is recorded in the
 * emitted plan and any plan can be recomputed from it. This command is a dry
 * run: it moves no money, credits no balance, contacts no payment or account
 * service, and does not determine who is paid.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublishableLeaderboardSnapshot,
  type GitHubActorKind,
  isBotActor,
  type LeaderboardEntry,
  type LeaderboardSnapshot,
  type RepositoryId,
  type ScoreEvent,
  TARGET_REPOSITORIES,
} from "../src/lib/leaderboard";

export const PAYOUT_PLAN_SCHEMA_VERSION = "1" as const;
export const PAYOUT_PLAN_KIND = "operator-payout-plan" as const;
export const PAYOUT_PLAN_STATUS = "dry-run" as const;
export const PAYOUT_PLAN_NOTICE =
  "Operator dry run. This plan moves no money, credits no balance, and does not determine payouts. The distribution model is an unapproved planning parameter, not a published rule.";

/**
 * The site treats a snapshot older than eight hours as stale
 * (`src/App.tsx`), and the local evidence command uses the same bound.
 * `snapshot.stale` is always `false` by contract, so freshness must be derived
 * from `generatedAt` exactly as the site derives it.
 */
export const MAX_SNAPSHOT_AGE_HOURS = 8;

export const ROUNDING_MODE = "floor-then-largest-remainder" as const;
export const REMAINDER_POLICY =
  "largest-remainder-then-canonical-order" as const;
export const ROUNDING_DESCRIPTION =
  "Each share is computed in integer minor units as floor(pool * weight / totalWeight). The leftover minor units, always fewer than the eligible contributor count, are awarded one each by descending exact remainder and then by canonical order. Allocations therefore sum to the pool exactly, and no contributor receives more than one minor unit above their exact share.";

export const ACCOUNT_LINKAGE_PROVIDER = "eliza-cloud" as const;
export const ACCOUNT_LINKAGE_STATUS = "unresolved" as const;
export const ACCOUNT_LINKAGE_NOTE =
  "No GitHub-identity-to-Eliza-Cloud-account mapping exists. Every payee account in this plan is unresolved; a later step must supply and verify that mapping before any balance could be credited.";

/**
 * The published snapshot contract admits `Bot`, `Mannequin`, `Organization`,
 * and `Unknown` actors, and the scoring contract's bot exclusion is enforced
 * only in the generator. A money-shaped document must not inherit that trust,
 * so the planner re-checks every leader itself.
 */
export const ELIGIBLE_ACTOR_KIND = "User" as const satisfies GitHubActorKind;
export const ELIGIBLE_ACTOR_REQUIREMENT =
  "Every payee is a non-bot GitHub user account (actor kind User); a bot or non-user leader refuses the plan.";

export const EXECUTION_BLOCKERS = [
  "no-approved-distribution-rule",
  "eliza-cloud-account-linkage-unresolved",
  "no-payout-execution-path",
] as const;

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
export const PUBLISHED_SITE_DIRECTORY = resolve(REPOSITORY_ROOT, "public");
export const DEFAULT_SNAPSHOT_PATH = resolve(
  PUBLISHED_SITE_DIRECTORY,
  "data/leaderboard.json",
);

/**
 * The only directory inside this working tree a plan may be written to. It is
 * listed in `.gitignore`, so a plan left there cannot reach the public
 * repository through `git add`.
 */
export const OPERATOR_PLAN_DIRECTORY_NAME = "plans" as const;
export const OPERATOR_PLAN_DIRECTORY = resolve(
  REPOSITORY_ROOT,
  OPERATOR_PLAN_DIRECTORY_NAME,
);

export interface PayoutCurrency {
  code: string;
  minorUnitScale: number;
  minorUnitName: string;
}

/** Minor-unit scales for the denominations an operator can plan in. */
export const PAYOUT_CURRENCIES = {
  USD: { code: "USD", minorUnitScale: 2, minorUnitName: "cent" },
  USDC: { code: "USDC", minorUnitScale: 6, minorUnitName: "micro-USDC" },
} as const satisfies Record<string, PayoutCurrency>;

export type PayoutCurrencyCode = keyof typeof PAYOUT_CURRENCIES;

export type DistributionModelId =
  | "proportional-by-points-v1"
  | "equal-share-v1";

export interface DistributionModel {
  id: DistributionModelId;
  description: string;
  weightFor: (entry: LeaderboardEntry) => bigint;
}

/**
 * Candidate distribution models. None of these is an approved payout rule; they
 * exist so an operator can compare concrete splits before a rule is written.
 */
export const DISTRIBUTION_MODELS = {
  "proportional-by-points-v1": {
    id: "proportional-by-points-v1",
    description:
      "Weight each eligible contributor by their published snapshot score and split the pool in proportion to those weights.",
    weightFor: (entry: LeaderboardEntry) => BigInt(entry.score),
  },
  "equal-share-v1": {
    id: "equal-share-v1",
    description:
      "Weight every eligible contributor equally and split the pool evenly regardless of score.",
    weightFor: () => 1n,
  },
} as const satisfies Record<DistributionModelId, DistributionModel>;

export interface PayoutRuleInput {
  model: DistributionModelId;
  pool: string;
  currency: PayoutCurrencyCode;
  minimumPoints: number;
}

export interface PayoutPlanSource {
  path: string;
  digest: string;
}

export interface CreatePayoutPlanInput {
  snapshot: unknown;
  source: PayoutPlanSource;
  rule: PayoutRuleInput;
  now?: number;
}

export interface PayoutPlanRepositoryPoints {
  repository: RepositoryId;
  points: number;
  events: number;
}

export interface PayoutPlanAllocation {
  order: number;
  contributor: {
    githubActorId: string;
    githubLogin: string;
    githubUrl: string;
    githubActorKind: GitHubActorKind;
    snapshotRank: number;
  };
  payee: {
    provider: typeof ACCOUNT_LINKAGE_PROVIDER;
    accountId: null;
    linkageStatus: typeof ACCOUNT_LINKAGE_STATUS;
    linkedAt: null;
  };
  weight: string;
  share: {
    numerator: string;
    denominator: string;
    basisPoints: number;
  };
  points: {
    total: number;
    mergedPullRequests: number;
    resolvedIssues: number;
    materialTestChanges: number;
    evidence: number;
    substantiveReviews: number;
  };
  ledger: {
    eventCount: number;
    byRepository: PayoutPlanRepositoryPoints[];
  };
  allocation: {
    amountMinorUnits: string;
    amount: string;
    floorMinorUnits: string;
    remainderNumerator: string;
    remainderUnitAwarded: boolean;
  };
}

export interface PayoutPlan {
  schemaVersion: typeof PAYOUT_PLAN_SCHEMA_VERSION;
  kind: typeof PAYOUT_PLAN_KIND;
  status: typeof PAYOUT_PLAN_STATUS;
  movesMoney: false;
  determinesPayouts: false;
  notice: string;
  planId: string;
  generatedAt: string;
  rule: {
    model: DistributionModelId;
    description: string;
    status: "unapproved-planning-parameter";
    inputs: {
      pool: string;
      poolMinorUnits: string;
      currency: string;
      minorUnitScale: number;
      minorUnitName: string;
      minimumPoints: number;
    };
    rounding: {
      mode: typeof ROUNDING_MODE;
      remainderPolicy: typeof REMAINDER_POLICY;
      description: string;
    };
  };
  snapshot: {
    path: string;
    digest: string;
    schemaVersion: string;
    ruleVersion: string;
    primaryRepository: string;
    repositories: string[];
    generatedAt: string;
    sourceUpdatedAt: string;
    ageMinutes: number;
    maximumAgeHours: number;
    window: { days: number; from: string; to: string };
    verificationWindow: { days: number; from: string; to: string };
    leaderCount: number;
    ledgerEventCount: number;
    ledgerPointTotal: number;
  };
  eligibility: {
    criterion: string;
    actorRequirement: string;
    minimumPoints: number;
    snapshotLeaders: number;
    eligibleContributors: number;
    excludedContributors: number;
  };
  totals: {
    weight: string;
    poolMinorUnits: string;
    pool: string;
    allocatedMinorUnits: string;
    allocated: string;
    unallocatedMinorUnits: string;
    remainderUnitsDistributed: number;
    zeroAllocationContributors: number;
  };
  accountLinkage: {
    provider: typeof ACCOUNT_LINKAGE_PROVIDER;
    status: typeof ACCOUNT_LINKAGE_STATUS;
    mappingSource: "none";
    linkedAccounts: number;
    unlinkedAccounts: number;
    note: string;
  };
  executionBlockers: string[];
  allocations: PayoutPlanAllocation[];
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const DECIMAL_AMOUNT_PATTERN = /^(\d{1,15})(?:\.(\d{1,18}))?$/;

/**
 * Parses an operator-supplied decimal amount into exact integer minor units.
 * Money never becomes a float: the digits are read as text and widened to the
 * currency's minor-unit scale.
 */
export function parseDecimalToMinorUnits(
  amount: string,
  minorUnitScale: number,
): bigint {
  if (typeof amount !== "string") {
    throw new TypeError("a pool amount must be a decimal string");
  }
  if (!Number.isInteger(minorUnitScale) || minorUnitScale < 0) {
    throw new TypeError("a minor-unit scale must be a non-negative integer");
  }
  const match = DECIMAL_AMOUNT_PATTERN.exec(amount.trim());
  if (!match) {
    throw new Error(
      `pool amount "${amount}" must be a plain positive decimal number without a sign, exponent, or separators`,
    );
  }
  const fraction = match[2] ?? "";
  if (fraction.length > minorUnitScale) {
    throw new Error(
      `pool amount "${amount}" carries more than the ${minorUnitScale} decimal places this currency can express`,
    );
  }
  return BigInt(`${match[1]}${fraction.padEnd(minorUnitScale, "0")}`);
}

/** Renders integer minor units back to a decimal string without floats. */
export function formatMinorUnits(
  amount: bigint,
  minorUnitScale: number,
): string {
  if (amount < 0n) {
    throw new Error("a payout amount cannot be negative");
  }
  if (!Number.isInteger(minorUnitScale) || minorUnitScale < 0) {
    throw new TypeError("a minor-unit scale must be a non-negative integer");
  }
  if (minorUnitScale === 0) {
    return amount.toString();
  }
  const digits = amount.toString().padStart(minorUnitScale + 1, "0");
  const boundary = digits.length - minorUnitScale;
  return `${digits.slice(0, boundary)}.${digits.slice(boundary)}`;
}

export interface WeightedCandidate {
  entry: LeaderboardEntry;
  weight: bigint;
}

export interface WeightedAllocation {
  candidate: WeightedCandidate;
  floorMinorUnits: bigint;
  remainderNumerator: bigint;
  remainderUnitAwarded: boolean;
  amountMinorUnits: bigint;
}

/**
 * Canonical allocation order: heaviest weight first, then the same lowercased
 * login, login, and immutable actor ID tiebreak the published ledger uses. Rank
 * is deliberately not an input, because equal scores receive different ranks
 * purely by login.
 */
export function compareWeightedCandidates(
  left: WeightedCandidate,
  right: WeightedCandidate,
): number {
  if (left.weight !== right.weight) {
    return left.weight > right.weight ? -1 : 1;
  }
  return (
    compareCodeUnits(
      left.entry.actor.login.toLowerCase(),
      right.entry.actor.login.toLowerCase(),
    ) ||
    compareCodeUnits(left.entry.actor.login, right.entry.actor.login) ||
    compareCodeUnits(left.entry.actor.id, right.entry.actor.id)
  );
}

function assertAllocationsSettleExactly(
  poolMinorUnits: bigint,
  totalWeight: bigint,
  allocations: readonly WeightedAllocation[],
): void {
  let allocated = 0n;
  for (const allocation of allocations) {
    const exactNumerator = poolMinorUnits * allocation.candidate.weight;
    if (
      allocation.floorMinorUnits * totalWeight +
        allocation.remainderNumerator !==
      exactNumerator
    ) {
      throw new Error(
        "payout allocation lost its exact share decomposition; refusing to emit the plan",
      );
    }
    const expected =
      allocation.floorMinorUnits + (allocation.remainderUnitAwarded ? 1n : 0n);
    if (allocation.amountMinorUnits !== expected) {
      throw new Error(
        "payout allocation does not match its floor and remainder award; refusing to emit the plan",
      );
    }
    if (
      allocation.amountMinorUnits * totalWeight >
      exactNumerator + totalWeight
    ) {
      throw new Error(
        `payout allocation for ${allocation.candidate.entry.actor.login} exceeds its exact share; refusing to emit the plan`,
      );
    }
    allocated += allocation.amountMinorUnits;
  }
  if (allocated !== poolMinorUnits) {
    throw new Error(
      `payout allocations sum to ${allocated} minor units instead of the ${poolMinorUnits}-minor-unit pool; refusing to emit the plan`,
    );
  }
}

/**
 * Splits a pool across weighted candidates in exact integer minor units using
 * the largest-remainder method, so the allocations always sum to the pool.
 */
export function allocateByWeight(
  poolMinorUnits: bigint,
  candidates: readonly WeightedCandidate[],
): WeightedAllocation[] {
  if (poolMinorUnits <= 0n) {
    throw new Error("a payout pool must be greater than zero");
  }
  if (candidates.length === 0) {
    throw new Error("a payout plan needs at least one eligible contributor");
  }
  let totalWeight = 0n;
  for (const candidate of candidates) {
    if (candidate.weight < 0n) {
      throw new Error(
        `contributor ${candidate.entry.actor.login} carries a negative distribution weight`,
      );
    }
    totalWeight += candidate.weight;
  }
  if (totalWeight <= 0n) {
    throw new Error(
      "the eligible contributors carry no distribution weight, so no split exists",
    );
  }

  const allocations = [...candidates]
    .sort(compareWeightedCandidates)
    .map((candidate) => {
      const exactNumerator = poolMinorUnits * candidate.weight;
      const floorMinorUnits = exactNumerator / totalWeight;
      return {
        candidate,
        floorMinorUnits,
        remainderNumerator: exactNumerator % totalWeight,
        remainderUnitAwarded: false,
        amountMinorUnits: floorMinorUnits,
      };
    });

  const flooredTotal = allocations.reduce(
    (total, allocation) => total + allocation.floorMinorUnits,
    0n,
  );
  let remainingUnits = poolMinorUnits - flooredTotal;
  if (remainingUnits < 0n || remainingUnits >= BigInt(allocations.length)) {
    throw new Error(
      "payout remainder fell outside its proven bound; refusing to emit the plan",
    );
  }

  const byRemainder = allocations
    .map((allocation, index) => ({ allocation, index }))
    .sort((left, right) => {
      if (
        left.allocation.remainderNumerator !==
        right.allocation.remainderNumerator
      ) {
        return left.allocation.remainderNumerator >
          right.allocation.remainderNumerator
          ? -1
          : 1;
      }
      return left.index - right.index;
    });
  for (const { allocation } of byRemainder) {
    if (remainingUnits === 0n) {
      break;
    }
    if (allocation.remainderNumerator === 0n) {
      throw new Error(
        "payout remainder cannot be awarded to an exact share; refusing to emit the plan",
      );
    }
    allocation.remainderUnitAwarded = true;
    allocation.amountMinorUnits = allocation.floorMinorUnits + 1n;
    remainingUnits -= 1n;
  }

  assertAllocationsSettleExactly(poolMinorUnits, totalWeight, allocations);
  return allocations;
}

interface ContributorLedgerSummary {
  eventCount: number;
  byRepository: Map<RepositoryId, { points: number; events: number }>;
}

function summarizeLedger(
  ledger: readonly ScoreEvent[],
): Map<string, ContributorLedgerSummary> {
  const summaries = new Map<string, ContributorLedgerSummary>();
  for (const event of ledger) {
    let summary = summaries.get(event.actor.id);
    if (!summary) {
      summary = { eventCount: 0, byRepository: new Map() };
      summaries.set(event.actor.id, summary);
    }
    summary.eventCount += 1;
    const repository = summary.byRepository.get(event.repository) ?? {
      points: 0,
      events: 0,
    };
    repository.points += event.points;
    repository.events += 1;
    summary.byRepository.set(event.repository, repository);
  }
  return summaries;
}

function repositoryBreakdown(
  summary: ContributorLedgerSummary,
): PayoutPlanRepositoryPoints[] {
  const breakdown: PayoutPlanRepositoryPoints[] = [];
  for (const repository of TARGET_REPOSITORIES) {
    const totals = summary.byRepository.get(repository.id);
    if (totals) {
      breakdown.push({
        repository: repository.id,
        points: totals.points,
        events: totals.events,
      });
    }
  }
  return breakdown;
}

function resolveCurrency(code: unknown): PayoutCurrency {
  if (typeof code !== "string" || !Object.hasOwn(PAYOUT_CURRENCIES, code)) {
    throw new Error(
      `unknown payout currency "${String(code)}"; supported currencies are ${Object.keys(PAYOUT_CURRENCIES).join(", ")}`,
    );
  }
  return PAYOUT_CURRENCIES[code as PayoutCurrencyCode];
}

function resolveModel(id: unknown): DistributionModel {
  if (typeof id !== "string" || !Object.hasOwn(DISTRIBUTION_MODELS, id)) {
    throw new Error(
      `unknown distribution model "${String(id)}"; supported models are ${Object.keys(DISTRIBUTION_MODELS).join(", ")}`,
    );
  }
  return DISTRIBUTION_MODELS[id as DistributionModelId];
}

/**
 * Refuses any snapshot whose leaders include an actor that cannot hold a pool
 * share. A bot in `leaders` means the ledger already violates the published
 * scoring contract, and a non-user actor has no human account to credit, so
 * both fail the whole plan instead of quietly funding or dropping a row an
 * operator cannot see in the summary.
 */
function assertHumanLeaders(snapshot: LeaderboardSnapshot): void {
  for (const entry of snapshot.leaders) {
    const actor = entry.actor;
    if (isBotActor(actor)) {
      throw new Error(
        `refusing to plan from a snapshot whose leaders include the bot ${actor.login} (actor kind ${actor.kind}, rank ${entry.rank}, ${entry.score} points): the scoring contract excludes bots, so this ledger is wrong. Regenerate it before planning a pool.`,
      );
    }
    if (actor.kind !== ELIGIBLE_ACTOR_KIND) {
      throw new Error(
        `refusing to plan from a snapshot whose leaders include ${actor.login} with GitHub actor kind ${actor.kind} (rank ${entry.rank}, ${entry.score} points): only a ${ELIGIBLE_ACTOR_KIND} account can hold a pool share.`,
      );
    }
  }
}

function assertFreshSnapshot(
  snapshot: LeaderboardSnapshot,
  now: number,
): number {
  const ageMs = now - Date.parse(snapshot.generatedAt);
  const maximumAgeMs = MAX_SNAPSHOT_AGE_HOURS * 60 * 60 * 1000;
  if (ageMs > maximumAgeMs) {
    const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
    throw new Error(
      `refusing to plan from a stale snapshot: it was generated ${ageHours} hours ago (${snapshot.generatedAt}), past the ${MAX_SNAPSHOT_AGE_HOURS}-hour bound the site treats as fresh. Regenerate the ledger first.`,
    );
  }
  return ageMs;
}

/**
 * Builds a deterministic, auditable payout plan. Every input is recorded, and
 * an unusable snapshot, an unusable rule, or an empty eligible set fails loudly
 * instead of producing an empty or zero plan.
 */
export function createPayoutPlan(input: CreatePayoutPlanInput): PayoutPlan {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) {
    throw new TypeError("a planning time must be finite");
  }
  const model = resolveModel(input.rule.model);
  const currency = resolveCurrency(input.rule.currency);
  const minimumPoints = input.rule.minimumPoints;
  if (!Number.isInteger(minimumPoints) || minimumPoints < 0) {
    throw new TypeError(
      "the eligibility minimum must be a non-negative integer number of points",
    );
  }
  const poolMinorUnits = parseDecimalToMinorUnits(
    input.rule.pool,
    currency.minorUnitScale,
  );
  if (poolMinorUnits <= 0n) {
    throw new Error(
      "refusing to plan a zero pool; supply the pool an operator intends to distribute",
    );
  }
  if (typeof input.source.path !== "string" || input.source.path.length === 0) {
    throw new TypeError("a plan must record the snapshot path it read");
  }
  if (
    typeof input.source.digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(input.source.digest)
  ) {
    throw new TypeError("a plan must record a sha256 digest of its snapshot");
  }

  const snapshotValue = input.snapshot;
  try {
    assertPublishableLeaderboardSnapshot(snapshotValue, now);
  } catch (cause) {
    throw new Error(
      `refusing to plan from a snapshot that fails the published leaderboard contract: ${messageOf(cause)}`,
      { cause },
    );
  }
  const snapshot: LeaderboardSnapshot = snapshotValue;
  const ageMs = assertFreshSnapshot(snapshot, now);
  assertHumanLeaders(snapshot);

  const eligible = snapshot.leaders.filter(
    (entry) => entry.score >= minimumPoints,
  );
  if (eligible.length === 0) {
    throw new Error(
      `refusing to emit an empty plan: no contributor in the snapshot reaches the ${minimumPoints}-point eligibility minimum`,
    );
  }

  const allocations = allocateByWeight(
    poolMinorUnits,
    eligible.map((entry) => ({ entry, weight: model.weightFor(entry) })),
  );
  const totalWeight = allocations.reduce(
    (total, allocation) => total + allocation.candidate.weight,
    0n,
  );
  const summaries = summarizeLedger(snapshot.ledger);

  const planAllocations = allocations.map((allocation, index) => {
    const entry = allocation.candidate.entry;
    const summary = summaries.get(entry.actor.id);
    if (!summary) {
      throw new Error(
        `contributor ${entry.actor.login} scores in the snapshot but owns no ledger events; refusing to plan`,
      );
    }
    return {
      order: index + 1,
      contributor: {
        githubActorId: entry.actor.id,
        githubLogin: entry.actor.login,
        githubUrl: entry.actor.url,
        githubActorKind: entry.actor.kind,
        snapshotRank: entry.rank,
      },
      payee: {
        provider: ACCOUNT_LINKAGE_PROVIDER,
        accountId: null,
        linkageStatus: ACCOUNT_LINKAGE_STATUS,
        linkedAt: null,
      },
      weight: allocation.candidate.weight.toString(),
      share: {
        numerator: allocation.candidate.weight.toString(),
        denominator: totalWeight.toString(),
        basisPoints: Number(
          (allocation.candidate.weight * 10000n) / totalWeight,
        ),
      },
      points: {
        total: entry.score,
        mergedPullRequests: entry.points.mergedPullRequests,
        resolvedIssues: entry.points.resolvedIssues,
        materialTestChanges: entry.points.materialTestChanges,
        evidence: entry.points.evidence,
        substantiveReviews: entry.points.substantiveReviews,
      },
      ledger: {
        eventCount: summary.eventCount,
        byRepository: repositoryBreakdown(summary),
      },
      allocation: {
        amountMinorUnits: allocation.amountMinorUnits.toString(),
        amount: formatMinorUnits(
          allocation.amountMinorUnits,
          currency.minorUnitScale,
        ),
        floorMinorUnits: allocation.floorMinorUnits.toString(),
        remainderNumerator: allocation.remainderNumerator.toString(),
        remainderUnitAwarded: allocation.remainderUnitAwarded,
      },
    } satisfies PayoutPlanAllocation;
  });

  const allocatedMinorUnits = allocations.reduce(
    (total, allocation) => total + allocation.amountMinorUnits,
    0n,
  );
  const body = {
    rule: {
      model: model.id,
      description: model.description,
      status: "unapproved-planning-parameter" as const,
      inputs: {
        pool: formatMinorUnits(poolMinorUnits, currency.minorUnitScale),
        poolMinorUnits: poolMinorUnits.toString(),
        currency: currency.code,
        minorUnitScale: currency.minorUnitScale,
        minorUnitName: currency.minorUnitName,
        minimumPoints,
      },
      rounding: {
        mode: ROUNDING_MODE,
        remainderPolicy: REMAINDER_POLICY,
        description: ROUNDING_DESCRIPTION,
      },
    },
    snapshot: {
      path: input.source.path,
      digest: input.source.digest,
      schemaVersion: snapshot.schemaVersion,
      ruleVersion: snapshot.ruleVersion,
      primaryRepository: snapshot.repository,
      repositories: snapshot.repositories.map((repository) => repository.id),
      generatedAt: snapshot.generatedAt,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      ageMinutes: Math.floor(ageMs / 60000),
      maximumAgeHours: MAX_SNAPSHOT_AGE_HOURS,
      window: { ...snapshot.window },
      verificationWindow: { ...snapshot.source.verificationWindow },
      leaderCount: snapshot.leaders.length,
      ledgerEventCount: snapshot.ledger.length,
      ledgerPointTotal: snapshot.ledger.reduce(
        (total, event) => total + event.points,
        0,
      ),
    },
    eligibility: {
      criterion:
        "Every contributor the snapshot scores, at or above the recorded eligibility minimum. Eligibility is not a payout entitlement.",
      actorRequirement: ELIGIBLE_ACTOR_REQUIREMENT,
      minimumPoints,
      snapshotLeaders: snapshot.leaders.length,
      eligibleContributors: eligible.length,
      excludedContributors: snapshot.leaders.length - eligible.length,
    },
    totals: {
      weight: totalWeight.toString(),
      poolMinorUnits: poolMinorUnits.toString(),
      pool: formatMinorUnits(poolMinorUnits, currency.minorUnitScale),
      allocatedMinorUnits: allocatedMinorUnits.toString(),
      allocated: formatMinorUnits(allocatedMinorUnits, currency.minorUnitScale),
      unallocatedMinorUnits: (poolMinorUnits - allocatedMinorUnits).toString(),
      remainderUnitsDistributed: allocations.filter(
        (allocation) => allocation.remainderUnitAwarded,
      ).length,
      zeroAllocationContributors: allocations.filter(
        (allocation) => allocation.amountMinorUnits === 0n,
      ).length,
    },
    accountLinkage: {
      provider: ACCOUNT_LINKAGE_PROVIDER,
      status: ACCOUNT_LINKAGE_STATUS,
      mappingSource: "none" as const,
      linkedAccounts: 0,
      unlinkedAccounts: planAllocations.length,
      note: ACCOUNT_LINKAGE_NOTE,
    },
    executionBlockers: [...EXECUTION_BLOCKERS],
    allocations: planAllocations,
  };

  const planId = `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
  return {
    schemaVersion: PAYOUT_PLAN_SCHEMA_VERSION,
    kind: PAYOUT_PLAN_KIND,
    status: PAYOUT_PLAN_STATUS,
    movesMoney: false,
    determinesPayouts: false,
    notice: PAYOUT_PLAN_NOTICE,
    planId,
    generatedAt: new Date(now).toISOString(),
    ...body,
  };
}

function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100)
    .toString()
    .padStart(2, "0");
  return `${whole}.${fraction}%`;
}

function padStart(value: string, width: number): string {
  return value.padStart(width, " ");
}

function padEnd(value: string, width: number): string {
  return value.padEnd(width, " ");
}

/** Renders the operator-readable form of a plan. */
export function formatPayoutPlanSummary(plan: PayoutPlan): string {
  const loginWidth = Math.max(
    "eligible total".length,
    ...plan.allocations.map(
      (allocation) => allocation.contributor.githubLogin.length,
    ),
  );
  const amountWidth = Math.max(
    plan.totals.allocated.length,
    ...plan.allocations.map(
      (allocation) => allocation.allocation.amount.length,
    ),
  );
  const orderWidth = Math.max(2, String(plan.allocations.length).length);
  const eligiblePoints = plan.allocations.reduce(
    (total, allocation) => total + allocation.points.total,
    0,
  );
  const pointsWidth = Math.max(6, String(eligiblePoints).length);

  const lines = [
    "slop.cash payout planner — DRY RUN, moves no money",
    "",
    plan.notice,
    "",
    `Plan        ${plan.planId}`,
    `Model       ${plan.rule.model} (${plan.rule.status})`,
    `Pool        ${plan.totals.pool} ${plan.rule.inputs.currency} (${plan.totals.poolMinorUnits} ${plan.rule.inputs.minorUnitName}s)`,
    `Rounding    ${plan.rule.rounding.mode}; ${plan.totals.remainderUnitsDistributed} remainder ${plan.rule.inputs.minorUnitName}(s) awarded`,
    `Snapshot    ${plan.snapshot.path} (${plan.snapshot.digest})`,
    `            generated ${plan.snapshot.generatedAt}, ${plan.snapshot.ageMinutes} minutes old, rules ${plan.snapshot.ruleVersion}`,
    `            ${plan.snapshot.leaderCount} leaders, ${plan.snapshot.ledgerEventCount} ledger events, ${plan.snapshot.ledgerPointTotal} points`,
    `Eligible    ${plan.eligibility.eligibleContributors} of ${plan.eligibility.snapshotLeaders} scoring contributors (minimum ${plan.eligibility.minimumPoints} points)`,
    `            ${plan.eligibility.actorRequirement}`,
    `Payees      ${plan.accountLinkage.linkedAccounts} linked Eliza Cloud accounts, ${plan.accountLinkage.unlinkedAccounts} unresolved`,
    "",
    `  ${padStart("#", orderWidth)}  ${padEnd("contributor", loginWidth)}  ${padStart("points", pointsWidth)}  ${padStart("share", 8)}  ${padStart("amount", amountWidth)}`,
  ];
  for (const allocation of plan.allocations) {
    lines.push(
      `  ${padStart(String(allocation.order), orderWidth)}  ${padEnd(allocation.contributor.githubLogin, loginWidth)}  ${padStart(String(allocation.points.total), pointsWidth)}  ${padStart(formatBasisPoints(allocation.share.basisPoints), 8)}  ${padStart(allocation.allocation.amount, amountWidth)}`,
    );
  }
  lines.push(
    `  ${padStart("", orderWidth)}  ${padEnd("eligible total", loginWidth)}  ${padStart(String(eligiblePoints), pointsWidth)}  ${padStart("100.00%", 8)}  ${padStart(plan.totals.allocated, amountWidth)}`,
    "",
    `Unallocated ${plan.totals.unallocatedMinorUnits} ${plan.rule.inputs.minorUnitName}s. Shares are truncated for display; allocations are exact integer ${plan.rule.inputs.minorUnitName}s.`,
  );
  if (plan.totals.zeroAllocationContributors > 0) {
    lines.push(
      `Warning     ${plan.totals.zeroAllocationContributors} eligible contributor(s) allocate zero ${plan.rule.inputs.minorUnitName}s at this pool size.`,
    );
  }
  lines.push(
    `Blocked     ${plan.executionBlockers.join(", ")}`,
    plan.accountLinkage.note,
    "",
  );
  return lines.join("\n");
}

export interface PayoutPlanOptions {
  snapshotPath: string;
  pool: string;
  currency: PayoutCurrencyCode;
  model: DistributionModelId;
  minimumPoints: number;
  outputPath: string | null;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parsePayoutPlanArguments(
  argv: readonly string[],
): PayoutPlanOptions {
  let pool: string | null = null;
  let currency = "USD";
  let model: string | null = null;
  let minimumPoints = "0";
  let snapshotPath = DEFAULT_SNAPSHOT_PATH;
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--pool":
        pool = requireValue(flag, value);
        index += 1;
        break;
      case "--currency":
        currency = requireValue(flag, value);
        index += 1;
        break;
      case "--model":
        model = requireValue(flag, value);
        index += 1;
        break;
      case "--minimum-points":
        minimumPoints = requireValue(flag, value);
        index += 1;
        break;
      case "--snapshot":
        snapshotPath = resolve(requireValue(flag, value));
        index += 1;
        break;
      case "--out":
        outputPath = resolve(requireValue(flag, value));
        index += 1;
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }

  if (pool === null) {
    throw new Error(
      "--pool <amount> is required; the planner never assumes a pool size",
    );
  }
  if (model === null) {
    throw new Error(
      `--model <id> is required; the planner never assumes a distribution model. Choose one of ${Object.keys(DISTRIBUTION_MODELS).join(", ")}; no model is an approved payout rule.`,
    );
  }
  if (!/^\d{1,9}$/.test(minimumPoints)) {
    throw new Error("--minimum-points must be a non-negative integer");
  }
  resolveCurrency(currency);
  resolveModel(model);
  return {
    snapshotPath,
    pool,
    currency: currency as PayoutCurrencyCode,
    model: model as DistributionModelId,
    minimumPoints: Number(minimumPoints),
    outputPath,
  };
}

/** Records a snapshot path the way a plan should cite it, root-relative when possible. */
export function describeSnapshotPath(snapshotPath: string): string {
  const resolved = resolve(snapshotPath);
  const fromRoot = relative(REPOSITORY_ROOT, resolved);
  return fromRoot.length > 0 && !fromRoot.startsWith("..")
    ? fromRoot
    : resolved;
}

export interface SnapshotSource extends PayoutPlanSource {
  snapshot: unknown;
}

export async function readSnapshotSource(
  snapshotPath: string,
): Promise<SnapshotSource> {
  let text: string;
  try {
    text = await readFile(snapshotPath, "utf8");
  } catch (cause) {
    throw new Error(
      `cannot read the leaderboard snapshot at ${snapshotPath}: ${messageOf(cause)}`,
      { cause },
    );
  }
  if (text.trim().length === 0) {
    throw new Error(`the leaderboard snapshot at ${snapshotPath} is empty`);
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `the leaderboard snapshot at ${snapshotPath} is not valid JSON: ${messageOf(cause)}`,
      { cause },
    );
  }
  return {
    path: describeSnapshotPath(snapshotPath),
    digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    snapshot,
  };
}

/**
 * A payout plan is an operator artifact that names every scoring contributor
 * beside a dollar amount. Writing one into the published site directory would
 * ship it to slop.cash, and writing one anywhere Git can track would publish
 * it to this public repository on the next `git add`, so both fail closed. The
 * ignored operator directory is the sole in-tree destination.
 */
export function assertOperatorOutputPath(outputPath: string): string {
  const resolved = resolve(outputPath);
  if (
    resolved === PUBLISHED_SITE_DIRECTORY ||
    resolved.startsWith(`${PUBLISHED_SITE_DIRECTORY}${sep}`)
  ) {
    throw new Error(
      "a payout plan is operator-only and must never be written into the published site directory",
    );
  }
  const insideRepository =
    resolved === REPOSITORY_ROOT ||
    resolved.startsWith(`${REPOSITORY_ROOT}${sep}`);
  if (
    insideRepository &&
    !resolved.startsWith(`${OPERATOR_PLAN_DIRECTORY}${sep}`)
  ) {
    throw new Error(
      `a payout plan names every scoring contributor beside an amount and this repository is public: write it outside the working tree, or under the Git-ignored ${OPERATOR_PLAN_DIRECTORY_NAME}/ directory, not ${relative(REPOSITORY_ROOT, resolved) || resolved}`,
    );
  }
  return resolved;
}

export async function writePlanAtomically(
  plan: PayoutPlan,
  outputPath: string,
): Promise<void> {
  const resolved = assertOperatorOutputPath(outputPath);
  await mkdir(dirname(resolved), { recursive: true });
  const temporaryPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, resolved);
  } finally {
    // A failed atomic write may leave only its unique temporary file.
    await rm(temporaryPath, { force: true });
  }
}

export interface PayoutPlannerDependencies {
  readSource: (snapshotPath: string) => Promise<SnapshotSource>;
  write: (plan: PayoutPlan, outputPath: string) => Promise<void>;
  now: () => number;
}

export async function runPayoutPlanner(
  argv: readonly string[],
  dependencies: PayoutPlannerDependencies = {
    readSource: readSnapshotSource,
    write: writePlanAtomically,
    now: () => Date.now(),
  },
): Promise<PayoutPlan> {
  const options = parsePayoutPlanArguments(argv);
  const source = await dependencies.readSource(options.snapshotPath);
  const plan = createPayoutPlan({
    snapshot: source.snapshot,
    source: { path: source.path, digest: source.digest },
    rule: {
      model: options.model,
      pool: options.pool,
      currency: options.currency,
      minimumPoints: options.minimumPoints,
    },
    now: dependencies.now(),
  });
  if (options.outputPath !== null) {
    await dependencies.write(plan, options.outputPath);
  }
  return plan;
}

export function payoutPlannerUsage(): string {
  return `Usage: bun scripts/plan-payouts.ts --pool <amount> --model <id> [options]

Plans a hypothetical split of a contributor pool from the published
contribution ledger. Dry run only: it moves no money, credits no balance, and
does not determine payouts. The plan document goes to stdout and the readable
summary goes to stderr.

Options:
  --pool <amount>       Required. Pool size as a plain decimal, e.g. 10000 or 10000.00.
  --model <id>          Required. ${Object.keys(DISTRIBUTION_MODELS).join(" | ")}.
                        No model is an approved payout rule and the planner
                        picks none for you, so state the split you want to see.
  --currency <code>     ${Object.keys(PAYOUT_CURRENCIES).join(" | ")} (default USD). Selects the minor-unit scale.
  --minimum-points <n>  Snapshot points a contributor needs to be eligible (default 0).
  --snapshot <path>     Snapshot to plan from (default public/data/leaderboard.json).
  --out <path>          Also write the plan document there. A plan names every
                        scoring contributor beside an amount, so it must land
                        outside this public working tree or in the ignored
                        ${OPERATOR_PLAN_DIRECTORY_NAME}/ directory, never inside public/.
  --help, -h            Show this help.

The planner refuses a missing, empty, malformed, contract-violating, or
older-than-${MAX_SNAPSHOT_AGE_HOURS}-hour snapshot, refuses a snapshot whose leaders include a bot
or any non-user GitHub actor, and refuses an empty eligible set, rather than
emitting an empty, zero, or non-human plan.
`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(payoutPlannerUsage());
  } else {
    try {
      const plan = await runPayoutPlanner(argv);
      process.stderr.write(formatPayoutPlanSummary(plan));
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(
        `[slop.cash] payout plan failed: ${messageOf(error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
