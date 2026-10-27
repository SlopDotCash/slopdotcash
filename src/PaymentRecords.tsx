import type { ReactNode } from "react";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import {
  knownAssetSymbol,
  type PublicVaultPayment,
  transactionUrl,
} from "./lib/payments/contracts";
import { findProject } from "./lib/projects.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { PayoutAmount } from "./PayoutRows";
import { ExternalLinkAnchor, formatCycleMonth } from "./Presentation";
import "./public-records.css";

/** A common layout only; the caller retains its record's amount and state. */
export function PaymentRecord({
  name,
  detail,
  amount,
  action,
}: {
  name: ReactNode;
  detail: ReactNode;
  amount: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="payment-record">
      <div className="payment-record-identity">
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <div className="payment-record-amount">{amount}</div>
      {action ? <div className="payment-record-action">{action}</div> : null}
    </li>
  );
}

export function VaultPaymentRecord({
  payment,
}: {
  payment: PublicVaultPayment;
}) {
  const network =
    ESCROW_NETWORKS[payment.network as keyof typeof ESCROW_NETWORKS];
  const href = transactionUrl(payment.network, payment.transactionId);
  return (
    <PaymentRecord
      name={findProject(payment.projectId)?.name ?? payment.projectId}
      detail={
        <>
          Finalized vault payment · {NETWORK_NAMES[payment.chain]}
          {network?.testnet ? " testnet" : ""} · Work month:{" "}
          {payment.contributionMonth
            ? formatCycleMonth(payment.contributionMonth)
            : "Not recorded"}
        </>
      }
      amount={
        <>
          <small>Net paid</small>
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
        </>
      }
      action={
        href ? (
          <ExternalLinkAnchor href={href}>View transaction</ExternalLinkAnchor>
        ) : (
          "Transaction unavailable"
        )
      }
    />
  );
}
