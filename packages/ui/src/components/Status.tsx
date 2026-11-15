import type { ComponentProps } from "react";
import { Ban, Check, CircleAlert, CircleSlash, Clock, Dot, Eye, LoaderCircle, Lock, type LucideIcon, Pause, RefreshCw, Send, Wallet } from "lucide-react";
import type { Icon, Presentation } from "../../gen/ui__status.ts";
import { cn } from "../lib/cn.ts";
import { tones } from "../lib/tone.ts";

// spec/ui/status.md, "A presentation is a tone, an icon and a word"
const icons: Record<Icon, LucideIcon> = {
  Check,
  Clock,
  Wallet,
  Send,
  Pause,
  Alert: CircleAlert,
  Ban,
  Spinner: LoaderCircle,
  Lock,
  Eye,
  Dot,
  Slash: CircleSlash,
  Refresh: RefreshCw,
};

export type StatusIconProps = Omit<ComponentProps<"svg">, "children"> & { icon: Icon };

/** The one glyph of each icon of a presentation. Decorative unless named by `aria-label`: the word beside it says what it means. */
export function StatusIcon({ icon, className, ...props }: StatusIconProps) {
  const Glyph = icons[icon];
  return <Glyph aria-hidden={props["aria-label"] ? undefined : true} className={cn("size-4 shrink-0", icon === "Spinner" && "motion-safe:animate-spin", className)} {...props} />;
}

export type StatusProps = Omit<ComponentProps<"span">, "children"> & {
  /** The state as its owning spec presents it: `paymentPresentation(…)`, `readPresentation(…)` and the others of `gen/ui__status.ts`. */
  presentation: Presentation;
};

/**
 * A state as an icon and a word in its tone's color; the word is its accessible name.
 * @model spec/ui/status.md
 * @design design.md#design-system
 */
// spec/ui/status.md, "A presentation is a tone, an icon and a word"
export function Status({ presentation: { tone, icon, label }, className, ...props }: StatusProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", tones[tone].text, className)} {...props}>
      <StatusIcon icon={icon} />
      {label}
    </span>
  );
}
