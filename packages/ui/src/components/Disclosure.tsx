import type { ComponentProps, ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { cn, focusRing } from "../lib/cn.ts";

export type DisclosureProps = Omit<ComponentProps<typeof Collapsible.Root>, "asChild"> & {
  /** The trigger's text, naming what it holds. */
  summary: string;
  /** What opening it shows. */
  children?: ReactNode;
};

/**
 * Detail a person may open, such as a long history. Never for what must stay visible: a required action,
 * consent, an amount, a restriction or evidence a decision rests on. Pass `open` and `onOpenChange` to control it.
 */
export function Disclosure({ summary, className, children, ...props }: DisclosureProps) {
  return (
    <Collapsible.Root className={cn("flex flex-col gap-2", className)} {...props}>
      <Collapsible.Trigger className={cn(focusRing, "group inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-foreground hover:text-primary")}>
        <ChevronDown aria-hidden className="size-4 -rotate-90 group-data-[state=open]:rotate-0 motion-safe:transition-transform motion-safe:duration-fast" />
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Content className="text-sm text-muted-foreground">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
