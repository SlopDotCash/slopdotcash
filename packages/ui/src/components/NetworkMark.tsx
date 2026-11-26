import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

const markVariants = cva("shrink-0", {
  variants: { size: { sm: "size-4", md: "size-5", lg: "size-8" } },
  defaultVariants: { size: "md" },
});

const families = {
  Base: "Base",
  "Base Sepolia": "Base",
  Ethereum: "Ethereum",
  "Ethereum Sepolia": "Ethereum",
  "Robinhood Chain": "Robinhood Chain",
  "Robinhood Chain Testnet": "Robinhood Chain",
  Solana: "Solana",
} as const;

export type NetworkMarkProps = Omit<ComponentProps<"span">, "children"> &
  VariantProps<typeof markVariants> & {
    /** The network a project, vault or payment is on; a test network wears its main network's mark beside its own name. */
    network: keyof typeof families;
    /** Shows the network's name beside its mark; hidden, it stays the accessible name. */
    showName?: boolean;
    /** Hides the mark and its name from assistive technology, for when the network is already named beside it. */
    decorative?: boolean;
  };

const brand = {
  // eslint-disable-next-line design-system/no-literal-colors -- Base "The Square" blue
  base: "#0000ff",
  // eslint-disable-next-line design-system/no-literal-colors -- Ethereum mark, light face
  ethereumLight: "#8c92b5",
  // eslint-disable-next-line design-system/no-literal-colors -- Ethereum mark, dark face
  ethereumDark: "#62688f",
  // eslint-disable-next-line design-system/no-literal-colors -- Robinhood Chain neon
  robinhood: "#ccff00",
  // eslint-disable-next-line design-system/no-literal-colors -- Solana green bar
  solanaGreen: "#14f195",
  // eslint-disable-next-line design-system/no-literal-colors -- Solana middle bar
  solanaMiddle: "#8e7af0",
  // eslint-disable-next-line design-system/no-literal-colors -- Solana purple bar
  solanaPurple: "#9945ff",
};

function Mark({ network, className }: { network: (typeof families)[NetworkMarkProps["network"]]; className: string }) {
  const svg = { "aria-hidden": true, focusable: false, className };
  if (network === "Base")
    return (
      <svg viewBox="0 0 1280 1280" {...svg}>
        <path fill={brand.base} d="M0,101.12c0-34.64,0-51.95,6.53-65.28,6.25-12.76,16.56-23.07,29.32-29.32C49.17,0,66.48,0,101.12,0h1077.76c34.63,0,51.96,0,65.28,6.53,12.75,6.25,23.06,16.56,29.32,29.32,6.52,13.32,6.52,30.64,6.52,65.28v1077.76c0,34.63,0,51.96-6.52,65.28-6.26,12.75-16.57,23.06-29.32,29.32-13.32,6.52-30.65,6.52-65.28,6.52H101.12c-34.64,0-51.95,0-65.28-6.52-12.76-6.26-23.07-16.57-29.32-29.32-6.53-13.32-6.53-30.65-6.53-65.28V101.12Z" />
      </svg>
    );
  if (network === "Ethereum")
    return (
      <svg viewBox="0 0 32 32" {...svg}>
        <path d="M16 2 7 17l9 5.3L25 17z" fill={brand.ethereumLight} />
        <path d="m16 24-9-5.3L16 31l9-12.3z" fill={brand.ethereumDark} />
        <path d="M16 2v20.3L25 17z" fill={brand.ethereumDark} />
      </svg>
    );
  if (network === "Solana")
    return (
      <svg viewBox="0 0 24 24" {...svg}>
        <path fill={brand.solanaGreen} d="M5 3h18l-4 4H1z" />
        <path fill={brand.solanaMiddle} d="M1 10h18l4 4H5z" />
        <path fill={brand.solanaPurple} d="M5 17h18l-4 4H1z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 42" {...svg}>
      <path fill={brand.robinhood} d="M0.237711 42H1.14916C1.31483 42 1.48056 41.9157 1.53587 41.7753C8.41284 23.9672 15.8974 15.1474 20.5926 9.86673C20.786 9.64201 20.7031 9.47355 20.4269 9.47355H12.0309C11.727 9.47355 11.4702 9.59707 11.2576 9.86673L5.23667 17.4507C4.3529 18.5742 4.13199 19.6134 4.13199 21.1021V28.8546C2.17104 34.4442 0.92819 38.2362 0.0168015 41.663C-0.038442 41.882 0.0444232 42 0.237711 42ZM30.5353 1.13119C29.2372 -0.273195 23.3821 -0.329391 20.6754 0.738011C20.1121 0.959852 19.5707 1.33622 19.3221 1.5525C16.8364 3.71537 15.1794 5.4288 13.6051 7.11409C13.4117 7.31068 13.4947 7.50727 13.7709 7.50727H23.0783C23.9345 7.50727 24.4316 8.01291 24.4316 8.88359V19.5573C24.4316 19.8382 24.6525 19.9225 24.8183 19.6696L30.4248 12.2261C31.3362 11.0183 31.6124 10.6532 31.8609 8.96792C32.1924 6.49613 31.999 2.70423 30.5353 1.13119ZM18.5212 29.4445L22.3601 23.0121C22.4431 22.8437 22.4706 22.647 22.4706 22.5066V11.7767C22.4706 11.4958 22.2773 11.3836 22.0841 11.6082C16.3118 18.1529 11.8099 25.0346 7.6395 33.3207C7.53455 33.5285 7.66712 33.7139 7.91572 33.6297L16.5327 30.9332C17.5048 30.6298 18.0517 30.231 18.5212 29.4445Z" />
    </svg>
  );
}

/** A network's mark, named by its network. Show a network's state with a `Status` beside it. */
export function NetworkMark({ network, showName = true, decorative = false, size, className, ...props }: NetworkMarkProps) {
  return (
    <span aria-hidden={decorative || undefined} className={cn("inline-flex items-center gap-2", className)} {...props}>
      <Mark network={families[network]} className={markVariants({ size })} />
      {decorative && !showName ? null : <span className={showName ? undefined : "sr-only"}>{network}</span>}
    </span>
  );
}
