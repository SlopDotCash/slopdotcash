import type { ComponentProps } from "react";
import type { TickerView } from "../../gen/frontend__presentation.ts";
import { cn } from "../lib/cn.ts";
import { exactValue, wrappedValue } from "../lib/exact.ts";

export type TokenAmountProps = Omit<ComponentProps<"div">, "children"> & {
  /** The exact amount, already formatted by its owner; shown as given. */
  value: string;
  /** The asset's symbol, for an asset whose ticker no registry classifies. */
  symbol?: string;
  /** The asset's ticker as `displayTicker` shows it: one dollar prefix for a project token, none for a native coin or an approved stablecoin. Never a dollar valuation; an unavailable ticker shows `token` instead. */
  ticker?: TickerView;
  /** The asset's token address, shown in place of a symbol the asset does not have. */
  token?: string;
  /** The amount before the fee, already formatted. */
  gross?: string;
  /** The fee taken from `gross`, already formatted. */
  fee?: string;
  /** The accessible name of the scrolling amount. */
  label?: string;
  /** The words before `gross` and `fee`. */
  partLabels?: { gross: string; fee: string };
};

const tickerText = ({ available, prefixDollars, body }: TickerView) => (available ? "$".repeat(prefixDollars) + body.join("") : undefined);

/** An exact amount of one asset, whole and selectable, with the gross and fee it came from when they matter. */
// spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
export function TokenAmount({ value, symbol, ticker, token, gross, fee, label = "Exact amount", partLabels = { gross: "Gross", fee: "Fee" }, className, ...props }: TokenAmountProps) {
  const parts = [[partLabels.gross, gross], [partLabels.fee, fee]].filter((part): part is [string, string] => part[1] !== undefined);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
      <div role="group" aria-label={label} tabIndex={0} className={exactValue}>
        {value} <span className="text-muted-foreground">{ticker ? (tickerText(ticker) ?? token) : (symbol ?? token)}</span>
      </div>
      {parts.length ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {parts.map(([name, amount]) => (
            <div key={name} className="flex gap-1">
              <dt>{name}</dt>
              <dd className={wrappedValue}>{amount}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
