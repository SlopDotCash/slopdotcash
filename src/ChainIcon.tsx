import { Feather } from "lucide-react";
import { useId } from "react";
import type { PaymentChain } from "./lib/payments/contracts";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";

/**
 * A round mark for a reward network. The glyphs are simplified drawings, not
 * the networks' official artwork. A decorative icon is hidden from assistive
 * technology; otherwise it is named by its network and `status`.
 */
export function ChainIcon({
  chain,
  status,
  decorative = false,
}: {
  chain: PaymentChain;
  status?: string;
  decorative?: boolean;
}) {
  const gradient = useId();
  const name = NETWORK_NAMES[chain];
  return (
    <span
      className="chain-icon"
      data-chain={chain}
      data-status={status}
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": status ? `${name}, ${status}` : name,
            title: name,
          })}
    >
      {chain === "ethereum" ? (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M16 5.5 9.5 16.2 16 20l6.5-3.8z" fill="#fff" />
          <path d="m16 21.4-6.5-3.8L16 26.6l6.5-9z" fill="#fff" opacity=".7" />
        </svg>
      ) : chain === "base" ? (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path
            d="M16 26.2A10.2 10.2 0 1 0 5.9 14.6h13.2v2.8H5.9A10.2 10.2 0 0 0 16 26.2z"
            fill="#fff"
          />
        </svg>
      ) : chain === "solana" ? (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={gradient} x1="0" x2="1" y1="1" y2="0">
              <stop offset="0" stopColor="#9945ff" />
              <stop offset="1" stopColor="#19fb9b" />
            </linearGradient>
          </defs>
          <g fill={`url(#${gradient})`}>
            <path d="M8.2 8.8h17.4l-2.9 3.2H5.3z" />
            <path d="M5.3 14.4h17.4l2.9 3.2H8.2z" />
            <path d="M8.2 20h17.4l-2.9 3.2H5.3z" />
          </g>
        </svg>
      ) : (
        <Feather aria-hidden="true" focusable="false" strokeWidth={2.4} />
      )}
    </span>
  );
}
