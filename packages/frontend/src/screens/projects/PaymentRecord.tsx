// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { PublicVaultPayment } from "@repo/settlement/client";
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { Button, DataState, ExternalLink } from "@repo/ui";
import { type ReactNode, useState } from "react";
import { CHAIN_NAMES, knownAssetSymbol } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import type { Shown } from "../home/listing.ts";
import { PayoutAmount } from "../payouts/PayoutAmount.tsx";
import { formatMonth } from "./summary.ts";

export type PaymentRecordProps = {
  /** Who or what the record is about. */
  name: ReactNode;
  /** One line of facts under the name. */
  detail: ReactNode;
  /** The record's amount, with the caller's own state. */
  amount: ReactNode;
  /** The record's one link or action. */
  action?: ReactNode;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** One public payment record in a list: a common layout only; the caller keeps its record's amount and state. */
export function PaymentRecord({ name, detail, amount, action }: PaymentRecordProps) {
  return (
    <li className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <strong className="font-medium text-foreground">{name}</strong>
        <small className="text-sm text-muted-foreground">{detail}</small>
      </div>
      <div className="flex min-w-0 flex-col gap-1">{amount}</div>
      {action ? <div className="text-sm">{action}</div> : null}
    </li>
  );
}

export type VaultPaymentRecordProps = {
  /** A finalized ordinary payment from a project vault. */
  payment: PublicVaultPayment;
  /** The listed name of the paying project, when the registry lists it. */
  projectName?: string;
};

/** @throws {never} */
function testnet(network: string): boolean {
  return isNetworkKey(network) && NETWORKS[network].testnet;
}

/** A finalized vault payment: the project, the network, the work month as recorded, and the exact net amount in the vault's asset. */
export function VaultPaymentRecord({ payment, projectName }: VaultPaymentRecordProps) {
  const href = transactionUrl(payment.network, payment.transactionId);
  return (
    <PaymentRecord
      name={projectName ?? payment.projectId}
      detail={
        <>
          Finalized vault payment · {CHAIN_NAMES[payment.chain]}
          {testnet(payment.network) ? " testnet" : ""} · Work month: {payment.contributionMonth ? formatMonth(payment.contributionMonth) : "Not recorded"}
        </>
      }
      amount={
        <>
          <small className="text-xs text-muted-foreground">Net paid</small>
          <PayoutAmount amount={payment.netBase} decimals={payment.assetDecimals} symbol={knownAssetSymbol(payment)} token={payment.assetAddress} />
        </>
      }
      action={
        href ? (
          <ExternalLink href={href} className={linkClass}>
            View transaction
          </ExternalLink>
        ) : (
          "Transaction unavailable"
        )
      }
    />
  );
}

export type VaultPaymentHistoryProps = {
  /** The finalized ordinary vault payments of the scope, newest first. */
  payments: Shown<ReadonlyArray<PublicVaultPayment>>;
  /** The listed name of a project, when the registry lists it. */
  nameOf: (projectId: string) => string | undefined;
};

const recentPayments = 5;

/** Finalized ordinary vault payments only, each in its own asset's base units: the recent five, or all of them. */
export function VaultPaymentHistory({ payments, nameOf }: VaultPaymentHistoryProps) {
  const [showAll, setShowAll] = useState(false);
  const rows = payments.value ?? [];
  return (
    <section aria-label="Finalized project payments" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">Finalized project payments</h2>
      <DataState status={payments.status} onRetry={payments.onRetry} retryLabel="Retry project payments">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">No finalized project-vault payments recorded.</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {(showAll ? rows : rows.slice(0, recentPayments)).map((payment) => (
                <VaultPaymentRecord key={payment.id} payment={payment} projectName={nameOf(payment.projectId)} />
              ))}
            </ul>
            {rows.length > recentPayments ? (
              <Button variant="outline" size="sm" className="self-start" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show recent payments" : `Show all ${rows.length} payments`}
              </Button>
            ) : null}
          </>
        )}
      </DataState>
    </section>
  );
}
