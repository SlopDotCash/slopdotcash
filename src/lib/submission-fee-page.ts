/**
 * The contributor pay page for the refundable submission fee
 * (`/fee/<owner>/<repo>/<number>`; operator decision, 19 November 2026; PRD
 * section 5). This file holds the page's pure rules: which pull request an
 * address names, which registered repository that is, and whether the fee
 * record the API returned may be shown and paid.
 *
 * The address bar only names the pull request. The numeric repository id
 * comes from the project registry, the item hash is computed here, and every
 * way to pay the API lists must match the published address tables in
 * `submission-fee.mjs` before the page offers it. A record that does not
 * match is refused whole; the page never repairs it.
 */

import { formatBaseUnits } from "./base-units.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CHAIN_IDS,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_SLOP_DECIMALS,
  SUBMISSION_FEE_STABLE_DECIMALS,
  SUBMISSION_FEE_TOKENS,
  type SubmissionFeeTerms,
  submissionFeeItem,
  submissionFeeTokenKind,
  validStableFee,
} from "./submission-fee.mjs";

/** The pull request an address names. Nothing else is read from the address. */
export type FeeRoute = { owner: string; repo: string; number: number };

/** One verified way to pay: every field equals the published tables. */
export type FeeWay = {
  network: string;
  chainId: number;
  contract: string;
  token: string;
  symbol: string;
  decimals: number;
  /** Base units to deposit now. */
  amount: string;
  minimumAccepted: string;
  keptTo: string;
  kind: "stable" | "slop";
};

export type FeeOutcome = "refund_due" | "kept_due" | "refunded" | "kept";

export type FeePayment = {
  at: string;
  network: string;
  depositId: number;
  token: string;
  symbol: string;
  decimals: number;
  amount: string;
  transaction: string;
  /** False while the deposit's block can still be replaced. */
  finalized: boolean;
  kind: "stable" | "slop";
};

export type FeeItem = {
  repositoryId: string;
  pullNumber: number;
  item: string;
  stableMinor: string;
  askedAt: string;
  due: FeeWay[];
  paid: FeePayment | null;
  outcome: FeeOutcome | null;
  outcomeAt: string | null;
  resolveTransaction: string | null;
};

/** The published tables, with every key present. */
export type FeeTables = Required<SubmissionFeeTerms>;

export const PUBLISHED_FEE_TABLES: FeeTables = {
  tokens: SUBMISSION_FEE_TOKENS,
  contracts: SUBMISSION_FEE_CONTRACTS,
  keptTo: SUBMISSION_FEE_KEPT_TO,
  burn: SUBMISSION_FEE_BURN,
  chainIds: SUBMISSION_FEE_CHAIN_IDS,
};

// GitHub's own limits: a login of up to 39 letters, digits and single
// hyphens; a repository name of up to 100 letters, digits, ".", "_" and "-".
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const NUMBER = /^[1-9][0-9]{0,9}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const AMOUNT = /^[1-9][0-9]{0,38}$/u;
const UINT128_MAX = (1n << 128n) - 1n;
const OUTCOMES: readonly string[] = [
  "refund_due",
  "kept_due",
  "refunded",
  "kept",
];

const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/** The pull request named by `/fee/<owner>/<repo>/<number>`, or null. */
export function feeRoute(
  owner: string,
  repo: string,
  number: string,
): FeeRoute | null {
  if (
    !OWNER.test(owner) ||
    !REPO.test(repo) ||
    repo === "." ||
    repo === ".." ||
    !NUMBER.test(number)
  )
    return null;
  return { owner, repo, number: Number(number) };
}

/**
 * The registered repository an address names, with its numeric GitHub id.
 * The registry records that id for every repository: the first one under
 * `authority.repositoryId`, an appended one under its own `githubId`. A
 * repository that no project lists has no fee, so it resolves to null.
 */
