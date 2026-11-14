import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type ListItemProps = Omit<ComponentProps<"li">, "title" | "children"> & {
  /** What the row is about, such as a payout, a payment, a message or a project. */
  title: ReactNode;
  /** A mark before the title, such as an `Avatar` or a `NetworkMark`. */
  leading?: ReactNode;
  /** One line of facts under the title. */
  meta?: ReactNode;
  /** A value at the row's end, such as a `TokenAmount` or a status. */
  trailing?: ReactNode;
  /** Controls for the row, after `trailing`. */
  actions?: ReactNode;
  /** Marks a row the person has not read yet, in weight and in words. */
  unread?: boolean;
  /** The word that says the row is unread. */
  unreadLabel?: string;
};

/** One row of a list: payouts, payment records, Inbox items and projects. Place it in a `ul` or `ol`. */
export function ListItem({ title, leading, meta, trailing, actions, unread = false, unreadLabel = "Unread", className, ...props }: ListItemProps) {
  return (
    <li className={cn("flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-0", className)} {...props}>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className={cn("flex min-w-0 items-center gap-2", unread ? "font-semibold text-foreground" : "font-medium")}>
          {unread ? (
            <span className="size-2 shrink-0 rounded-full bg-info">
              <span className="sr-only">{unreadLabel}</span>
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </div>
        {meta ? <div className="truncate text-sm text-muted-foreground">{meta}</div> : null}
      </div>
      {trailing ? <div className="shrink-0 text-right">{trailing}</div> : null}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </li>
  );
}
