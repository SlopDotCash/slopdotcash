// spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Coins } from "lucide-react";
import type { ReactNode } from "react";
import { formatAssetAmount, knownAssetSymbol, type PaymentAsset } from "../../kernels/assetText.ts";

export type PayoutAmountProps = {
  /** The amount in base units, as the record holds it. */
  amount: string;
  /** The asset's decimals. */
  decimals: number;
  /** The asset's symbol, for a reviewed asset. */
  symbol?: string;
  /** The asset's token address, for an asset with no reviewed symbol. */
  token?: string;
  /** The amount before the fee, already formatted with its asset. */
  gross?: string;
  /** The fee taken from `gross`, already formatted with its asset. */
  fee?: string;
};

const exact = "max-w-full overflow-x-auto whitespace-nowrap tabular-nums";

/** @throws {RangeError} */
export function exactAmount(base: string, decimals: number): string {
  return formatBaseUnits({ value: BigInt(base), decimals });
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span role="group" aria-label={label} tabIndex={0} className={exact}>
      {children}
    </span>
  );
}

/** An exact amount of one asset: a symbol for a reviewed asset, a coin mark and the token address for any other. */
export function PayoutAmount({ amount, decimals, symbol, token, gross, fee }: PayoutAmountProps) {
  return (
    <span className="flex min-w-0 flex-col items-end gap-1">
      <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
        <Part label="Exact amount">
          <strong className="font-mono text-lg leading-data font-bold text-foreground">{exactAmount(amount, decimals)}</strong>
        </Part>
        {symbol !== undefined ? (
          <span className="text-ui leading-page font-bold text-muted-foreground">{symbol}</span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1 text-ui leading-page font-bold text-muted-foreground">
            <Coins aria-hidden className="size-4 shrink-0" />
            {token !== undefined ? (
              <span className={exact}>
                <span className="sr-only">Token </span>
                <code>{token}</code>
              </span>
            ) : null}
          </span>
        )}
      </span>
      {gross !== undefined || fee !== undefined ? (
        <span className="flex max-w-full flex-wrap justify-end gap-x-3 text-xs text-muted-foreground">
          {gross !== undefined ? <Part label="Gross amount">Gross {gross}</Part> : null}
          {fee !== undefined ? <Part label="Fee amount">−{fee} fee</Part> : null}
        </span>
      ) : null}
    </span>
  );
}

export type NetPayout = PaymentAsset & { readonly grossBase: string; readonly feeBase: string; readonly netBase: string };

/** The net amount of a payout with its gross award and fee, every one exact. */
export function netAmountProps(payout: NetPayout): PayoutAmountProps {
  return {
    amount: payout.netBase,
    decimals: payout.assetDecimals,
    symbol: knownAssetSymbol(payout),
    token: payout.assetAddress,
    gross: formatAssetAmount(BigInt(payout.grossBase), payout),
    fee: formatAssetAmount(BigInt(payout.feeBase), payout),
  };
}
