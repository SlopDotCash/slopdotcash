/**
 * Defines the small browser-safe index of immutable reward-cycle artifacts.
 * Detailed allocations and transaction receipts remain separate public JSON
 * files while this index drives lifecycle labels and aggregate totals.
 */

import { findProject } from "./projects.mjs";
import { isSolanaAddress } from "./wallets";

export const CYCLE_INDEX_SCHEMA_VERSION = "1" as const;

export interface CycleFileReference {
  sha256: string;
  url: string;
}

export interface CycleWalletProof {
  address: string;
  chain: "solana";
  observedAt: string;
  sourceCommit: string;
  sourceUrl: string;
}

export type CycleIndexState =
  | "closed-no-awards"
  | "external-provisional"
  | "paid"
  | "payment-ready"
  | "review"
  | "settlement-planned";

export interface CycleIndexEntry {
  projectId: string;
  cycleId: string;
  kind: "external-prize-share" | "monthly-pool";
  state: CycleIndexState;
  generatedAt: string;
  contributionWindow: { from: string; to: string };
  reviewEndsAt: string | null;
  approvedAt: string | null;
  settledAt: string | null;
  reward: {
    currency: "USDC" | null;
    capMinor: string;
    suggestedMinor: string;
    approvedMinor: string;
    paidMinor: string;
    feeMinor: string;
    sharePartsPerMillion: number | null;
  };
  contributors: Array<{
    actor: { id: string; login: string };
    score: number;
    state:
      | "approved"
      | "excluded"
      | "external-share"
      | "held"
      | "paid"
      | "proposed"
      | "unclaimed";
    suggestedMinor: string;
    approvedMinor: string;
    paidMinor: string;
    sharePartsPerMillion: number | null;
    wallet: CycleWalletProof | null;
  }>;
  files: {
    sourceSnapshot: CycleFileReference;
    proposal: CycleFileReference;
    allocation: CycleFileReference | null;
    executionPlan: CycleFileReference | null;
    settlement: CycleFileReference | null;
  };
}

export interface CycleIndex {
  schemaVersion: typeof CYCLE_INDEX_SCHEMA_VERSION;
  generatedAt: string;
  cycles: CycleIndexEntry[];
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  if (
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    (pattern && !pattern.test(value))
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function iso(value: unknown, field: string): string {
  const result = text(
    value,
    field,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  );
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`${field} is not a UTC timestamp`);
  }
  return result;
}

function nullableIso(value: unknown, field: string): string | null {
  return value === null ? null : iso(value, field);
}

function minor(value: unknown, field: string): string {
  return text(value, field, /^(?:0|[1-9]\d*)$/u);
}

function fileReference(
  value: unknown,
  field: string,
  prefix: string,
): CycleFileReference {
  const reference = record(value, field);
  exact(reference, ["sha256", "url"], field);
  const url = text(reference.url, `${field}.url`);
  if (!url.startsWith(prefix) || !/\.json$/u.test(url) || url.includes("..")) {
    throw new TypeError(`${field}.url is outside its cycle`);
  }
  return {
    sha256: text(reference.sha256, `${field}.sha256`, /^[0-9a-f]{64}$/u),
    url,
  };
}

function nullableFileReference(
  value: unknown,
  field: string,
  prefix: string,
): CycleFileReference | null {
  return value === null ? null : fileReference(value, field, prefix);
}

function contributorWallet(
  value: unknown,
  field: string,
  login: string,
): CycleWalletProof | null {
  if (value === null) return null;
  const wallet = record(value, field);
  exact(
    wallet,
    ["address", "chain", "observedAt", "sourceCommit", "sourceUrl"],
    field,
  );
  const address = text(wallet.address, `${field}.address`);
  if (wallet.chain !== "solana" || !isSolanaAddress(address)) {
    throw new TypeError(`${field} is not a Solana wallet`);
  }
  const sourceCommit = text(
    wallet.sourceCommit,
    `${field}.sourceCommit`,
    /^[0-9a-f]{40}$/u,
  );
  const sourceUrl = text(wallet.sourceUrl, `${field}.sourceUrl`);
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch (error) {
    throw new TypeError(`${field}.sourceUrl is invalid`, { cause: error });
  }
  const expectedPath = `/${login}/${login}/blob/${sourceCommit}/README.md`;
  if (
    parsed.origin !== "https://github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.toLowerCase() !== expectedPath.toLowerCase()
  ) {
    throw new TypeError(`${field}.sourceUrl is not immutable profile proof`);
  }
  return {
    address,
    chain: "solana",
    observedAt: iso(wallet.observedAt, `${field}.observedAt`),
    sourceCommit,
    sourceUrl,
  };
}

