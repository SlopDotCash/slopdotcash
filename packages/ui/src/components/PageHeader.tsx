import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type PageHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  /** The view's one heading. */
  title: ReactNode;
  /** A picture beside the title, such as a project's image; decorative, so hidden from assistive technology. */
  icon?: ReactNode;
  /** The view's main controls, at the end of the row. */
  actions?: ReactNode;
  /** A short line above the heading, such as where the view sits. */
  eyebrow?: ReactNode;
  /** One paragraph under the heading, such as a project's description or a cycle's dates. */
  lead?: ReactNode;
  /** More under the lead, such as a status badge. */
  children?: ReactNode;
};

const iconFrame = cn(
  "shrink-0",
  "has-[>svg]:inline-flex has-[>svg]:size-10 has-[>svg]:items-center has-[>svg]:justify-center has-[>svg]:rounded-chip has-[>svg]:bg-primary/10 has-[>svg]:text-primary-hover",
  "[&>svg]:size-5.5 [&>svg]:text-primary-hover max-md:has-[>svg]:size-8 max-md:[&>svg]:size-4.5",
);

/** The classes of a section's `h2` under a `PageHeader`: development's display type, uppercase and heavy, one size for every section. */
export const sectionTitle = "text-2xl leading-none font-extrabold tracking-tighter text-foreground uppercase md:text-3xl";

/** The top of a view: its heading with what frames it, and the actions that belong to the whole view. */
export function PageHeader({ title, icon, actions, eyebrow, lead, children, className, ...props }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-8 gap-y-4", className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col">
        {eyebrow ? <div className="mb-3 text-sm text-muted-foreground">{eyebrow}</div> : null}
        <div className="flex items-center gap-3 max-md:items-start max-md:gap-2.5">
          {icon ? <div aria-hidden className={iconFrame}>{icon}</div> : null}
          <h1 className="min-w-0 flex-1 text-heading leading-heading font-extrabold tracking-display text-foreground uppercase lg:text-4xl xl:text-5xl">{title}</h1>
        </div>
        {lead ? <p className="mt-3.5 max-w-[68ch] leading-body text-muted-foreground">{lead}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
