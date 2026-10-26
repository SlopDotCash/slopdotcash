import { useEffect, useState } from "react";
import { errorMessage } from "./lib/errors";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { ProjectApiError, projectApiRequest } from "./lib/project-api";
import { formatAssetAmount } from "./lib/project-schema.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { OwnerVaultSetup } from "./OwnerVaultSetup";
import { VaultActions } from "./VaultActions";

type PrivateFunds = {
  currency: string;
  decimals: number;
  availableMinor: string;
  freeMinor: string;
  snapshotAt: string;
};

/** Owner-only funding view. Bounty balances never use the public payment API. */
export function OwnerBountyVault({
  project,
  onRegistered,
}: {
  project: ProjectDefinition;
  onRegistered: (value: {
    project: ProjectDefinition;
    revision: number;
  }) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        funds: PrivateFunds | null;
        canSetup: boolean;
        refreshError?: string;
      }
  >({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh repeats the private balance read.
  useEffect(() => {
    let active = true;
    // A balance refresh must not unmount the wallet action and erase its
    // finalized result or an in-flight recovery form.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    projectApiRequest<{ funds: PrivateFunds | null; canSetup: boolean }>(
      "GET",
      `project-vaults/${project.id}?purpose=security-bounty`,
    ).then(
      (result) => {
        if (active) setState({ status: "ready", ...result });
      },
      (error: unknown) => {
        if (!active) return;
        const message = errorMessage(error, "Bounty funds could not load.");
        const temporary =
          error instanceof ProjectApiError &&
          (error.status === 0 || error.status >= 500);
        setState((previous) =>
          temporary && previous.status === "ready"
            ? { ...previous, canSetup: false, refreshError: message }
            : { status: "error", message },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [project, reload]);
  const deployments = project.securityBounty?.settlement?.deployments ?? [];
  return (
    <section className="owner-section" aria-label="Bounty funds">
      <h2>Bounty funds</h2>
      <div className="owner-form">
        <p>
          These funds are separate from contribution rewards. Slop shows this
          balance only to project owners.
        </p>
        {state.status === "loading" ? (
          <p role="status">Loading private bounty funds…</p>
        ) : null}
        {state.status === "error" ? <p role="alert">{state.message}</p> : null}
        {state.status === "ready" ? (
          <>
            {state.refreshError ? (
              <p role="alert">
                {state.refreshError}{" "}
                {state.funds
                  ? "Last verified balance is stale."
                  : "Last verified vault information is shown."}{" "}
                New setup and deposits are disabled until a successful refresh.
                Existing transaction checks and owner withdrawals remain
                available.
              </p>
            ) : null}
            {!state.canSetup && !state.refreshError ? (
              <p>
                This project is restricted. New setup and deposits are disabled.
                {deployments.length > 0
                  ? " The owner can still check existing deposit or withdrawal transactions and withdraw free funds."
                  : " Vault registration can resume after reinstatement."}
              </p>
            ) : null}
            {state.funds ? (
              <>
                <p>
                  Available for new awards:{" "}
                  {formatAssetAmount(
                    state.funds.availableMinor,
                    state.funds.decimals,
                  )}{" "}
                  {state.funds.currency}.
                </p>
                <p>
                  Finalized balance checked at{" "}
                  {new Date(state.funds.snapshotAt).toLocaleString()}.
                </p>
              </>
            ) : (
              <p>
                No current finalized balance is available. After a deposit, wait
                for the private scanner, then refresh.
              </p>
            )}
            {deployments.length === 0 && state.canSetup ? (
              <OwnerVaultSetup
                project={project}
                payoutPolicy="security-bounty"
                onRegistered={(registered, connected, _notice, revision) => {
                  setWallet(connected);
                  onRegistered({ project: registered, revision });
                  setReload((value) => value + 1);
                }}
              />
            ) : null}
            {deployments.map((deployment) => (
              <VaultActions
                key={`${deployment.network}:${deployment.vault}`}
                projectId={project.id}
                deployment={deployment}
                payoutPolicy="security-bounty"
                canDeposit={state.canSetup}
                connectedWallet={wallet ?? undefined}
                onFinalized={() => setReload((value) => value + 1)}
              />
            ))}
          </>
        ) : null}
        <button
          type="button"
          className="button secondary-button"
          disabled={state.status === "loading"}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh bounty funds
        </button>
      </div>
    </section>
  );
}
