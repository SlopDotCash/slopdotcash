// spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { TokenAmount } from "@repo/ui";
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
  /** The words before the fee. */
  feeLabel?: string;
};

/** @throws {RangeError} */
export function exactAmount(base: string, decimals: number): string {
  return formatBaseUnits({ value: BigInt(base), decimals });
}

/** An exact amount of one asset: a symbol for a reviewed asset, the token address for any other. */
export function PayoutAmount({ amount, decimals, symbol, token, gross, fee, feeLabel = "Fee" }: PayoutAmountProps) {
  return <TokenAmount value={exactAmount(amount, decimals)} symbol={symbol} token={symbol === undefined ? token : undefined} gross={gross} fee={fee} partLabels={{ gross: "Gross", fee: feeLabel }} />;
}

export type NetPayout = PaymentAsset & { readonly grossBase: string; readonly feeBase: string; readonly netBase: string };

/** The net amount of a payout with its gross award and fee, every one exact. */
export function netAmountProps(payout: NetPayout, feeLabel?: string): PayoutAmountProps {
  return {
    amount: payout.netBase,
    decimals: payout.assetDecimals,
    symbol: knownAssetSymbol(payout),
    token: payout.assetAddress,
    gross: formatAssetAmount(BigInt(payout.grossBase), payout),
    fee: formatAssetAmount(BigInt(payout.feeBase), payout),
    feeLabel,
  };
}
