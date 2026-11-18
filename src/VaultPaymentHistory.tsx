import { LoaderCircle } from "lucide-react";
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
        <h2>Payments</h2>
      </div>
      {state.status === "loading" ? (
        <p aria-label="Loading project payments" role="status">
          <LoaderCircle aria-hidden="true" className="wallet-spin" size={18} />
        </p>
      ) : state.status === "error" ? (
        <p role="status">
          Payments unavailable ·{" "}
          <button
            aria-label="Retry project payments"
            type="button"
            className="text-button"
            onClick={retry}
          >
            Retry
          </button>
        </p>
      ) : state.payments.length === 0 ? (
        <p>No payments yet</p>
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
              {showAll ? "Show less" : `All ${state.payments.length}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
