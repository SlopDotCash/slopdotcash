/**
 * The public record, /data/record.json, rebuilt by every release build
 * (scripts/record/build-record.mjs, PRD section 7). /record and /receipts read
 * only this same-origin file; neither page reads GitHub or a chain.
 */
import { fetchWithDeadline, readBoundedJson } from "./browser-json";

export const RECORD_DATA_PATH = "/data/record.json";
const RECORD_MAX_BYTES = 4 * 1024 * 1024;

export type RecordPool = {
  projectId: string;
  month: string;
  capUsdc: number;
  allocatedUsdc: number;
  paidUsdc: number;
  transfers: number;
  rows: number;
  unclaimedRows: number;
  unclaimedUsdc: number;
  firstAt: string | null;
  exampleSignature: string | null;
  file?: string;
};

export type RecordSettlement = {
  projectId: string;
  month: string;
  capUsdc: number | null;
  settledAt: string;
  paidUsdc: number;
  transfers: number;
};

export type RecordCyclePool = {
  projectId: string;
  month: string;
  files: string[];
  status: string;
  generatedAt: string;
  approvedAt: string | null;
  reviewEndsAt: string | null;
  capUsdc: number | null;
  contributors: number;
  settlement: RecordSettlement | null;
};

export type RecordMonth = {
  month: string;
  counts: {
    merged: number;
    reviews: number;
    calendarMerged: number;
    calendarReviews: number;
  } | null;
  uniqueContributors: number;
  pools: RecordCyclePool[];
};

export type RecordProject = {
  id: string;
  name: string;
  status: string;
  kind: string | null;
  capDisplay: string | null;
  chain: string | null;
  authority: string | null;
  repository: string | null;
  prize: string | null;
};

export type ReceiptRecipient = {
  login: string | null;
  received: string;
  transactions: { id: string; url: string }[];
};

export type Receipt = {
  anchor: string;
  projectId: string;
  project: string;
  month: string;
  networkName: string;
  asset: string;
  stable: boolean;
  contributors: number;
  total: string;
  fee: string;
  feeExact: boolean;
  recipients: ReceiptRecipient[];
  own: { payments: number; total: string } | null;
  privateRecords: boolean;
  reserved: string | null;
  firstSentAt: string;
  lastSentAt: string;
  merges: {
    windowDays: number;
    asOf: string;
    repositories: {
      repository: string;
      mergedOutside: number;
      medianHours: number | null;
    }[];
  } | null;
};

export type PublicRecord = {
  builtAt: string;
  money: {
    transfers: number;
    paidUsdc: number;
    allocatedUsdc: number;
    unclaimedUsdc: number;
    platformFeeCollected: boolean;
    pools: RecordPool[];
    settlements?: RecordSettlement[];
  };
  months?: RecordMonth[];
  projects: RecordProject[];
  proposal: {
    projectId: string;
    cycleId: string;
    status: string;
    allocations: number;
    capUsdc: number;
    approvedUsdc: number;
    generatedAt: string;
  };
  receipts?: {
    builtAt: string | null;
    items: Receipt[];
  };
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The fields the pages read are present; anything else is not the record. */
export function parsePublicRecord(value: unknown): PublicRecord {
  if (
    !object(value) ||
    typeof value.builtAt !== "string" ||
    !object(value.money) ||
    !Array.isArray(value.money.pools) ||
    !Array.isArray(value.projects) ||
    !object(value.proposal)
  )
    throw new Error("The public record is not in the expected shape");
  return value as PublicRecord;
}

export async function loadPublicRecord(
  signal: AbortSignal,
): Promise<{ record: PublicRecord }> {
  const response = await fetchWithDeadline(RECORD_DATA_PATH, {
    signal,
    cache: "no-cache",
  });
  if (!response.ok)
    throw new Error(`The public record answered ${response.status}`);
  return {
    record: parsePublicRecord(
      await readBoundedJson(response, RECORD_MAX_BYTES, "The public record"),
    ),
  };
}
