// spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
import { NETWORKS, chainFamily, isNetworkKey } from "@repo/settlement/kernels/networks";
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";
import type { SlotStorage } from "../core/slots.ts";
import { type OwnerPlan, planOf, planText } from "./ownerPlans.schema.ts";

export interface OwnedSlot {
  readonly account: number;
  readonly attempt: Attempt;
  readonly plan: string;
}

export type SlotRead = { readonly kind: "empty" } | { readonly kind: "owned"; readonly slot: OwnedSlot } | { readonly kind: "unreadable"; readonly text: string };

const allowed = ["account", "attemptId", "request", "plan", "hash", "candidate"];
const maxPlanLength = 65_536;
const legacyIdentity = "development";
const releaseKeys = ["attemptId", "planId", "hash"];
const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/u;
const settingCapPattern = /^(0|[1-9][0-9]{0,38})$/u;
const attemptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const evmHashPattern = /^0x[0-9a-fA-F]{64}$/u;
const solanaSignaturePattern = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/u;

/** @throws {never} */
function optionalText(value: unknown): string | undefined {
  return value === undefined ? "" : typeof value === "string" && value !== "" ? value : undefined;
}

/** @throws {never} */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @throws {never} */
function legacyAttempt(attemptId: unknown): string | undefined {
  if (attemptId === undefined) return legacyIdentity;
  return typeof attemptId === "string" && attemptIdPattern.test(attemptId) ? attemptId : undefined;
}

/** @throws {never} */
function legacyHash(hash: unknown, solana: boolean): string | undefined {
  if (hash === null) return "";
  return typeof hash === "string" && (solana ? solanaSignaturePattern : evmHashPattern).test(hash) ? hash : undefined;
}

/** @throws {never} */
function legacySlot(attemptId: unknown, bytesId: string, plan: OwnerPlan | undefined, hash: string | undefined, recovered: boolean): OwnedSlot | undefined {
  const identity = legacyAttempt(attemptId);
  if (identity === undefined || plan === undefined || hash === undefined) return undefined;
  return { account: 0, plan: planText(plan), attempt: { identity, bytesId, hash: recovered ? "" : hash, candidate: recovered ? hash : "" } };
}

/** @throws {never} */
function legacyCreation(record: Readonly<Record<string, unknown>>): OwnedSlot | undefined {
  const { input, review } = record;
  if (!isRecord(input) || !isRecord(review)) return undefined;
  const { network, claimId, automatic, expectedRevision } = input;
  const payoutPolicy = input.payoutPolicy ?? review.payoutPolicy ?? "ordinary";
  if (typeof network !== "string" || !isNetworkKey(network) || typeof claimId !== "string" || typeof automatic !== "boolean" || typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)) return undefined;
  if ((payoutPolicy !== "ordinary" && payoutPolicy !== "security-bounty") || typeof review.owner !== "string" || typeof review.asset !== "string" || typeof review.capDisplay !== "string") return undefined;
  const solana = chainFamily(NETWORKS[network].chain) === "solana";
  const plan = planOf(planText({ kind: "vaultCreation", network, claimId, automatic, payoutPolicy, expectedRevision, owner: review.owner, asset: review.asset, capDisplay: review.capDisplay }));
  return legacySlot(record.attemptId, "creation", plan, legacyHash(record.hash, solana), false);
}

/** @throws {never} */
function legacySolanaSetting(record: Readonly<Record<string, unknown>>): OwnedSlot | undefined {
  const { cap, enabled, decimals, wallet, solanaBlockhash, hashSource } = record;
  if (typeof wallet !== "string" || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || typeof cap !== "string" || typeof enabled !== "boolean" || (enabled && cap === "0") || typeof solanaBlockhash !== "string") return undefined;
  if (hashSource !== undefined && (record.hash === null || (hashSource !== "wallet" && hashSource !== "recovery"))) return undefined;
  const plan = planOf(planText({ kind: "solanaSetting", cap, enabled, blockhash: solanaBlockhash }));
  return legacySlot(record.attemptId, "prepared", plan, legacyHash(record.hash, true), hashSource === "recovery");
}

