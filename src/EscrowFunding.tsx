import { CircleAlert, Hourglass, LoaderCircle, RotateCcw } from "lucide-react";
import { lazy, useCallback, useEffect, useState } from "react";
import "./owner-review.css";
import { readBoundedJson } from "./lib/browser-json";
import type { VaultConnection } from "./lib/evm-vault-actions";
import {
  formatAssetAmount,
  isAssetDecimals,
  isBaseUnits,
  reservedGross,
  VAULT_SNAPSHOT_STALE_MS,
  type VaultSnapshot,
} from "./lib/payments/contracts";
import { useProjectMaintainer } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { CANONICAL_UINT } from "./lib/record-validation.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { usePublicResource } from "./lib/use-public-resource";
import { NetworkName } from "./Presentation";

const AutomaticMonthlyPayment = lazy(() =>
  import("./AutomaticMonthlyPayment").then((module) => ({
    default: module.AutomaticMonthlyPayment,
  })),
);
const OwnerVaultSetup = lazy(() =>
  import("./OwnerVaultSetup").then((module) => ({
    default: module.OwnerVaultSetup,
  })),
);
const VaultActions = lazy(() =>
  import("./VaultActions").then((module) => ({ default: module.VaultActions })),
);

interface VaultResponse {
  projectId: string;
  snapshots: VaultSnapshot[];
  staleAfterMs: number;
  servedAt: string;
}
const CUMULATIVE = [
  "totalDeposited",
  "totalPaid",
  "totalPayoutFees",
  "totalGrossWithdrawn",
  "totalWithdrawalFees",
] as const;
const CURRENT = [
  "freeBalance",
  "reservedPrincipal",
  "reservedFees",
  "accruedFees",
  "reserved",
] as const;
/** The edge and browser caches keep one vault read for 60 seconds. */
const RETURN_REFRESH_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;

function validSnapshot(s: VaultSnapshot, projectId: string): boolean {
  return (
    !!s &&
    s.projectId === projectId &&
    typeof s.network === "string" &&
    Object.hasOwn(NETWORK_NAMES, s.chain) &&
    typeof s.vault === "string" &&
    typeof s.assetAddress === "string" &&
    /^[0-9A-Za-z]{32,44}$/.test(s.assetAddress) &&
    isAssetDecimals(s.assetDecimals) &&
    CUMULATIVE.every((k) => isBaseUnits(s[k])) &&
    CURRENT.every((k) => s[k] === null || isBaseUnits(s[k])) &&
    CANONICAL_UINT.test(s.blockNumber) &&
    !Number.isNaN(Date.parse(s.blockTime)) &&
    !Number.isNaN(Date.parse(s.observedAt))
  );
}

/** Free and reserved funds as one bar (PRD section 6). */
function BalanceMeter({
  free,
  reserved,
}: {
  free: string | null;
  reserved: string | null;
}) {
  if (free === null || reserved === null) return null;
  const total = BigInt(free) + BigInt(reserved);
  if (total === 0n) return null;
  const freeShare = Number((BigInt(free) * 10_000n) / total);
  return (
    <div className="pr-bar vault-meter" aria-hidden="true">
      {BigInt(free) > 0n ? (
        <span className="vault-available" style={{ flexGrow: freeShare }} />
      ) : null}
      {BigInt(reserved) > 0n ? (
        <span
          className="vault-reserved"
          style={{ flexGrow: 10_000 - freeShare }}
        />
      ) : null}
    </div>
  );
}

function VaultTotals({ snapshot }: { snapshot: VaultSnapshot }) {
  const value = (amount: string | null) =>
    amount === null ? "Not reported" : formatAssetAmount(amount, snapshot);
  const reservedAwards = reservedGross(snapshot);
  return (
    <div className="vault-snapshot">
      <BalanceMeter free={snapshot.freeBalance} reserved={reservedAwards} />
      <dl className="vault-stats">
        <div className="vault-stat vault-stat--available">
          <dt>
            <span className="pr-dot vault-available" aria-hidden="true" />
            Available
          </dt>
          <dd>{value(snapshot.freeBalance)}</dd>
        </div>
        <div className="vault-stat">
          <dt>Paid out</dt>
          <dd>{value(snapshot.totalPaid)}</dd>
          <dd className="vault-stat-note">
            + {value(snapshot.totalPayoutFees)} fees
          </dd>
        </div>
      </dl>
    </div>
  );
}

