// spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown"
import { slopDecimals, slopFeeBase, slopRateScaled, submissionFeeItem, validStableFee } from "@repo/backend/client";
import { reportDepositItem } from "@repo/security/client";
import { toAmount } from "@repo/settlement/kernels/amounts";
import type { FeeOutcome, FeeRecord, FeeWay as RuleWay, Subject } from "../../../gen/frontend__feePages.ts";
import type { RegistryBoot, RegistryProject } from "../../reads/registry.vibe";
import { findHistoricalProjectByRepositoryId } from "../../reads/registry.vibe";
import {
  type FeeTerms,
  type FeeWay,
  type SolanaFeeWay,
  type WayKind,
  checkSolanaWay,
  isSolanaFeeNetwork,
  isSolanaSignature,
  isSolanaTransactionOrAddress,
  publishedWay,
  tokenOf,
  wayKey,
} from "../../wallets/fee/feeCalls.ts";

export type { FeeTerms, FeeWay, SolanaFeeWay };

export type RecordOutcome = "refund_due" | "kept_due" | "refunded" | "kept";

export interface FeeRoute {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface FeeRepository {
  readonly projectName: string;
  readonly projectSlug: string;
  readonly repository: string;
  readonly repositoryId: string;
}

export interface FeePayment {
  readonly at: string;
  readonly network: string;
  readonly depositId: number;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly amount: string;
  readonly transaction: string;
  readonly finalized: boolean;
  readonly kind: WayKind;
}

export interface ShownRecord {
  readonly item: string;
  readonly stableMinor: string;
  readonly due: ReadonlyArray<FeeWay>;
  readonly solana: SolanaFeeWay | null;
  readonly slopWithheld: boolean;
  readonly paid: FeePayment | null;
  readonly outcome: RecordOutcome | null;
  readonly resolveTransaction: string | null;
}

export interface CheckedRecord {
  readonly record: FeeRecord;
  readonly ratesRead: boolean;
  readonly shown: ShownRecord;
}

export interface FeeRates {
  readonly current: string | null;
  readonly previous: string | null;
}

export type FeeSubject =
  | { readonly kind: "PullRequestFee"; readonly repositoryId: string; readonly pullNumber: number; readonly item: string }
  | { readonly kind: "ReportDeposit"; readonly caseId: string; readonly item: string }
  | { readonly kind: "StandingDeposit"; readonly githubId: string; readonly item: string };

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const repoPattern = /^[A-Za-z0-9._-]{1,100}$/u;
const numberPattern = /^[1-9][0-9]{0,9}$/u;
const casePattern = /^sc_[A-Za-z0-9_-]{8,72}$/u;
const hashPattern = /^0x[0-9a-fA-F]{64}$/u;
const amountPattern = /^[1-9][0-9]{0,38}$/u;
const repositoryIdPattern = /^[1-9][0-9]{0,15}$/u;
const uint128Max = (1n << 128n) - 1n;
const wholeSlop = 10n ** BigInt(slopDecimals);
const outcomes: Readonly<Record<RecordOutcome, FeeOutcome>> = { refund_due: "RefundDue", kept_due: "KeptDue", refunded: "Refunded", kept: "Kept" };

/** @throws {never} */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** @throws {never} */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** @throws {never} */
function instant(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** @throws {never} */
function optional(value: unknown, valid: (entry: unknown) => boolean): boolean {
  return value === null || value === undefined || valid(value);
}

/** @throws {never} */
function amountOf(value: string): bigint {
  return amountPattern.test(value) ? BigInt(value) : 0n;
}

/** @throws {never} */
function parseDepositId(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
  if (typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
  }
  return undefined;
}

/** @throws {never} */
export function feeRoute(owner: string, repo: string, number: string): FeeRoute | undefined {
  if (!ownerPattern.test(owner) || !repoPattern.test(repo) || repo === "." || repo === ".." || !numberPattern.test(number)) return undefined;
  return { owner, repo, number: Number(number) };
}

/** @throws {never} */
export function reportCase(caseId: string): string | undefined {
  return casePattern.test(caseId) ? caseId : undefined;
}

/** @throws {never} */
export function feeRepository(route: FeeRoute, boot: RegistryBoot): FeeRepository | undefined {
  const named = `${route.owner}/${route.repo}`.toLowerCase();
  const project: RegistryProject | undefined = findHistoricalProjectByRepositoryId(boot, named);
  const repositories = Array.isArray(project?.repositories) ? project.repositories.map(recordOf) : [];
  const index = repositories.findIndex((repository) => [repository?.id, ...(Array.isArray(repository?.aliases) ? (repository.aliases as ReadonlyArray<unknown>) : [])].some((name) => typeof name === "string" && name.toLowerCase() === named));
  const repository = repositories[index];
  if (project === undefined || repository === undefined) return undefined;
  const repositoryId = index === 0 ? recordOf(project.authority)?.repositoryId : repository.githubId;
  if (typeof repositoryId !== "string" || !repositoryIdPattern.test(repositoryId)) return undefined;
  return { projectName: text(project.name), projectSlug: text(project.slug), repository: text(repository.id), repositoryId };
}

/** @throws {never} */
export function pullRequestSubject(repositoryId: string, pullNumber: number): FeeSubject | undefined {
  const item = submissionFeeItem(repositoryId, pullNumber);
  return item === undefined ? undefined : { kind: "PullRequestFee", repositoryId, pullNumber, item };
}

/** @throws {never} */
export function reportSubject(caseId: string): FeeSubject | undefined {
  const item = reportDepositItem(caseId);
  return item === undefined ? undefined : { kind: "ReportDeposit", caseId, item };
}

/** @throws {never} */
export function standingSubject(githubId: string, item: string): FeeSubject | undefined {
  return githubId !== "" && /^0x[0-9a-fA-F]{64}$/u.test(item) ? { kind: "StandingDeposit", githubId, item: item.toLowerCase() } : undefined;
}

/** @throws {never} */
export function feeRatesOf(value: unknown): FeeRates | undefined {
  const body = recordOf(value);
  if (body?.schema !== "slop-submission-fee-rate-v1") return undefined;
  const rate = (entry: unknown): string | null | undefined => {
    if (entry === null) return null;
    const slopPerUsd = recordOf(entry)?.slopPerUsd;
    return typeof slopPerUsd === "string" && slopRateScaled(slopPerUsd) !== undefined ? slopPerUsd : undefined;
  };
  const current = rate(body.rate);
  const previous = rate(body.previous);
  if (current === undefined || previous === undefined || (current === null && previous !== null)) return undefined;
  return { current, previous };
}

/** @throws {never} */
export function publishedSlopAmounts(stableMinor: string, rates: FeeRates): ReadonlyArray<{ readonly amount: string; readonly minimumAccepted: string }> {
  if (rates.current === null) return [];
  const now = slopFeeBase(stableMinor, rates.current);
  if (now === undefined) return [];
  if (rates.previous === null) return [{ amount: now, minimumAccepted: now }];
  const before = slopFeeBase(stableMinor, rates.previous);
  if (before === undefined) return [];
  return [{ amount: now, minimumAccepted: BigInt(before) < BigInt(now) ? before : now }, { amount: before, minimumAccepted: before }];
}

/** @throws {never} */
export function listsSlop(value: unknown): boolean {
  const due = recordOf(value)?.due;
  return Array.isArray(due) && due.some((entry) => recordOf(entry)?.symbol === "SLOP");
}

interface Listed {
  readonly rule: RuleWay;
  readonly shown: FeeWay | undefined;
}

/** @throws {never} */
function listedWay(entry: unknown, subject: FeeSubject, terms: FeeTerms, stableMinor: string, rates: FeeRates | undefined): Listed {
  const way = recordOf(entry);
  const network = text(way?.network);
  const token = text(way?.token);
  const amount = text(way?.amount);
  const singleSlop = subject.kind === "ReportDeposit" || subject.kind === "StandingDeposit";
  const minimumAccepted = singleSlop ? amount : text(way?.minimumAccepted);
  const fallbackChainId = terms.networks.find((item) => item.network === network)?.chainId ?? -1;
  const chainId = typeof way?.chainId === "number" ? way.chainId : subject.kind === "StandingDeposit" ? fallbackChainId : -1;
  const shown = publishedWay(terms, {
    network,
    chainId,
    contract: text(way?.contract),
    token,
    symbol: text(way?.symbol),
    decimals: typeof way?.decimals === "number" ? way.decimals : -1,
    amount,
    minimumAccepted,
    keptTo: text(way?.keptTo),
  });
  const kind = tokenOf(terms, network, token)?.kind ?? "stable";
  const pairs = rates === undefined ? [] : publishedSlopAmounts(stableMinor, rates);
  return {
    rule: {
      network,
      token: token.toLowerCase(),
      kind: kind === "slop" ? "SlopWay" : "StableWay",
      published: shown !== undefined,
      withinUint128: amountOf(amount) <= uint128Max,
      amount: toAmount(amountOf(amount)),
      minimum: toAmount(amountOf(minimumAccepted)),
      wholeSlop: amountOf(amount) % wholeSlop === 0n,
      publishedSlopPair: pairs.some((pair) => pair.amount === amount && pair.minimumAccepted === minimumAccepted),
    },
    shown,
  };
}

/** @throws {never} */
function solanaRuleWay(solana: SolanaFeeWay): RuleWay {
  return {
    network: solana.network,
    token: solana.token.toLowerCase(),
    kind: "StableWay",
    published: true,
    withinUint128: amountOf(solana.amount) <= uint128Max,
    amount: toAmount(amountOf(solana.amount)),
    minimum: toAmount(amountOf(solana.minimumAccepted)),
    wholeSlop: false,
    publishedSlopPair: false,
  };
}

/** @throws {never} */
function paymentOf(value: unknown, terms: FeeTerms): FeePayment | undefined {
  const paid = recordOf(value);
  const network = text(paid?.network);
  const token = text(paid?.token);
  const facts = tokenOf(terms, network, token);
  const depositId = parseDepositId(paid?.depositId);
  const amount = text(paid?.amount);
  const transaction = text(paid?.transaction);
  const solana = isSolanaFeeNetwork(network);
  const validTx = solana ? isSolanaTransactionOrAddress(transaction) : hashPattern.test(transaction);
  if (paid === undefined || facts === undefined || depositId === undefined || typeof paid.finalized !== "boolean"
    || !instant(paid.at) || !amountPattern.test(amount) || !validTx) return undefined;
  return { at: text(paid.at), network, depositId, token, symbol: facts.symbol, decimals: facts.decimals, amount, transaction, finalized: paid.finalized, kind: facts.kind };
}

/** @throws {never} */
function validResolveTx(entry: unknown, paid: FeePayment | null | undefined): boolean {
  if (typeof entry !== "string") return false;
  return paid !== null && paid !== undefined && isSolanaFeeNetwork(paid.network)
    ? isSolanaSignature(entry)
    : hashPattern.test(entry);
}

/** @throws {never} */
function ownRecord(body: Record<string, unknown> | undefined, subject: FeeSubject, payment: FeePayment | null | undefined): boolean {
  if (body === undefined || typeof body.item !== "string" || body.item.toLowerCase() !== subject.item || !Array.isArray(body.due)
    || !optional(body.outcomeAt, instant) || !optional(body.resolveTransaction, (entry) => validResolveTx(entry, payment))
    || !optional(body.outcome, (entry) => typeof entry === "string" && Object.hasOwn(outcomes, entry))) return false;
  if (subject.kind === "StandingDeposit") {
    return optional(body.askedAt, instant);
  }
  if (!instant(body.askedAt)) return false;
  return subject.kind === "PullRequestFee"
    ? body.schema === "slop-submission-fee-item-v1" && String(body.repositoryId) === subject.repositoryId && body.pullNumber === subject.pullNumber
    : body.schema === "slop-report-deposit-v1" && body.caseId === subject.caseId;
}

/** @throws {never} */
export function checkedRecord(value: unknown, subject: FeeSubject, terms: FeeTerms, rates: FeeRates | undefined): CheckedRecord {
  const body = recordOf(value);
  const payment = body?.paid === null || body?.paid === undefined ? null : paymentOf(body.paid, terms);
  let own = ownRecord(body, subject, payment);
  const stableMinor = subject.kind === "PullRequestFee" ? text(body?.stableMinor) : "";
  const rawDue = own && Array.isArray(body?.due) ? body.due : [];
  const isSolanaEntry = (entry: unknown) => isSolanaFeeNetwork(text(recordOf(entry)?.network));
  const solanaEntries = subject.kind === "PullRequestFee" ? rawDue.filter(isSolanaEntry) : [];
  let solana: SolanaFeeWay | null = null;
  if (solanaEntries.length > 1) {
    own = false;
  } else if (solanaEntries.length === 1) {
    const checked = checkSolanaWay(terms, solanaEntries[0], stableMinor);
    if (checked === "invalid") own = false;
    else solana = checked;
  }
  const evmEntries = subject.kind === "PullRequestFee" ? rawDue.filter((entry) => !isSolanaEntry(entry)) : rawDue;
  const listed = evmEntries.map((entry) => listedWay(entry, subject, terms, stableMinor, rates));
  const outcome = typeof body?.outcome === "string" && Object.hasOwn(outcomes, body.outcome) ? (body.outcome as RecordOutcome) : null;
  const ratesRead = rates !== undefined;
  const ruleSubject: Subject = subject.kind === "PullRequestFee" ? "PullRequestFee" : "ReportDeposit";
  const ways: RuleWay[] = [
    ...listed.map((entry) => entry.rule),
    ...(solana !== null ? [solanaRuleWay(solana)] : []),
  ];
  const record: FeeRecord = {
    subject: ruleSubject,
    ownRecord: own,
    stableInLimits: subject.kind !== "PullRequestFee" || validStableFee(stableMinor),
    stableMinor: toAmount(amountOf(stableMinor)),
    ways,
    paid: body?.paid !== null && body?.paid !== undefined,
    paidPublished: payment !== undefined && payment !== null,
    paidNetwork: payment?.network ?? "",
    paidKind: payment?.kind === "slop" ? "SlopWay" : "StableWay",
    outcome: outcome === null ? "NoOutcome" : outcomes[outcome],
  };
  const offered = listed.flatMap((entry) => (entry.shown !== undefined && (ratesRead || entry.shown.kind === "stable" || subject.kind !== "PullRequestFee") ? [entry.shown] : []));
  return {
    record,
    ratesRead,
    shown: {
      item: subject.item,
      stableMinor,
      due: offered,
      solana,
      slopWithheld: subject.kind === "PullRequestFee" && listed.some((entry) => entry.shown?.kind === "slop") && !ratesRead,
      paid: payment ?? null,
      outcome,
      resolveTransaction: typeof body?.resolveTransaction === "string" ? body.resolveTransaction : null,
    },
  };
}

/** @throws {never} */
export function stillDue(fresh: ShownRecord, reviewed: FeeWay): boolean {
  const current = fresh.due.find((entry) => wayKey(entry) === wayKey(reviewed));
  return current !== undefined && current.amount === reviewed.amount;
}

/** @throws {never} */
export function stillDueSolana(fresh: ShownRecord, reviewed: SolanaFeeWay): boolean {
  return fresh.solana !== null
    && fresh.solana.network === reviewed.network
    && fresh.solana.token === reviewed.token
    && fresh.solana.amount === reviewed.amount;
}
