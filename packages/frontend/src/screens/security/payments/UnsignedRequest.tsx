// spec/settlement/directBounty.md, "A standard award freezes its network, asset and two split amounts"; spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
import type { OwnerRequest } from "@repo/settlement/client";
import { Address, CopyButton, TokenAmount } from "@repo/ui";
import { Download } from "lucide-react";
import { Fact } from "../cases/parts.tsx";
import { requestDownload, requestSymbol, requestText, transferAmount } from "./request.ts";

export type UnsignedRequestProps = {
  /** The prepared request, parsed. */
  request: OwnerRequest;
  /** The request exactly as the case carries it, which is what is copied and downloaded. */
  raw: unknown;
};

const roleNames = { researcher: "Researcher", fee: "Slop fee" } as const;

/** The transfers still due, each with its exact amount and recipient, before any wallet is asked. */
export function UnsignedRequest({ request, raw }: UnsignedRequestProps) {
  const symbol = requestSymbol(request);
  return (
    <section aria-labelledby="transfers-due" className="flex flex-col gap-3">
      <h5 id="transfers-due" className="font-semibold text-foreground">
        Transfers still due
      </h5>
      <p>Send these transfers with your external wallet, then verify the transaction IDs.</p>
      <dl className="flex flex-col gap-2">
        <Fact term="From">
          <Address value={request.payer.address} label="Payer wallet" copyLabel="Copy payer wallet" />
        </Fact>
        <Fact term="Asset">
          <Address value={request.asset.address} label="Payment asset" copyLabel="Copy payment asset" />
        </Fact>
      </dl>
      <ul className="flex flex-col gap-3">
        {request.transfers.map((transfer, index) => {
          const name = roleNames[transfer.role];
          const transaction = request.transactions?.[index];
          return (
            <li key={`${transfer.role}:${transfer.recipient}`} data-payment-recipient={transfer.recipient} className="flex flex-col gap-2 rounded-md border border-border p-4">
              <span className="text-sm font-medium text-muted-foreground">{name}</span>
              <TokenAmount value={transferAmount(request, transfer)} symbol={symbol} label={`${name} amount`} />
              <Address value={transfer.recipient} label={`${name} wallet`} copyLabel={`Copy ${name === "Researcher" ? "researcher" : name} wallet`} />
              {transaction ? <CopyButton variant="labeled" text={requestText(transaction)} label={`Copy ${name === "Researcher" ? "researcher" : name} transfer`} /> : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {request.solana ? <CopyButton variant="labeled" text={request.solana.transaction} label="Copy Solana transaction" /> : null}
        <CopyButton variant="labeled" text={requestText(raw)} label="Copy unsigned request" />
        <a href={requestDownload(raw)} download="private-payment-request.json" className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2">
          <Download aria-hidden className="size-4" /> Download unsigned request
        </a>
      </div>
    </section>
  );
}
