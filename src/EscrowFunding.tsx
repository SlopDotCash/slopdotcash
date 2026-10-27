import { useCallback, useState } from "react";
import { AutomaticMonthlyPayment } from "./AutomaticMonthlyPayment";
import { readBoundedJson } from "./lib/browser-json";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { networkLabel } from "./lib/network-names";
import {
  formatAssetAmount,
  isAssetDecimals,
  isBaseUnits,
  reservedGross,
  type VaultSnapshot,
} from "./lib/payments/contracts";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { CANONICAL_UINT } from "./lib/record-validation.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { usePublicResource } from "./lib/use-public-resource";
import { OwnerVaultSetup } from "./OwnerVaultSetup";
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

function VaultTotals({
  snapshot,
  staleAfterMs,
}: {
  snapshot: VaultSnapshot;
  staleAfterMs: number;
}) {
  const value = (amount: string | null) =>
    amount === null ? "Not reported" : formatAssetAmount(amount, snapshot);
  const reservedAwards = reservedGross(snapshot);
  const stale = vaultSnapshotStale(snapshot, staleAfterMs);
  const network = Object.hasOwn(ESCROW_NETWORKS, snapshot.network)
    ? networkLabel(snapshot.network)
    : snapshot.network;
  return (
    <>
      {stale && (
        <p role="alert">
          These totals may be outdated · read{" "}
          {formatDateTime(snapshot.observedAt)}.
        </p>
      )}
      <dl>
        <dt>Deposited</dt>
        <dd>{value(snapshot.totalDeposited)}</dd>
        <dt>Paid out</dt>
        <dd>{value(snapshot.totalPaid)}</dd>
        <dt>Payout fees</dt>
        <dd>{value(snapshot.totalPayoutFees)}</dd>
        <dt>Withdrawn (gross)</dt>
        <dd>{value(snapshot.totalGrossWithdrawn)}</dd>
        <dt>Withdrawal fees</dt>
        <dd>{value(snapshot.totalWithdrawalFees)}</dd>
        <dt>Available</dt>
        <dd>{value(snapshot.freeBalance)}</dd>
        <dt>Reserved for awards</dt>
        <dd>{value(reservedAwards)}</dd>
        {snapshot.reservedFees !== null && (
          <>
            <dt>Reserved payout fees</dt>
            <dd>{value(snapshot.reservedFees)}</dd>
          </>
        )}
      </dl>
      <p>
        As of {formatDateTime(snapshot.blockTime)} · finalized block{" "}
        {snapshot.blockNumber} on {network}.
      </p>
    </>
  );
}

type VaultTotalsState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; vault: VaultResponse };

/** Loads the cached, finalized vault counters for a project with a deployed vault. */
export function useVaultTotals(
  project: ProjectDefinition,
  revision = 0,
): VaultTotalsState {
  const deployed = Boolean(project.escrow?.deployments.length);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh reloads the cached vault totals.
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
  const [state] = usePublicResource(
    deployed,
    load,
    "Could not load vault totals.",
  );
  if (!deployed) return { status: "none" };
  return state.status === "ready"
    ? { status: "ready", vault: state.vault }
    : state;
}

export { reservedGross };
/** Measured against the viewer's clock: the response itself can be edge-cached. */
export function vaultSnapshotStale(
  snapshot: VaultSnapshot,
  staleAfterMs: number,
): boolean {
  return Date.now() - Date.parse(snapshot.observedAt) > staleAfterMs;
}

export function EscrowFunding({
  project,
  onRegistered,
}: {
  project: ProjectDefinition;
  onRegistered: (project: ProjectDefinition) => void;
}) {
  const [registrationNotice, setRegistrationNotice] = useState("");
  const [connectedWallet, setConnectedWallet] =
    useState<VaultConnection | null>(null);
  const [revision, setRevision] = useState(0);
  const totals = useVaultTotals(project, revision);
  const deployed = totals.status !== "none";
  const withdrawalFee = project.escrow
    ? project.escrow.withdrawalFeeBasisPoints / 100
    : null;
  return (
    <section className="section project-funding" aria-label="Project escrow">
      <h2>
        Project vault · {NETWORK_NAMES[project.escrow?.chain ?? "solana"]}
      </h2>
      <p>
        Fees: 2% of each award
        {withdrawalFee !== null && `, ${withdrawalFee}% of withdrawals`}.
        Reserved awards cannot be withdrawn.
      </p>
      {!deployed ? (
        <OwnerVaultSetup
          project={project}
          onRegistered={(updated, wallet, notice) => {
            onRegistered(updated);
            setConnectedWallet(wallet);
            setRegistrationNotice(notice ?? "");
          }}
        />
      ) : (
        <>
          {registrationNotice && <p role="status">{registrationNotice}</p>}
          <p>Deposit below. Direct token transfers are not credited.</p>
          {totals.status === "error" ? (
            <p role="alert">{totals.message}</p>
          ) : totals.status !== "ready" ? (
            <p role="status">Loading vault totals…</p>
          ) : totals.vault.snapshots.length === 0 ? (
            <p role="status">Vault totals are not available yet.</p>
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
              connectedWallet={connectedWallet ?? undefined}
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
    </section>
  );
}
