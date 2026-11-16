import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type PageHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  /** The view's one heading. */
  title: ReactNode;
  /** A picture beside the title, such as a project's image; decorative, so hidden from assistive technology. */
  icon?: ReactNode;
  /** The view's main controls, at the end of the row. */
  actions?: ReactNode;
};

/** The top of a view: its heading, and the actions that belong to the whole view. */
export function PageHeader({ title, icon, actions, className, ...props }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)} {...props}>
      {icon ? <div aria-hidden className="shrink-0">{icon}</div> : null}
      <h1 className="min-w-0 flex-1 text-2xl font-semibold text-balance text-foreground">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
