// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { PublicVaultPayment } from "@repo/settlement/client";
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { Button, cn, ExternalLink, NetworkMark, Spinner, Status, StatusIcon } from "@repo/ui";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
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

/** One public payment record in a list: a common layout only; the caller keeps its record's amount and state. */
export function PaymentRecord({ name, detail, amount, action }: PaymentRecordProps) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_auto] items-center gap-x-6 gap-y-3 border-b border-border py-4 last:border-b-0 max-md:grid-cols-1">
      <div className="grid min-w-0 gap-1">
        <strong className="font-bold text-foreground">{name}</strong>
        <small className="mt-1.25 text-ui leading-page text-muted-foreground">{detail}</small>
      </div>
      <div className="grid min-w-0 justify-items-end gap-1 max-md:justify-items-start">{amount}</div>
      {action ? <div className="min-w-0">{action}</div> : null}
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

function Chip({ label }: { label: string }) {
  return <Status badge presentation={{ tone: "Neutral", icon: "Dot", label }} />;
}

/** A finalized vault payment: the project, the network, the work month as recorded, and the exact net amount in the vault's asset. */
export function VaultPaymentRecord({ payment, projectName }: VaultPaymentRecordProps) {
  const href = transactionUrl(payment.network, payment.transactionId);
  return (
    <PaymentRecord
      name={projectName ?? payment.projectId}
      detail={
        <span className="inline-flex flex-wrap items-center gap-1">
          <Chip label="Vault" /> <NetworkMark network={CHAIN_NAMES[payment.chain]} showName={false} size="sm" className="[&>svg]:size-4.5" /> {payment.contributionMonth ? formatMonth(payment.contributionMonth) : "—"}
          {testnet(payment.network) ? (
            <>
              {" "}
              <Chip label="Testnet" />
            </>
          ) : null}
        </span>
      }
      amount={
        <>
          <small className="mt-1.25 text-ui leading-page text-muted-foreground">Net</small>
          <PayoutAmount amount={payment.netBase} decimals={payment.assetDecimals} symbol={knownAssetSymbol(payment)} token={payment.assetAddress} />
        </>
      }
      action={
        href ? (
          <ExternalLink href={href} label="View transaction" title="View transaction" className="inline-grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ExternalLinkIcon aria-hidden className="size-4" />
          </ExternalLink>
        ) : (
          <StatusIcon icon="Slash" role="img" aria-label="Transaction unavailable" />
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
  /** The section's own spacing on the page that shows it. */
  className?: string;
};

const recentPayments = 5;

const pending: ReadonlySet<ReadStatus> = new Set(["Idle", "Loading"]);

const settled: ReadonlySet<ReadStatus> = new Set(["Current", "Empty", "Stale"]);

/** Finalized ordinary vault payments only, each in its own asset's base units: the recent five, or all of them. */
export function VaultPaymentHistory({ payments, nameOf, className }: VaultPaymentHistoryProps) {
  const [showAll, setShowAll] = useState(false);
  const rows = payments.value ?? [];
  return (
    <section aria-label="Finalized project payments" className={cn("flex flex-col items-start", className)}>
      <h2 className="mb-4 text-name leading-page font-extrabold tracking-tight text-foreground uppercase">Payments</h2>
      {pending.has(payments.status) ? (
        <p>
          <Spinner size="sm" label="Loading project payments" />
        </p>
      ) : !settled.has(payments.status) ? (
        <p role="status" className="text-muted-foreground">
          Payments unavailable ·{" "}
          <Button variant="link" aria-label="Retry project payments" onClick={payments.onRetry}>
            Retry
          </Button>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">No payments yet</p>
      ) : (
        <>
          <ul className="flex w-full flex-col">
            {(showAll ? rows : rows.slice(0, recentPayments)).map((payment) => (
              <VaultPaymentRecord key={payment.id} payment={payment} projectName={nameOf(payment.projectId)} />
            ))}
          </ul>
          {rows.length > recentPayments ? (
            <Button variant="outline" size="sm" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : `All ${rows.length}`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
