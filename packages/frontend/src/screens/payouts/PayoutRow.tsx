// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/ui/status.md, "Payment states keep award, funding and settlement apart"
import { ListItem, Status, TransactionStatus } from "@repo/ui";
import type { ReactNode } from "react";
import { NetworkName } from "../funding/vault/index.ts";
import { PayoutAmount, type PayoutAmountProps } from "./PayoutAmount.tsx";
import type { Presentation } from "./status.ts";

export type PayoutRowProps = {
  /** The network the payout is on. */
  network: string;
  /** The project that funds it; absent for a payout no project funds. */
  projectId?: string;
  /** The amount and, for an award, its gross and fee. */
  amount: PayoutAmountProps;
  /** Context beside the network, such as the award month. */
  note?: string;
  /** The payout's state as its owning spec presents it. */
  status: Presentation;
  /** The full wording of the state, when its word is short. */
  statusTitle?: string;
  /** The finalized or submitted transaction on the network's explorer. */
  explorerUrl?: string;
  /** The explorer link's words. */
  explorerLabel?: string;
  /** What the person can do for this payout. */
  children?: ReactNode;
};

/** One payout on one line: its project, network, exact amount, state and transaction. */
export function PayoutRow({ network, projectId, amount, note, status, statusTitle, explorerUrl, explorerLabel = "View transaction", children }: PayoutRowProps) {
  return (
    <ListItem
      className="flex-wrap"
      title={projectId ? <a href={`/projects/${encodeURIComponent(projectId)}`} className="text-primary underline underline-offset-4 hover:decoration-2">{projectId}</a> : <NetworkName network={network} />}
      detail={
        projectId || note ? (
          <span className="inline-flex items-center gap-1">
            {projectId ? <NetworkName network={network} /> : null}
            {note ? <span>{projectId ? `· ${note}` : note}</span> : null}
          </span>
        ) : undefined
      }
      trailing={<PayoutAmount {...amount} />}
      actions={
        <>
          {explorerUrl === undefined ? <Status presentation={status} title={statusTitle} /> : <TransactionStatus presentation={status} explorerUrl={explorerUrl} explorerLabel={explorerLabel} title={statusTitle} />}
          {children}
        </>
      }
    />
  );
}
