import { useCallback } from "react";
import { browserDeployment } from "./browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { isEscrowChain } from "./escrow-policy.mjs";
import { readCompletePages } from "./paged-history";
import type { DirectTransfer, DirectTransferPage } from "./payments/contracts";
import { CANONICAL_UINT } from "./record-validation.mjs";
import { usePublicResource } from "./use-public-resource";

const money = (v: unknown) => typeof v === "string" && CANONICAL_UINT.test(v);

/** Validates one direct transfer from the payments API. */
export function isDirectTransfer(t: unknown): t is DirectTransfer {
  const v = t as DirectTransfer;
  return (
    !!v &&
    typeof v.projectId === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/u.test(v.contributionMonth) &&
    /^[1-9]\d*$/u.test(v.githubUserId) &&
    typeof v.login === "string" &&
    typeof v.network === "string" &&
    isEscrowChain(v.chain) &&
    typeof v.recipient === "string" &&
    money(v.amountMicro) &&
    typeof v.transactionId === "string" &&
    !Number.isNaN(Date.parse(v.blockTime))
  );
}

export async function loadDirectTransfers(
  path: string,
  signal: AbortSignal,
): Promise<DirectTransfer[]> {
  // The payments API answers only the deployed product origins. The local dev
  // server proxies this public read to slop.cash (vite.config.ts).
  if (
    !import.meta.env.DEV &&
    !browserDeployment.browserOrigins.has(window.location.origin)
  )
    throw new Error("Direct payment records unavailable");
  let legacy = false;
  const transfers = await readCompletePages<DirectTransfer>({
    fetchPage: async (query) => {
      const response = await fetchWithDeadline(
        `/api/v1/payments/${path}/direct-transfers${query}`,
        {
          signal,
          cache: "no-store",
          headers: { "x-slop-direct-history": "paged" },
        },
      );
      if (!response.ok) throw new Error("Direct payment records unavailable");
      const value = (await readBoundedJson(
        response,
        1_048_576,
        "direct payments",
      )) as Partial<DirectTransferPage> | null;
      if (
        !value ||
        !Array.isArray(value.transfers) ||
        !value.transfers.every(isDirectTransfer) ||
        !money(value.totalMicro)
      )
        throw new Error("Direct payment records could not be verified");
      // Old deployed servers and saved fixtures answer the complete legacy list.
      if (
        query === "" &&
        !Object.hasOwn(value, "through") &&
        !Object.hasOwn(value, "next") &&
        !Object.hasOwn(value, "total")
      ) {
        legacy = true;
        return value.transfers;
      }
      if (
        value.transfers
          .reduce((sum, row) => sum + BigInt(row.amountMicro), 0n)
          .toString() !== value.totalMicro
      )
        throw new Error("Direct payment history could not be verified");
      return {
        rows: value.transfers,
        through: value.through,
        total: value.total,
        next: value.next,
      };
    },
    key: (transfer) => `${transfer.network}:${transfer.transactionId}`,
    errors: {
      history: "Direct payment history could not be verified",
      duplicate: "Duplicate direct payment record",
      count: "Direct payment history count does not match",
      incomplete: "Incomplete direct payment history",
    },
  });
  if (legacy) return transfers;
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return transfers.sort(
    (a, b) =>
      compare(a.blockTime, b.blockTime) ||
      compare(a.transactionId, b.transactionId),
  );
}

/**
 * Loads transfers sent outside escrow from the payments database, for one
 * project or one numeric GitHub actor. A failed read stays an error; it never
 * becomes an empty list.
 */
export function useDirectTransfers(
  scope: { projectId: string } | { githubUserId: string } | null,
) {
  const path = !scope
    ? ""
    : "projectId" in scope
      ? `projects/${encodeURIComponent(scope.projectId)}`
      : `actors/${encodeURIComponent(scope.githubUserId)}`;
  const load = useCallback(
    async (signal: AbortSignal) => ({
      transfers: await loadDirectTransfers(path, signal),
    }),
    [path],
  );
  return usePublicResource(
    Boolean(path),
    load,
    "Direct payment records unavailable",
    30_000,
  );
}
