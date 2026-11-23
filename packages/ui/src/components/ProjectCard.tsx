import { type ReactElement, type ReactNode, isValidElement, useState } from "react";
import { Slottable } from "@radix-ui/react-slot";
import { ArrowRight } from "lucide-react";
import { cn, focusRing } from "../lib/cn.ts";
import { Card, CardTitle } from "./Card.tsx";

export type ProjectCardProps = {
  /** The link to the project, without children: an `<a href>` or a router's link. The whole card becomes it; without one, as in a preview, it is no link. */
  children?: ReactElement;
  /** The project's name. */
  name: string;
  /**
   * The project's image: its custom image, else its GitHub owner's avatar, as the owner decided it. An image that
   * fails to load gives way to the name's first letter.
   * spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews".
   */
  image?: string;
  /** A mark at the start of the name, such as the security bounty's shield, read and wrapped with it. */
  icon?: ReactNode;
  /** Defers loading the image until the card nears the screen, for cards below the fold. */
  lazy?: boolean;
  description?: string;
  /** The amount line, already formatted, such as the month's pool. */
  amount?: string;
  /** What the amount is counted in or per, shown quieter after it, such as "/mo". */
  unit?: string;
  /** Tags after the amount, such as a status chip. */
  tags?: ReactNode;
  /** Small lines under the amount, such as the review budget or the maintainer's share. */
  lines?: ReactNode;
  /** One short line after the amount. */
  note?: string;
  className?: string;
};

const avatar = "size-14 shrink-0 rounded-avatar bg-popover";

/** A project in a list, as one link to its page: its picture and name, what it is, and what it pays. */
export function ProjectCard({ children, name, image, icon, lazy = false, description, amount, unit, tags, lines, note, className }: ProjectCardProps) {
  const link = isValidElement(children);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Card
      asChild={link}
      className={cn(
        "group grid min-h-47.5 min-w-0 grid-rows-[auto_1fr] gap-7 rounded-xl border-transparent p-8 max-md:min-h-0 max-md:p-6",
        link && [focusRing, "hover:border-primary motion-safe:transition-colors motion-safe:duration-base"],
        className,
      )}
    >
      {link ? <Slottable>{children}</Slottable> : null}
      <div className="flex items-center gap-4">
        {image && failed !== image ? (
          <img src={image} alt="" aria-hidden width={56} height={56} decoding="async" loading={lazy ? "lazy" : undefined} onError={() => setFailed(image)} className={cn(avatar, "object-cover")} />
        ) : (
          <span aria-hidden className={cn(avatar, "grid place-items-center text-2xl font-extrabold")}>{name.slice(0, 1)}</span>
        )}
        <CardTitle className="min-w-0 flex-1 text-2xl leading-none font-extrabold tracking-tight break-words uppercase lg:text-3xl [&_svg]:inline-block [&_svg]:align-baseline [&_svg]:text-primary-hover">
          {icon ? <>{icon}{" "}</> : null}
          {name}
        </CardTitle>
        {link ? <ArrowRight aria-hidden className="size-6 shrink-0 text-muted-foreground group-hover:text-primary" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {description ? <p className="max-w-165 text-base leading-summary text-muted-foreground max-md:text-copy lg:text-xl">{description}</p> : null}
        {amount || tags ? (
          <p className="mt-auto flex flex-wrap items-baseline gap-2">
            {amount ? <strong className="font-sans text-3xl font-extrabold tracking-tight lg:text-4xl">{amount}</strong> : null}
            {unit ? <span className="text-copy font-bold text-muted-foreground">{unit}</span> : null}
            {tags}
          </p>
        ) : null}
        {lines ? <div className="mt-1.75 flex flex-col gap-5.75 text-sm text-primary-hover">{lines}</div> : null}
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
    </Card>
  );
}
