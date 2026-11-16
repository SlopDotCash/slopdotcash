import { type ReactElement, isValidElement } from "react";
import { Slottable } from "@radix-ui/react-slot";
import { cn, focusRing } from "../lib/cn.ts";
import { Card, CardTitle } from "./Card.tsx";

export type ProjectCardProps = {
  /** The link to the project, without children: an `<a href>` or a router's link. The whole card becomes it; without one, as in a preview, it is no link. */
  children?: ReactElement;
  /** The project's name. */
  name: string;
  /**
   * The project's image: its custom image, else its GitHub owner's avatar, as the owner decided it.
   * spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews".
   */
  image?: string;
  description?: string;
  /** The amount line, already formatted, such as the month's pool. */
  amount?: string;
  /** One short line after the amount. */
  note?: string;
  className?: string;
};

/** A project in a list, as one link to its page. */
export function ProjectCard({ children, name, image, description, amount, note, className }: ProjectCardProps) {
  const link = isValidElement(children);
  return (
    <Card asChild={link} className={cn("gap-3", link && [focusRing, "hover:bg-accent motion-safe:transition-colors motion-safe:duration-fast"], className)}>
      {link ? <Slottable>{children}</Slottable> : null}
      <div className="flex items-center gap-3">
        {image ? <img src={image} alt="" className="size-10 shrink-0 rounded-md bg-muted" /> : null}
        <CardTitle className="min-w-0 break-words">{name}</CardTitle>
      </div>
      {description ? <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p> : null}
      {amount ? <p className="font-mono text-lg font-medium tabular-nums">{amount}</p> : null}
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </Card>
  );
}
