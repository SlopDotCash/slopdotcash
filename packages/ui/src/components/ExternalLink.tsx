import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../lib/cn.ts";

export type ExternalLinkProps = Omit<ComponentProps<"a">, "target" | "rel" | "href" | "children"> & {
  /** The address on another site. */
  href: string;
  /** What the link shows: its name, unless `label` gives one. */
  children: ReactNode;
  /** The accessible name, where what is shown is an icon or a short handle. */
  label?: string;
};

/** A link to another site, opened in a new tab without handing that site this page. */
export function ExternalLink({ href, label, className, ...props }: ExternalLinkProps) {
  return <a href={href} aria-label={label} target="_blank" rel="noreferrer" className={cn(focusRing, "rounded-sm", className)} {...props} />;
}
