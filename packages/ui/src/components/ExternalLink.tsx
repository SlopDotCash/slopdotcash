import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../lib/cn.ts";

const newTab = "opens in a new tab";

export type ExternalLinkProps = Omit<ComponentProps<"a">, "target" | "rel" | "children" | "aria-label"> & { href: string } & (
    | {
        /** The link's words, which are its accessible name. */
        children: string;
        /** A fuller accessible name than the words show. */
        label?: string;
      }
    | {
        /** What the link shows when words alone do not name it, such as an icon or a short handle. */
        children: ReactNode;
        /** The accessible name, required when the link does not show its name in words. */
        label: string;
      }
  );

/** A link to another site, opened in a new tab without passing this page as the referrer; assistive technology hears that it opens a new tab. */
// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
export function ExternalLink({ href, label, className, children, ...props }: ExternalLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label === undefined ? undefined : `${label}, ${newTab}`}
      className={cn(focusRing, "rounded-sm text-primary underline-offset-4 hover:underline", className)}
      {...props}
    >
      {children}
      {label === undefined ? <span className="sr-only">, {newTab}</span> : null}
    </a>
  );
}
