import {
  Check,
  Clock,
  Coins,
  ExternalLink,
  type LucideIcon,
  Send,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { ChainIcon } from "./ChainIcon";
import { networkLabel } from "./lib/network-names";
import {
  type AccountMonthlyAward,
  type AccountPayment,
  formatAssetAmount,
  formatBaseUnits,
  knownAssetSymbol,
  type PaymentChain,
} from "./lib/payments/contracts";
import { StatusBadge } from "./Presentation";

type PayoutTone = "success" | "warning" | "danger" | "neutral";

type PayoutStatus = {
  label: string;
  /** The full wording when the short label needs it. */
  title?: string;
  tone: PayoutTone;
  icon: LucideIcon;
};

/** PRD section 6 payment states of a reserved award. */
export const PAYMENT_STATUS: Record<
  AccountPayment["deliveryState"],
  PayoutStatus
> = {
  paid: { label: "Paid", tone: "success", icon: Check },
  needs_wallet: { label: "Awaiting wallet", tone: "warning", icon: Wallet },
  ready: {
    label: "Queued",
    title: "Payment queued",
    tone: "neutral",
    icon: Clock,
  },
  submitted: { label: "Submitted", tone: "neutral", icon: Send },
  held: { label: "Held", tone: "danger", icon: TriangleAlert },
};

/** An approved award that is not yet reserved in its vault. */
export const AWARD_STATUS: Record<AccountMonthlyAward["state"], PayoutStatus> =
  {
    underfunded: {
      label: "Underfunded",
      title: "Approved, underfunded",
      tone: "warning",
      icon: Wallet,
    },
    conflict: {
      label: "Conflict",
      title: "Approved, conflict: cannot be reserved",
      tone: "danger",
      icon: TriangleAlert,
    },
    "awaiting-reservation": {
      label: "Approved",
      title: "Approved, awaiting reservation",
      tone: "neutral",
      icon: Clock,
    },
  };

/** One payout on one line: network, amount, colored status and a transaction link. */
export function PayoutRow({
  chain,
  network,
  projectId,
  amount,
  note,
  status,
  statusTitle = status.title,
  transactionUrl,
  transactionLabel,
  children,
}: {
  chain: PaymentChain;
  network: string;
  projectId: string;
  amount: ReactNode;
  /** Muted context beside the amount, such as the award month. */
  note?: string;
  status: PayoutStatus;
  statusTitle?: string;
  transactionUrl: string | null;
  transactionLabel: string;
  /** Actions for this payout, shown below the line. */
  children?: ReactNode;
}) {
  return (
    <li className="payout-row">
      <span className="payout-network">
        <ChainIcon chain={chain} decorative />
      </span>
      <span className="payout-main">
        {amount}
        <small>
          <a href={`/projects/${encodeURIComponent(projectId)}`}>{projectId}</a>{" "}
          · {networkLabel(network)}
          {note ? ` · ${note}` : ""}
        </small>
      </span>
      <StatusBadge
        className="payout-pill"
        tone={status.tone}
        title={statusTitle}
        icon={<status.icon aria-hidden="true" size={14} />}
      >
        {status.label}
      </StatusBadge>
      {transactionUrl ? (
        <a
          className="payout-tx"
          href={transactionUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={transactionLabel}
          title={transactionLabel}
        >
          <ExternalLink aria-hidden="true" size={16} />
        </a>
      ) : (
        <span className="payout-tx" aria-hidden="true" />
      )}
      {children}
    </li>
  );
}

/** An amount with its asset: a symbol for a reviewed asset, a coin mark for any other token. */
export function PayoutAmount({
  base,
  decimals,
  symbol,
  address,
  title,
}: {
  base: string;
  decimals: number;
  symbol: string | null;
  address?: string;
  title?: string;
}) {
  return (
    <span className="payout-value" title={title}>
      <span
        className="payout-exact"
        role="region"
        aria-label="Exact amount"
        tabIndex={0}
      >
        <strong>{formatBaseUnits(base, decimals)}</strong>
      </span>
      {symbol ? (
        <span className="payout-unit">{symbol}</span>
      ) : (
        <span className="payout-unit payout-token">
          <Coins aria-hidden="true" size={16} />
          <span>
            Token <code>{address}</code>
          </span>
        </span>
      )}
    </span>
  );
}

/** The net amount of a payout, with its gross award and fee visible on every input device. */
export function NetAmount({
  payout,
}: {
  payout: Pick<
    AccountPayment,
    | "network"
    | "assetAddress"
    | "assetDecimals"
    | "grossBase"
    | "feeBase"
    | "netBase"
  >;
}) {
  return (
    <span className="payout-amount">
      <PayoutAmount
        base={payout.netBase}
        decimals={payout.assetDecimals}
        symbol={knownAssetSymbol(
          payout.network,
          payout.assetAddress,
          payout.assetDecimals,
        )}
        address={payout.assetAddress}
      />
      <small>
        <span
          className="payout-exact"
          role="region"
          aria-label="Gross amount"
          tabIndex={0}
        >
          Gross {formatAssetAmount(payout.grossBase, payout)}
        </span>
        <span
          className="payout-exact"
          role="region"
          aria-label="Fee amount"
          tabIndex={0}
        >
          fee {formatAssetAmount(payout.feeBase, payout)}
        </span>
      </small>
    </span>
  );
}

export const RECEIVED_STATUS: PayoutStatus = {
  label: "Received",
  tone: "success",
  icon: Check,
};
