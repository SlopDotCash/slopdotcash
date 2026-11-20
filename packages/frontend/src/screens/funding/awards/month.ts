// spec/settlement/monthly.md, "Only a current owner, steward or repository administrator changes another recipient's amount"; spec/settlement/monthly.md, "The owner may finalize early; the coordinator freezes at the cutoff unless the default is off"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"
import { decodeBytes32, escrowAbi } from "@repo/settlement/chain/evm/abi";
import { commitAwardCalldata } from "@repo/settlement/chain/evm/actions";
import type { MonthlyAsset, MonthlyAwardState } from "@repo/settlement/client";
import { decimalRefusalMessage, formatBaseUnits, parseDecimalAmount } from "@repo/settlement/kernels/amounts";
import { FIRST_PERIOD, formatPeriod, parsePeriod, periodContaining, shiftPeriod } from "@repo/settlement/kernels/calendar";
import type { StatusProps } from "@repo/ui";
import { decodeFunctionData } from "viem";
import { type AwardDisplay, type AwardFacts, awardPresentation as decisionPresentation, paymentDisplay, paymentPresentation } from "../../../../gen/frontend__projections.ts";
import { assetSymbol, knownAssetSymbol } from "../../../kernels/assetText.ts";
import { storageKeys } from "../../../platform/storage.vibe";
import type { SlotStorage } from "../../../wallets/core/slots.ts";
import { readText } from "../../../wallets/owner/flowSlots.ts";
import type { OwnerPlan } from "../../../wallets/owner/ownerPlans.schema.ts";

export type Presentation = StatusProps["presentation"];

export interface MonthBounds {
  readonly first: string;
  readonly lastClosed: string;
  readonly start: string;
}

export type ParsedGross = { readonly kind: "Parsed"; readonly base: string } | { readonly kind: "Refused"; readonly message: string };

export interface SavedAward {
  readonly githubUserId: string;
  readonly gross: bigint;
  readonly sourceDigest: string;
}

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC", year: "numeric" });
const zeroAmount = /^0*(\.0*)?$/u;
const wholeBaseUnits = /^[1-9][0-9]{0,19}$/u;

/** @throws {never} */
export function monthText(period: string): string {
  const parsed = parsePeriod(period);
  return parsed === undefined ? period : monthFormat.format(new Date(Date.UTC(Math.trunc(parsed / 100), (parsed % 100) - 1, 1)));
}

/** @throws {never} */
export function shiftMonth(period: string, months: number): string {
  const parsed = parsePeriod(period);
  if (parsed === undefined) return period;
  try {
    return formatPeriod(shiftPeriod(parsed, months));
  } catch {
    return period;
  }
}

/** The months an owner may review: from the first monthly period, or an older public month, to the last closed month. @throws {never} */
export function monthBounds(publicMonths: ReadonlyArray<string>, nowMs: number): MonthBounds {
  const months = [...new Set(publicMonths.filter((month) => parsePeriod(month) !== undefined))].sort();
  const firstPeriod = formatPeriod(FIRST_PERIOD);
  const earliest = months[0];
  const latest = months.at(-1);
  const current = parsePeriod(new Date(nowMs).toISOString().slice(0, 7));
  const lastClosed = current === undefined ? firstPeriod : shiftMonth(formatPeriod(current), -1);
  return {
    first: earliest !== undefined && earliest < firstPeriod ? earliest : firstPeriod,
    lastClosed,
    start: latest !== undefined && latest > lastClosed ? latest : lastClosed,
  };
}

/** Every month from `first` through `last`, oldest first. @throws {never} */
export function monthsBetween(first: string, last: string): ReadonlyArray<string> {
  const months: string[] = [];
  for (let month = first; month <= last && months.length < 1200; month = shiftMonth(month, 1)) {
    months.push(month);
    if (shiftMonth(month, 1) === month) break;
  }
  return months;
}

/** @throws {never} */
export function commitmentKey(projectId: string, period: string): string {
  return `${storageKeys.awardCommitment.key}${projectId}:${period}`;
}

/** The months whose award commitment this browser saved and has not settled. @throws {never} */
export function savedCommitmentMonths(storage: SlotStorage | undefined, projectId: string, months: ReadonlyArray<string>): ReadonlyArray<string> {
  return months.filter((month) => readText(storage, commitmentKey(projectId, month)) !== null);
}

/** Base units as a plain decimal an owner can edit, without grouping. @throws {never} */
export function editableUnits(base: string, decimals: number | null): string {
  if (decimals === null) return base;
  try {
    return formatBaseUnits({ value: BigInt(base), decimals, grouping: false });
  } catch {
    return base;
  }
}

