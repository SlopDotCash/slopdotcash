// spec/frontend/projections.md, "Story: Let anyone fund a project from its public page and see who funded"; spec/settlement/vaultDeposits.md, "The funders read lists the newest 50 deposits with the full count and names a depositor only by one public, open, wallet-signed registration"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Button, ExternalLink, ListItem, NetworkMark, Spinner, TokenAmount } from "@repo/ui";
import { ExternalLink as LinkOut } from "lucide-react";
import { useState } from "react";
import { type FundersView, noFundersText } from "../../../../gen/frontend__projections.ts";
import { CHAIN_NAMES, knownAssetSymbol } from "../../../kernels/assetText.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { formatDate } from "../../projects/summary.ts";
import type { ProjectDeposits } from "./funding.vibe";

export type VaultFundersProps = {
  /** What the funders read shows now. */
  view: FundersView;
  /** The checked funders read, newest first, once one is current. */
  funders?: ProjectDeposits;
  /** Reads the funders again after a failed read. */
  onRetry: () => void;
};

type Deposit = ProjectDeposits["deposits"][number];

const shownRows = 5;
const linkClass = "font-bold text-foreground underline-offset-4 hover:underline";

function shortAddress(address: string): string {
  return `${address.slice(0, address.startsWith("0x") ? 6 : 4)}…${address.slice(-4)}`;
}

function Depositor({ address }: { address: string }) {
  return (
    <code title={address} className="font-mono text-xs">
      {shortAddress(address)}
    </code>
  );
}

function FunderRow({ deposit }: { deposit: Deposit }) {
  const href = transactionUrl(deposit.network, deposit.transactionId);
  return (
    <ListItem
      title={
        deposit.githubLogin ? (
          <a href={`/contributors/${encodeURIComponent(deposit.githubLogin)}`} className={linkClass}>
            {deposit.githubLogin}
          </a>
        ) : (
          <Depositor address={deposit.depositor} />
        )
      }
      detail={
        <span className="flex items-center gap-1">
          <NetworkMark network={CHAIN_NAMES[deposit.chain]} showName={false} size="sm" />
          {formatDate(deposit.depositedAt)}
          {deposit.githubLogin ? (
            <>
              {" · "}
              <Depositor address={deposit.depositor} />
            </>
          ) : null}
        </span>
      }
      trailing={
        <TokenAmount
          value={formatBaseUnits({ value: BigInt(deposit.amountBase), decimals: deposit.assetDecimals })}
          symbol={knownAssetSymbol({ network: deposit.network, assetAddress: deposit.assetAddress, assetDecimals: deposit.assetDecimals })}
          token={deposit.assetAddress}
        />
      }
      actions={
        href ? (
          <ExternalLink href={href} label="View deposit transaction" title="View deposit transaction">
            <LinkOut aria-hidden="true" className="size-4" />
          </ExternalLink>
        ) : null
      }
    />
  );
}

/** Finalized deposits recorded from each vault's own event, newest first: evidence of who funded, not a balance. */
export function VaultFunders({ view, funders, onRetry }: VaultFundersProps) {
  const [showAll, setShowAll] = useState(false);
  if (view === "FundersHidden") return null;
  const deposits = funders?.deposits ?? [];
  return (
    <section aria-label="Funded by" className="flex flex-col gap-3">
      <h3 className="text-lg font-bold text-foreground">Funded by</h3>
      {view === "FundersError" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          Funders unavailable ·
          <Button variant="link" size="sm" aria-label="Retry funders" onClick={onRetry}>
            Retry
          </Button>
        </p>
      ) : view === "NoFunders" ? (
        <p className="text-sm text-muted-foreground">{noFundersText}</p>
      ) : view === "FundersLoading" || funders === undefined ? (
        <Spinner size="sm" label="Loading funders" />
      ) : (
        <>
          <ul className="flex flex-col">
            {(showAll ? deposits : deposits.slice(0, shownRows)).map((deposit) => (
              <FunderRow key={deposit.id} deposit={deposit} />
            ))}
          </ul>
          {deposits.length > shownRows ? (
            <Button variant="secondary" size="sm" className="self-start" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : `Newest ${deposits.length}`}
            </Button>
          ) : null}
          {funders.total > deposits.length ? (
            <p className="text-sm text-muted-foreground">
              {funders.total} deposits recorded. The newest {deposits.length} are listed.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
