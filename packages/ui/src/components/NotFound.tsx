import type { ReactNode } from "react";
import { ArrowRight, CircleAlert } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { Button } from "./Button.tsx";
import { PageHeader } from "./PageHeader.tsx";

export type NotFoundProps = {
  /** What was not found. */
  title?: string;
  /** Why, or where else to look. */
  children?: ReactNode;
  /** `section` where the route already provides its own `main`. */
  as?: "main" | "section";
  /** Where the way back leads, and what it says. */
  home?: { href: string; label: string };
  className?: string;
};

/** Stands where an address names no page or nothing the product lists, with the way back to the projects. */
export function NotFound({ title = "Page not found", children, as: Element = "main", home = { href: "/", label: "See open projects" }, className }: NotFoundProps) {
  return (
    <Element className={cn("flex flex-col items-start gap-4", className)}>
      <PageHeader title={title} icon={<CircleAlert className="size-6 text-muted-foreground" />} />
      {children}
      <Button asChild>
        <a href={home.href}>
          {home.label}
          <ArrowRight aria-hidden className="size-4" />
        </a>
      </Button>
    </Element>
  );
}
