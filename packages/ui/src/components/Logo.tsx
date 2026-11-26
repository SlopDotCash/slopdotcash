import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

/** The wordmark's type, the mark's side and the wordmark's own rule, by size: `header` is development's header wordmark, its name read aloud but hidden under `sm`. */
const sizes = {
  sm: ["gap-2 text-base font-semibold", "size-6", ""],
  md: ["gap-2 text-lg font-semibold", "size-8", ""],
  lg: ["gap-2 text-xl font-semibold", "size-10", ""],
  xl: ["gap-2 text-2xl font-semibold", "size-26", ""],
  header: ["gap-3 text-wordmark font-extrabold whitespace-nowrap max-md:text-wordmark-sm", "size-9", "max-sm:sr-only"],
} as const;

// eslint-disable-next-line design-system/no-literal-colors -- the Slop mark's published orange and ink
const marks = { default: { tile: "#ff5a19", ink: "#0f0e0c" }, inverse: { tile: "#0f0e0c", ink: "#ff5a19" } };

export type LogoProps = Omit<ComponentProps<"span">, "children"> & {
  size?: keyof typeof sizes;
  /** `inverse` swaps the colors, an orange "S" on an ink tile, for an orange surface. */
  variant?: keyof typeof marks;
  /** Shows the name beside the mark. */
  wordmark?: boolean;
  /** The name the mark stands for: its accessible name, and the wordmark's text, whose first dot is the accent's, as in "slop.cash". */
  label?: string;
};

/** The Slop mark: an orange tile with an ink "S", alone or with its wordmark. */
export function Logo({ variant = "default", size = "md", wordmark = false, label = "Slop", className, ...props }: LogoProps) {
  const { tile, ink } = marks[variant];
  const [type, side, name] = sizes[size];
  const dot = label.indexOf(".");
  return (
    <span className={cn("inline-flex shrink-0 items-center text-foreground", type, className)} {...props}>
      <svg viewBox="0 0 64 64" role={wordmark ? undefined : "img"} aria-label={wordmark ? undefined : label} aria-hidden={wordmark || undefined} className={cn("shrink-0", side)}>
        <rect width="64" height="64" rx="6" fill={tile} />
        <g transform="translate(4.5 4) scale(0.86)">
          <path d="M44 18C40 12 22 11 21 22C20 32 44 31 43 42C42 53 24 53 19 46" fill="none" stroke={ink} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <path fill={ink} d="M16 46h6v9a3 3 0 0 1-6 0ZM25 51h6v7a3 3 0 0 1-6 0ZM34.5 49.5h5v5.5a2.5 2.5 0 0 1-5 0ZM41 18h6v10a3 3 0 0 1-6 0ZM28.9 13.6h5v6.5a2.5 2.5 0 0 1-5 0Z" />
        </g>
      </svg>
      {wordmark && <span className={name}>{dot < 0 ? label : <>{label.slice(0, dot)}<span className="text-primary">.</span>{label.slice(dot + 1)}</>}</span>}
    </span>
  );
}