type VaultTotalsState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "ready";
      vault: VaultResponse;
      /** A newer read is loading; the last good read stays visible. */
      refreshing: boolean;
      /** The newer read failed; `vault` is the last good read (PRD section 9). */
      refreshError: string | null;
      retry: () => void;
    };

/**
 * Loads the cached, finalized vault counters for a project with a deployed
 * vault. The totals stay current without a refresh control: a new read runs
 * when the oldest snapshot turns stale (then once per stale window, also after
 * an empty or failed read) and when the reader returns to the page after the
 * cache window. A refresh keeps the last good totals visible.
 */
export function useVaultTotals(
  project: ProjectDefinition,
  revision = 0,
): VaultTotalsState {
  const deployed = Boolean(project.escrow?.deployments.length);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a finalized action reloads the cached vault totals.
  const load = useCallback(
    async (signal: AbortSignal) => {
      const response = await fetch(
        `/api/v1/payments/projects/${encodeURIComponent(project.id)}/vault`,
        { signal },
      );
      if (!response.ok) throw new Error("Vault totals are unavailable.");
      const vault = (await readBoundedJson(
        response,
        65536,
        "project vault totals",
      )) as VaultResponse;
      if (
        !vault ||
        vault.projectId !== project.id ||
        !Array.isArray(vault.snapshots) ||
        !Number.isSafeInteger(vault.staleAfterMs) ||
        Number.isNaN(Date.parse(vault.servedAt)) ||
        !vault.snapshots.every((s) => validSnapshot(s, project.id))
      )
        throw new Error("The vault totals could not be verified.");
      return { vault };
    },
    [project.id, revision],
  );
  const [state, retry] = usePublicResource(
    deployed,
    load,
    "Could not load vault totals.",
  );
  const [lastGood, setLastGood] = useState<{
    projectId: string;
    vault: VaultResponse;
  } | null>(null);
  useEffect(() => {
    if (state.status === "ready")
      setLastGood({ projectId: state.vault.projectId, vault: state.vault });
  }, [state]);
  useEffect(() => {
    if (
      !deployed ||
      state.status === "loading" ||
      (state.status === "ready" && state.vault.projectId !== project.id)
    )
      return;
    const settledAt = Date.now();
    const vault = state.status === "ready" ? state.vault : null;
    const staleAfterMs = vault?.staleAfterMs ?? VAULT_SNAPSHOT_STALE_MS;
    const untilStale = Math.min(
      ...(vault?.snapshots ?? []).map(
        (snapshot) =>
          Date.parse(snapshot.observedAt) + staleAfterMs - settledAt,
      ),
    );
    const delay =
      Number.isFinite(untilStale) && untilStale > 0
        ? untilStale + 1_000
        : Math.max(staleAfterMs, RETURN_REFRESH_MS);
    const timer = window.setTimeout(
      () => {
        if (document.visibilityState !== "hidden") retry();
      },
      Math.min(delay, MAX_TIMER_MS),
    );
    const onReturn = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - settledAt >= RETURN_REFRESH_MS
      )
        retry();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [deployed, state, retry, project.id]);
  if (!deployed) return { status: "none" };
  // A loader change takes effect after render; never relabel its prior result.
  if (state.status === "ready" && state.vault.projectId !== project.id)
    return { status: "loading" };
  if (state.status === "ready")
    return {
      status: "ready",
      vault: state.vault,
      refreshing: false,
      refreshError: null,
      retry,
    };
  const previous = lastGood?.projectId === project.id ? lastGood.vault : null;
  if (previous)
    return {
      status: "ready",
      vault: previous,
      refreshing: state.status === "loading",
      refreshError: state.status === "error" ? state.message : null,
      retry,
    };
  return state.status === "error" ? { ...state, retry } : state;
}

export { reservedGross };