export function feeRepository(
  route: FeeRoute,
  find: (repositoryId: string) => ProjectDefinition | null,
): {
  projectId: string;
  projectName: string;
  projectSlug: string;
  /** The registry's own spelling of "owner/name". */
  repository: string;
  repositoryId: string;
} | null {
  const named = `${route.owner}/${route.repo}`.toLowerCase();
  const project = find(named);
  if (!project) return null;
  const index = project.repositories.findIndex((repository) =>
    [repository.id, ...(repository.aliases ?? [])].some(
      (name) => name.toLowerCase() === named,
    ),
  );
  if (index < 0) return null;
  const repository = project.repositories[index];
  const repositoryId =
    index === 0 ? project.authority.repositoryId : repository.githubId;
  if (
    typeof repositoryId !== "string" ||
    !/^[1-9][0-9]{0,15}$/u.test(repositoryId)
  )
    return null;
  return {
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    repository: repository.id,
    repositoryId,
  };
}

/** The storage slot of a tab's saved wallet request for one pull request. */
export function feeDepositKey(item: string): string {
  return `slop:fee-deposit:v1:${item.toLowerCase()}`;
}

/** The API path of one pull request's fee record. */
export function feeItemPath(repositoryId: string, pullNumber: number): string {
  return `/api/v1/submission-fee/items/${repositoryId}/${pullNumber}`;
}

