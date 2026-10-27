import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { knownAssetSymbol, transactionUrl } from "./lib/payments/contracts";
import { findProject } from "./lib/projects.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import {
  type PublicPaymentScope,
  useVaultPayments,
} from "./lib/use-vault-payments";
import { ExternalLinkAnchor, formatCycleMonth } from "./Presentation";
import { PayoutAmount } from "./PayoutRows";

/** Only finalized ordinary payments; each asset keeps its own base units. */
export function VaultPaymentHistory({ scope }: { scope: PublicPaymentScope }) {
  const [state, retry] = useVaultPayments(scope);
  if (scope === null) return null;
  return (
    <section className="section" aria-label="Finalized project payments">
      <h2>Finalized project payments</h2>
      {state.status === "loading" ? (
        <p role="status">Loading project payments…</p>
      ) : state.status === "error" ? (
        <p role="status">
          Project payment records unavailable.{" "}
          <button type="button" className="text-button" onClick={retry}>
            Retry project payments
          </button>
        </p>
      ) : state.payments.length === 0 ? (
        <p>No finalized project-vault payments recorded.</p>
      ) : (
        <div className="cycle-records">
          <p>
            Verified ordinary project-vault payments. Amounts are net of the
            recorded fee.
          </p>
          {state.payments.map((payment) => {
            const network =
              ESCROW_NETWORKS[payment.network as keyof typeof ESCROW_NETWORKS];
            const href = transactionUrl(payment.network, payment.transactionId);
            return (
              <article className="cycle-record" key={payment.id}>
                <div>
                  <h3>
                    {findProject(payment.projectId)?.name ?? payment.projectId}
                  </h3>
                  <p>
                    {NETWORK_NAMES[payment.chain]}
                    {network?.testnet ? " testnet" : ""}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Work month</dt>
                    <dd>
                      {payment.contributionMonth
                        ? formatCycleMonth(payment.contributionMonth)
                        : "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt>Net paid</dt>
                    <dd>
                      <PayoutAmount
                        base={payment.netBase}
                        decimals={payment.assetDecimals}
                        symbol={knownAssetSymbol(
                          payment.network,
                          payment.assetAddress,
                          payment.assetDecimals,
                        )}
                        address={payment.assetAddress}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Transaction</dt>
                    <dd>
                      {href ? (
                        <ExternalLinkAnchor href={href}>
                          View transaction
                        </ExternalLinkAnchor>
                      ) : (
                        "Unavailable"
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