function RetryButton({ retry }: { retry: () => void }) {
  return (
    <button onClick={retry} type="button">
      <RotateCcw aria-hidden="true" size={15} /> Retry
    </button>
  );
}

/** Loading, empty, error and ready totals, each shown differently. */
function VaultTotalsView({
  totals,
}: {
  totals: Exclude<VaultTotalsState, { status: "none" }>;
}) {
  if (totals.status === "error")
    return (
      <p className="data-notice data-error" role="alert">
        <CircleAlert aria-hidden="true" size={15} />
        {totals.message}
        <RetryButton retry={totals.retry} />
      </p>
    );
  const refreshError = totals.status === "ready" &&
    totals.refreshError !== null && (
      <p className="data-notice data-error" role="alert">
        <CircleAlert aria-hidden="true" size={15} />
        {totals.refreshError}
        <RetryButton retry={totals.retry} />
      </p>
    );
  if (totals.status === "loading" || totals.vault.snapshots.length === 0)
    return (
      <div className="vault-totals">
        {refreshError}
        <p className="vault-fee" role="status">
          {totals.status === "loading" ? (
            <>
              <LoaderCircle aria-hidden="true" size={14} />
              Loading vault totals…
            </>
          ) : (
            <>
              <Hourglass aria-hidden="true" size={14} />
              Totals not read yet
            </>
          )}
        </p>
      </div>
    );
  return (
    <div className="vault-totals" aria-busy={totals.refreshing || undefined}>
      {refreshError}
      {totals.vault.snapshots.map((snapshot) => (
        <VaultTotals
          key={`${snapshot.network}:${snapshot.vault}`}
          snapshot={snapshot}
        />
      ))}
    </div>
  );
}

export function EscrowFunding({
  project,
  onRegistered,
  readOnly = false,
}: {
  project: ProjectDefinition;
  onRegistered?: (project: ProjectDefinition) => void;
  readOnly?: boolean;
}) {
  const { allowed } = useProjectMaintainer(project.id);
  const [registrationNotice, setRegistrationNotice] = useState("");
  const [connectedWallet, setConnectedWallet] =
    useState<VaultConnection | null>(null);
  const [revision, setRevision] = useState(0);
  const totals = useVaultTotals(project, revision);
  const chain = project.escrow?.chain ?? "solana";
  if (readOnly && totals.status === "none") return null;
  return (
    <section className="section project-funding" aria-label="Project escrow">
      <header className="vault-header">
        <h2>
          Project vault{" "}
          <NetworkName chain={chain} iconOnly>
            {NETWORK_NAMES[chain]}
          </NetworkName>
        </h2>
      </header>
      {totals.status === "none" ? (
        allowed && !readOnly ? (
          <OwnerVaultSetup
            project={project}
            onRegistered={(updated, wallet, notice) => {
              onRegistered?.(updated);
              setConnectedWallet(wallet);
              setRegistrationNotice(notice ?? "");
            }}
          />
        ) : (
          <p className="vault-unconfigured" role="status">
            <CircleAlert aria-hidden="true" />
            <span>
              The project vault is not set up. Payments disbursed by the project
              maintainer are not guaranteed.
            </span>
          </p>
        )
      ) : (
        <>
          {registrationNotice && <p role="status">{registrationNotice}</p>}
          <VaultTotalsView totals={totals} />
          {!readOnly &&
            project.escrow?.deployments.map((deployment) => (
              <VaultActions
                key={`${deployment.network}:${deployment.vault}`}
                deployment={deployment}
                connectedWallet={connectedWallet ?? undefined}
                projectId={project.id}
                onFinalized={() => setRevision((value) => value + 1)}
              />
            ))}
          {!readOnly && project.reward.kind === "monthly-pool"
            ? project.escrow?.deployments.map((deployment) => (
                <AutomaticMonthlyPayment
                  key={`monthly:${deployment.network}:${deployment.vault}`}
                  project={project}
                  deployment={deployment}
                  onFinalized={() => setRevision((value) => value + 1)}
                />
              ))
            : null}
        </>
      )}
    </section>
  );
}
