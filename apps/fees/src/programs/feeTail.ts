// spec/fees/feeReport.md, "Only an administrator reads the fee report, and it never contains a signed transaction or secret"
import { type ProviderFailure, sanitizeProviderFailure } from "../kernels/providerFailure.ts";
import { jsonValue } from "../solana/bytes.ts";
import { candidateAccepted, keptCount } from "./feeTailBounds.ts";

export const tailNetworks = ["base", "ethereum", "robinhood", "solana"] as const;
export type TailNetwork = (typeof tailNetworks)[number];

export const attemptStates = ["ran", "locked", "not_converted", "quoted", "pending", "skipped", "no_route", "submitted", "finalized", "failed", "unknown"] as const;
export type AttemptState = (typeof attemptStates)[number];

const tailEvents = [
  "fee_converter_run",
  "fee_converter_network_error",
  "fee_buyback_error",
  "fee_bridge_arrived",
  "fee_bridge_refunded",
  "fee_conversion_error",
  "fee_conversion_reconcile_error",
  "fee_conversion_lock_lost",
  "fee_conversion_not_converted",
  "fee_balance_unavailable",
  "fee_send_waiting",
  "fee_send_replaced",
  "fee_claim_skipped",
  "fee_claim_quoted",
  "fee_claim_included",
  "fee_claim_error",
  "fee_claim_finalized",
  "fee_claim_submitted",
  "fee_claims_failed",
  "fee_approval_submitted",
  "fee_bridge_submitted",
  "fee_bridge_waiting",
  "fee_bridge_cancelling",
  "fee_bridge_unfilled",
  "fee_buyback_undecided",
  "fee_buyback_waiting",
  "fee_send_rebroadcast",
  "fee_send_receipt_mismatch",
  "fee_solana_expiry_proven",
  "fee_solana_expiry_held",
  "fee_solana_expiry_operators_held",
] as const;
export type TailEvent = (typeof tailEvents)[number];

export type FeeErrorCategory =
  | "response-json"
  | "rpc-shape"
  | "unsupported-token-account"
  | "rpc-blocked"
  | "authentication"
  | "below-minimum"
  | "below-gas-multiple"
  | "rpc-rate-limit"
  | "timeout"
  | "quote-provider"
  | "bridge-verification"
  | "recovery-proof"
  | "signer-configuration"
  | "project-readiness"
  | "deployment-verification"
  | "native-budget"
  | "lease"
  | "rpc-unavailable"
  | "other"
  | "unspecified";

const outcomes = ["ok", "canceled", "exceededCpu", "exceededMemory", "exception", "unknown"] as const;
const buybackLegs = ["bridge", "arrival", "refund", "burn"] as const;
const tailItems = 100;
const exceptionItems = 10;
const runResultItems = 4;

const errorTagCategories: Readonly<Record<string, FeeErrorCategory>> = {
  RpcUnavailable: "rpc-unavailable",
  RpcRefused: "rpc-unavailable",
  ChainUnavailable: "rpc-unavailable",
  ChainRefused: "rpc-unavailable",
  SolanaRefused: "rpc-unavailable",
  ReceiptUnreadable: "rpc-unavailable",
  RpcMalformed: "rpc-shape",
  RateLimited: "rpc-rate-limit",
  TimeoutError: "timeout",
  JupiterRefused: "quote-provider",
  JupiterUnavailable: "quote-provider",
  KyberRefused: "quote-provider",
  KyberUnavailable: "quote-provider",
  QuoteUnrepresentable: "quote-provider",
  DlnRefused: "bridge-verification",
  DlnUnavailable: "bridge-verification",
  RouteMismatch: "bridge-verification",
  WitnessInconsistent: "recovery-proof",
  RpcUnqualified: "recovery-proof",
  PairUnqualified: "recovery-proof",
  KeyMismatch: "signer-configuration",
  KeyInvalid: "signer-configuration",
  SignRefused: "signer-configuration",
  ReadinessUnbound: "project-readiness",
  DeploymentRefused: "deployment-verification",
  FeeCapTooLow: "native-budget",
  RunIdentityTaken: "lease",
};

export interface RunResult {
  readonly network: TailNetwork;
  readonly status: AttemptState;
  readonly claimed: number | null;
  readonly reconciled: number | null;
}

