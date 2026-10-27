import { useState } from "react";
import {
  type PublicPaymentScope,
  useVaultPayments,
} from "./lib/use-vault-payments";
import { VaultPaymentRecord } from "./PaymentRecords";

/** Only finalized ordinary payments; each asset keeps its own base units. */
export function VaultPaymentHistory({ scope }: { scope: PublicPaymentScope }) {
  const [state, retry] = useVaultPayments(scope);
  const [showAll, setShowAll] = useState(false);
  if (scope === null) return null;
  return (
    <section className="section" aria-label="Finalized project payments">
      <div className="profile-card-heading">
        <h2>Finalized project payments</h2>
      </div>
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
        <>
          <ul className="payment-records">
            {(showAll ? state.payments : state.payments.slice(0, 5)).map(
              (payment) => (
                <VaultPaymentRecord key={payment.id} payment={payment} />
              ),
            )}
          </ul>
          {state.payments.length > 5 ? (
            <button
              type="button"
              className="button secondary-button button-small"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll
                ? "Show recent payments"
                : `Show all ${state.payments.length} payments`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
