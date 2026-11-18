import { ExternalLink, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import { ChainIcon } from "./ChainIcon";
import { Link } from "./Link";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import type { EscrowDeployment } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import {
  isPublicVaultDeposit,
  knownAssetSymbol,
  type PublicVaultDeposits,
  transactionUrl,
} from "./lib/payments/contracts";
import { vaultActionKey } from "./lib/pending-attempt";
import { usePublicResource } from "./lib/use-public-resource";
import { shortAddress } from "./lib/wallets";
import { PaymentRecord } from "./PaymentRecords";
import { PayoutAmount } from "./PayoutRows";
import { formatDate } from "./Presentation";

const VaultActions = lazy(() =>
  import("./VaultActions").then((module) => ({ default: module.VaultActions })),
);

/** A funding request saved in this tab reopens the form after a reload. */
function hasSavedRequest(deployment: EscrowDeployment): boolean {
  try {
    return sessionStorage.getItem(vaultActionKey(deployment)) !== null;
  } catch {
    return false;
  }
}

/**
 * The public project page's deposit control (operator decision, 18 November
 * 2026, PRD section 6). Any connected wallet may deposit; nothing here
 * withdraws. The risk is stated before a wallet is chosen, and the wallet
 * code loads only when a visitor asks to fund.
 */
export function PublicVaultFunding({
  projectId,
  deployment,
  showNetwork,
  onFinalized,
}: {
  projectId: string;
  deployment: EscrowDeployment;
  /** A project with more than one vault names each vault's network. */
  showNetwork: boolean;
  onFinalized: () => void;
}) {
  const [open, setOpen] = useState(() => hasSavedRequest(deployment));
  return (
    <div className="vault-public-funding">
      <p>
        Anyone can fund this project from their own wallet. Depositors have no
        refund right. The project owner can withdraw free funds, less a 2% fee.
      </p>
      {open ? (
        <Suspense
          fallback={
            <p aria-label="Loading the funding form" role="status">
              <LoaderCircle
                aria-hidden="true"
                className="wallet-spin"
                size={18}
              />
            </p>
          }
        >
          <VaultActions
            depositOnly
            projectId={projectId}
            deployment={deployment}
            onFinalized={onFinalized}
          />
        </Suspense>
      ) : (
        <button
          type="button"
          className="button secondary-button"
          onClick={() => setOpen(true)}
        >
          Fund this project
          {showNetwork ? ` · ${networkLabel(deployment.network)}` : ""}
        </button>
      )}
    </div>
  );
}

/**
 * Finalized deposits recorded from each vault's own event, newest first. The
 * list is evidence of who funded, not a balance: an owner withdrawal does not
 * remove a row.
 */
export function VaultFunders({
  projectId,
  revision,
}: {
  projectId: string;
  /** Changes after a finalized deposit on this page, to read the list again. */
  revision: number;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: a finalized deposit reloads the list.
  const load = useCallback(
    async (signal: AbortSignal) => {
      const response = await fetchWithDeadline(
        `/api/v1/payments/projects/${encodeURIComponent(projectId)}/deposits`,
        { signal },
      );
      if (!response.ok) throw new Error("Funders are unavailable.");
      const value = (await readBoundedJson(
        response,
        262_144,
        "project vault deposits",
      )) as PublicVaultDeposits | null;
      if (
        !value ||
        value.projectId !== projectId ||
        !Array.isArray(value.deposits) ||
        !value.deposits.every(
          (deposit) =>
            isPublicVaultDeposit(deposit) && deposit.projectId === projectId,
        ) ||
        !Number.isSafeInteger(value.total) ||
        value.total < value.deposits.length
      )
        throw new Error("The funders could not be verified.");
      return { funders: value };
    },
    [projectId, revision],
  );
  const [state, retry] = usePublicResource(
    true,
    load,
    "Could not load funders.",
  );
  const [showAll, setShowAll] = useState(false);
  // A loader change takes effect after render; never show another project's list.
  const ready =
    state.status === "ready" && state.funders.projectId === projectId
      ? state.funders
      : null;
  return (
    <section className="vault-funders" aria-label="Funded by">
      <h3>Funded by</h3>
      {state.status === "error" ? (
        <p role="status">
          Funders unavailable ·{" "}
          <button
            aria-label="Retry funders"
            type="button"
            className="text-button"
            onClick={retry}
          >
            Retry
          </button>
        </p>
      ) : ready === null ? (
        <p aria-label="Loading funders" role="status">
          <LoaderCircle aria-hidden="true" className="wallet-spin" size={18} />
        </p>
      ) : ready.deposits.length === 0 ? (
        <p>No deposits recorded yet</p>
      ) : (
        <>
          <ul className="payment-records">
            {(showAll ? ready.deposits : ready.deposits.slice(0, 5)).map(
              (deposit) => {
                const href = transactionUrl(
                  deposit.network,
                  deposit.transactionId,
                );
                return (
                  <PaymentRecord
                    key={deposit.id}
                    name={
                      deposit.githubLogin ? (
                        <Link
                          href={`/contributors/${encodeURIComponent(deposit.githubLogin)}`}
                        >
                          {deposit.githubLogin}
                        </Link>
                      ) : (
                        <code title={deposit.depositor}>
                          {shortAddress(deposit.depositor)}
                        </code>
                      )
                    }
                    detail={
                      <>
                        <ChainIcon chain={deposit.chain} />{" "}
                        {formatDate(deposit.depositedAt)}
                        {deposit.githubLogin ? (
                          <>
                            {" · "}
                            <code title={deposit.depositor}>
                              {shortAddress(deposit.depositor)}
                            </code>
                          </>
                        ) : null}
                      </>
                    }
                    amount={
                      <PayoutAmount
                        base={deposit.amountBase}
                        decimals={deposit.assetDecimals}
                        symbol={knownAssetSymbol(
                          deposit.network,
                          deposit.assetAddress,
                          deposit.assetDecimals,
                        )}
                        address={deposit.assetAddress}
                      />
                    }
                    action={
                      href ? (
                        <a
                          className="payout-tx"
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="View deposit transaction"
                          title="View deposit transaction"
                        >
                          <ExternalLink aria-hidden="true" size={16} />
                        </a>
                      ) : null
                    }
                  />
                );
              },
            )}
          </ul>
          {ready.deposits.length > 5 ? (
            <button
              type="button"
              className="button secondary-button button-small"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Show less" : `Newest ${ready.deposits.length}`}
            </button>
          ) : null}
          {ready.total > ready.deposits.length ? (
            <p>
              {ready.total} deposits recorded. The newest{" "}
              {ready.deposits.length} are listed.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