export interface TailRecord {
  readonly event: TailEvent;
  readonly network?: TailNetwork;
  readonly leg?: string;
  readonly token?: string;
  readonly vault?: string;
  readonly errorCategory?: FeeErrorCategory;
  readonly rpcMethod?: string;
  readonly providerFailure?: ProviderFailure;
  readonly trigger?: "recovery" | "receipts" | "unknown";
  readonly results?: ReadonlyArray<RunResult>;
}

export interface TailObservation {
  readonly outcome: (typeof outcomes)[number];
  readonly exceptionCategories: ReadonlyArray<FeeErrorCategory>;
  readonly records: ReadonlyArray<TailRecord>;
}

function isOneOf<T extends string>(choices: ReadonlyArray<T>, value: unknown): value is T {
  return typeof value === "string" && (choices as ReadonlyArray<string>).includes(value);
}

/** @throws {never} */
export function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key) ? (value as Readonly<Record<string, unknown>>)[key] : undefined;
}

/** @throws {never} */
export function listOf(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countOf(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** @throws {never} */
export function tailNetwork(value: unknown): TailNetwork | undefined {
  return typeof value === "string" && isOneOf(tailNetworks, value.toLowerCase()) && /^[a-zA-Z][a-z]+$/u.test(value) ? (value.toLowerCase() as TailNetwork) : undefined;
}

/** @throws {never} */
export function feeErrorCategory(value: unknown): FeeErrorCategory {
  if (typeof value !== "string") return "unspecified";
  const tagged = Object.hasOwn(errorTagCategories, value) ? errorTagCategories[value] : undefined;
  if (tagged !== undefined) return tagged;
  const message = value.toLowerCase();
  if (/^unexpected (?:token|end)|json (?:parse|parsing)|is not valid json|unparseable response/.test(message)) return "response-json";
  if (/^invalid rpc (?:object|string|list)|^cannot read properties of (?:undefined|null)|^undefined is not an object/.test(message)) return "rpc-shape";
  if (/not a supported token program account|truncated (?:mint|token)|classic (?:mint|token).*mismatch|unsupported token-2022|duplicate token-2022|^token account (?:data is unavailable|is malformed)|^duplicate fee token account|^fee token holding differs/.test(message)) return "unsupported-token-account";
  if (/\bblocked\b|access denied|not allowed|not permitted/.test(message)) return "rpc-blocked";
  if (/401|403|unauthorized|forbidden|authentication/.test(message)) return "authentication";
  if (/below the minimum/.test(message)) return "below-minimum";
  if (/gas-cost multiple/.test(message)) return "below-gas-multiple";
  if (/429|rate.?limit/.test(message)) return "rpc-rate-limit";
  if (/timeout|timed out|abort/.test(message)) return "timeout";
  if (/^jupiter /.test(message)) return "quote-provider";
  if (/^bridge (?:row lacks|quote differs)|^signed bridge order differs|^dln (?:order|proposal|response)|^robinhood chain order status is unavailable/.test(message)) return "bridge-verification";
  if (/recovery|full.history|independent/.test(message)) return "recovery-proof";
  if (/key|signer|seed/.test(message)) return "signer-configuration";
  if (/reviewed.*project|project.*reviewed/.test(message)) return "project-readiness";
  if (/deploy|authority|program|code hash|mint|vault/.test(message)) return "deployment-verification";
  if (/native|lamport|insufficient|budget|ceiling/.test(message)) return "native-budget";
  if (/\b(?:locked|lease)\b/.test(message)) return "lease";
  if (/^solana |rpc|fetch|connect|http|network/.test(message)) return "rpc-unavailable";
  return "other";
}

/** @throws {never} */
export function feeRpcMethod(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^Solana (getAccountInfo|getMultipleAccounts|getBalance|getTokenAccountsByOwner|getGenesisHash|getLatestBlockhash|getBlockHeight|getFeeForMessage|simulateTransaction|getSignatureStatuses|getSignaturesForAddress|getTransaction|getBlock|sendTransaction):/.exec(value)?.[1];
}

function loggedEvents(message: ReadonlyArray<unknown>): ReadonlyArray<unknown> {
  const named = message.findIndex((part) => isOneOf(tailEvents, part));
  if (named === -1) return message.map((part) => (typeof part === "string" ? jsonValue(part) : part));
  const fields = message.slice(named + 1).filter(isRecord).reduce<Readonly<Record<string, unknown>>>((merged, part) => ({ ...merged, ...part }), {});
  return [{ ...fields, event: message[named] }];
}

/** @throws {never} */
export function publicAddress(network: TailNetwork | undefined, value: unknown): value is string {
  if (network === undefined || typeof value !== "string") return false;
  return network === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value) : /^0x[a-fA-F0-9]{40}$/u.test(value);
}

/** @throws {never} */
export function runResults(value: unknown): ReadonlyArray<RunResult> {
  return listOf(value).slice(0, runResultItems).flatMap((result) => {
    const network = tailNetwork(fieldOf(result, "network"));
    if (network === undefined) return [];
    const status = fieldOf(result, "status");
    return [{ network, status: isOneOf(attemptStates, status) ? status : "unknown", claimed: countOf(fieldOf(result, "claimed")), reconciled: countOf(fieldOf(result, "reconciled")) }];
  });
}

function buybackLeg(name: TailEvent, leg: unknown) {
  if (name !== "fee_buyback_error" || typeof leg !== "string") return undefined;
  if (isOneOf(buybackLegs, leg)) return leg;
  return /^buyback 0x[a-fA-F0-9]{40}$/u.test(leg) ? "buyback" : undefined;
}

function tailRecord(event: unknown): ReadonlyArray<TailRecord> {
  const name = fieldOf(event, "event");
  if (!isOneOf(tailEvents, name)) return [];
  const network = tailNetwork(fieldOf(event, "network"));
  const leg = buybackLeg(name, fieldOf(event, "leg"));
  const token = fieldOf(event, "token");
  const vault = fieldOf(event, "vault");
  const stated = fieldOf(event, "reason");
  const errored = fieldOf(event, "error");
  const failed = stated !== undefined || errored !== undefined;
  const reason = stated ?? errored;
  const rpcMethod = failed ? feeRpcMethod(reason) : undefined;
  const trigger = fieldOf(event, "trigger");
  const diagnosed = name === "fee_claim_error" || name === "fee_conversion_error" || (name === "fee_buyback_error" && network === "solana" && leg === "bridge");
  const providerFailure = diagnosed ? sanitizeProviderFailure(fieldOf(event, "providerFailure")) : undefined;
  return [{
    event: name,
    ...(network === undefined ? {} : { network }),
    ...(leg === undefined ? {} : { leg }),
    ...(publicAddress(network, token) ? { token } : {}),
    ...(publicAddress(network, vault) ? { vault } : {}),
    ...(failed ? { errorCategory: feeErrorCategory(reason) } : {}),
    ...(rpcMethod === undefined ? {} : { rpcMethod }),
    ...(providerFailure === undefined ? {} : { providerFailure }),
    ...(name === "fee_converter_run" ? { trigger: trigger === "recovery" || trigger === "receipts" ? trigger : "unknown", results: runResults(fieldOf(event, "results")) } : {}),
  }];
}

/** @throws {never} */
export function sanitizeFeeTail(value: unknown, worker: string): TailObservation | null {
  if (fieldOf(value, "scriptName") !== worker) return null;
  const records = listOf(fieldOf(value, "logs")).flatMap((log) => loggedEvents(listOf(fieldOf(log, "message")))).flatMap(tailRecord);
  const exceptions = listOf(fieldOf(value, "exceptions"));
  const outcome = fieldOf(value, "outcome");
  return {
    outcome: isOneOf(outcomes, outcome) ? outcome : "unknown",
    exceptionCategories: exceptions.slice(0, keptCount(exceptions.length, exceptionItems)).map((entry) => feeErrorCategory(fieldOf(entry, "message"))),
    records: records.slice(0, keptCount(records.length, tailItems)),
  };
}

/** @throws {never} */
export function requireSolanaProbeCandidate(value: string): string | undefined {
  const url = URL.parse(value);
  if (url === null) return undefined;
  return candidateAccepted(url.protocol === "https:", url.hostname.endsWith(".helius-rpc.com"), url.username === "", url.password === "", url.hash === "", url.port === "" || url.port === "443") ? url.href : undefined;
}
