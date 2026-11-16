import type { ComponentProps } from "react";
import { cn, focusRing } from "../lib/cn.ts";

export type ExternalLinkProps = Omit<ComponentProps<"a">, "target" | "rel" | "href"> & {
  /** The address on another site. */
  href: string;
  /** The accessible name, where what is shown is an icon or a short handle. */
  label?: string;
};

/** A link to another site, opened in a new tab without handing that site this page. */
export function ExternalLink({ href, label, className, ...props }: ExternalLinkProps) {
  return <a href={href} aria-label={label} target="_blank" rel="noreferrer" className={cn(focusRing, "rounded-sm", className)} {...props} />;
}
