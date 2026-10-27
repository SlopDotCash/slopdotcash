import type { ReactNode } from "react";
import "./owner-review.css";

/** Shared comparison layout; callers retain their own change and publish rules. */
export function ChangeReview({
  label,
  before,
  after,
}: {
  label: string;
  before: ReactNode;
  after: ReactNode;
}) {
  return (
    <div className="owner-change-review">
      <h3>{label}</h3>
      <dl>
        <div>
          <dt>Current</dt>
          <dd>{before}</dd>
        </div>
        <div>
          <dt>Proposed</dt>
          <dd>{after}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The operation owns reconciliation and clearing; this only presents recovery. */
export function UnsentTransactionRecovery({
  disabled,
  onClear,
}: {
  disabled: boolean;
  onClear: () => void;
}) {
  return (
    <details className="owner-transaction-recovery">
      <summary>Wallet confirms nothing was sent</summary>
      <p>
        Check wallet activity first. If it was sent, enter its transaction hash
        or signature above.
      </p>
      <button
        type="button"
        className="button secondary-button"
        disabled={disabled}
        onClick={onClear}
      >
        I checked my wallet; this request was not sent
      </button>
    </details>
  );
}

export function PendingTransaction({ children }: { children: ReactNode }) {
  return <div className="owner-pending-transaction">{children}</div>;
}
