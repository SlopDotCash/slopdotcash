// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { PublicVaultPayment } from "@repo/settlement/client";
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { Button, ExternalLink, NetworkMark, Spinner, Status, StatusIcon } from "@repo/ui";
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

function Chip({ label }: { label: string }) {
  return <Status presentation={{ tone: "Neutral", icon: "Dot", label }} />;
}

/** A finalized vault payment: the project, the network, the work month as recorded, and the exact net amount in the vault's asset. */
export function VaultPaymentRecord({ payment, projectName }: VaultPaymentRecordProps) {
  const href = transactionUrl(payment.network, payment.transactionId);
  return (
    <PaymentRecord
      name={projectName ?? payment.projectId}
      detail={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Chip label="Vault" /> <NetworkMark network={CHAIN_NAMES[payment.chain]} showName={false} size="sm" /> {payment.contributionMonth ? formatMonth(payment.contributionMonth) : "—"}
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
          <small className="text-xs text-muted-foreground">Net</small>
          <PayoutAmount amount={payment.netBase} decimals={payment.assetDecimals} symbol={knownAssetSymbol(payment)} token={payment.assetAddress} />
        </>
      }
      action={
        href ? (
          <ExternalLink href={href} label="View transaction" title="View transaction" className={linkClass}>
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
};

const recentPayments = 5;

const pending: ReadonlySet<ReadStatus> = new Set(["Idle", "Loading"]);

const settled: ReadonlySet<ReadStatus> = new Set(["Current", "Empty", "Stale"]);

/** Finalized ordinary vault payments only, each in its own asset's base units: the recent five, or all of them. */
export function VaultPaymentHistory({ payments, nameOf }: VaultPaymentHistoryProps) {
  const [showAll, setShowAll] = useState(false);
  const rows = payments.value ?? [];
  return (
    <section aria-label="Finalized project payments" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">Payments</h2>
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
          <ul className="flex flex-col divide-y divide-border">
            {(showAll ? rows : rows.slice(0, recentPayments)).map((payment) => (
              <VaultPaymentRecord key={payment.id} payment={payment} projectName={nameOf(payment.projectId)} />
            ))}
          </ul>
          {rows.length > recentPayments ? (
            <Button variant="outline" size="sm" className="self-start" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : `All ${rows.length}`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