function cycleEntry(value: unknown, index: number): CycleIndexEntry {
  const field = `cycle index.cycles[${index}]`;
  const entry = record(value, field);
  exact(
    entry,
    [
      "approvedAt",
      "contributionWindow",
      "contributors",
      "cycleId",
      "files",
      "generatedAt",
      "kind",
      "projectId",
      "reviewEndsAt",
      "reward",
      "settledAt",
      "state",
    ],
    field,
  );
  const projectId = text(
    entry.projectId,
    `${field}.projectId`,
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  );
  const project = findProject(projectId);
  if (!project) throw new TypeError(`${field}.projectId is unknown`);
  const cycleId = text(
    entry.cycleId,
    `${field}.cycleId`,
    /^\d{4}-(?:0[1-9]|1[0-2])$/u,
  );
  if (entry.kind !== "monthly-pool" && entry.kind !== "external-prize-share") {
    throw new TypeError(`${field}.kind is invalid`);
  }
  if (entry.kind !== project.reward.kind) {
    throw new TypeError(`${field}.kind differs from project policy`);
  }
  const states: CycleIndexState[] = [
    "closed-no-awards",
    "external-provisional",
    "paid",
    "payment-ready",
    "review",
    "settlement-planned",
  ];
  if (!states.includes(entry.state as CycleIndexState)) {
    throw new TypeError(`${field}.state is invalid`);
  }
  const window = record(
    entry.contributionWindow,
    `${field}.contributionWindow`,
  );
  exact(window, ["from", "to"], `${field}.contributionWindow`);
  const contributionWindow = {
    from: iso(window.from, `${field}.contributionWindow.from`),
    to: iso(window.to, `${field}.contributionWindow.to`),
  };
  if (
    contributionWindow.from.slice(0, 7) !== cycleId ||
    Date.parse(contributionWindow.to) <= Date.parse(contributionWindow.from)
  ) {
    throw new TypeError(`${field}.contributionWindow is invalid`);
  }
  const reward = record(entry.reward, `${field}.reward`);
  exact(
    reward,
    [
      "approvedMinor",
      "capMinor",
      "currency",
      "feeMinor",
      "paidMinor",
      "sharePartsPerMillion",
      "suggestedMinor",
    ],
    `${field}.reward`,
  );
  if (reward.currency !== null && reward.currency !== "USDC") {
    throw new TypeError(`${field}.reward.currency is invalid`);
  }
  const share = reward.sharePartsPerMillion;
  if (
    share !== null &&
    (!Number.isSafeInteger(share) ||
      Number(share) < 0 ||
      Number(share) > 1_000_000)
  ) {
    throw new TypeError(`${field}.reward.sharePartsPerMillion is invalid`);
  }
  const normalizedReward = {
    currency: reward.currency as "USDC" | null,
    capMinor: minor(reward.capMinor, `${field}.reward.capMinor`),
    suggestedMinor: minor(
      reward.suggestedMinor,
      `${field}.reward.suggestedMinor`,
    ),
    approvedMinor: minor(reward.approvedMinor, `${field}.reward.approvedMinor`),
    paidMinor: minor(reward.paidMinor, `${field}.reward.paidMinor`),
    feeMinor: minor(reward.feeMinor, `${field}.reward.feeMinor`),
    sharePartsPerMillion: share === null ? null : Number(share),
  };
  if (
    BigInt(normalizedReward.approvedMinor) >
      BigInt(normalizedReward.capMinor) ||
    BigInt(normalizedReward.paidMinor) > BigInt(normalizedReward.approvedMinor)
  ) {
    throw new TypeError(`${field}.reward money totals do not reconcile`);
  }
  if (!Array.isArray(entry.contributors)) {
    throw new TypeError(`${field}.contributors must be an array`);
  }
  const contributorStates = new Set([
    "approved",
    "excluded",
    "external-share",
    "held",
    "paid",
    "proposed",
    "unclaimed",
  ]);
  const contributors = entry.contributors.map((value, contributorIndex) => {
    const contributorField = `${field}.contributors[${contributorIndex}]`;
    const contributor = record(value, contributorField);
    exact(
      contributor,
      [
        "actor",
        "approvedMinor",
        "paidMinor",
        "score",
        "sharePartsPerMillion",
        "state",
        "suggestedMinor",
        "wallet",
      ],
      contributorField,
    );
    const actor = record(contributor.actor, `${contributorField}.actor`);
    exact(actor, ["id", "login"], `${contributorField}.actor`);
    const actorId = text(actor.id, `${contributorField}.actor.id`);
    const login = text(
      actor.login,
      `${contributorField}.actor.login`,
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u,
    );
    if (
      !Number.isSafeInteger(contributor.score) ||
      Number(contributor.score) < 0
    ) {
      throw new TypeError(`${contributorField}.score is invalid`);
    }
    if (!contributorStates.has(String(contributor.state))) {
      throw new TypeError(`${contributorField}.state is invalid`);
    }
    const state =
      contributor.state as CycleIndexEntry["contributors"][number]["state"];
    const wallet = contributorWallet(
      contributor.wallet,
      `${contributorField}.wallet`,
      login,
    );
    if (
      (entry.kind === "external-prize-share" && wallet !== null) ||
      (state === "unclaimed" && wallet !== null) ||
      (["approved", "paid", "proposed"].includes(state) && wallet === null)
    ) {
      throw new TypeError(`${contributorField}.wallet contradicts its state`);
    }
    const share = contributor.sharePartsPerMillion;
    if (
      share !== null &&
      (!Number.isSafeInteger(share) ||
        Number(share) < 0 ||
        Number(share) > 1_000_000)
    ) {
      throw new TypeError(
        `${contributorField}.sharePartsPerMillion is invalid`,
      );
    }
    const suggestedMinor = minor(
      contributor.suggestedMinor,
      `${contributorField}.suggestedMinor`,
    );
    const approvedMinor = minor(
      contributor.approvedMinor,
      `${contributorField}.approvedMinor`,
    );
    const paidMinor = minor(
      contributor.paidMinor,
      `${contributorField}.paidMinor`,
    );
    if (
      BigInt(approvedMinor) > BigInt(suggestedMinor) ||
      BigInt(paidMinor) > BigInt(approvedMinor)
    ) {
      throw new TypeError(`${contributorField} money totals do not reconcile`);
    }
    return {
      actor: { id: actorId, login },
      score: Number(contributor.score),
      state,
      suggestedMinor,
      approvedMinor,
      paidMinor,
      sharePartsPerMillion: share === null ? null : Number(share),
      wallet,
    };
  });
  if (
    new Set(contributors.map((contributor) => contributor.actor.id)).size !==
    contributors.length
  ) {
    throw new TypeError(`${field}.contributors repeats an actor`);
  }
  const contributorTotals = contributors.reduce(
    (totals, contributor) => ({
      suggested: totals.suggested + BigInt(contributor.suggestedMinor),
      approved: totals.approved + BigInt(contributor.approvedMinor),
      paid: totals.paid + BigInt(contributor.paidMinor),
      share: totals.share + (contributor.sharePartsPerMillion ?? 0),
    }),
    { suggested: 0n, approved: 0n, paid: 0n, share: 0 },
  );
  if (
    contributorTotals.suggested !== BigInt(normalizedReward.suggestedMinor) ||
    contributorTotals.approved !== BigInt(normalizedReward.approvedMinor) ||
    contributorTotals.paid !== BigInt(normalizedReward.paidMinor) ||
    contributorTotals.share !== (normalizedReward.sharePartsPerMillion ?? 0)
  ) {
    throw new TypeError(
      `${field}.contributors do not reconcile with reward totals`,
    );
  }
  const prefix = `/data/cycles/${projectId}/${cycleId}/`;
  const files = record(entry.files, `${field}.files`);
  exact(
    files,
    ["allocation", "executionPlan", "proposal", "settlement", "sourceSnapshot"],
    `${field}.files`,
  );
  const normalizedFiles = {
    sourceSnapshot: fileReference(
      files.sourceSnapshot,
      `${field}.files.sourceSnapshot`,
      prefix,
    ),
    proposal: fileReference(files.proposal, `${field}.files.proposal`, prefix),
    allocation: nullableFileReference(
      files.allocation,
      `${field}.files.allocation`,
      prefix,
    ),
    executionPlan: nullableFileReference(
      files.executionPlan,
      `${field}.files.executionPlan`,
      prefix,
    ),
    settlement: nullableFileReference(
      files.settlement,
      `${field}.files.settlement`,
      prefix,
    ),
  };
  const state = entry.state as CycleIndexState;
  const isEmptyClose = state === "closed-no-awards";
  const hasZeroReward =
    normalizedReward.suggestedMinor === "0" &&
    normalizedReward.approvedMinor === "0" &&
    normalizedReward.paidMinor === "0" &&
    normalizedReward.feeMinor === "0" &&
    (normalizedReward.sharePartsPerMillion ?? 0) === 0;
  if (
    (isEmptyClose &&
      (contributors.length !== 0 ||
        !hasZeroReward ||
        normalizedFiles.allocation ||
        normalizedFiles.executionPlan ||
        normalizedFiles.settlement)) ||
    (state === "external-provisional" &&
      (entry.kind !== "external-prize-share" ||
        normalizedFiles.allocation ||
        normalizedFiles.executionPlan ||
        normalizedFiles.settlement)) ||
    (!isEmptyClose &&
      state !== "external-provisional" &&
      entry.kind !== "monthly-pool") ||
    (["payment-ready", "settlement-planned", "paid"].includes(state) &&
      !normalizedFiles.allocation) ||
    (["settlement-planned", "paid"].includes(state) &&
      !normalizedFiles.executionPlan) ||
    (state === "paid" && !normalizedFiles.settlement)
  ) {
    throw new TypeError(`${field}.state does not match its immutable files`);
  }
  return {
    projectId,
    cycleId,
    kind: entry.kind,
    state,
    generatedAt: iso(entry.generatedAt, `${field}.generatedAt`),
    contributionWindow,
    reviewEndsAt: nullableIso(entry.reviewEndsAt, `${field}.reviewEndsAt`),
    approvedAt: nullableIso(entry.approvedAt, `${field}.approvedAt`),
    settledAt: nullableIso(entry.settledAt, `${field}.settledAt`),
    reward: normalizedReward,
    contributors,
    files: normalizedFiles,
  };
}

/** Validates cycle index bytes before the browser renders financial state. */
export function assertCycleIndex(value: unknown): asserts value is CycleIndex {
  const index = record(value, "cycle index");
  exact(index, ["cycles", "generatedAt", "schemaVersion"], "cycle index");
  if (index.schemaVersion !== CYCLE_INDEX_SCHEMA_VERSION) {
    throw new TypeError("cycle index schema version is invalid");
  }
  iso(index.generatedAt, "cycle index.generatedAt");
  if (!Array.isArray(index.cycles)) {
    throw new TypeError("cycle index.cycles must be an array");
  }
  const cycles = index.cycles.map(cycleEntry);
  const keys = cycles.map((entry) => `${entry.projectId}\0${entry.cycleId}`);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("cycle index repeats a project cycle");
  }
  for (let position = 1; position < cycles.length; position += 1) {
    const previous = cycles[position - 1];
    const current = cycles[position];
    if (
      previous.cycleId < current.cycleId ||
      (previous.cycleId === current.cycleId &&
        previous.projectId.localeCompare(current.projectId) > 0)
    ) {
      throw new TypeError("cycle index is not canonically ordered");
    }
  }
}
