import { useEffect, useState } from "react";
import { AutomaticMonthlyPayment } from "./AutomaticMonthlyPayment";
import { readBoundedJson } from "./lib/browser-json";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { CHAIN_NAMES, networkLabel } from "./lib/network-names";
import {
  formatAssetAmount,
  isAssetDecimals,
  isBaseUnits,
  type VaultSnapshot,
} from "./lib/payments/contracts";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { formatDateTime } from "./Presentation";
import { VaultActions } from "./VaultActions";

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

function validSnapshot(s: VaultSnapshot, projectId: string): boolean {
  return (
    !!s &&
    s.projectId === projectId &&
    typeof s.network === "string" &&
    Object.hasOwn(CHAIN_NAMES, s.chain) &&
    typeof s.vault === "string" &&
    typeof s.assetAddress === "string" &&
    /^[0-9A-Za-z]{32,44}$/.test(s.assetAddress) &&
    isAssetDecimals(s.assetDecimals) &&
    CUMULATIVE.every((k) => isBaseUnits(s[k])) &&
    CURRENT.every((k) => s[k] === null || isBaseUnits(s[k])) &&
    /^(0|[1-9][0-9]*)$/.test(s.blockNumber) &&
    !Number.isNaN(Date.parse(s.blockTime)) &&
    !Number.isNaN(Date.parse(s.observedAt))
  );
}

function VaultTotals({
  snapshot,
  staleAfterMs,
}: {
  snapshot: VaultSnapshot;
  staleAfterMs: number;
}) {
  const value = (amount: string | null) =>
    amount === null
      ? "Not reported by this vault type"
      : formatAssetAmount(amount, snapshot);
  // EVM vaults split reserved principal and fees; Solana reports one reserved total.
  const reservedAwards = snapshot.reservedPrincipal ?? snapshot.reserved;
  const stale = vaultSnapshotStale(snapshot, staleAfterMs);
  const network = Object.hasOwn(ESCROW_NETWORKS, snapshot.network)
    ? networkLabel(snapshot.network)
    : `${snapshot.network} (not a registry network)`;
  return (
    <>
      {stale && (
        <p role="alert">
          These totals are stale. The last finalized vault read was at{" "}
          {formatDateTime(snapshot.observedAt)}. The chain may show newer
          activity.
        </p>
      )}
      <dl>
        <dt>Deposited</dt>
        <dd>{value(snapshot.totalDeposited)}</dd>
        <dt>Paid out to contributors</dt>
        <dd>{value(snapshot.totalPaid)}</dd>
        <dt>Payout fees</dt>
        <dd>{value(snapshot.totalPayoutFees)}</dd>
        <dt>Withdrawn by the owner (gross)</dt>
        <dd>{value(snapshot.totalGrossWithdrawn)}</dd>
        <dt>Withdrawal fees</dt>
        <dd>{value(snapshot.totalWithdrawalFees)}</dd>
        <dt>Free balance</dt>
        <dd>{value(snapshot.freeBalance)}</dd>
        <dt>Reserved for committed awards</dt>
        <dd>{value(reservedAwards)}</dd>
        {snapshot.reservedFees !== null && (
          <>
            <dt>Reserved payout fees</dt>
            <dd>{value(snapshot.reservedFees)}</dd>
          </>
        )}
      </dl>
      <p>
        As of {formatDateTime(snapshot.blockTime)} (finalized block{" "}
        {snapshot.blockNumber} on {network}). Read from the vault counters at{" "}
        {formatDateTime(snapshot.observedAt)}. Amounts are in the vault asset
        only and are not dollar values.
      </p>
    </>
  );
}

export type VaultTotalsState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; vault: VaultResponse };

