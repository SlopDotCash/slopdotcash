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

/** A saved wallet request: its link, hash recovery and the check action. */
export function PendingWalletCheck({
  children,
  link,
  hashSource,
  solana,
  recoveryHash,
  onRecoveryHash,
  busy,
  canCheck,
  onCheck,
  unsent,
  onClear,
}: {
  children: ReactNode;
  link: string | null | undefined;
  hashSource: "wallet" | "recovery" | undefined;
  solana: boolean;
  recoveryHash: string;
  onRecoveryHash: (value: string) => void;
  busy: boolean;
  canCheck: boolean;
  onCheck: () => void;
  unsent: boolean;
  onClear: () => void;
}) {
  return (
    <PendingTransaction>
      {children}
      {link ? (
        <p>
          <a href={link} target="_blank" rel="noreferrer">
            {hashSource === "wallet"
              ? "View submitted transaction"
              : "View transaction to check"}
          </a>
        </p>
      ) : null}
      {hashSource !== "wallet" ? (
        <label>
          Transaction {solana ? "signature" : "hash"} from your wallet
          <input
            value={recoveryHash}
            disabled={busy}
            onChange={(event) => onRecoveryHash(event.target.value)}
            spellCheck={false}
          />
        </label>
      ) : null}
      <button
        type="button"
        className="button primary-button"
        disabled={busy || !canCheck}
        onClick={onCheck}
      >
        Check transaction
      </button>
      {unsent ? (
        <UnsentTransactionRecovery disabled={busy} onClear={onClear} />
      ) : null}
    </PendingTransaction>
  );
}
