import type { ComponentProps, ReactNode } from "react";
import type { Presentation } from "../../gen/ui__status.ts";
import { cn } from "../lib/cn.ts";
import { politeness } from "../lib/live.ts";
import { Address, type AddressProps } from "./Address.tsx";
import { ExternalLink } from "./ExternalLink.tsx";
import { Status } from "./Status.tsx";

export type TransactionStatusProps = Omit<ComponentProps<"div">, "children" | "onCopy"> & {
  /** The transaction's state as its owner presents it: pending, not confirmed, not sent, finalized or failed. */
  presentation: Presentation;
  /** The transaction hash or signature in full, once the wallet or the person has given one. */
  hash?: string;
  /** The accessible name of the hash, such as "Transaction hash" or "Transaction signature". */
  hashLabel?: string;
  /** The block explorer's page for the transaction, from the network's configured explorer. */
  explorerUrl?: string;
  /** The explorer link's words. */
  explorerLabel?: string;
  /** Writes the hash to the clipboard (CopyButton). */
  onCopy?: AddressProps["onCopy"];
  /** The owner's recovery or check controls, below the facts. */
  actions?: ReactNode;
};

/** A wallet transaction as its owner tracks it: its state, its hash in full and its page on the network's explorer. */
// spec/ui/status.md, "A presentation is a tone, an icon and a word"
export function TransactionStatus({ presentation, hash, hashLabel = "Transaction hash", explorerUrl, explorerLabel = "View on explorer", onCopy, actions, className, ...props }: TransactionStatusProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Status presentation={presentation} aria-live={politeness.Polite} />
        {explorerUrl === undefined ? null : (
          <ExternalLink href={explorerUrl} className="text-sm">
            {explorerLabel}
          </ExternalLink>
        )}
      </div>
      {hash === undefined ? null : <Address value={hash} label={hashLabel} copyLabel={`Copy ${hashLabel.toLowerCase()}`} onCopy={onCopy} />}
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