/** Loads the cached, finalized vault counters for a project with a deployed vault. */
export function useVaultTotals(
  project: ProjectDefinition,
  revision = 0,
): VaultTotalsState {
  const [vault, setVault] = useState<VaultResponse | null>(null);
  const [error, setError] = useState("");
  const deployed = Boolean(project.escrow?.deployments.length);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh reloads the cached vault totals.
  useEffect(() => {
    setVault(null);
    setError("");
    if (!deployed) return;
    const controller = new AbortController();
    fetch(`/api/v1/payments/projects/${encodeURIComponent(project.id)}/vault`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Vault totals are not available. Please retry.");
        const value = (await readBoundedJson(
          response,
          65536,
          "project vault totals",
        )) as VaultResponse;
        if (
          !value ||
          !Array.isArray(value.snapshots) ||
          !Number.isSafeInteger(value.staleAfterMs) ||
          Number.isNaN(Date.parse(value.servedAt)) ||
          !value.snapshots.every((s) => validSnapshot(s, project.id))
        )
          throw new Error("The vault totals could not be verified.");
        if (!controller.signal.aborted) setVault(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load vault totals.",
          );
      });
    return () => controller.abort();
  }, [project.id, deployed, revision]);
  if (!deployed) return { status: "none" };
  if (error) return { status: "error", message: error };
  return vault ? { status: "ready", vault } : { status: "loading" };
}

/** Measured against the viewer's clock: the response itself can be edge-cached. */
export function vaultSnapshotStale(
  snapshot: VaultSnapshot,
  staleAfterMs: number,
): boolean {
  return Date.now() - Date.parse(snapshot.observedAt) > staleAfterMs;
}

export function EscrowFunding({ project }: { project: ProjectDefinition }) {
  const [revision, setRevision] = useState(0);
  const totals = useVaultTotals(project, revision);
  const deployed = totals.status !== "none";
  const withdrawalFee = project.escrow
    ? project.escrow.withdrawalFeeBasisPoints / 100
    : null;
  return (
    <section className="section project-funding" aria-label="Project escrow">
      <h2>Project vault · {CHAIN_NAMES[project.escrow?.chain ?? "solana"]}</h2>
      <p>
        Awards pay out after a 2% fee in the reward token. Reserved awards
        cannot be withdrawn.
        {withdrawalFee !== null &&
          ` Withdrawing unused funds costs ${withdrawalFee}%.`}
      </p>
      {!deployed ? (
        <p>
          This project has no vault yet. Deposits and payments are not possible
          until a project revision records the owner&apos;s vault.
        </p>
      ) : (
        <>
          <p>
            Use the deposit action below to fund this project. Direct token
            transfers are not credited.
          </p>
          {project.reward.paymentMode !== "enabled" ? (
            <p role="note">
              Payments are disabled for this project. No award is paid from the
              vault until payments are enabled.
            </p>
          ) : null}
          {totals.status === "error" ? (
            <p role="alert">{totals.message}</p>
          ) : totals.status !== "ready" ? (
            <p role="status">Loading the cached vault totals…</p>
          ) : totals.vault.snapshots.length === 0 ? (
            <p role="status">
              No finalized vault read is recorded yet. Totals appear after the
              next payments scan.
            </p>
          ) : (
            totals.vault.snapshots.map((snapshot) => (
              <VaultTotals
                key={`${snapshot.network}:${snapshot.vault}`}
                snapshot={snapshot}
                staleAfterMs={totals.vault.staleAfterMs}
              />
            ))
          )}
          {project.reward.kind === "monthly-pool"
            ? project.escrow?.deployments.map((deployment) => (
                <AutomaticMonthlyPayment
                  key={`monthly:${deployment.network}:${deployment.vault}`}
                  project={project}
                  deployment={deployment}
                  onFinalized={() => setRevision((value) => value + 1)}
                />
              ))
            : null}
          {project.escrow?.deployments.map((deployment) => (
            <VaultActions
              key={`${deployment.network}:${deployment.vault}`}
              deployment={deployment}
              projectId={project.id}
              onFinalized={() => setRevision((value) => value + 1)}
            />
          ))}
          <button
            className="button secondary-button"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh vault totals
          </button>
        </>
      )}
      <p>
        <a href="/earnings">View your payouts</a>
      </p>
    </section>
  );
}
