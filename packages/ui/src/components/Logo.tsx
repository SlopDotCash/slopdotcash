import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

/** The wordmark's type and the mark's side, by size. */
const sizes = { sm: ["text-base", "size-6"], md: ["text-lg", "size-8"], lg: ["text-xl", "size-10"] } as const;

// The Slop mark keeps its published colors in either theme (design.md): another party's identity is not a role of the palette.
// eslint-disable-next-line design-system/no-literal-colors -- the Slop mark's published orange and ink
const marks = { default: { tile: "#ff5a19", ink: "#0f0e0c" }, inverse: { tile: "#0f0e0c", ink: "#ff5a19" } };

export type LogoProps = Omit<ComponentProps<"span">, "children"> & {
  size?: keyof typeof sizes;
  /** `inverse` swaps the colors, an orange "S" on an ink tile, for an orange surface. */
  variant?: keyof typeof marks;
  /** Shows the domain beside the mark. */
  wordmark?: boolean;
  /** The site's domain, such as slop.cash or slop.tech, chosen by the app: the mark's accessible name, and the wordmark's text. */
  domain?: string;
};

function Wordmark({ domain }: { domain: string }) {
  const dot = domain.indexOf(".");
  if (dot < 0) return domain;
  return (
    <span>
      {domain.slice(0, dot)}
      <span className="text-primary">.</span>
      {domain.slice(dot + 1)}
    </span>
  );
}

/** The Slop mark: an orange tile with an ink "S", alone or with the site's domain as its wordmark. */
export function Logo({ variant = "default", size = "md", wordmark = false, domain = "slop.cash", className, ...props }: LogoProps) {
  const { tile, ink } = marks[variant];
  const [type, side] = sizes[size];
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold text-foreground", type, className)} {...props}>
      <svg viewBox="0 0 64 64" role={wordmark ? undefined : "img"} aria-label={wordmark ? undefined : domain} aria-hidden={wordmark || undefined} className={cn("shrink-0", side)}>
        <rect width="64" height="64" rx="6" fill={tile} />
        <g transform="translate(4.5 4) scale(0.86)">
          <path d="M44 18C40 12 22 11 21 22C20 32 44 31 43 42C42 53 24 53 19 46" fill="none" stroke={ink} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <path fill={ink} d="M16 46h6v9a3 3 0 0 1-6 0ZM25 51h6v7a3 3 0 0 1-6 0ZM34.5 49.5h5v5.5a2.5 2.5 0 0 1-5 0ZM41 18h6v10a3 3 0 0 1-6 0ZM28.9 13.6h5v6.5a2.5 2.5 0 0 1-5 0Z" />
        </g>
      </svg>
      {wordmark && <Wordmark domain={domain} />}
    </span>
  );
}
