// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"
import type { Chain } from "@repo/settlement/kernels/networks";
import { cn, focusRing, ListItem, NetworkMark, Status, target, TransactionStatus } from "@repo/ui";
import type { ReactNode } from "react";
import { CHAIN_NAMES, networkLabel } from "../../kernels/assetText.ts";
import { PayoutAmount, type PayoutAmountProps } from "./PayoutAmount.tsx";
import type { Presentation } from "./status.ts";

export type PayoutRowProps = {
  /** The chain whose mark stands for the network. */
  chain: Chain;
  /** The network the payout is on. */
  network: string;
  /** The project that funds it; absent for a payout no project funds. */
  projectId?: string;
  /** The amount and, for an award, its gross and fee. */
  amount: PayoutAmountProps;
  /** Context beside the project, such as the award month. */
  note?: string;
  /** The payout's state as its owning spec presents it. */
  status: Presentation;
  /** The full wording of the state, when its word is short. */
  statusTitle?: string;
  /** Where the person resolves this state; the status becomes the link. */
  statusHref?: string;
  /** The finalized or submitted transaction on the network's explorer. */
  explorerUrl?: string;
  /** The explorer link's words. */
  explorerLabel?: string;
  /** What the person can do for this payout. */
  children?: ReactNode;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** @throws {never} */
function testNetwork(network: string): boolean {
  return /test/iu.test(networkLabel(network));
}

/** One payout on one line: its network, exact amount, project, state and transaction. */
export function PayoutRow({ chain, network, projectId, amount, note, status, statusTitle, statusHref, explorerUrl, explorerLabel = "View transaction", children }: PayoutRowProps) {
  const name = networkLabel(network);
  const context = [testNetwork(network) ? name : undefined, note].filter((part): part is string => part !== undefined);
  const shown = <Status presentation={status} title={statusTitle} />;
  const statusLabel = statusTitle === undefined ? undefined : statusTitle.toLowerCase().includes(status.label.toLowerCase()) ? statusTitle : `${status.label} — ${statusTitle}`;
  return (
    <ListItem
      className="flex-wrap"
      leading={<NetworkMark network={CHAIN_NAMES[chain]} showName={false} role="img" aria-label={name} title={name} />}
      title={
        <span className="text-sm text-muted-foreground">
          {projectId !== undefined ? (
            <a href={`/projects/${encodeURIComponent(projectId)}`} className={linkClass}>
              {projectId}
            </a>
          ) : null}
          {context.length > 0 ? `${projectId !== undefined ? " · " : ""}${context.join(" · ")}` : null}
        </span>
      }
      trailing={<PayoutAmount {...amount} />}
      actions={
        <>
          {statusHref !== undefined ? (
            <a href={statusHref} aria-label={statusLabel} className={cn(focusRing, target, "rounded-sm hover:underline")}>
              {shown}
            </a>
          ) : explorerUrl !== undefined ? (
            <TransactionStatus presentation={status} explorerUrl={explorerUrl} explorerLabel={explorerLabel} title={statusTitle} />
          ) : (
            shown
          )}
          {children}
        </>
      }
    />
  );
}