/** The record did not match the published tables; nothing from it is used. */
export class FeeRecordError extends Error {
  constructor() {
    super(
      "The fee record for this pull request could not be checked against Slop's published addresses. Do not pay from this page.",
    );
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new FeeRecordError();
  return value as Record<string, unknown>;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new FeeRecordError();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw new FeeRecordError();
  return value;
}

/** The token's published symbol and decimals on a network, or a refusal. */
function tokenFacts(network: string, token: string, tables: FeeTables) {
  const kind = submissionFeeTokenKind(network, token, tables);
  if (kind === null) throw new FeeRecordError();
  if (kind === "slop")
    return { kind, symbol: "SLOP", decimals: SUBMISSION_FEE_SLOP_DECIMALS };
  const entry = tables.tokens[network];
  const symbol = (["usdc", "usdg"] as const).find(
    (name) => typeof entry[name] === "string" && same(entry[name], token),
  );
  if (!symbol) throw new FeeRecordError();
  return {
    kind,
    symbol: symbol.toUpperCase(),
    decimals: SUBMISSION_FEE_STABLE_DECIMALS,
  };
}

function way(
  value: unknown,
  stableMinor: string | null,
  tables: FeeTables,
): FeeWay {
  const entry = record(value);
  const network = entry.network;
  if (typeof network !== "string" || !Object.hasOwn(tables.tokens, network))
    throw new FeeRecordError();
  const contract = tables.contracts[network];
  const chainId = tables.chainIds[network];
  const token = text(entry.token, ADDRESS);
  const facts = tokenFacts(network, token, tables);
  const keptTo = facts.kind === "slop" ? tables.burn : tables.keptTo[network];
  const amount = text(entry.amount, AMOUNT);
  const minimumAccepted = text(entry.minimumAccepted, AMOUNT);
  if (
    typeof contract !== "string" ||
    !ADDRESS.test(contract) ||
    typeof entry.contract !== "string" ||
    !same(entry.contract, contract) ||
    !Number.isSafeInteger(chainId) ||
    entry.chainId !== chainId ||
    typeof keptTo !== "string" ||
    typeof entry.keptTo !== "string" ||
    !same(entry.keptTo, keptTo) ||
    entry.symbol !== facts.symbol ||
    entry.decimals !== facts.decimals ||
    BigInt(amount) > UINT128_MAX ||
    BigInt(minimumAccepted) > BigInt(amount) ||
    // A stablecoin fee is the pull request's own recorded fee, exactly.
    (facts.kind === "stable" &&
      (stableMinor === null
        ? !validStableFee(amount) || minimumAccepted !== amount
        : amount !== stableMinor || minimumAccepted !== stableMinor))
  )
    throw new FeeRecordError();
  // The published spelling is used from here on, never the reply's.
  return {
    network,
    chainId,
    contract,
    token,
    symbol: facts.symbol,
    decimals: facts.decimals,
    amount,
    minimumAccepted,
    keptTo,
    kind: facts.kind,
  };
}

/**
 * A way to pay that this browser tab saved with a wallet request. It is
 * checked against the published tables again before any transaction is read
 * for it; its amount is the one that was reviewed then.
 */
export function savedFeeWay(
  value: unknown,
  tables: FeeTables = PUBLISHED_FEE_TABLES,
): FeeWay {
  return way(value, null, tables);
}

/**
 * Reads the API's fee record for one pull request. It must be the record of
 * exactly this repository and number, its item must be the hash computed
 * here, and each way to pay must name the published contract, chain, token
 * and kept-to address. Anything else throws; nothing is offered from it.
 */
export function readFeeItem(
  value: unknown,
  repositoryId: string,
  pullNumber: number,
  tables: FeeTables = PUBLISHED_FEE_TABLES,
): FeeItem {
  const body = record(value);
  const item = submissionFeeItem(repositoryId, pullNumber);
  if (
    body.schema !== "slop-submission-fee-item-v1" ||
    String(body.repositoryId) !== repositoryId ||
    body.pullNumber !== pullNumber ||
    typeof body.item !== "string" ||
    !same(body.item, item) ||
    typeof body.stableMinor !== "string" ||
    !validStableFee(body.stableMinor) ||
    !Array.isArray(body.due) ||
    body.due.length > 8
  )
    throw new FeeRecordError();
  const stableMinor = body.stableMinor;
  const due = body.due.map((entry) => way(entry, stableMinor, tables));
  if (
    new Set(due.map((entry) => `${entry.network}:${entry.token.toLowerCase()}`))
      .size !== due.length
  )
    throw new FeeRecordError();
  let paid: FeePayment | null = null;
  if (body.paid !== null && body.paid !== undefined) {
    const payment = record(body.paid);
    const network = payment.network;
    if (
      typeof network !== "string" ||
      !Object.hasOwn(tables.tokens, network) ||
      !Number.isSafeInteger(payment.depositId) ||
      (payment.depositId as number) < 1 ||
      typeof payment.finalized !== "boolean"
    )
      throw new FeeRecordError();
    const token = text(payment.token, ADDRESS);
    paid = {
      at: instant(payment.at),
      network,
      depositId: payment.depositId as number,
      token,
      ...tokenFacts(network, token, tables),
      amount: text(payment.amount, AMOUNT),
      transaction: text(payment.transaction, HASH),
      finalized: payment.finalized,
    };
  }
  const outcome = body.outcome ?? null;
  if (outcome !== null && !OUTCOMES.includes(outcome as string))
    throw new FeeRecordError();
  // Nothing is due once a deposit is recorded, and nothing is decided before one.
  if (paid ? due.length > 0 : outcome !== null) throw new FeeRecordError();
  return {
    repositoryId,
    pullNumber,
    item,
    stableMinor,
    askedAt: instant(body.askedAt),
    due,
    paid,
    outcome: outcome as FeeOutcome | null,
    outcomeAt:
      body.outcomeAt === null || body.outcomeAt === undefined
        ? null
        : instant(body.outcomeAt),
    resolveTransaction:
      body.resolveTransaction === null || body.resolveTransaction === undefined
        ? null
        : text(body.resolveTransaction, HASH),
  };
}

/** "2 USDC", "75 SLOP": the exact amount, without trailing zeros. */
export function feeAmountText(amount: {
  amount: string;
  decimals: number;
  symbol: string;
}): string {
  return `${formatBaseUnits(amount.amount, amount.decimals)} ${amount.symbol}`;
}

/** Where a kept deposit goes, in the words the terms use. */
export function keptToText(kind: "stable" | "slop"): string {
  return kind === "slop" ? "the burn address" : "Slop's fee wallet";
}