/** @throws {never} */
function legacyEvmSetting(record: Readonly<Record<string, unknown>>): OwnedSlot | undefined {
  const { cap, enabled, decimals, wallet, hashSource } = record;
  if (typeof wallet !== "string" || !evmAddressPattern.test(wallet) || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || typeof cap !== "string" || !settingCapPattern.test(cap) || typeof enabled !== "boolean" || (enabled && cap === "0")) return undefined;
  if (hashSource !== undefined && (record.hash === null || (hashSource !== "wallet" && hashSource !== "recovery"))) return undefined;
  const plan = planOf(planText({ kind: "evmSetting", from: wallet.toLowerCase(), cap, enabled }));
  return legacySlot(record.attemptId, "prepared", plan, legacyHash(record.hash, false), hashSource !== "wallet");
}

/** @throws {never} */
function legacyRelease(record: Readonly<Record<string, unknown>>): OwnedSlot | undefined {
  if (!Object.keys(record).every((key) => releaseKeys.includes(key)) || typeof record.planId !== "string") return undefined;
  const plan = planOf(planText({ kind: "evmRelease", planId: record.planId }));
  const hash = record.hash === null ? "" : typeof record.hash === "string" && (evmHashPattern.test(record.hash) || solanaSignaturePattern.test(record.hash)) ? record.hash : undefined;
  return legacySlot(record.attemptId, "release", plan, hash, false);
}

/** @throws {never} */
function legacyOf(record: Readonly<Record<string, unknown>>): OwnedSlot | undefined {
  if (!("version" in record)) return "planId" in record ? legacyRelease(record) : undefined;
  if (record.version !== 1) return undefined;
  if ("input" in record && "review" in record) return legacyCreation(record);
  if ("wallet" in record && "solanaBlockhash" in record) return legacySolanaSetting(record);
  if ("wallet" in record && "cap" in record && "enabled" in record) return legacyEvmSetting(record);
  return undefined;
}

/** @throws {never} */
export function slotOfText(text: string | null): SlotRead {
  if (text === null) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable", text };
  }
  if (!isRecord(parsed)) return { kind: "unreadable", text };
  if ("version" in parsed || "planId" in parsed) {
    const legacy = legacyOf(parsed);
    return legacy === undefined ? { kind: "unreadable", text } : { kind: "owned", slot: legacy };
  }
  if (!Object.keys(parsed).every((key) => allowed.includes(key))) return { kind: "unreadable", text };
  const { account, attemptId, request, plan, hash, candidate } = parsed;
  const hashText = optionalText(hash);
  const candidateText = optionalText(candidate);
  if (
    typeof account !== "number" || !Number.isSafeInteger(account) || account < 0
    || typeof attemptId !== "string" || attemptId === "" || typeof request !== "string" || request === ""
    || typeof plan !== "string" || plan.length > maxPlanLength || hashText === undefined || candidateText === undefined
  ) return { kind: "unreadable", text };
  return { kind: "owned", slot: { account, plan, attempt: { identity: attemptId, bytesId: request, hash: hashText, candidate: candidateText } } };
}

/** @throws {never} */
export function textOfSlot(slot: OwnedSlot): string | null {
  if (slot.attempt.identity === "" && slot.attempt.bytesId === "") return null;
  return JSON.stringify({
    account: slot.account,
    attemptId: slot.attempt.identity,
    request: slot.attempt.bytesId,
    plan: slot.plan,
    ...(slot.attempt.hash === "" ? {} : { hash: slot.attempt.hash }),
    ...(slot.attempt.candidate === "" ? {} : { candidate: slot.attempt.candidate }),
  });
}

/** @throws {never} */
export function readText(storage: SlotStorage | undefined, key: string): string | null {
  if (storage === undefined) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** @throws {never} */
export function compareAndWrite(storage: SlotStorage | undefined, key: string, expected: string | null, next: string | null): boolean {
  if (storage === undefined) return false;
  try {
    if (storage.getItem(key) !== expected) return false;
    if (next === null) storage.removeItem(key);
    else storage.setItem(key, next);
    return true;
  } catch {
    return false;
  }
}
