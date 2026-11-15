import { type ComponentProps, useId } from "react";
import { Feather } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

const markVariants = cva("shrink-0", {
  variants: { size: { sm: "size-4", md: "size-5", lg: "size-8" } },
  defaultVariants: { size: "md" },
});

export type NetworkMarkProps = Omit<ComponentProps<"span">, "children"> &
  VariantProps<typeof markVariants> & {
    /** The network a project, vault or payment is on. */
    network: "Base" | "Ethereum" | "Robinhood Chain" | "Solana";
    /** Shows the network's name beside its mark; hidden, it stays the accessible name. */
    showName?: boolean;
    /** A state of the network to read with its name, such as "not confirmed". */
    status?: string;
  };

// Each network's published colors: another party's identity, not a role of this palette (design.md).
const brand = {
  // eslint-disable-next-line design-system/no-literal-colors -- Base brand blue
  base: "#0052FF",
  // eslint-disable-next-line design-system/no-literal-colors -- Ethereum brand blue
  ethereum: "#627EEA",
  // eslint-disable-next-line design-system/no-literal-colors -- white glyph of the Ethereum mark
  glyph: "#FFFFFF",
  // eslint-disable-next-line design-system/no-literal-colors -- Solana gradient start
  solanaFrom: "#00FFA3",
  // eslint-disable-next-line design-system/no-literal-colors -- Solana gradient end
  solanaTo: "#DC1FFF",
  // eslint-disable-next-line design-system/no-literal-colors -- Robinhood neon
  robinhood: "#CCFF00",
  // eslint-disable-next-line design-system/no-literal-colors -- black glyph of the Robinhood mark
  ink: "#000000",
};

function Mark({ network, className }: { network: NetworkMarkProps["network"]; className: string }) {
  const gradientId = useId();
  const svg = { "aria-hidden": true, focusable: false, className };
  if (network === "Base")
    return (
      <svg viewBox="0 0 111 111" {...svg}>
        <path d="M54.921 110.034c30.438 0 55.113-24.632 55.113-55.017S85.359 0 54.921 0C26.043 0 2.353 22.171 0 50.392h72.847v9.25H0c2.353 28.22 26.043 50.392 54.921 50.392Z" fill={brand.base} />
      </svg>
    );
  if (network === "Ethereum")
    return (
      <svg viewBox="0 0 32 32" {...svg}>
        <circle cx="16" cy="16" r="16" fill={brand.ethereum} />
        <g fill={brand.glyph}>
          <path fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z" />
          <path d="M16.498 4 9 16.22l7.498-3.35z" />
          <path fillOpacity=".602" d="M16.498 21.968v6.027L24 17.616z" />
          <path d="M16.498 27.995v-6.028L9 17.616z" />
          <path fillOpacity=".2" d="m16.498 20.573 7.497-4.353-7.497-3.348z" />
          <path fillOpacity=".602" d="m9 16.22 7.498 4.353v-7.701z" />
        </g>
      </svg>
    );
  if (network === "Solana")
    return (
      <svg viewBox="0 0 397.7 311.7" {...svg}>
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="360.879" y1="351.455" x2="141.213" y2="-69.294">
            <stop offset="0" stopColor={brand.solanaFrom} />
            <stop offset="1" stopColor={brand.solanaTo} />
          </linearGradient>
        </defs>
        <g fill={`url(#${gradientId})`}>
          <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1z" />
          <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1z" />
          <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1z" />
        </g>
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" {...svg}>
      <circle cx="12" cy="12" r="12" fill={brand.robinhood} />
      <Feather x="5" y="5" width="14" height="14" strokeWidth={2.4} color={brand.ink} />
    </svg>
  );
}

/** A network's mark, named by its network and, when given, its status. */
export function NetworkMark({ network, showName = true, status, size, className, ...props }: NetworkMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      <Mark network={network} className={markVariants({ size })} />
      <span className={showName ? undefined : "sr-only"}>
        {network}
        {status ? <span className="sr-only">, {status}</span> : null}
      </span>
    </span>
  );
}
