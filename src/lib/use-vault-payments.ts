import { useCallback } from "react";
import { browserDeployment } from "./browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { isEscrowChain } from "./escrow-policy.mjs";
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
      const payments: PublicVaultPayment[] = [];
      const ids = new Set<string>();
      let after = 0;
      let through: number | null = null;
      let total: number | null = null;
      for (;;) {
        const query =
          through === null ? "" : `?after=${after}&through=${through}`;
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
          !value.payments.every(isPayment) ||
          value.payments.length > 100 ||
          !Number.isSafeInteger(value.through) ||
          value.through < 0 ||
          !Number.isSafeInteger(value.total) ||
          value.total < 0 ||
          (through !== null && value.through !== through) ||
          (total !== null && value.total !== total) ||
          (value.next !== null &&
            (value.payments.length === 0 ||
              !Number.isSafeInteger(value.next) ||
              value.next <= after ||
              value.next > value.through))
        )
          throw new Error("Project payment history could not be verified");
        through = value.through;
        total = value.total;
        for (const payment of value.payments) {
          if (ids.has(payment.id))
            throw new Error("Duplicate project payment record");
          ids.add(payment.id);
          payments.push(payment);
        }
        if (
          payments.length > total ||
          (value.next !== null && payments.length >= total)
        )
          throw new Error("Project payment history count does not match");
        if (value.next === null) {
          if (payments.length !== total)
            throw new Error("Incomplete project payment history");
          return { payments: payments.reverse(), path };
        }
        after = value.next;
      }
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
