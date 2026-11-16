import { useCallback } from "react";
import { browserDeployment } from "./browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { isEscrowChain } from "./escrow-policy.mjs";
import { readCompletePages } from "./paged-history";
import {
  isBaseUnits,
  type PublicVaultPayment,
  type PublicVaultPaymentPage,
  transactionUrl,
} from "./payments/contracts";
import { usePublicResource } from "./use-public-resource";

export type PublicPaymentScope =
  | { all: true }
  | { githubUserId: string }
  | { projectId: string }
  | null;

function isPayment(value: unknown): value is PublicVaultPayment {
  if (!value || typeof value !== "object") return false;
  const p = value as PublicVaultPayment;
  return (
    typeof p.id === "string" &&
    typeof p.projectId === "string" &&
    typeof p.network === "string" &&
    isEscrowChain(p.chain) &&
    typeof p.assetAddress === "string" &&
    Number.isSafeInteger(p.assetDecimals) &&
    p.assetDecimals >= 0 &&
    p.assetDecimals <= 36 &&
    isBaseUnits(p.netBase) &&
    (p.contributionMonth === null ||
      /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(p.contributionMonth)) &&
    typeof p.transactionId === "string" &&
    transactionUrl(p.network, p.transactionId) !== null &&
    typeof p.indexedAt === "string" &&
    Number.isFinite(Date.parse(p.indexedAt))
  );
}

export function useVaultPayments(scope: PublicPaymentScope) {
  const path =
    !scope || "all" in scope
      ? "vault-payments"
      : "githubUserId" in scope
        ? `actors/${encodeURIComponent(scope.githubUserId)}/vault-payments`
        : `projects/${encodeURIComponent(scope.projectId)}/vault-payments`;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (
        !import.meta.env.DEV &&
        !browserDeployment.browserOrigins.has(window.location.origin)
      )
        throw new Error("Project payment records unavailable");
      const payments = await readCompletePages<PublicVaultPayment>({
        fetchPage: async (query) => {
          const response = await fetchWithDeadline(
            `/api/v1/payments/${path}${query}`,
            { signal, cache: "no-store" },
          );
          if (!response.ok)
            throw new Error("Project payment records unavailable");
          const value = (await readBoundedJson(
            response,
            1_048_576,
            "project payments",
          )) as PublicVaultPaymentPage;
          if (
            !value ||
            !Array.isArray(value.payments) ||
            !value.payments.every(isPayment)
          )
            throw new Error("Project payment history could not be verified");
          return {
            rows: value.payments,
            through: value.through,
            total: value.total,
            next: value.next,
          };
        },
        key: (payment) => payment.id,
        errors: {
          history: "Project payment history could not be verified",
          duplicate: "Duplicate project payment record",
          count: "Project payment history count does not match",
          incomplete: "Incomplete project payment history",
        },
      });
      return { payments: payments.reverse(), path };
    },
    [path],
  );
  const [state, retry] = usePublicResource(
    scope !== null,
    load,
    "Project payment records unavailable",
    30_000,
  );
  return [
    state.status === "ready" && state.path !== path
      ? { status: "loading" as const }
      : state,
    retry,
  ] as const;
}
