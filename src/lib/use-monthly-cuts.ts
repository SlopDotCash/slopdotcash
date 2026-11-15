import { useCallback } from "react";
import { browserDeployment } from "./browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { isBaseUnits } from "./payments/contracts";
import { usePublicResource } from "./use-public-resource";

/**
 * One current owner cut of a project month (PRD section 6, operator decision
 * of 15 November 2026): the contributor's amount is below the proposed amount,
 * with the owner's public reason.
 */
export interface PublicMonthlyCut {
  githubUserId: string;
  login: string;
  proposedGrossBase: string;
  grossBase: string;
  reason: string;
  cutAt: string;
}

function isCut(value: unknown): value is PublicMonthlyCut {
  if (!value || typeof value !== "object") return false;
  const cut = value as PublicMonthlyCut;
  return (
    typeof cut.githubUserId === "string" &&
    /^[1-9][0-9]{0,19}$/u.test(cut.githubUserId) &&
    typeof cut.login === "string" &&
    cut.login.length > 0 &&
    isBaseUnits(cut.proposedGrossBase) &&
    isBaseUnits(cut.grossBase) &&
    BigInt(cut.grossBase) < BigInt(cut.proposedGrossBase) &&
    typeof cut.reason === "string" &&
    cut.reason.length > 0 &&
    typeof cut.cutAt === "string" &&
    Number.isFinite(Date.parse(cut.cutAt))
  );
}

/** The public cuts of one project month, read from the payments API. */
export function useMonthlyCuts(projectId: string, period: string | null) {
  const path =
    period === null
      ? null
      : `/api/v1/payments/projects/${encodeURIComponent(projectId)}/monthly/${encodeURIComponent(period)}/cuts`;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (
        !import.meta.env.DEV &&
        !browserDeployment.browserOrigins.has(window.location.origin)
      )
        throw new Error("Owner cuts unavailable");
      const response = await fetchWithDeadline(path ?? "", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Owner cuts unavailable");
      const value = (await readBoundedJson(
        response,
        1_048_576,
        "owner cuts",
      )) as { projectId?: unknown; period?: unknown; cuts?: unknown };
      if (
        value?.projectId !== projectId ||
        value.period !== period ||
        !Array.isArray(value.cuts) ||
        !value.cuts.every(isCut)
      )
        throw new Error("Owner cuts could not be verified");
      return { cuts: value.cuts as PublicMonthlyCut[], path };
    },
    [path, period, projectId],
  );
  const [state, retry] = usePublicResource(
    path !== null,
    load,
    "Owner cuts unavailable",
  );
  return [
    state.status === "ready" && state.path !== path
      ? { status: "loading" as const }
      : state,
    retry,
  ] as const;
}