/** @throws {never} */
export function parsedGross(text: string, decimals: number | null): ParsedGross {
  const trimmed = text.trim();
  if (zeroAmount.test(trimmed) && /\d/u.test(trimmed)) return { kind: "Parsed", base: "0" };
  if (decimals === null) return wholeBaseUnits.test(trimmed) ? { kind: "Parsed", base: trimmed } : { kind: "Refused", message: "Enter a whole number of token base units." };
  const parsed = parseDecimalAmount({ text: trimmed, decimals });
  return parsed.kind === "Parsed" ? { kind: "Parsed", base: parsed.amount.toString() } : { kind: "Refused", message: decimalRefusalMessage[parsed.reason](decimals) };
}

/** Formats exact base units in the month's asset, or names them as base units while the asset is unknown. @throws {never} */
export function amountText(asset: MonthlyAsset | null): (base: string) => string {
  return (base) => {
    if (asset === null) return `${base} token base units`;
    try {
      const known = knownAssetSymbol(asset);
      const symbol = known ?? (asset.symbol === null ? undefined : assetSymbol({ kind: "token", symbol: asset.symbol }));
      const value = formatBaseUnits({ value: BigInt(base), decimals: asset.assetDecimals });
      return symbol === undefined ? value : `${value} ${symbol}`;
    } catch {
      return `${base} token base units`;
    }
  };
}

/** @throws {SyntaxError} */
export function sumOf(values: ReadonlyArray<string>): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

/** @throws {never} */
export function secondsOf(iso: string | null): number {
  if (iso === null) return 0;
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : 0;
}

/** @throws {never} */
export function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** A saved amount below the proposed amount is a cut. @throws {never} */
export function isCut(parsed: ParsedGross, proposed: string): boolean {
  return parsed.kind === "Parsed" && BigInt(parsed.base) < BigInt(proposed);
}

const awardFacts: Readonly<Record<MonthlyAwardState, AwardFacts>> = {
  excluded: { decision: "ExcludedAward", funding: "Funded", wallet: true, scheduled: false, held: false, submitted: false, exactFinality: false },
  underfunded: { decision: "ApprovedAward", funding: "Underfunded", wallet: true, scheduled: false, held: false, submitted: false, exactFinality: false },
  "awaiting-reservation": { decision: "ApprovedAward", funding: "Funded", wallet: true, scheduled: false, held: false, submitted: false, exactFinality: false },
  reserved: { decision: "ApprovedAward", funding: "Funded", wallet: true, scheduled: true, held: false, submitted: false, exactFinality: false },
  paid: { decision: "ApprovedAward", funding: "Funded", wallet: true, scheduled: false, held: false, submitted: true, exactFinality: true },
  conflict: { decision: "ApprovedAward", funding: "Funded", wallet: true, scheduled: false, held: true, submitted: false, exactFinality: false },
};

const awardLabels: Readonly<Record<MonthlyAwardState, string>> = {
  underfunded: "Underfunded",
  excluded: "Excluded: account banned",
  "awaiting-reservation": "Approved: ready to reserve",
  reserved: "Reserved, not yet paid",
  paid: "Paid",
  conflict: "Conflict: another award holds this source",
};

/** @throws {never} */
function look(display: AwardDisplay): Omit<Presentation, "label"> {
  switch (display.tag) {
    case "InvalidAward":
      return { tone: "Negative", icon: "Alert" };
    case "DecisionState": {
      const { tone, icon } = decisionPresentation(display.decision);
      return { tone, icon };
    }
    case "PaymentState": {
      const { tone, icon } = paymentPresentation(display.payment);
      return { tone, icon };
    }
  }
}

/** A frozen award's decision, funding and settlement as one state, never paid without finality. @throws {never} */
export function awardPresentation(state: MonthlyAwardState): Presentation {
  return { ...look(paymentDisplay(awardFacts[state])), label: awardLabels[state] };
}

/** The award a saved commitment call asks the vault to reserve: decoded with the escrow ABI and kept only when it re-encodes to the exact saved call. @throws {never} */
export function savedAward(plan: OwnerPlan | undefined): SavedAward | undefined {
  if (plan?.kind !== "evmCall") return undefined;
  try {
    const call = decodeFunctionData({ abi: escrowAbi, data: plan.data as `0x${string}` });
    if (call.functionName !== "commitAward") return undefined;
    const [rawId, actor, gross, rawSource] = call.args;
    const id = decodeBytes32(rawId);
    const sourceDigest = decodeBytes32(rawSource);
    if (id === undefined || sourceDigest === undefined || commitAwardCalldata({ purpose: "OrdinaryPurpose", id, actor, gross, sourceDigest }) !== plan.data) return undefined;
    return { githubUserId: actor.toString(), gross, sourceDigest: sourceDigest.slice(2).toLowerCase() };
  } catch {
    return undefined;
  }
}
